import { Timestamp } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';

export interface PublicConfirmedTicket {
  token: string;
}

export interface PublicPreparingTicket {
  token: string;
  estimatedMinutes: number | null;
}

export interface PublicReadyTicket {
  token: string;
}

export interface PublicLiveQueueDocument {
  confirmedTokens: string[];
  readyTokens: string[];
  preparingTokens: string[];
  confirmed: PublicConfirmedTicket[];
  preparing: PublicPreparingTicket[];
  ready: PublicReadyTicket[];
  activeCount: number;
  updatedAt: Timestamp;
}

/**
 * Pure projection builder that sanitizes raw order documents into a single public display payload.
 * Invariant: Strips 100% of PII, student identifiers, roll numbers, phone numbers,
 * item details, payment amounts, and internal priority levels (preventing public friction).
 */
export function buildPublicQueuePayload(
  orders: Array<{
    tokenNumber?: string;
    status?: string;
    estimatedMinutes?: number | null;
    createdAt?: Timestamp | Date;
    isOnlyReadyMade?: boolean;
  }>
): PublicLiveQueueDocument {
  const confirmed: PublicConfirmedTicket[] = [];
  const preparing: PublicPreparingTicket[] = [];
  const ready: PublicReadyTicket[] = [];
  const confirmedTokens: string[] = [];
  const readyTokens: string[] = [];
  const preparingTokens: string[] = [];

  // Chronological FIFO sorting: display tickets in order of creation
  const getTimeMs = (raw: Timestamp | Date | undefined): number => {
    if (!raw) return 0;
    if (raw instanceof Date) return raw.getTime();
    if (typeof (raw as any).toMillis === 'function') return (raw as any).toMillis();
    return 0;
  };

  const sortedOrders = [...orders].sort((a, b) => getTimeMs(a.createdAt) - getTimeMs(b.createdAt));

  for (const o of sortedOrders) {
    const token = (o.tokenNumber || '').trim();
    if (!token) continue;

    const status = (o.status || '').toLowerCase();
    const isOnlyReadyMade = o.isOnlyReadyMade === true;

    // Pure ready-made orders bypass cooking and appear directly in Ready for Pickup on TV
    if (status === 'ready' || (isOnlyReadyMade && ['confirmed', 'placed', 'preparing'].includes(status))) {
      ready.push({ token });
      readyTokens.push(token);
    } else if (status === 'preparing') {
      preparing.push({
        token,
        estimatedMinutes: typeof o.estimatedMinutes === 'number' && o.estimatedMinutes > 0
          ? o.estimatedMinutes
          : null,
      });
      preparingTokens.push(token);
    } else if (['confirmed', 'placed'].includes(status)) {
      confirmed.push({ token });
      confirmedTokens.push(token);
    }
  }

  return {
    confirmedTokens,
    readyTokens,
    preparingTokens,
    confirmed,
    preparing,
    ready,
    activeCount: readyTokens.length + preparingTokens.length + confirmedTokens.length,
    updatedAt: Timestamp.now(),
  };
}

/**
 * Computes midnight IST (Asia/Kolkata) as a Firestore Timestamp
 */
function getTodayStartTimestamp(): Timestamp {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const istStart = new Date(`${dateStr}T00:00:00+05:30`);
  return Timestamp.fromDate(istStart);
}

/**
 * Updates the single authoritative public projection document: publicLiveQueue/current.
 * This is executed strictly by trusted backend Cloud Functions upon order state changes.
 */
export async function updatePublicLiveQueueProjection(db: admin.firestore.Firestore): Promise<void> {
  try {
    const startOfDay = getTodayStartTimestamp();
    const activeOrdersSnap = await db
      .collection('orders')
      .where('status', 'in', ['placed', 'confirmed', 'preparing', 'ready'])
      .where('createdAt', '>=', startOfDay)
      .get();

    const ordersData = activeOrdersSnap.docs.map((doc) => doc.data());
    const payload = buildPublicQueuePayload(ordersData);

    await db.collection('publicLiveQueue').doc('current').set(payload);
  } catch (error) {
    console.error('Failed to update public live queue projection:', error);
  }
}
