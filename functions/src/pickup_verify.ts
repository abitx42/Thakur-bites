import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UserRole } from './types';
import { enforceRateLimit } from './rate_limiter';

const db = admin.firestore();

/**
 * Validates 4-digit PIN / QR hash and marks the order collected idempotently.
 * Fix 6: Protects against PIN brute-forcing with per-order lockout.
 */
export const verifyPickup = onCall<{ orderId: string; pinCode: string }>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  await enforceRateLimit(request.auth.uid, 'pickup_verify');

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

    // Check if order is locked due to excessive PIN failures
    if (orderData.isLockedForInvestigation || (orderData.failedPinAttempts || 0) >= 3) {
      throw new HttpsError('permission-denied', 'Order is locked due to repeated PIN failures. Manager verification required.');
    }

    if (orderData.status !== 'ready' && orderData.status !== 'confirmed' && orderData.status !== 'preparing') {
      throw new HttpsError('failed-precondition', `Order is currently in status: ${orderData.status}.`);
    }

    // Verify PIN or hash match
    const cleanPin = pinCode.trim();
    const inputHash = crypto.createHash('sha256').update(cleanPin).digest('hex');
    const isPinMatch = orderData.pickupPin === cleanPin || orderData.pickupPinHash === inputHash;

    if (!isPinMatch) {
      const attempts = (orderData.failedPinAttempts || 0) + 1;
      const isLocked = attempts >= 3;

      transaction.update(orderRef, {
        failedPinAttempts: attempts,
        isLockedForInvestigation: isLocked,
        lastFailedPinAt: now,
      });

      // Record security event
      const secRef = db.collection('securityEvents').doc();
      transaction.set(secRef, {
        eventType: isLocked ? 'ORDER_PIN_BRUTEFORCE_LOCKOUT' : 'FAILED_PICKUP_VERIFICATION',
        orderId,
        actorUid: request.auth!.uid,
        attemptNumber: attempts,
        severity: isLocked ? 'critical' : 'warn',
        timestamp: now,
      });

      throw new HttpsError(
        'permission-denied',
        isLocked
          ? 'Incorrect PIN. Order locked for security. Please present physical ID.'
          : `Incorrect pickup PIN (${3 - attempts} attempt(s) remaining).`
      );
    }

    transaction.update(orderRef, {
      status: 'collected',
      collectedAt: now,
      collectedByStaffId: request.auth!.uid,
      verificationMethod: 'PIN',
      failedPinAttempts: 0,
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
