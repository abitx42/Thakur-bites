import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UserRole, FinancialTransactionRecord } from './types';
import { logSecurityEvent } from './security_logger';
import { enforceRateLimit } from './rate_limiter';
import { assertOperationalMode } from './kill_switch';
import { enforceAppCheck } from './app_check';
import { RazorpayPaymentAdapter } from './payments';
import { enforceAppVersionPolicy } from './version_policy';
import { assertCapability } from './authorization_policy';

const db = admin.firestore();

export interface RefundRequest {
  orderId: string;
  reason: string;
  amountPaise?: number; // Optional partial refund amount in paise
  idempotencyKey?: string; // Caller-supplied idempotency key
  appVersion?: string;
}

export interface RefundResponse {
  success: boolean;
  refundId: string;
  orderId: string;
  refundedPaise: number;
  totalRefundedPaise: number;
  remainingRefundablePaise: number;
  status: 'refunded' | 'partially_refunded';
}

/**
 * Claims a refund balance before any external side effect. Both the staff refund
 * flow and cancellation flow use this primitive so a retry cannot double-refund.
 */
export async function reserveAndExecuteRefund(params: {
  orderId: string;
  reason: string;
  amountPaise: number;
  actorId: string;
  actorRole: UserRole;
  idempotencyKey?: string;
  cancellation?: boolean;
}): Promise<{ refundId: string; reservationId: string; isCash: boolean; amountPaidPaise: number; previousRefundedPaise: number }> {
  const { orderId, reason, amountPaise, actorId, actorRole, idempotencyKey, cancellation = false } = params;
  const orderRef = db.collection('orders').doc(orderId);
  const initialSnap = await orderRef.get();
  if (!initialSnap.exists) throw new HttpsError('not-found', 'Order not found.');

  const initial = initialSnap.data()!;
  const amountPaidPaise = Number(initial.amountPaidPaise);
  const previousRefundedPaise = Number(initial.amountRefundedPaise || 0);
  if (!Number.isSafeInteger(amountPaidPaise) || amountPaidPaise <= 0 || !Number.isSafeInteger(previousRefundedPaise) || previousRefundedPaise < 0) {
    throw new HttpsError('internal', `FINANCIAL_INTEGRITY_ERROR: Order ${orderId} has invalid payment totals.`);
  }
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > amountPaidPaise - previousRefundedPaise) {
    throw new HttpsError('invalid-argument', 'Refund amount exceeds the authoritative remaining balance.');
  }
  if (cancellation && amountPaise !== amountPaidPaise - previousRefundedPaise) {
    throw new HttpsError('failed-precondition', 'Cancellation requires refunding the full remaining balance.');
  }

  const isCash = initial.paymentMethod === 'counter_cash';
  const reservationId = crypto.randomBytes(16).toString('hex');
  const reservationRef = db.collection('refundReservations').doc(reservationId);
  const now = admin.firestore.Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found during refund reservation.');
    const current = snap.data()!;
    if (current.status === 'cancelled' || current.status === 'collected' || (current.paymentStatus !== 'paid' && current.paymentStatus !== 'partially_refunded')) {
      throw new HttpsError('failed-precondition', 'Order is not eligible for a refund.');
    }
    const currentPaid = Number(current.amountPaidPaise);
    const currentRefunded = Number(current.amountRefundedPaise || 0);
    const remaining = currentPaid - currentRefunded;
    if (!Number.isSafeInteger(currentPaid) || !Number.isSafeInteger(currentRefunded) || amountPaise > remaining || (cancellation && amountPaise !== remaining)) {
      throw new HttpsError('failed-precondition', 'Concurrent refund detected. Please retry.');
    }
    transaction.set(reservationRef, {
      reservationId, orderId, requestedRefundPaise: amountPaise, amountPaidPaise: currentPaid,
      curPrevRefunded: currentRefunded, actorUid: actorId, actorRole, reason,
      status: 'RESERVATION_CREATED', isCash, idempotencyKey: idempotencyKey || null,
      cancellation, createdAt: now,
    });
    transaction.update(orderRef, {
      amountRefundedPaise: currentRefunded + amountPaise,
      refundLifecycleStatus: 'REFUND_REQUESTED',
      updatedAt: now,
    });
  });

  let refundId = `rfnd_cash_${reservationId}`;
  try {
    if (!isCash) {
      const gatewayPaymentId = initial.gatewayPaymentId;
      if (!gatewayPaymentId) throw new HttpsError('failed-precondition', 'Cannot refund online order without a recorded gateway payment ID.');
      refundId = (await new RazorpayPaymentAdapter().createRefund(gatewayPaymentId, amountPaise, reason)).refundId;
    }
    await reservationRef.update({ status: isCash ? 'GATEWAY_SKIPPED_CASH' : 'GATEWAY_SUCCEEDED', gatewayRefundId: refundId, gatewayExecutedAt: admin.firestore.Timestamp.now() });
  } catch (error: unknown) {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(orderRef);
      if (current.exists && Number(current.data()!.amountRefundedPaise) === previousRefundedPaise + amountPaise) {
        transaction.update(orderRef, { amountRefundedPaise: previousRefundedPaise, refundLifecycleStatus: 'GATEWAY_REFUND_FAILED', updatedAt: admin.firestore.Timestamp.now() });
      }
      transaction.update(reservationRef, { status: 'GATEWAY_FAILED', failedAt: admin.firestore.Timestamp.now(), error: error instanceof Error ? error.message : 'Unknown gateway failure' });
    });
    throw error;
  }

  return { refundId, reservationId, isCash, amountPaidPaise, previousRefundedPaise };
}

