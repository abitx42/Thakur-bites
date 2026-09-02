import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { OrderStatus, UserRole } from './types';
import { enforceRateLimit } from './rate_limiter';
import { enforceAppCheck } from './app_check';
import { updatePublicLiveQueueProjection } from './tv_projection';
import { assertActiveWorkstationSession } from './shift_pins';
import { enforceAppVersionPolicy } from './version_policy';
import { reserveAndExecuteRefund } from './refunds';
import { hasCapability } from './authorization_policy';

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
  confirmed: [{ next: ['preparing'], roles: ['kitchen', 'manager', 'admin', 'developer', 'security_admin'] }],
  preparing: [{ next: ['ready'], roles: ['kitchen', 'manager', 'admin', 'developer', 'security_admin'] }],
  ready: [],
  collected: [],
  cancelled: [],
};

/**
 * Validates and executes an authoritative kitchen operational order status transition.
 */
export const updateOrderStatus = onCall<{ orderId: string; nextStatus: OrderStatus; appVersion?: string }>(async (request) => {
  enforceAppCheck(request);
  await enforceAppVersionPolicy(request.data?.appVersion);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  await assertActiveWorkstationSession(request.auth.uid, request.auth.token);
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
  appVersion?: string;
}

/**
 * Authoritative Domain Command: Cancel Order with Atomic Inventory Release/Restoration and Refund Workflow (TB-NEW-015 & TB-NEW-016).
 */
export const cancelOrder = onCall<CancelOrderRequest>(async (request) => {
  enforceAppCheck(request);
  await enforceAppVersionPolicy(request.data?.appVersion);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  await assertActiveWorkstationSession(request.auth.uid, request.auth.token);
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

  // 1. Initial order validation & Gateway Refund Execution for Paid Online Orders
  const initialSnap = await orderRef.get();
  if (!initialSnap.exists) {
    throw new HttpsError('not-found', `Order ${orderId} not found.`);
  }

  const initialOrderData = initialSnap.data()!;
  const isOwner = initialOrderData.studentId === actorId;
  const isStaff = hasCapability(actorRole, 'cancel_staff_order');

  if (!isOwner && !isStaff) {
    throw new HttpsError('permission-denied', 'You do not have permission to cancel this order.');
  }

  if (initialOrderData.status === 'collected' || initialOrderData.status === 'cancelled') {
    throw new HttpsError('failed-precondition', `Order is already in ${initialOrderData.status} state.`);
  }

  if (initialOrderData.paymentStatus === 'paid' && (initialOrderData.status === 'preparing' || initialOrderData.status === 'ready') && !isStaff) {
    throw new HttpsError('failed-precondition', 'Order is already being prepared. Please contact counter staff for cancellation.');
  }

  let gatewayRefundId: string | undefined;
  let refundReservationId: string | undefined;
  let refundDispatched = false;
  let amountToRefundPaise = 0;

  if (initialOrderData.paymentStatus === 'paid') {
    const amountPaidPaise = Number(initialOrderData.amountPaidPaise);
    if (!Number.isSafeInteger(amountPaidPaise) || amountPaidPaise <= 0) {
      throw new HttpsError('internal', `FINANCIAL_INTEGRITY_ERROR: Paid order ${orderId} has invalid or missing amountPaidPaise.`);
    }
    amountToRefundPaise = amountPaidPaise;

    const refund = await reserveAndExecuteRefund({
      orderId,
      reason: cleanReason,
      amountPaise: amountPaidPaise,
      actorId,
      actorRole,
      cancellation: true,
    });
    gatewayRefundId = refund.refundId;
    refundReservationId = refund.reservationId;
    refundDispatched = !refund.isCash;
  }

  const cancelResult = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found.`);
    }

    const orderData = snap.data()!;
    if (orderData.status === 'collected' || orderData.status === 'cancelled') {
      throw new HttpsError('failed-precondition', `Order is already in ${orderData.status} state.`);
    }

    // 1. Release or Restore Inventory (Fail-Closed Hardened)
    const isCommitted = orderData.paymentStatus === 'paid' && orderData.status !== 'payment_pending';
    for (const item of (orderData.items || [])) {
      const itemRef = db.collection('menuItems').doc(item.itemId);
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists) {
        throw new HttpsError('internal', `INVENTORY_ITEM_NOT_FOUND: Item "${item.itemId}" missing from catalog during cancellation.`);
      }

      const itemData = itemSnap.data()!;
      if (itemData.type === 'instant') {
        const stockOnHand = itemData.stockOnHand;
        const reservedStock = itemData.reservedStock !== undefined ? itemData.reservedStock : 0;

        if (typeof stockOnHand !== 'number' || !Number.isSafeInteger(stockOnHand) || stockOnHand < 0) {
          throw new HttpsError('internal', `INVENTORY_CORRUPTION: Item "${itemData.name}" has invalid stockOnHand during cancellation.`);
        }
        if (typeof reservedStock !== 'number' || !Number.isSafeInteger(reservedStock) || reservedStock < 0) {
          throw new HttpsError('internal', `INVENTORY_CORRUPTION: Item "${itemData.name}" has invalid reservedStock during cancellation.`);
        }

        if (isCommitted) {
          const newStockOnHand = stockOnHand + item.quantity;
          const newAvailable = newStockOnHand - reservedStock;
          transaction.update(itemRef, {
            stockOnHand: newStockOnHand,
            available: newAvailable > 0,
            isOrderable: newAvailable > 0,
            updatedAt: now,
          });
        } else {
          const newReserved = Math.max(0, reservedStock - item.quantity);
          const newAvailable = stockOnHand - newReserved;
          transaction.update(itemRef, {
            reservedStock: newReserved,
            available: newAvailable > 0,
            isOrderable: newAvailable > 0,
            updatedAt: now,
          });
        }
      }
    }

    // 2. Mark reservation status as RELEASED
    const resRef = db.collection('inventoryReservations').doc(orderId);
    transaction.set(resRef, { status: 'RELEASED', releasedAt: now, releaseReason: cleanReason }, { merge: true });

    // 3. If paid, post refund disbursement ledger entry
    if (gatewayRefundId) {
      const isCash = orderData.paymentMethod === 'counter_cash';
      const finTxRef = db.collection('financialTransactions').doc(`refund_fin_${gatewayRefundId}`);

      transaction.set(finTxRef, {
        transactionId: finTxRef.id,
        orderId,
        type: 'REFUND_DISBURSEMENT',
        amount: amountToRefundPaise / 100,
        amountPaise: amountToRefundPaise,
        currency: 'INR',
        postings: [
          { account: 'SALES_REVENUE', debitPaise: amountToRefundPaise, creditPaise: 0 },
          { account: isCash ? 'CASH_ON_HAND' : 'GATEWAY_RECEIVABLE', debitPaise: 0, creditPaise: amountToRefundPaise },
        ],
        gatewayTransactionId: gatewayRefundId,
        gatewayOrderId: orderData.gatewayOrderId || 'direct',
        actorId,
        timestamp: now,
        status: 'REFUNDED',
      });

      transaction.update(orderRef, {
        status: 'cancelled',
        paymentStatus: 'refunded',
        refundLifecycleStatus: 'GATEWAY_REFUNDED',
        refundId: gatewayRefundId,
        refundedAt: now,
        amountRefundedPaise: amountToRefundPaise,
        amountRefundablePaise: 0,
        refundReason: cleanReason,
        cancelledAt: now,
        cancelledBy: actorId,
        cancellationReason: cleanReason,
        updatedAt: now,
      });
      transaction.update(db.collection('refundReservations').doc(refundReservationId!), {
        status: 'FINALIZED',
        finalizedAt: now,
      });
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
      metadata: { refundDispatched, refundId: gatewayRefundId, refundReservationId, previousPaymentStatus: orderData.paymentStatus },
    });

    return {
      success: true,
      orderId,
      status: 'cancelled',
      refundDispatched,
      refundId: orderData.paymentStatus === 'paid' ? gatewayRefundId : undefined,
    };
  });

  await updatePublicLiveQueueProjection(db);
  return cancelResult;
});
