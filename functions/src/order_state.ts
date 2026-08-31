import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { OrderStatus, UserRole } from './types';
import { enforceRateLimit } from './rate_limiter';
import { enforceAppCheck } from './app_check';
import { updatePublicLiveQueueProjection } from './tv_projection';

const db = admin.firestore();

/**
 * Operational State Transitions Matrix (Decoupled from Payment States).
 * Invariant: 'ready' -> 'collected' is strictly executed via verifyPickup (QR/PIN).
 * Invariant TB-NEW-016: Cancellations of orders must go through the dedicated cancelOrder command
 * to ensure inventory restoration, reservation release, and refund coupling.
 */
const ALLOWED_OPERATIONAL_TRANSITIONS: Record<OrderStatus, { next: OrderStatus[]; roles: UserRole[] }[]> = {
  draft: [],
  payment_pending: [], // Payment pending cancellations must go through cancelOrExpirePaymentSession or cancelOrder
  paid: [],
  confirmed: [{ next: ['preparing'], roles: ['kitchen', 'manager', 'admin'] }],
  preparing: [{ next: ['ready'], roles: ['kitchen', 'manager', 'admin'] }],
  ready: [],
  collected: [],
  cancelled: [],
};

/**
 * Validates and executes an authoritative kitchen operational order status transition.
 */
