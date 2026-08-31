import * as admin from 'firebase-admin';

export interface PublicPreparingTicket {
  token: string;
  estimatedMinutes: number | null;
}

export interface PublicReadyTicket {
  token: string;
}

export interface PublicLiveQueueDocument {
  preparing: PublicPreparingTicket[];
  ready: PublicReadyTicket[];
  activeCount: number;
  updatedAt: admin.firestore.Timestamp;
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
    createdAt?: admin.firestore.Timestamp | Date;
  }>
): PublicLiveQueueDocument {
  const preparing: PublicPreparingTicket[] = [];
  const ready: PublicReadyTicket[] = [];

  for (const o of orders) {
    const token = (o.tokenNumber || '').trim();
    if (!token) continue;

    const status = (o.status || '').toLowerCase();

    if (status === 'ready') {
      ready.push({ token });
    } else if (['preparing', 'confirmed', 'placed'].includes(status)) {
      preparing.push({
        token,
        estimatedMinutes: typeof o.estimatedMinutes === 'number' && o.estimatedMinutes > 0
          ? o.estimatedMinutes
          : null,
      });
    }
  }

  return {
    preparing,
    ready,
    activeCount: preparing.length + ready.length,
    updatedAt: admin.firestore.Timestamp.now(),
  };
}

/**
 * Updates the single authoritative public projection document: publicLiveQueue/current.
 * This is executed strictly by trusted backend Cloud Functions upon order state changes.
 */
export async function updatePublicLiveQueueProjection(db: admin.firestore.Firestore): Promise<void> {
  try {
    const activeOrdersSnap = await db
      .collection('orders')
      .where('status', 'in', ['placed', 'confirmed', 'preparing', 'ready'])
      .get();

    const ordersData = activeOrdersSnap.docs.map((doc) => doc.data());
    const payload = buildPublicQueuePayload(ordersData);

    await db.collection('publicLiveQueue').doc('current').set(payload);
  } catch (error) {
    console.error('Failed to update public live queue projection:', error);
  }
}
