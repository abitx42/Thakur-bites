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
import { createSanitizedHttpsError } from './security_responses';

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

export interface ExecuteRefundParams {
  orderId: string;
  reason: string;
  amountPaise?: number;
  actorId: string;
  actorRole: UserRole;
  idempotencyKey?: string;
  cancellation?: boolean;
}

export interface ExecuteRefundResult {
  success: boolean;
  refundId: string;
  reservationId: string;
  orderId: string;
  refundedPaise: number;
  totalRefundedPaise: number;
  remainingRefundablePaise: number;
  status: 'refunded' | 'partially_refunded';
  isCash: boolean;
  amountPaidPaise: number;
  previousRefundedPaise: number;
}

/**
 * Authoritative Single Refund Engine — Distributed Race-Condition & Idempotency-Safe.
 * 
 * Invariants Enforced:
 * 1. Transactional Idempotency Claiming: Claim `refundIdempotency/{key}` before external gateway execution.
 * 2. Delta Accounting & In-Flight Reservation: Speculatively increments `pendingRefundPaise` to block double-refunds,
 *    and settles via delta arithmetic (`pendingRefundPaise -= X`, `amountRefundedPaise += X`). Rollbacks only
 *    decrement `pendingRefundPaise -= X`, NEVER clobbering concurrent or later refunds with stale absolute values.
 * 3. Deterministic Gateway Key: Razorpay receives `TB-REFUND-${orderId}-${reservationId}` for external deduplication.
 * 4. Double-entry financial transactions and audit logs posted atomically upon finalization.
 */