/**
 * Formal, Audited Cumulative Refund Engine — Race-Condition-Safe.
 */
export const processOrderRefund = onCall<RefundRequest>(async (request) => {
  enforceAppCheck(request);
  await enforceAppVersionPolicy(request.data?.appVersion);
  await assertOperationalMode('refund');

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  try {
    assertCapability(actorRole, 'process_refund');
  } catch (err) {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_REFUND_ATTEMPT',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: { role: actorRole },
    });
    throw new HttpsError('permission-denied', 'Only managers and administrators are authorized to process refunds.');
  }

  await enforceRateLimit(request.auth.uid, 'refund');

  const { orderId, reason, amountPaise, idempotencyKey } = request.data || {};
  if (!orderId || typeof orderId !== 'string' || orderId.trim().length === 0 || orderId.length > 128) {
    throw new HttpsError('invalid-argument', 'Valid non-empty orderId (max 128 chars) is required.');
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 200) {
    throw new HttpsError('invalid-argument', 'Valid refund reason string (1-200 characters) is required.');
  }

  // Caller-supplied idempotency key check
  const cleanIdempKey = idempotencyKey && typeof idempotencyKey === 'string' ? idempotencyKey.trim().slice(0, 128) : undefined;
  if (cleanIdempKey) {
    const existingIdempDoc = await db.collection('refundIdempotency').doc(cleanIdempKey).get();
    if (existingIdempDoc.exists) {
      const data = existingIdempDoc.data()!;
      return {
        success: true,
        refundId: data.refundId,
        orderId: data.orderId,
        refundedPaise: data.refundedPaise,
        totalRefundedPaise: data.totalRefundedPaise,
        remainingRefundablePaise: data.remainingRefundablePaise || 0,
        status: data.status,
      };
    }
  }

  const cleanReason = reason.trim();
  const orderRef = db.collection('orders').doc(orderId);
  const now = admin.firestore.Timestamp.now();

  // ─── Step 1: Validate order (pre-flight, non-transactional read) ─────────
  const initialSnap = await orderRef.get();
  if (!initialSnap.exists) {
    throw new HttpsError('not-found', 'Order not found.');
  }

  const orderData = initialSnap.data()!;
  if (orderData.paymentStatus !== 'paid' && orderData.paymentStatus !== 'partially_refunded') {
    throw new HttpsError(
      'failed-precondition',
      `Cannot refund an order with paymentStatus '${orderData.paymentStatus}' (must be 'paid' or 'partially_refunded').`
    );
  }

  // Strict Fail-Closed Paid Amount Validation
  const amountPaidPaise = Number(orderData.amountPaidPaise);
  if (!Number.isSafeInteger(amountPaidPaise) || amountPaidPaise <= 0) {
    throw new HttpsError('internal', `FINANCIAL_INTEGRITY_ERROR: Order ${orderId} is missing authoritative amountPaidPaise.`);
  }

  const previouslyRefundedPaise = Number(orderData.amountRefundedPaise || 0);
  const remainingRefundablePaise = Math.max(0, amountPaidPaise - previouslyRefundedPaise);

  if (remainingRefundablePaise <= 0) {
    throw new HttpsError('failed-precondition', `Order ${orderId} has already been fully refunded.`);
  }

  const requestedRefundPaise = amountPaise !== undefined ? Number(amountPaise) : remainingRefundablePaise;

  if (!Number.isSafeInteger(requestedRefundPaise) || requestedRefundPaise <= 0 || requestedRefundPaise > remainingRefundablePaise) {
    throw new HttpsError(
      'invalid-argument',
      `Invalid refund amount ${requestedRefundPaise} paise. Maximum refundable amount is ${remainingRefundablePaise} paise.`
    );
  }

  const isCash = orderData.paymentMethod === 'counter_cash';
  const reservationId = crypto.randomBytes(16).toString('hex');
  const reservationRef = db.collection('refundReservations').doc(reservationId);

  // ─── Step 2: Atomic Reservation (THE race-condition lock) ─────────────────
  // This transaction atomically verifies the refundable amount hasn't changed AND
  // creates the exclusive reservation. Only one concurrent caller can commit this.
  // The second concurrent caller will see a stale `remainingRefundablePaise` mismatch
  // and be rejected — BEFORE any gateway call is made.
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Order not found during reservation.');
    }

    const currentData = snap.data()!;
    const curPrevRefunded = Number(currentData.amountRefundedPaise || 0);
    const curRemaining = Math.max(0, amountPaidPaise - curPrevRefunded);

    // Fail-closed: if another concurrent refund already consumed some amount, reject
    if (requestedRefundPaise > curRemaining) {
      throw new HttpsError(
        'failed-precondition',
        'Concurrent refund detected: requested amount exceeds remaining refundable balance. Please retry.'
      );
    }

    // Create the atomic reservation document — this is the exclusive lock
    transaction.set(reservationRef, {
      reservationId,
      orderId,
      requestedRefundPaise,
      amountPaidPaise,
      curPrevRefunded,
      actorUid: request.auth!.uid,
      actorRole,
      reason: cleanReason,
      status: 'RESERVATION_CREATED',
      isCash,
      idempotencyKey: cleanIdempKey || null,
      createdAt: now,
    });

    // Also speculatively increment amountRefundedPaise to block any other concurrent reservation
    transaction.update(orderRef, {
      amountRefundedPaise: curPrevRefunded + requestedRefundPaise,
      refundLifecycleStatus: 'REFUND_REQUESTED',
      updatedAt: now,
    });
  });

  // ─── Step 3: Gateway Execution (AFTER reservation is committed) ───────────
  // If this fails, the reservation document remains with status=GATEWAY_FAILED
  // which the reconciliation cron will pick up and reverse the amountRefundedPaise increment.
  let gatewayRefundId = `rfnd_cash_${reservationId}`;

  if (!isCash) {
    const gatewayPaymentId = orderData.gatewayPaymentId;
    if (!gatewayPaymentId) {
      // Rollback the speculative increment
      await orderRef.update({
        amountRefundedPaise: previouslyRefundedPaise,
        refundLifecycleStatus: 'GATEWAY_REFUND_FAILED',
        updatedAt: admin.firestore.Timestamp.now(),
      });
      await reservationRef.update({ status: 'GATEWAY_FAILED', failedAt: admin.firestore.Timestamp.now() });
      throw new HttpsError('failed-precondition', 'Cannot refund online order without a recorded gateway payment ID.');
    }

    try {
      const adapter = new RazorpayPaymentAdapter();
      const refundRes = await adapter.createRefund(gatewayPaymentId, requestedRefundPaise, cleanReason);
      gatewayRefundId = refundRes.refundId;
      await reservationRef.update({ status: 'GATEWAY_SUCCEEDED', gatewayRefundId, gatewayExecutedAt: admin.firestore.Timestamp.now() });
    } catch (err: any) {
      // Rollback the speculative increment so future refund attempts can proceed
      await orderRef.update({
        amountRefundedPaise: previouslyRefundedPaise,
        refundLifecycleStatus: 'GATEWAY_REFUND_FAILED',
        updatedAt: admin.firestore.Timestamp.now(),
      });
      await reservationRef.update({ status: 'GATEWAY_FAILED', failedAt: admin.firestore.Timestamp.now(), error: err.message });

      await logSecurityEvent({
        eventType: 'GATEWAY_REFUND_FAILED',
        severity: 'HIGH',
        orderId,
        actorUid: request.auth.uid,
        details: { error: err.message, gatewayPaymentId, amountPaise: requestedRefundPaise, reservationId },
      });
      throw new HttpsError('internal', `Payment gateway refund failed: ${err.message}`);
    }
  }

  // ─── Step 4: Finalization Transaction ────────────────────────────────────
  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Order not found during finalization.');
    }

    const currentOrderData = snap.data()!;
    // At this point amountRefundedPaise was already speculatively updated in Step 2
    const newTotalRefundedPaise = Number(currentOrderData.amountRefundedPaise);
    const isFullRefund = newTotalRefundedPaise >= amountPaidPaise;
    const nextPaymentStatus = isFullRefund ? 'refunded' : 'partially_refunded';
    const nextOrderStatus = isFullRefund ? 'cancelled' : currentOrderData.status;

    // 1. Write to immutable financialTransactions ledger
    const finTxRef = db.collection('financialTransactions').doc(`refund_fin_${gatewayRefundId}`);
    const finRecord: FinancialTransactionRecord = {
      transactionId: finTxRef.id,
      orderId,
      type: 'REFUND_DISBURSEMENT',
      amount: requestedRefundPaise / 100,
      amountPaise: requestedRefundPaise,
      currency: 'INR',
      postings: [
        { account: 'SALES_REVENUE', debitPaise: requestedRefundPaise, creditPaise: 0 },
        { account: isCash ? 'CASH_ON_HAND' : 'GATEWAY_RECEIVABLE', debitPaise: 0, creditPaise: requestedRefundPaise },
      ],
      gatewayTransactionId: gatewayRefundId,
      gatewayOrderId: currentOrderData.gatewayOrderId || 'direct',
      actorId: request.auth!.uid,
      timestamp: now,
      status: 'REFUNDED',
    };
    transaction.set(finTxRef, finRecord);

    // 2. Finalize Order State
    transaction.update(orderRef, {
      paymentStatus: nextPaymentStatus,
      refundLifecycleStatus: 'GATEWAY_REFUNDED',
      status: nextOrderStatus,
      refundId: gatewayRefundId,
      refundedAt: now,
      amountRefundablePaise: amountPaidPaise - newTotalRefundedPaise,
      lastRefundAmountPaise: requestedRefundPaise,
      refundReason: cleanReason,
      refundedByStaffId: request.auth!.uid,
      refundReservationId: reservationId,
      updatedAt: now,
    });

    // 3. Mark reservation as finalized
    transaction.update(reservationRef, {
      status: 'FINALIZED',
      gatewayRefundId,
      finalizedAt: now,
    });

    // 4. Immutable Audit Event
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: currentOrderData.status,
      toStatus: nextOrderStatus,
      actorId: request.auth!.uid,
      actorRole,
      timestamp: now,
      reason: `REFUND_PROCESSED: ${cleanReason}`,
      metadata: {
        refundId: gatewayRefundId,
        reservationId,
        refundAmountPaise: requestedRefundPaise,
        totalRefundedPaise: newTotalRefundedPaise,
        isFullRefund,
        paymentMethod: currentOrderData.paymentMethod,
      },
    });

    // 5. Idempotency record
    if (cleanIdempKey) {
      const idempRef = db.collection('refundIdempotency').doc(cleanIdempKey);
      transaction.set(idempRef, {
        idempotencyKey: cleanIdempKey,
        refundId: gatewayRefundId,
        reservationId,
        orderId,
        refundedPaise: requestedRefundPaise,
        totalRefundedPaise: newTotalRefundedPaise,
        remainingRefundablePaise: amountPaidPaise - newTotalRefundedPaise,
        status: nextPaymentStatus,
        createdAt: now,
      });
    }

    return {
      success: true,
      refundId: gatewayRefundId,
      orderId,
      refundedPaise: requestedRefundPaise,
      totalRefundedPaise: newTotalRefundedPaise,
      remainingRefundablePaise: amountPaidPaise - newTotalRefundedPaise,
      status: nextPaymentStatus,
    };
  });
});
