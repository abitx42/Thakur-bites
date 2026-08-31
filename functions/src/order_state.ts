import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { OrderStatus, UserRole } from './types';
import { enforceRateLimit } from './rate_limiter';

const db = admin.firestore();

/**
 * Operational State Transitions Matrix (Decoupled from Payment States).
 * Payment states are strictly transitioned via PaymentFinalizer, CashSettlement, or RefundEngine.
 */
const ALLOWED_OPERATIONAL_TRANSITIONS: Record<OrderStatus, { next: OrderStatus[]; roles: UserRole[] }[]> = {
  draft: [],
  payment_pending: [], // Payment pending cancellations must go through cancelOrExpirePaymentSession
  paid: [],
  confirmed: [{ next: ['preparing', 'cancelled'], roles: ['kitchen', 'manager', 'admin'] }],
  preparing: [{ next: ['ready', 'cancelled'], roles: ['kitchen', 'manager', 'admin'] }],
  ready: [{ next: ['collected'], roles: ['pickup', 'manager', 'admin'] }],
  collected: [],
  cancelled: [],
};

/**
 * Validates and executes an authoritative kitchen/pickup operational order status transition.
 */
export const updateOrderStatus = onCall<{ orderId: string; nextStatus: OrderStatus }>(async (request) => {
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

  return await db.runTransaction(async (transaction) => {
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
    } else if (nextStatus === 'collected') {
      updates.collectedAt = now;
      updates.collectedByStaffId = actorId;
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
});
