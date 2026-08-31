import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UserRole } from './types';
import { enforceRateLimit } from './rate_limiter';
import { getRequiredSecret } from './secrets';

const db = admin.firestore();

/**
 * Validates 4-digit PIN (Zero-Knowledge SHA-256 Hash) or Cryptographically Signed One-Time QR Token,
 * and marks the order collected idempotently.
 *
 * P0 Hardening:
 * 1. Only orders with status == 'ready' can be collected.
 * 2. Explicit studentId binding in QR tokens.
 * 3. One-time QR nonce consumption (qrConsumedAt guard).
 * 4. Zero legacy plaintext PIN fallback.
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

    // P0: 7: Order must be in 'ready' status before collection is permitted
    if (orderData.status !== 'ready') {
      throw new HttpsError(
        'failed-precondition',
        `Cannot hand over order. Order is currently in '${orderData.status}' status (must be 'ready').`
      );
    }

    let isVerified = false;
    let verificationMethod: 'PIN' | 'QR' = 'PIN';

    // 1. Check Signed One-Time QR Token Verification (P0: 5 & 6)
    if (qrToken && typeof qrToken === 'string') {
      verificationMethod = 'QR';

      // Check if QR token was already consumed
      if (orderData.qrConsumedAt) {
        throw new HttpsError('permission-denied', 'This QR pickup token has already been consumed.');
      }

      const parts = qrToken.trim().split('.');
      if (parts.length === 5) {
        const [tOrderId, tStudentId, tNonce, tExpiresAtStr, tSignature] = parts;
        const expiresAt = parseInt(tExpiresAtStr, 10);
        const currentUnix = Math.floor(Date.now() / 1000);

        // Explicit Order & Student ID Binding (P0: 6)
        if (tOrderId === orderId && tStudentId === orderData.studentId && expiresAt > currentUnix) {
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

    // 2. Check Zero-Knowledge PIN Hash Verification (P0: 8: Strict Hash Match Only)
    if (!isVerified && pinCode && typeof pinCode === 'string') {
      verificationMethod = 'PIN';
      const cleanPin = pinCode.trim();
      const inputHash = crypto.createHash('sha256').update(cleanPin).digest('hex');
      if (orderData.pickupPinHash === inputHash) {
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
          ? 'Verification failed. Order locked for security. Please present physical student ID to manager.'
          : `Incorrect pickup ${verificationMethod} (${3 - attempts} attempt(s) remaining).`
      );
    }

    // Atomic update with QR consumption and status transition
    transaction.update(orderRef, {
      status: 'collected',
      collectedAt: now,
      collectedByStaffId: request.auth!.uid,
      verificationMethod,
      qrConsumedAt: verificationMethod === 'QR' ? now : null,
      qrConsumedBy: verificationMethod === 'QR' ? request.auth!.uid : null,
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
