import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UserRole } from './types';
import { enforceRateLimit } from './rate_limiter';
import { getRequiredSecret } from './secrets';
import { logSecurityEvent } from './security_logger';
import { enforceAppCheck } from './app_check';
import { updatePublicLiveQueueProjection } from './tv_projection';

const db = admin.firestore();

/**
 * Validates 6-digit PIN (Zero-Knowledge SHA-256 Hash) or Cryptographically Signed One-Time QR Token,
 * and marks the order collected idempotently.
 *
 * Stage 4 Hardening:
 * 1. Reads cryptographic secrets from isolated `orderSecrets/{orderId}` collection.
 * 2. Explicit stored QR nonce & expiry matching (`tokenNonce === secretDoc.qrNonce`).
 * 3. One-time QR nonce consumption (`qrConsumedAt`).
 * 4. Multi-staff brute force lockout tracking.
 */
export const verifyPickup = onCall<{ orderId: string; pinCode?: string; qrToken?: string }>(async (request) => {
  enforceAppCheck(request);
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
  const secretRef = db.collection('orderSecrets').doc(orderId);
  const now = admin.firestore.Timestamp.now();

  const verifyResult = await db.runTransaction(async (transaction) => {
    const [orderSnap, secretSnap] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(secretRef),
    ]);

    if (!orderSnap.exists) {
      throw new HttpsError('not-found', 'Order not found.');
    }

    const orderData = orderSnap.data()!;
    const secretData = secretSnap.exists ? secretSnap.data()! : null;

    if (orderData.status === 'collected') {
      return { success: true, alreadyCollected: true, message: 'Order has already been collected.' };
    }

    // Check if order is locked due to excessive PIN failures
    const failedAttempts = secretData?.failedPinAttempts ?? orderData.failedPinAttempts ?? 0;
    const isLocked = secretData?.isLockedForInvestigation ?? orderData.isLockedForInvestigation ?? (failedAttempts >= 3);

    if (isLocked || failedAttempts >= 3) {
      throw new HttpsError('permission-denied', 'Order is locked due to repeated verification failures. Physical student ID verification required.');
    }

    // Order must be in 'ready' status before collection is permitted
    if (orderData.status !== 'ready') {
      throw new HttpsError(
        'failed-precondition',
        `Cannot hand over order. Order is currently in '${orderData.status}' status (must be 'ready').`
      );
    }

    let isVerified = false;
    let verificationMethod: 'PIN' | 'QR' = 'PIN';

    // 1. Check Signed One-Time QR Token Verification
    if (qrToken && typeof qrToken === 'string') {
      verificationMethod = 'QR';

      const isConsumed = !!(secretData?.qrConsumedAt || orderData.qrConsumedAt);
      if (isConsumed) {
        throw new HttpsError('permission-denied', 'This QR pickup token has already been consumed.');
      }

      const storedNonce = secretData?.qrNonce || orderData.qrNonce;
      const storedExpiresAt = secretData?.qrExpiresAt || orderData.qrExpiresAt;

      const parts = qrToken.trim().split('.');
      if (parts.length === 5) {
        const [tOrderId, tStudentId, tNonce, tExpiresAtStr, tSignature] = parts;
        const expiresAt = parseInt(tExpiresAtStr, 10);
        const currentUnix = Math.floor(Date.now() / 1000);

        // Explicit Order, Student ID, Nonce, and Expiry Matching
        const isNonceValid = storedNonce ? tNonce === storedNonce : true;
        const isExpiryValid = storedExpiresAt ? expiresAt === storedExpiresAt : true;

        if (tOrderId === orderId && tStudentId === orderData.studentId && isNonceValid && isExpiryValid && expiresAt > currentUnix) {
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

    // 2. Check Zero-Knowledge PIN Hash Verification (PBKDF2 Hardened)
    if (!isVerified && pinCode && typeof pinCode === 'string') {
      verificationMethod = 'PIN';
      const cleanPin = pinCode.trim();
      const targetHash = secretData?.pickupPinHash || orderData.pickupPinHash;
      const salt = secretData?.salt || orderData?.salt || '';

      if (targetHash) {
        if (salt) {
          const pbkdf2Hash = crypto.pbkdf2Sync(cleanPin, salt, 10000, 32, 'sha256').toString('hex');
          const expBuf = Buffer.from(targetHash, 'hex');
          const actBuf = Buffer.from(pbkdf2Hash, 'hex');
          if (expBuf.length === actBuf.length && crypto.timingSafeEqual(expBuf, actBuf)) {
            isVerified = true;
          }
        }
        // Legacy SHA-256 fallback
        if (!isVerified) {
          const sha256Hash = crypto.createHash('sha256').update(cleanPin).digest('hex');
          const expBuf = Buffer.from(targetHash, 'hex');
          const actBuf = Buffer.from(sha256Hash, 'hex');
          if (expBuf.length === actBuf.length && crypto.timingSafeEqual(expBuf, actBuf)) {
            isVerified = true;
          }
        }
      }
    }

    if (!isVerified) {
      const attempts = failedAttempts + 1;
      const shouldLock = attempts >= 3;

      transaction.update(orderRef, {
        failedPinAttempts: attempts,
        isLockedForInvestigation: shouldLock,
        lastFailedVerificationAt: now,
      });

      if (secretSnap.exists) {
        transaction.update(secretRef, {
          failedPinAttempts: attempts,
          isLockedForInvestigation: shouldLock,
          updatedAt: now,
        });
      }

      // Record centralized security event
      logSecurityEvent({
        eventType: shouldLock ? 'ORDER_PICKUP_BRUTEFORCE_LOCKOUT' : 'FAILED_PICKUP_VERIFICATION',
        orderId,
        actorUid: request.auth!.uid,
        severity: shouldLock ? 'CRITICAL' : 'LOW',
        details: { verificationMethod, attemptNumber: attempts },
      }).catch(() => {});

      throw new HttpsError(
        'permission-denied',
        shouldLock
          ? 'Verification failed. Order locked for security. Please present physical student ID to manager.'
          : `Incorrect pickup ${verificationMethod} (${3 - attempts} attempt(s) remaining).`
      );
    }

    // 3. Mark Order as Collected
    const updates: Record<string, any> = {
      status: 'collected',
      collectedAt: now,
      collectedByStaffId: request.auth!.uid,
      updatedAt: now,
      failedPinAttempts: 0,
      isLockedForInvestigation: false,
    };

    if (verificationMethod === 'QR') {
      updates.qrConsumedAt = now;
      updates.qrConsumedBy = request.auth!.uid;

      if (secretSnap.exists) {
        transaction.update(secretRef, {
          qrConsumedAt: now,
          qrConsumedBy: request.auth!.uid,
          updatedAt: now,
        });
      }
    }

    transaction.update(orderRef, updates);

    // Release Faculty Priority Lock (TB-004) so faculty can place another priority order
    if (orderData.studentId) {
      const facultyLockRef = db.collection('facultyPriorityLocks').doc(orderData.studentId);
      transaction.delete(facultyLockRef);
    }

    // Record immutable order event
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: 'ready',
      toStatus: 'collected',
      actorId: request.auth!.uid,
      actorRole,
      verificationMethod,
      timestamp: now,
    });

    return {
      success: true,
      orderId,
      status: 'collected',
      tokenNumber: orderData.tokenNumber,
      collectedAt: now,
      verificationMethod,
    };
  });

  // Asynchronously synchronize the single ephemeral publicLiveQueue/current document
  await updatePublicLiveQueueProjection(db);

  return verifyResult;
});

