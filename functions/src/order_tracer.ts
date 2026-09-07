import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { enforceAppCheck } from './app_check';
import { assertCapability } from './authorization_policy';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export type OrderLifecycleStage =
  | 'ORDER_CREATED'
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_CAPTURED'
  | 'WEBHOOK_RECEIVED'
  | 'ORDER_CONFIRMED'
  | 'KITCHEN_PREPARING'
  | 'FOOD_READY'
  | 'FOOD_COLLECTED'
  | 'PAYMENT_RECONCILED'
  | 'ORDER_CANCELLED'
  | 'REFUND_QUEUED'
  | 'REFUND_PROCESSED';

export interface OrderLifecycleTraceEvent {
  traceId: string;
  orderId: string;
  correlationId: string;
  stage: OrderLifecycleStage;
  timestamp: Timestamp;
  actorId: string;
  details?: Record<string, any>;
}

export interface OrderForensicReport {
  orderId: string;
  correlationId: string;
  currentStatus: string;
  paymentStatus: string;
  totalAmountPaise: number;
  timeline: Array<{
    stage: OrderLifecycleStage;
    timestamp: string;
    actorId: string;
    details?: Record<string, any>;
  }>;
  resolutionDiagnosis: {
    isFullySettled: boolean;
    isFoodCollected: boolean;
    isOrphaned: boolean;
    hasDiscrepancy: boolean;
    summary: string;
  };
}

/**
 * Authoritatively records an immutable trace event for an order lifecycle transition.
 */