export async function reserveAndExecuteRefund(params: ExecuteRefundParams): Promise<ExecuteRefundResult> {
  const { orderId, reason, amountPaise, actorId, actorRole, idempotencyKey, cancellation = false } = params;

  if (!orderId || typeof orderId !== 'string' || orderId.trim().length === 0 || orderId.length > 128) {
    throw new HttpsError('invalid-argument', 'Valid non-empty orderId (max 128 chars) is required.');
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 200) {
    throw new HttpsError('invalid-argument', 'Valid refund reason string (1-200 characters) is required.');
  }

  const cleanReason = reason.trim();
  const cleanIdempKey = idempotencyKey && typeof idempotencyKey === 'string' ? idempotencyKey.trim().slice(0, 128) : undefined;
  const now = admin.firestore.Timestamp.now();

  // ─── Step 1: Transactional Idempotency Key Claim (TB-NEW-005 Remediation) ───
  const idempRef = cleanIdempKey ? db.collection('refundIdempotency').doc(cleanIdempKey) : null;
  if (idempRef) {
    const claimResult = await db.runTransaction(async (t) => {
      const snap = await t.get(idempRef);
      if (snap.exists) {
        const data = snap.data()!;
        if (data.status === 'SETTLED' || data.status === 'refunded' || data.status === 'partially_refunded') {
          return { status: 'RESOLVED', data };
        }
        const elapsedMs = Date.now() - (data.claimedAt?.toMillis?.() || 0);
        if (data.status === 'PROCESSING' && elapsedMs < 60000) {
          return { status: 'IN_PROGRESS' };
        }
        // If previous failed or lease expired (>60s), reclaim
        t.update(idempRef, {
          status: 'PROCESSING',
          claimedAt: now,
          attemptCount: admin.firestore.FieldValue.increment(1),
        });
        return { status: 'CLAIMED' };
      }

      t.set(idempRef, {
        idempotencyKey: cleanIdempKey,
        orderId,
        actorUid: actorId,
        status: 'PROCESSING',
        claimedAt: now,
        createdAt: now,
        attemptCount: 1,
      });
      return { status: 'CLAIMED' };
    });

    if (claimResult.status === 'RESOLVED') {
      const d = claimResult.data!;
      return {
        success: true,
        refundId: d.refundId,
        reservationId: d.reservationId,
        orderId: d.orderId,
        refundedPaise: d.refundedPaise,
        totalRefundedPaise: d.totalRefundedPaise,
        remainingRefundablePaise: d.remainingRefundablePaise || 0,
        status: d.status,
        isCash: d.isCash || false,
        amountPaidPaise: d.amountPaidPaise || 0,
        previousRefundedPaise: d.previousRefundedPaise || 0,
      };
    }

    if (claimResult.status === 'IN_PROGRESS') {
      throw new HttpsError('failed-precondition', 'A refund with this idempotency key is currently in progress. Please wait.');
    }
  }

  // ─── Step 2: Validate Order & Balances ──────────────────────────────────
  const orderRef = db.collection('orders').doc(orderId);
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

  const amountPaidPaise = Number(orderData.amountPaidPaise);
  if (!Number.isSafeInteger(amountPaidPaise) || amountPaidPaise <= 0) {
    throw new HttpsError('internal', `FINANCIAL_INTEGRITY_ERROR: Order ${orderId} has invalid amountPaidPaise.`);
  }

  const previouslyRefundedPaise = Number(orderData.amountRefundedPaise || 0);
  const previousPendingPaise = Number(orderData.pendingRefundPaise || 0);
  const remainingRefundablePaise = Math.max(0, amountPaidPaise - previouslyRefundedPaise - previousPendingPaise);

  if (remainingRefundablePaise <= 0) {
    throw new HttpsError('failed-precondition', `Order ${orderId} has no remaining refundable balance.`);
  }

  const requestedRefundPaise = amountPaise !== undefined ? Number(amountPaise) : remainingRefundablePaise;
  if (!Number.isSafeInteger(requestedRefundPaise) || requestedRefundPaise <= 0 || requestedRefundPaise > remainingRefundablePaise) {
    throw new HttpsError(
      'invalid-argument',
      `Invalid refund amount ${requestedRefundPaise} paise. Maximum currently refundable is ${remainingRefundablePaise} paise.`
    );
  }

  if (cancellation && requestedRefundPaise !== remainingRefundablePaise) {
    throw new HttpsError('failed-precondition', 'Cancellation requires refunding the full remaining balance.');
  }

  const isCash = orderData.paymentMethod === 'counter_cash';
  const reservationId = crypto.randomBytes(16).toString('hex');
  const reservationRef = db.collection('refundReservations').doc(reservationId);

  // ─── Step 3: Atomic Reservation Lock (Delta Accounting) ────────────────
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found during refund reservation.');

    const current = snap.data()!;
    if (current.status === 'cancelled' && !cancellation) {
      throw new HttpsError('failed-precondition', 'Order is already cancelled.');
    }
    if (current.status === 'collected' && !cancellation) {
      throw new HttpsError('failed-precondition', 'Order is already collected.');
    }
    if (current.paymentStatus !== 'paid' && current.paymentStatus !== 'partially_refunded') {
      throw new HttpsError('failed-precondition', 'Order is not eligible for a refund.');
    }

    const curPaid = Number(current.amountPaidPaise);
    const curSettled = Number(current.amountRefundedPaise || 0);
    const curPending = Number(current.pendingRefundPaise || 0);
    const curAvailable = curPaid - curSettled - curPending;

    if (!Number.isSafeInteger(curPaid) || !Number.isSafeInteger(curSettled) || requestedRefundPaise > curAvailable || (cancellation && requestedRefundPaise !== curAvailable)) {
      throw new HttpsError('failed-precondition', 'Concurrent refund detected or insufficient balance. Please retry.');
    }

    transaction.set(reservationRef, {
      reservationId,
      orderId,
      requestedRefundPaise,
      amountPaidPaise: curPaid,
      curPrevRefunded: curSettled,
      curPrevPending: curPending,
      actorUid: actorId,
      actorRole,
      reason: cleanReason,
      status: 'RESERVATION_CREATED',
      isCash,
      idempotencyKey: cleanIdempKey || null,
      cancellation,
      createdAt: now,
    });

    // Delta arithmetic: increment pendingRefundPaise to lock funds without corrupting settled ledger
    transaction.update(orderRef, {
      pendingRefundPaise: admin.firestore.FieldValue.increment(requestedRefundPaise),
      refundLifecycleStatus: 'REFUND_REQUESTED',
      updatedAt: now,
    });
  });

  // ─── Step 4: External Gateway Call with Deterministic Idempotency Key ───
  const deterministicGatewayKey = cleanIdempKey || `TB-REFUND-${orderId}-${reservationId}`;
  let gatewayRefundId = `rfnd_cash_${reservationId}`;

  if (!isCash) {
    const gatewayPaymentId = orderData.gatewayPaymentId;
    if (!gatewayPaymentId) {
      // Rollback reservation delta in transaction
      await db.runTransaction(async (transaction) => {
        transaction.update(orderRef, {
          pendingRefundPaise: admin.firestore.FieldValue.increment(-requestedRefundPaise),
          refundLifecycleStatus: 'GATEWAY_REFUND_FAILED',
          updatedAt: admin.firestore.Timestamp.now(),
        });
        transaction.update(reservationRef, {
          status: 'GATEWAY_FAILED',
          failedAt: admin.firestore.Timestamp.now(),
          error: 'Missing gatewayPaymentId',
        });
      });
      if (idempRef) {
        await idempRef.update({
          status: 'FAILED',
          failedAt: admin.firestore.Timestamp.now(),
          error: 'Missing gatewayPaymentId',
        }).catch(() => {});
      }
      throw new HttpsError('failed-precondition', 'Cannot refund online order without a recorded gateway payment ID.');
    }

    try {
      const adapter = new RazorpayPaymentAdapter();
      const refundRes = await adapter.createRefund(gatewayPaymentId, requestedRefundPaise, cleanReason, deterministicGatewayKey);
      gatewayRefundId = refundRes.refundId;
      await reservationRef.update({
        status: 'GATEWAY_SUCCEEDED',
        gatewayRefundId,
        gatewayExecutedAt: admin.firestore.Timestamp.now(),
      });
    } catch (err: any) {
      // Rollback reservation delta safely using FieldValue.increment(-requestedRefundPaise) (Finding 6)
      await db.runTransaction(async (transaction) => {
        transaction.update(orderRef, {
          pendingRefundPaise: admin.firestore.FieldValue.increment(-requestedRefundPaise),
          refundLifecycleStatus: 'GATEWAY_REFUND_FAILED',
          updatedAt: admin.firestore.Timestamp.now(),
        });
        transaction.update(reservationRef, {
          status: 'GATEWAY_FAILED',
          failedAt: admin.firestore.Timestamp.now(),
          error: err.message,
        });
      });

      if (idempRef) {
        await idempRef.update({
          status: 'FAILED',
          failedAt: admin.firestore.Timestamp.now(),
          error: err.message,
        }).catch(() => {});
      }

      throw createSanitizedHttpsError('REFUND', err, {
        orderId,
        actorUid: actorId,
        details: { gatewayPaymentId, amountPaise: requestedRefundPaise, reservationId },
      });
    }
  } else {
    await reservationRef.update({
      status: 'GATEWAY_SKIPPED_CASH',
      gatewayRefundId,
      gatewayExecutedAt: admin.firestore.Timestamp.now(),
    });
  }

  // ─── Step 5: Finalization Transaction (Delta Accounting & Double-Entry Ledger) ───
  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Order not found during refund finalization.');
    }

    const currentOrderData = snap.data()!;
    const settledSoFar = Number(currentOrderData.amountRefundedPaise || 0);
    const newTotalRefundedPaise = settledSoFar + requestedRefundPaise;
    const isFullRefund = newTotalRefundedPaise >= amountPaidPaise;
    const nextPaymentStatus = isFullRefund ? 'refunded' : 'partially_refunded';
    const nextOrderStatus = (isFullRefund && currentOrderData.status !== 'collected') ? 'cancelled' : currentOrderData.status;

    // 1. Immutable Financial Transactions double-entry ledger posting
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
      actorId,
      timestamp: now,
      status: 'REFUNDED',
    };
    transaction.set(finTxRef, finRecord);

    // 2. Finalize Order State (Delta accounting: decrement pending, increment settled)
    transaction.update(orderRef, {
      pendingRefundPaise: admin.firestore.FieldValue.increment(-requestedRefundPaise),
      amountRefundedPaise: admin.firestore.FieldValue.increment(requestedRefundPaise),
      paymentStatus: nextPaymentStatus,
      refundLifecycleStatus: 'GATEWAY_REFUNDED',
      status: nextOrderStatus,
      refundId: gatewayRefundId,
      refundedAt: now,
      amountRefundablePaise: amountPaidPaise - newTotalRefundedPaise,
      lastRefundAmountPaise: requestedRefundPaise,
      refundReason: cleanReason,
      refundedByStaffId: actorId,
      refundReservationId: reservationId,
      updatedAt: now,
    });

    // 3. Mark reservation as finalized
    transaction.update(reservationRef, {
      status: isCash ? 'GATEWAY_SKIPPED_CASH' : 'FINALIZED',
      gatewayRefundId,
      finalizedAt: now,
    });

    // 4. Immutable Audit Event
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: currentOrderData.status,
      toStatus: nextOrderStatus,
      actorId,
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

    // 5. Idempotency record transition to SETTLED
    if (idempRef) {
      transaction.set(idempRef, {
        idempotencyKey: cleanIdempKey,
        refundId: gatewayRefundId,
        reservationId,
        orderId,
        refundedPaise: requestedRefundPaise,
        totalRefundedPaise: newTotalRefundedPaise,
        remainingRefundablePaise: amountPaidPaise - newTotalRefundedPaise,
        status: nextPaymentStatus,
        isCash,
        amountPaidPaise,
        previousRefundedPaise: settledSoFar,
        settledAt: now,
      }, { merge: true });
    }

    return {
      success: true,
      refundId: gatewayRefundId,
      reservationId,
      orderId,
      refundedPaise: requestedRefundPaise,
      totalRefundedPaise: newTotalRefundedPaise,
      remainingRefundablePaise: amountPaidPaise - newTotalRefundedPaise,
      status: nextPaymentStatus,
      isCash,
      amountPaidPaise,
      previousRefundedPaise: settledSoFar,
    };
  });
}

/**
 * Formal, Audited Cumulative Refund Engine — Race-Condition-Safe & Idempotency-Hardened.
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
  const result = await reserveAndExecuteRefund({
    orderId,
    reason,
    amountPaise,
    actorId: request.auth.uid,
    actorRole,
    idempotencyKey,
    cancellation: false,
  });

  return {
    success: result.success,
    refundId: result.refundId,
    orderId: result.orderId,
    refundedPaise: result.refundedPaise,
    totalRefundedPaise: result.totalRefundedPaise,
    remainingRefundablePaise: result.remainingRefundablePaise,
    status: result.status,
  };
});
