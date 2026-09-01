import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UserRole, FinancialTransactionRecord } from './types';
import { logSecurityEvent } from './security_logger';
import { enforceRateLimit } from './rate_limiter';
import { assertOperationalMode } from './kill_switch';
import { enforceAppCheck } from './app_check';
import { RazorpayPaymentAdapter } from './payments';

const db = admin.firestore();

export interface RefundRequest {
  orderId: string;
  reason: string;
  amountPaise?: number; // Optional partial refund amount in paise
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
 * Formal, Audited Cumulative Refund Engine (P0 & Stage 2 Hardened).
 * Strictly guarantees: amountRefundedPaise + requestedRefundPaise <= amountPaidPaise.
 */
export const processOrderRefund = onCall<RefundRequest>(async (request) => {
  enforceAppCheck(request);
  await assertOperationalMode('refund');

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  if (actorRole !== 'manager' && actorRole !== 'admin' && actorRole !== 'security_admin') {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_REFUND_ATTEMPT',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: { role: actorRole },
    });
    throw new HttpsError('permission-denied', 'Only managers and administrators are authorized to process refunds.');
  }

  await enforceRateLimit(request.auth.uid, 'refund');

  const { orderId, reason, amountPaise } = request.data || {};
  if (!orderId || typeof orderId !== 'string' || orderId.trim().length === 0 || orderId.length > 128) {
    throw new HttpsError('invalid-argument', 'Valid non-empty orderId (max 128 chars) is required.');
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 200) {
    throw new HttpsError('invalid-argument', 'Valid refund reason string (1-200 characters) is required.');
  }

  const cleanReason = reason.trim();
  const orderRef = db.collection('orders').doc(orderId);
  const now = admin.firestore.Timestamp.now();

  // 1. Initial order validation
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

  const orderTotalPaise = Number(orderData.totalAmountPaise || (orderData.totalAmount ? Math.round(orderData.totalAmount * 100) : 0));
  const amountPaidPaise = Number(orderData.amountPaidPaise || orderTotalPaise);

  if (!Number.isSafeInteger(amountPaidPaise) || amountPaidPaise <= 0) {
    throw new HttpsError('internal', `FINANCIAL_INTEGRITY_ERROR: Order ${orderId} has invalid paid amount.`);
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
  let refundId = `rfnd_${crypto.randomBytes(8).toString('hex')}`;

  // 2. Real Gateway Execution for Online Payments (TB-NEW-001)
  if (!isCash) {
    const gatewayPaymentId = orderData.gatewayPaymentId;
    if (!gatewayPaymentId) {
      throw new HttpsError('failed-precondition', 'Cannot refund online order without a recorded gateway payment ID.');
    }

    try {
      const adapter = new RazorpayPaymentAdapter();
      const refundRes = await adapter.createRefund(gatewayPaymentId, requestedRefundPaise, cleanReason);
      refundId = refundRes.refundId;
    } catch (err: any) {
      await logSecurityEvent({
        eventType: 'GATEWAY_REFUND_FAILED',
        severity: 'HIGH',
        orderId,
        actorUid: request.auth.uid,
        details: { error: err.message, gatewayPaymentId, amountPaise: requestedRefundPaise },
      });
      throw new HttpsError('internal', `Payment gateway refund failed: ${err.message}`);
    }
  }

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Order not found.');
    }

    const currentOrderData = snap.data()!;
    const curPrevRefunded = Number(currentOrderData.amountRefundedPaise || 0);
    const curRemaining = Math.max(0, amountPaidPaise - curPrevRefunded);

    if (requestedRefundPaise > curRemaining) {
      throw new HttpsError('failed-precondition', 'Concurrent refund detected: requested amount exceeds remaining refundable balance.');
    }

    const newTotalRefundedPaise = curPrevRefunded + requestedRefundPaise;
    const isFullRefund = newTotalRefundedPaise === amountPaidPaise;
    const nextPaymentStatus = isFullRefund ? 'refunded' : 'partially_refunded';
    const nextOrderStatus = isFullRefund ? 'cancelled' : currentOrderData.status;

    // 1. Write to immutable financialTransactions ledger with deterministic ID (TB-NEW-001 & TB-NEW-002)
    const finTxRef = db.collection('financialTransactions').doc(`refund_fin_${refundId}`);
    const finRecord: FinancialTransactionRecord = {
      transactionId: finTxRef.id,
      orderId,
      type: 'REFUND_DISBURSEMENT',
      amount: requestedRefundPaise / 100,
      amountPaise: requestedRefundPaise,
      currency: 'INR',
      postings: [
        {
          account: 'SALES_REVENUE',
          debitPaise: requestedRefundPaise,
          creditPaise: 0,
        },
        {
          account: isCash ? 'CASH_ON_HAND' : 'GATEWAY_RECEIVABLE',
          debitPaise: 0,
          creditPaise: requestedRefundPaise,
        },
      ],
      gatewayTransactionId: refundId,
      gatewayOrderId: currentOrderData.gatewayOrderId || 'direct',
      actorId: request.auth!.uid,
      timestamp: now,
      status: 'REFUNDED',
    };
    transaction.set(finTxRef, finRecord);

    // 2. Update Order State with Cumulative Refund Tracking
    transaction.update(orderRef, {
      paymentStatus: nextPaymentStatus,
      status: nextOrderStatus,
      refundId,
      refundedAt: now,
      amountRefundedPaise: newTotalRefundedPaise,
      amountRefundablePaise: amountPaidPaise - newTotalRefundedPaise,
      lastRefundAmountPaise: requestedRefundPaise,
      refundReason: cleanReason,
      refundedByStaffId: request.auth!.uid,
      updatedAt: now,
    });

    // 3. Record Immutable Audit Event
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
        refundId,
        refundAmountPaise: requestedRefundPaise,
        totalRefundedPaise: newTotalRefundedPaise,
        isFullRefund,
        paymentMethod: currentOrderData.paymentMethod,
      },
    });

    return {
      success: true,
      refundId,
      orderId,
      refundedPaise: requestedRefundPaise,
      totalRefundedPaise: newTotalRefundedPaise,
      remainingRefundablePaise: amountPaidPaise - newTotalRefundedPaise,
      status: nextPaymentStatus,
    };
  });
});