/**
 * Manager/Admin Manual Physical Override for Locked Orders
 */
export const unlockOrderPickupVerification = onCall<{ orderId: string; reason: string }>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  if (actorRole !== 'manager' && actorRole !== 'admin' && actorRole !== 'security_admin') {
    throw new HttpsError('permission-denied', 'Only managers or administrators can unlock a security-locked order.');
  }

  await enforceRateLimit(request.auth.uid, 'unlock_order');

  const { orderId, reason } = request.data;
  if (!orderId || !reason || reason.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'orderId and a non-empty override reason are required.');
  }

  const orderRef = db.collection('orders').doc(orderId);
  const secretRef = db.collection('orderSecrets').doc(orderId);
  const now = admin.firestore.Timestamp.now();

  return await db.runTransaction(async (transaction) => {
    const [snap, secretSnap] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(secretRef),
    ]);

    if (!snap.exists) {
      throw new HttpsError('not-found', 'Order not found.');
    }

    transaction.update(orderRef, {
      failedPinAttempts: 0,
      isLockedForInvestigation: false,
      unlockedByStaffId: request.auth!.uid,
      unlockedAt: now,
      unlockReason: reason,
      updatedAt: now,
    });

    if (secretSnap.exists) {
      transaction.update(secretRef, {
        failedPinAttempts: 0,
        isLockedForInvestigation: false,
        updatedAt: now,
      });
    }

    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: snap.data()!.status,
      toStatus: snap.data()!.status,
      actorId: request.auth!.uid,
      actorRole,
      timestamp: now,
      reason: `MANAGER_UNLOCK_OVERRIDE: ${reason}`,
    });

    return { success: true, orderId, unlockedAt: now };
  });
});
