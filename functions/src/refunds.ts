import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UserRole, FinancialTransactionRecord } from './types';
import { logSecurityEvent } from './security_logger';
import { enforceRateLimit } from './rate_limiter';
import { assertOperationalMode } from './kill_switch';

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

  const { orderId, reason, amountPaise } = request.data;
  if (!orderId || !reason || reason.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'orderId and a non-empty refund reason are required.');
  }

  const orderRef = db.collection('orders').doc(orderId);
  const now = admin.firestore.Timestamp.now();
  const refundId = `rfnd_${crypto.randomBytes(8).toString('hex')}`;

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Order not found.');
    }

    const orderData = snap.data()!;
    if (orderData.paymentStatus !== 'paid' && orderData.paymentStatus !== 'partially_refunded') {
      throw new HttpsError(
        'failed-precondition',
        `Cannot refund an order with paymentStatus '${orderData.paymentStatus}' (must be 'paid' or 'partially_refunded').`
      );
    }

    // Cumulative Refund Bounds Assertion
    const orderTotalPaise = orderData.totalAmountPaise || Math.round(Number(orderData.totalAmount || 0) * 100);
    const amountPaidPaise = orderData.amountPaidPaise || orderTotalPaise;
    const previouslyRefundedPaise = Number(orderData.amountRefundedPaise || 0);
    const remainingRefundablePaise = Math.max(0, amountPaidPaise - previouslyRefundedPaise);

    if (remainingRefundablePaise <= 0) {
      throw new HttpsError('failed-precondition', `Order ${orderId} has already been fully refunded.`);
    }

    const requestedRefundPaise = amountPaise !== undefined ? amountPaise : remainingRefundablePaise;

    if (!Number.isSafeInteger(requestedRefundPaise) || requestedRefundPaise <= 0 || requestedRefundPaise > remainingRefundablePaise) {
      throw new HttpsError(
        'invalid-argument',
        `Invalid refund amount ${requestedRefundPaise} paise. Maximum refundable amount is ${remainingRefundablePaise} paise.`
      );
    }

    const newTotalRefundedPaise = previouslyRefundedPaise + requestedRefundPaise;
    const isFullRefund = newTotalRefundedPaise === amountPaidPaise;
    const nextPaymentStatus = isFullRefund ? 'refunded' : 'partially_refunded';
    const nextOrderStatus = isFullRefund ? 'cancelled' : orderData.status;

    // 1. Write to immutable financialTransactions ledger (Double-Entry Debit/Credit)
    const isCash = orderData.paymentMethod === 'counter_cash';
    const finTxRef = db.collection('financialTransactions').doc();
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
      gatewayOrderId: orderData.gatewayOrderId || 'direct',
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
      refundReason: reason,
      refundedByStaffId: request.auth!.uid,
      updatedAt: now,
    });

    // 3. Record Immutable Audit Event
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: orderData.status,
      toStatus: nextOrderStatus,
      actorId: request.auth!.uid,
      actorRole,
      timestamp: now,
      reason: `REFUND_PROCESSED: ${reason}`,
      metadata: {
        refundId,
        refundAmountPaise: requestedRefundPaise,
        totalRefundedPaise: newTotalRefundedPaise,
        isFullRefund,
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