export const updateOrderStatus = onCall<{ orderId: string; nextStatus: OrderStatus }>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const actorId = request.auth.uid;
  await enforceRateLimit(actorId, 'order_status');
  const actorRole = (request.auth.token.role as UserRole) || 'student';
  const { orderId, nextStatus } = request.data;

  if (!orderId || !nextStatus) {
    throw new HttpsError('invalid-argument', 'orderId and nextStatus are required.');
  }

  if (nextStatus === 'paid' || nextStatus === 'payment_pending') {
    throw new HttpsError(
      'permission-denied',
      'Payment state transitions cannot be performed through updateOrderStatus. Use payment finalizers.'
    );
  }

  const orderRef = db.collection('orders').doc(orderId);
  const now = admin.firestore.Timestamp.now();

  const stateResult = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found.`);
    }

    const orderData = snap.data()!;
    const currentStatus = orderData.status as OrderStatus;

    if (currentStatus === nextStatus) {
      return { success: true, message: `Order already in status ${nextStatus}` };
    }

    // Check transition validity
    const allowed = ALLOWED_OPERATIONAL_TRANSITIONS[currentStatus];
    const match = allowed?.find(rule => rule.next.includes(nextStatus));

    if (!match) {
      throw new HttpsError(
        'failed-precondition',
        `Illegal operational transition from ${currentStatus} to ${nextStatus}.`
      );
    }

    // Check role permission
    if (!match.roles.includes(actorRole) && actorRole !== 'admin' && actorRole !== 'security_admin') {
      throw new HttpsError(
        'permission-denied',
        `Role ${actorRole} is not authorized to transition order from ${currentStatus} to ${nextStatus}.`
      );
    }

    const updates: Record<string, any> = {
      status: nextStatus,
      updatedAt: now,
    };

    if (nextStatus === 'ready') {
      updates.readyAt = now;
    }

    transaction.update(orderRef, updates);

    // Record immutable orderEvent
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: currentStatus,
      toStatus: nextStatus,
      actorId,
      actorRole,
      timestamp: now,
    });

    return { success: true, fromStatus: currentStatus, toStatus: nextStatus };
  });

  // Asynchronously synchronize the single ephemeral publicLiveQueue/current document
  await updatePublicLiveQueueProjection(db);

  return stateResult;
});

export interface CancelOrderRequest {
  orderId: string;
  reason: string;
}

/**
 * Authoritative Domain Command: Cancel Order with Atomic Inventory Release/Restoration and Refund Workflow (TB-NEW-015 & TB-NEW-016).
 */
export const cancelOrder = onCall<CancelOrderRequest>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const actorId = request.auth.uid;
  await enforceRateLimit(actorId, 'order_status');
  const actorRole = (request.auth.token.role as UserRole) || 'student';
  const { orderId, reason } = request.data || {};

  if (!orderId || typeof orderId !== 'string' || orderId.trim().length === 0 || orderId.length > 128) {
    throw new HttpsError('invalid-argument', 'Valid non-empty orderId (max 128 chars) is required.');
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 200) {
    throw new HttpsError('invalid-argument', 'Valid cancellation reason string (1-200 chars) is required.');
  }

  const cleanReason = reason.trim();
  const orderRef = db.collection('orders').doc(orderId);
  const now = admin.firestore.Timestamp.now();

  const cancelResult = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found.`);
    }

    const orderData = snap.data()!;
    const isOwner = orderData.studentId === actorId;
    const isStaff = ['manager', 'admin', 'security_admin'].includes(actorRole);

    // Permission boundary: Customer can only cancel unpaid / pending orders. Staff can cancel confirmed/preparing.
    if (!isOwner && !isStaff) {
      throw new HttpsError('permission-denied', 'You do not have permission to cancel this order.');
    }

    if (orderData.status === 'collected' || orderData.status === 'cancelled') {
      throw new HttpsError('failed-precondition', `Order is already in ${orderData.status} state.`);
    }

    // If order was already paid, customer cannot self-cancel if already preparing/ready without staff authorization
    if (orderData.paymentStatus === 'paid' && (orderData.status === 'preparing' || orderData.status === 'ready') && !isStaff) {
      throw new HttpsError('failed-precondition', 'Order is already being prepared. Please contact counter staff for cancellation.');
    }

    // 1. Release or Restore Inventory
    // If stock was committed (paid/confirmed), restore stockOnHand. If stock was only reserved, release reservation.
    const isCommitted = orderData.paymentStatus === 'paid' && orderData.status !== 'payment_pending';
    for (const item of (orderData.items || [])) {
      const itemRef = db.collection('menuItems').doc(item.itemId);
      const itemSnap = await transaction.get(itemRef);
      if (itemSnap.exists) {
        const itemData = itemSnap.data()!;
        if (itemData.type === 'instant') {
          if (isCommitted) {
            // Restore physical stockOnHand
            const newStockOnHand = (itemData.stockOnHand || 0) + item.quantity;
            const reserved = itemData.reservedStock || 0;
            const newAvailable = newStockOnHand - reserved;
            transaction.update(itemRef, {
              stockOnHand: newStockOnHand,
              available: newAvailable > 0,
              isOrderable: newAvailable > 0,
              updatedAt: now,
            });
          } else {
            // Release reservation
            const reserved = Math.max(0, (itemData.reservedStock || 0) - item.quantity);
            const stockOnHand = itemData.stockOnHand || 0;
            const newAvailable = stockOnHand - reserved;
            transaction.update(itemRef, {
              reservedStock: reserved,
              available: newAvailable > 0,
              isOrderable: newAvailable > 0,
              updatedAt: now,
            });
          }
        }
      }
    }

    // 2. Mark reservation status as RELEASED
    const resRef = db.collection('inventoryReservations').doc(orderId);
    transaction.set(resRef, { status: 'RELEASED', releasedAt: now, releaseReason: cleanReason }, { merge: true });

    // 3. If paid, execute refund disbursement ledger entry
    let refundDispatched = false;
    if (orderData.paymentStatus === 'paid') {
      const orderTotalPaise = Number(orderData.totalAmountPaise || (orderData.totalAmount ? Math.round(orderData.totalAmount * 100) : 0));
      const isCash = orderData.paymentMethod === 'counter_cash';
      const refundId = `rfnd_${crypto.randomBytes(8).toString('hex')}`;
      const finTxRef = db.collection('financialTransactions').doc(`refund_fin_${refundId}`);

      transaction.set(finTxRef, {
        transactionId: finTxRef.id,
        orderId,
        type: 'REFUND_DISBURSEMENT',
        amount: orderTotalPaise / 100,
        amountPaise: orderTotalPaise,
        currency: 'INR',
        postings: [
          { account: 'SALES_REVENUE', debitPaise: orderTotalPaise, creditPaise: 0 },
          { account: isCash ? 'CASH_ON_HAND' : 'GATEWAY_RECEIVABLE', debitPaise: 0, creditPaise: orderTotalPaise },
        ],
        gatewayTransactionId: refundId,
        gatewayOrderId: orderData.gatewayOrderId || 'direct',
        actorId,
        timestamp: now,
        status: 'REFUNDED',
      });

      transaction.update(orderRef, {
        status: 'cancelled',
        paymentStatus: 'refunded',
        refundId,
        refundedAt: now,
        amountRefundedPaise: orderTotalPaise,
        refundReason: cleanReason,
        cancelledAt: now,
        cancelledBy: actorId,
        updatedAt: now,
      });
      refundDispatched = true;
    } else {
      transaction.update(orderRef, {
        status: 'cancelled',
        paymentStatus: 'cancelled',
        cancelledAt: now,
        cancelledBy: actorId,
        cancellationReason: cleanReason,
        updatedAt: now,
      });
    }

    // 4. Release Faculty Priority Lock if held
    if (orderData.studentId) {
      const lockRef = db.collection('facultyPriorityLocks').doc(orderData.studentId);
      transaction.delete(lockRef);
    }

    // 5. Record Immutable Order Event
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: orderData.status,
      toStatus: 'cancelled',
      actorId,
      actorRole,
      timestamp: now,
      reason: `ORDER_CANCELLED: ${cleanReason}`,
      metadata: { refundDispatched, previousPaymentStatus: orderData.paymentStatus },
    });

    return {
      success: true,
      orderId,
      status: 'cancelled',
      refundDispatched,
    };
  });

  await updatePublicLiveQueueProjection(db);
  return cancelResult;
});
