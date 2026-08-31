import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UserRole, FinancialTransactionRecord } from './types';
import { logSecurityEvent } from './security_logger';

const db = admin.firestore();

export interface RefundRequest {
  orderId: string;
  reason: string;
  amountPaise?: number; // Optional partial refund, defaults to full amount
}

export interface RefundResponse {
  success: boolean;
  refundId: string;
  orderId: string;
  refundedPaise: number;
  status: 'refunded' | 'partially_refunded';
}

/**
 * Formal, Audited Refund Workflow (P2: 24).
 * Restricted to Manager and Admin roles.
 */
export const processOrderRefund = onCall<RefundRequest>(async (request) => {
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
    if (orderData.paymentStatus !== 'paid') {
      throw new HttpsError(
        'failed-precondition',
        `Cannot refund an order with paymentStatus '${orderData.paymentStatus}' (must be 'paid').`
      );
    }

    const orderTotalPaise = orderData.totalAmountPaise || Math.round(Number(orderData.totalAmount || 0) * 100);
    const refundAmountPaise = amountPaise !== undefined ? amountPaise : orderTotalPaise;

    if (!Number.isSafeInteger(refundAmountPaise) || refundAmountPaise <= 0 || refundAmountPaise > orderTotalPaise) {
      throw new HttpsError('invalid-argument', `Invalid refund amount ${refundAmountPaise} paise. Must be between 1 and ${orderTotalPaise}.`);
    }

    const isFullRefund = refundAmountPaise === orderTotalPaise;
    const nextPaymentStatus = isFullRefund ? 'refunded' : 'partially_refunded';
    const nextOrderStatus = isFullRefund ? 'cancelled' : orderData.status;

    // 1. Write to immutable financialTransactions ledger (Double-Entry Debit/Credit)
    const isCash = orderData.paymentMethod === 'counter_cash';
    const finTxRef = db.collection('financialTransactions').doc();
    const finRecord: FinancialTransactionRecord = {
      transactionId: finTxRef.id,
      orderId,
      type: 'REFUND_DISBURSEMENT',
      amount: refundAmountPaise / 100,
      amountPaise: refundAmountPaise,
      currency: 'INR',
      postings: [
        {
          account: 'SALES_REVENUE',
          debitPaise: refundAmountPaise,
          creditPaise: 0,
        },
        {
          account: isCash ? 'CASH_ON_HAND' : 'GATEWAY_RECEIVABLE',
          debitPaise: 0,
          creditPaise: refundAmountPaise,
        },
      ],
      gatewayTransactionId: refundId,
      gatewayOrderId: orderData.gatewayOrderId || 'direct',
      actorId: request.auth!.uid,
      timestamp: now,
      status: 'REFUNDED',
    };
    transaction.set(finTxRef, finRecord);

    // 2. Update Order State
    transaction.update(orderRef, {
      paymentStatus: nextPaymentStatus,
      status: nextOrderStatus,
      refundId,
      refundedAt: now,
      refundedAmountPaise: refundAmountPaise,
      refundReason: reason,
      refundedByStaffId: request.auth!.uid,
      updatedAt: now,
    });

    // 3. Record immutable orderEvent
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: orderData.status,
      toStatus: nextOrderStatus,
      actorId: request.auth!.uid,
      actorRole,
      timestamp: now,
      reason: `REFUND_PROCESSED: ${reason}`,
      metadata: { refundId, refundAmountPaise, isFullRefund },
    });

    // 4. Record security / financial audit event
    const secRef = db.collection('securityEvents').doc();
    transaction.set(secRef, {
      eventType: 'REFUND_DISBURSED',
      orderId,
      actorUid: request.auth!.uid,
      actorRole,
      refundId,
      refundAmountPaise,
      reason,
      severity: 'INFO',
      timestamp: now,
    });

    return {
      success: true,
      refundId,
      orderId,
      refundedPaise: refundAmountPaise,
      status: nextPaymentStatus,
    };
  });
});
