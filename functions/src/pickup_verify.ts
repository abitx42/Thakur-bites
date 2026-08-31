import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UserRole } from './types';

const db = admin.firestore();

/**
 * Validates 4-digit PIN / QR hash and marks the order collected idempotently.
 */
export const verifyPickup = onCall<{ orderId: string; pinCode: string }>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  if (actorRole !== 'pickup' && actorRole !== 'manager' && actorRole !== 'admin' && actorRole !== 'security_admin') {
    throw new HttpsError('permission-denied', 'Only pickup counter staff can verify and collect orders.');
  }

  const { orderId, pinCode } = request.data;
  if (!orderId || !pinCode) {
    throw new HttpsError('invalid-argument', 'orderId and pinCode are required.');
  }

  const orderRef = db.collection('orders').doc(orderId);
  const now = admin.firestore.Timestamp.now();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Order not found.');
    }

    const orderData = snap.data()!;
    if (orderData.status === 'collected') {
      return { success: true, alreadyCollected: true, message: 'Order has already been collected.' };
    }

    if (orderData.status !== 'ready' && orderData.status !== 'confirmed' && orderData.status !== 'preparing') {
      throw new HttpsError('failed-precondition', `Order is currently in status: ${orderData.status}.`);
    }

    // Verify PIN or hash match
    const inputHash = crypto.createHash('sha256').update(pinCode.trim()).digest('hex');
    const isPinMatch = orderData.pickupPin === pinCode.trim() || orderData.pickupPinHash === inputHash;

    if (!isPinMatch) {
      // Record failed attempt
      const secRef = db.collection('securityEvents').doc();
      transaction.set(secRef, {
        eventType: 'FAILED_PICKUP_VERIFICATION',
        orderId,
        actorUid: request.auth!.uid,
        timestamp: now,
      });

      throw new HttpsError('permission-denied', 'Incorrect pickup PIN/QR code.');
    }

    transaction.update(orderRef, {
      status: 'collected',
      collectedAt: now,
      collectedByStaffId: request.auth!.uid,
      verificationMethod: 'PIN',
      updatedAt: now,
    });

    // Record immutable orderEvent
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: orderData.status,
      toStatus: 'collected',
      actorId: request.auth!.uid,
      actorRole,
      timestamp: now,
      metadata: { verificationMethod: 'PIN' },
    });

    return { success: true, alreadyCollected: false, orderId, tokenNumber: orderData.tokenNumber };
  });
});
