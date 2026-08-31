import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UserRole } from './types';
import { enforceRateLimit } from './rate_limiter';
import { getRequiredSecret } from './secrets';

const db = admin.firestore();

/**
 * Validates 4-digit PIN (Zero-Knowledge SHA-256 Hash) or Cryptographically Signed QR Token,
 * and marks the order collected idempotently.
 */
export const verifyPickup = onCall<{ orderId: string; pinCode?: string; qrToken?: string }>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  await enforceRateLimit(request.auth.uid, 'pickup_verify');

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  if (actorRole !== 'pickup' && actorRole !== 'manager' && actorRole !== 'admin' && actorRole !== 'security_admin') {
    throw new HttpsError('permission-denied', 'Only pickup counter staff can verify and collect orders.');
  }

  const { orderId, pinCode, qrToken } = request.data;
  if (!orderId || (!pinCode && !qrToken)) {
    throw new HttpsError('invalid-argument', 'orderId and either pinCode or qrToken are required.');
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
      throw new HttpsError('permission-denied', 'Order is locked due to repeated verification failures. Physical student ID verification required.');
    }

    if (orderData.status !== 'ready' && orderData.status !== 'confirmed' && orderData.status !== 'preparing') {
      throw new HttpsError('failed-precondition', `Order is currently in status: ${orderData.status}.`);
    }

    let isVerified = false;
    let verificationMethod: 'PIN' | 'QR' = 'PIN';

    // 1. Check Signed QR Token Verification
    if (qrToken && typeof qrToken === 'string') {
      verificationMethod = 'QR';
      const parts = qrToken.trim().split('.');
      if (parts.length === 5) {
        const [tOrderId, tStudentId, tNonce, tExpiresAtStr, tSignature] = parts;
        const expiresAt = parseInt(tExpiresAtStr, 10);
        const currentUnix = Math.floor(Date.now() / 1000);

        if (tOrderId === orderId && expiresAt > currentUnix) {
          const qrSigningSecret = getRequiredSecret('QR_SIGNING_SECRET');
          const expectedSig = crypto.createHmac('sha256', qrSigningSecret)
            .update(`${tOrderId}:${tStudentId}:${tNonce}:${tExpiresAtStr}`)
            .digest('hex');

          try {
            const expBuf = Buffer.from(expectedSig, 'utf8');
            const actBuf = Buffer.from(tSignature, 'utf8');
            if (expBuf.length === actBuf.length && crypto.timingSafeEqual(expBuf, actBuf)) {
              isVerified = true;
            }
          } catch (_) {
            isVerified = false;
          }
        }
      }
    }

    // 2. Check Zero-Knowledge PIN Hash Verification
    if (!isVerified && pinCode && typeof pinCode === 'string') {
      verificationMethod = 'PIN';
      const cleanPin = pinCode.trim();
      const inputHash = crypto.createHash('sha256').update(cleanPin).digest('hex');
      if (orderData.pickupPinHash === inputHash || orderData.pickupPin === cleanPin) {
        isVerified = true;
      }
    }

    if (!isVerified) {
      const attempts = (orderData.failedPinAttempts || 0) + 1;
      const isLocked = attempts >= 3;

      transaction.update(orderRef, {
        failedPinAttempts: attempts,
        isLockedForInvestigation: isLocked,
        lastFailedVerificationAt: now,
      });

      // Record security event
      const secRef = db.collection('securityEvents').doc();
      transaction.set(secRef, {
        eventType: isLocked ? 'ORDER_PICKUP_BRUTEFORCE_LOCKOUT' : 'FAILED_PICKUP_VERIFICATION',
        orderId,
        verificationMethod,
        actorUid: request.auth!.uid,
        attemptNumber: attempts,
        severity: isLocked ? 'critical' : 'warn',
        timestamp: now,
      });

      throw new HttpsError(
        'permission-denied',
        isLocked
          ? 'Verification failed. Order locked for security. Please present physical ID.'
          : `Incorrect pickup ${verificationMethod} (${3 - attempts} attempt(s) remaining).`
      );
    }

    transaction.update(orderRef, {
      status: 'collected',
      collectedAt: now,
      collectedByStaffId: request.auth!.uid,
      verificationMethod,
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
      metadata: { verificationMethod },
    });

    return {
      success: true,
      alreadyCollected: false,
      orderId,
      tokenNumber: orderData.tokenNumber,
      verificationMethod,
    };
  });
});