export async function recordOrderLifecycleTrace(params: {
  orderId: string;
  correlationId?: string;
  stage: OrderLifecycleStage;
  actorId?: string;
  details?: Record<string, any>;
}): Promise<OrderLifecycleTraceEvent> {
  const {
    orderId,
    correlationId = `REQ-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    stage,
    actorId = 'system',
    details = {},
  } = params;

  const traceId = `TRC-${crypto.randomUUID()}`;
  const now = Timestamp.now();

  const traceEvent: OrderLifecycleTraceEvent = {
    traceId,
    orderId,
    correlationId,
    stage,
    timestamp: now,
    actorId,
    details,
  };

  try {
    await db
      .collection('orders')
      .doc(orderId)
      .collection('lifecycleTraces')
      .doc(traceId)
      .set(traceEvent);
  } catch (err: any) {
    console.warn(`[recordOrderLifecycleTrace] Notice: Failed to write trace for order ${orderId}: ${err.message}`);
  }

  return traceEvent;
}

/**
 * Forensic Correlation Diagnostic:
 * Reconstructs the complete lifecycle journey of any order in < 5 seconds.
 * Can be queried by orderId, gatewayPaymentId, or gatewayOrderId.
 */
export const getOrderLifecycleTrace = onCall<{ identifier: string }>(async (request): Promise<OrderForensicReport> => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication required for forensic trace lookup.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  assertCapability(callerRole, 'view_business_analytics', 'Insufficient permissions to inspect forensic order traces.');

  const identifier = (request.data?.identifier || '').trim();
  if (!identifier) {
    throw new HttpsError('invalid-argument', 'Valid orderId, paymentId, or gatewayOrderId is required.');
  }

  let orderDoc = await db.collection('orders').doc(identifier).get();

  // If not found directly by orderId, search by gatewayPaymentId or gatewayOrderId
  if (!orderDoc.exists) {
    const payQuery = await db.collection('orders').where('gatewayPaymentId', '==', identifier).limit(1).get();
    if (!payQuery.empty) {
      orderDoc = payQuery.docs[0];
    } else {
      const ordQuery = await db.collection('orders').where('gatewayOrderId', '==', identifier).limit(1).get();
      if (!ordQuery.empty) {
        orderDoc = ordQuery.docs[0];
      }
    }
  }

  if (!orderDoc.exists) {
    throw new HttpsError('not-found', `No order found matching identifier: ${identifier}`);
  }

  const orderData = orderDoc.data()!;
  const orderId = orderDoc.id;

  // Retrieve traces subcollection
  const tracesSnap = await db
    .collection('orders')
    .doc(orderId)
    .collection('lifecycleTraces')
    .orderBy('timestamp', 'asc')
    .get();

  const timeline = tracesSnap.docs.map((d) => {
    const data = d.data();
    return {
      stage: data.stage as OrderLifecycleStage,
      timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : new Date().toISOString(),
      actorId: data.actorId || 'unknown',
      details: data.details || {},
    };
  });

  // If no granular subcollection traces exist yet (legacy orders), synthesize timeline from order fields
  if (timeline.length === 0) {
    const createdAtIso = orderData.createdAt?.toDate ? orderData.createdAt.toDate().toISOString() : new Date().toISOString();
    timeline.push({
      stage: 'ORDER_CREATED',
      timestamp: createdAtIso,
      actorId: orderData.studentId || 'student',
      details: { amountPaise: orderData.totalAmountPaise },
    });

    if (orderData.paymentStatus === 'paid' || orderData.paymentStatus === 'captured') {
      timeline.push({
        stage: 'PAYMENT_CAPTURED',
        timestamp: orderData.paymentCapturedAt?.toDate?.()?.toISOString() || createdAtIso,
        actorId: 'gateway',
        details: { gatewayPaymentId: orderData.gatewayPaymentId },
      });
      timeline.push({
        stage: 'ORDER_CONFIRMED',
        timestamp: orderData.confirmedAt?.toDate?.()?.toISOString() || createdAtIso,
        actorId: 'system',
        details: { tokenNumber: orderData.tokenNumber },
      });
    }

    if (orderData.status === 'preparing') {
      timeline.push({
        stage: 'KITCHEN_PREPARING',
        timestamp: orderData.preparingAt?.toDate?.()?.toISOString() || createdAtIso,
        actorId: 'cook',
        details: {},
      });
    }

    if (orderData.status === 'ready' || orderData.status === 'collected') {
      timeline.push({
        stage: 'FOOD_READY',
        timestamp: orderData.readyAt?.toDate?.()?.toISOString() || createdAtIso,
        actorId: 'cook',
        details: {},
      });
    }

    if (orderData.status === 'collected') {
      timeline.push({
        stage: 'FOOD_COLLECTED',
        timestamp: orderData.collectedAt?.toDate?.()?.toISOString() || createdAtIso,
        actorId: 'pickup_counter',
        details: {},
      });
    }

    if (orderData.status === 'cancelled') {
      timeline.push({
        stage: 'ORDER_CANCELLED',
        timestamp: orderData.cancelledAt?.toDate?.()?.toISOString() || createdAtIso,
        actorId: 'system',
        details: { cancellationReason: orderData.cancellationReason },
      });
    }
  }

  const isPaid = orderData.paymentStatus === 'paid' || orderData.paymentStatus === 'captured';
  const isCollected = orderData.status === 'collected';
  const isCancelled = orderData.status === 'cancelled';
  const isOrphaned = isPaid && isCancelled;

  let summary = 'Order completed normally.';
  if (isOrphaned) {
    summary = 'ORPHANED PAYMENT: Student funds captured after cancellation. Auto-refund queued.';
  } else if (!isPaid && !isCancelled) {
    summary = 'PAYMENT PENDING: Waiting for student gateway completion or webhook verification.';
  } else if (isPaid && !isCollected) {
    summary = `IN PROGRESS: Food is ${orderData.status}. Token #${orderData.tokenNumber || '—'}.`;
  }

  return {
    orderId,
    correlationId: orderData.correlationId || orderData.gatewayPaymentId || `REQ-${orderId.slice(0, 8)}`,
    currentStatus: orderData.status || 'unknown',
    paymentStatus: orderData.paymentStatus || 'unpaid',
    totalAmountPaise: Number(orderData.totalAmountPaise || 0),
    timeline,
    resolutionDiagnosis: {
      isFullySettled: isPaid,
      isFoodCollected: isCollected,
      isOrphaned,
      hasDiscrepancy: isOrphaned,
      summary,
    },
  };
});
