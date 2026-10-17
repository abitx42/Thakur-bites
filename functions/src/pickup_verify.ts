import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UserRole } from './types';
import { enforceRateLimit } from './rate_limiter';
import { getRequiredSecret } from './secrets';
import { logSecurityEvent } from './security_logger';
import { enforceAppCheck } from './app_check';
import { updatePublicLiveQueueProjection } from './tv_projection';
import { assertActiveWorkstationSession } from './shift_pins';
import { enforceAppVersionPolicy } from './version_policy';
import { assertNoHoneytokens } from './honeypot_defense';
import { assertCapability } from './authorization_policy';

const db = admin.firestore();

function pickupRequestData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', 'Pickup request data must be an object.');
  }
  return data as Record<string, unknown>;
}

function pickupOrderId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 ||
      value === '.' || value === '..' || /[/\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpsError('invalid-argument', 'Valid orderId (one document ID, max 128 characters) is required.');
  }
  return value;
}

function pickupAppVersion(value: unknown): string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.length > 64)) {
    throw new HttpsError('invalid-argument', 'appVersion must be a string of at most 64 characters.');
  }
  return value as string | undefined;
}

function storedFailedAttempts(orderData: Record<string, any>, secretData: Record<string, any> | null): number {
  const count = (value: unknown): number => {
    if (value === undefined || value === null) return 0;
    // Corrupt counters must never reset a lockout or participate in string concatenation.
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 3) : 3;
  };
  return Math.max(count(orderData.failedPinAttempts), count(secretData?.failedPinAttempts));
}

function validQrNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validQrExpiry(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Validates a 4-8 digit PIN hash or a cryptographically signed one-time QR token,
 * and atomically marks the order collected. Duplicate collection is rejected.
 *
 * Stage 4 Hardening:
 * 1. Reads cryptographic secrets from isolated `orderSecrets/{orderId}` collection.
 * 2. Explicit stored QR nonce & expiry matching (`tokenNonce === secretDoc.qrNonce`).
 * 3. One-time QR nonce consumption (`qrConsumedAt`).
 * 4. Multi-staff brute force lockout tracking.
 */
export const verifyPickup = onCall<{ orderId: string; pinCode?: string; pin?: string; qrToken?: string; staffVerified?: boolean; appVersion?: string }>(async (request) => {
  const data = pickupRequestData(request.data);
  const orderId = pickupOrderId(data.orderId);
  const appVersion = pickupAppVersion(data.appVersion);
  if (data.staffVerified !== undefined && typeof data.staffVerified !== 'boolean') {
    throw new HttpsError('invalid-argument', 'staffVerified must be a boolean; pickup still requires a PIN or QR token.');
  }
  for (const value of [data.pinCode, data.pin]) {
    if (value !== undefined && (typeof value !== 'string' || !/^[0-9]{4,8}$/.test(value))) {
      throw new HttpsError('invalid-argument', 'PIN must be a 4-8 digit numeric string.');
    }
  }
  const pinCode = (data.pinCode ?? data.pin) as string | undefined;
  if (data.qrToken !== undefined &&
      (typeof data.qrToken !== 'string' || !data.qrToken.trim() || data.qrToken.length > 2048)) {
    throw new HttpsError('invalid-argument', 'QR token must be a non-empty string <= 2048 characters.');
  }
  const qrToken = typeof data.qrToken === 'string' ? data.qrToken.trim() : undefined;
  if (!pinCode && !qrToken) {
    throw new HttpsError('invalid-argument', 'orderId and either pinCode or qrToken are required.');
  }

  await assertNoHoneytokens(data, request.auth?.uid, 'verifyPickup');
  enforceAppCheck(request);
  await enforceAppVersionPolicy(appVersion);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const actorRole = (typeof request.auth.token.role === 'string' ? request.auth.token.role : 'student') as UserRole;
  assertCapability(actorRole, 'verify_pickup', 'Only staff with pickup verification capability can collect orders.');
  await assertActiveWorkstationSession(request.auth.uid, request.auth.token);
  await enforceRateLimit(request.auth.uid, 'pickup_verify');

  const orderRef = db.collection('orders').doc(orderId);
  const secretRef = db.collection('orderSecrets').doc(orderId);

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
    const now = Timestamp.now();

    if (orderData.status === 'collected') {
      throw new HttpsError(
        'failed-precondition',
        `ALREADY_COLLECTED: Order ${orderData.tokenNumber || orderId} was already collected at ${orderData.collectedAt?.toDate()?.toLocaleTimeString() || 'earlier'}. Do not hand over duplicate meal.`
      );
    }

    if (orderData.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'Cannot verify pickup for a cancelled order.');
    }

    // Check if order is locked due to excessive PIN failures
    const failedAttempts = storedFailedAttempts(orderData, secretData);
    const isLocked = secretData?.isLockedForInvestigation || orderData.isLockedForInvestigation;

    if (isLocked || failedAttempts >= 3) {
      throw new HttpsError('permission-denied', 'Order is locked due to repeated verification failures. Physical student ID verification required.');
    }

    // Strict Payment Barrier (SEC-02): Unpaid orders cannot be handed over
    const isPaid = orderData.paymentStatus === 'paid' || orderData.paymentStatus === 'captured';
    if (!isPaid) {
      logSecurityEvent({
        eventType: 'UNPAID_ORDER_PICKUP_ATTEMPTED',
        orderId,
        actorUid: request.auth!.uid,
        severity: 'HIGH',
        details: { paymentStatus: orderData.paymentStatus, paymentMethod: orderData.paymentMethod },
      }).catch(() => {});

      throw new HttpsError(
        'failed-precondition',
        `Cannot release order. Payment status is '${orderData.paymentStatus || 'pending'}'. Customer must complete payment at the cashier counter first.`
      );
    }


    // Order must be in 'ready' status or express ready-made before collection is permitted
    const isReadyOrInstant = orderData.status === 'ready' ||
      (orderData.isOnlyReadyMade === true && ['placed', 'paid', 'confirmed', 'preparing'].includes(orderData.status));

    if (!isReadyOrInstant) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot hand over order. Order is currently in '${orderData.status}' status (must be 'ready' or ready-made).`
      );
    }

    let isVerified = false;
    let verificationMethod: 'PIN' | 'QR' = 'PIN';
    let consumedQr = false;

    // 1. Check Signed One-Time QR Token Verification
    if (qrToken) {
      verificationMethod = 'QR';

      consumedQr = !!(secretData?.qrConsumedAt || orderData.qrConsumedAt);
      // Public/legacy order fields are not a credential authority.
      const storedNonce = secretData?.qrNonce;
      const storedExpiresAt = secretData?.qrExpiresAt;

      const parts = qrToken.split('.');
      if (!consumedQr && secretSnap.exists && validQrNonce(storedNonce) && validQrExpiry(storedExpiresAt) && parts.length === 5) {
        const [tOrderId, tStudentId, tNonce, tExpiresAtStr, tSignature] = parts;
        const expiresAt = Number(tExpiresAtStr);
        const currentUnix = Math.floor(Date.now() / 1000);

        // Explicit Order, Student ID, Nonce, and Expiry Matching
        if (tOrderId === orderId && tStudentId === orderData.studentId && tNonce === storedNonce &&
            tExpiresAtStr === String(storedExpiresAt) && expiresAt > currentUnix && /^[a-fA-F0-9]{64}$/.test(tSignature)) {
          const qrSigningSecret = getRequiredSecret('QR_SIGNING_SECRET');
          const expectedSig = crypto.createHmac('sha256', qrSigningSecret)
            .update(`${tOrderId}:${tStudentId}:${tNonce}:${tExpiresAtStr}`)
            .digest('hex');

          isVerified = crypto.timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(tSignature, 'hex'));
        }
      }
    }

    // 2. Check Zero-Knowledge PIN Hash Verification (PBKDF2 Hardened)
    if (!isVerified && pinCode) {
      verificationMethod = 'PIN';
      const targetHash = secretData?.pickupPinHash;
      const salt = secretData?.salt;

      if (typeof targetHash === 'string' && /^[a-fA-F0-9]{64}$/.test(targetHash)) {
        if (typeof salt === 'string' && salt.length > 0 && salt.length <= 256) {
          const pbkdf2Hash = crypto.pbkdf2Sync(pinCode, salt, 10000, 32, 'sha256');
          isVerified = crypto.timingSafeEqual(Buffer.from(targetHash, 'hex'), pbkdf2Hash);
        }
        // Preserve legacy unsalted hashes, but only from the isolated secret document.
        if (!isVerified) {
          const sha256Hash = crypto.createHash('sha256').update(pinCode).digest();
          isVerified = crypto.timingSafeEqual(Buffer.from(targetHash, 'hex'), sha256Hash);
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
        ...(shouldLock ? { qrConsumedAt: now, qrConsumedBy: 'SYSTEM_LOCKOUT' } : {}),
      });

      transaction.set(secretRef, {
        orderId,
        ...(typeof orderData.studentId === 'string' ? { studentId: orderData.studentId } : {}),
        failedPinAttempts: attempts,
        isLockedForInvestigation: shouldLock,
        updatedAt: now,
        ...(!secretSnap.exists ? { createdAt: now } : {}),
        ...(shouldLock ? { qrConsumedAt: now, qrConsumedBy: 'SYSTEM_LOCKOUT' } : {}),
      }, { merge: true });

      // Returning a rejection outcome lets Firestore commit lockout writes. Throwing
      // here would roll all of them back, including QR revocation on the third miss.
      return { verified: false as const, attempts, shouldLock, verificationMethod, consumedQr };
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

    if (!orderData.readyAt) {
      updates.readyAt = now;
    }

    // Every successful handover retires outstanding QR credentials, including PIN collection.
    updates.qrConsumedAt = now;
    updates.qrConsumedBy = request.auth!.uid;
    transaction.update(secretRef, {
      qrConsumedAt: now,
      qrConsumedBy: request.auth!.uid,
      failedPinAttempts: 0,
      isLockedForInvestigation: false,
      updatedAt: now,
    });

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
      fromStatus: orderData.status || 'ready',
      toStatus: 'collected',
      actorId: request.auth!.uid,
      actorRole,
      verificationMethod,
      timestamp: now,
    });

    return {
      verified: true as const,
      value: {
        success: true,
        orderId,
        status: 'collected',
        tokenNumber: orderData.tokenNumber,
        collectedAt: now,
        verificationMethod,
      },
    };
  });

  if (!verifyResult.verified) {
    logSecurityEvent({
      eventType: verifyResult.shouldLock ? 'ORDER_PICKUP_BRUTEFORCE_LOCKOUT' : 'FAILED_PICKUP_VERIFICATION',
      orderId,
      actorUid: request.auth.uid,
      severity: verifyResult.shouldLock ? 'CRITICAL' : 'LOW',
      details: { verificationMethod: verifyResult.verificationMethod, attemptNumber: verifyResult.attempts },
    }).catch(() => {});
    throw new HttpsError('permission-denied', verifyResult.shouldLock
      ? 'Verification failed. Order locked for security. Please present physical student ID to manager.'
      : verifyResult.consumedQr
        ? 'This QR pickup token has already been consumed.'
        : `Incorrect pickup ${verifyResult.verificationMethod} (${3 - verifyResult.attempts} attempt(s) remaining).`);
  }

  // The authoritative handover has committed. A derived display failure must not
  // tell staff that collection failed and encourage a duplicate physical handover.
  try {
    await updatePublicLiveQueueProjection(db);
  } catch (_) {
    console.warn('[verifyPickup] Collection committed; public queue projection sync failed.', { orderId });
    logSecurityEvent({
      eventType: 'PICKUP_PROJECTION_SYNC_FAILED',
      severity: 'MEDIUM',
      orderId,
      actorUid: request.auth.uid,
      details: { projection: 'publicLiveQueue/current' },
    }).catch(() => {});
  }

  return verifyResult.value;
});

/**
 * Manager/Admin Manual Physical Override for Locked Orders
 */
export const unlockOrderPickupVerification = onCall<{ orderId: string; reason: string }>(async (request) => {
  await assertNoHoneytokens(request.data, request.auth?.uid, 'unlockOrderPickupVerification');
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  await assertActiveWorkstationSession(request.auth.uid, request.auth.token);
  const actorRole = (request.auth.token.role as UserRole) || 'student';
  if (actorRole !== 'manager' && actorRole !== 'admin' && actorRole !== 'security_admin') {
    throw new HttpsError('permission-denied', 'Only managers or administrators can unlock a security-locked order.');
  }

  await enforceRateLimit(request.auth.uid, 'unlock_order');

  const data = pickupRequestData(request.data);
  const orderId = pickupOrderId(data.orderId);
  const reason = data.reason;
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
    throw new HttpsError('invalid-argument', 'A non-empty override reason (max 500 characters) is required.');
  }

  const orderRef = db.collection('orders').doc(orderId);
  const secretRef = db.collection('orderSecrets').doc(orderId);
  const now = Timestamp.now();

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

/**
 * Platform 2.0 Authoritative Student Endpoint to retrieve / refresh Pickup QR Token
 * 
 * Allows students to view or refresh their valid cryptographic QR token for active orders,
 * decoupling QR validity from food preparation delays.
 */
export const getStudentPickupQr = onCall<{ orderId: string; appVersion?: string }>(async (request) => {
  const data = pickupRequestData(request.data);
  const orderId = pickupOrderId(data.orderId);
  const appVersion = pickupAppVersion(data.appVersion);
  await assertNoHoneytokens(data, request.auth?.uid, 'getStudentPickupQr');
  enforceAppCheck(request);
  await enforceAppVersionPolicy(appVersion);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  await enforceRateLimit(request.auth.uid, 'pickup_view');

  const orderRef = db.collection('orders').doc(orderId);
  const secretRef = db.collection('orderSecrets').doc(orderId);
  return await db.runTransaction(async (transaction) => {
    const [orderSnap, secretSnap] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(secretRef),
    ]);

    if (!orderSnap.exists) {
      throw new HttpsError('not-found', 'Order not found.');
    }

    const orderData = orderSnap.data()!;
    if (orderData.studentId !== request.auth!.uid) {
      throw new HttpsError('permission-denied', 'You can only view pickup credentials for your own orders.');
    }

    if (orderData.status === 'collected') {
      throw new HttpsError('failed-precondition', 'Order has already been collected.');
    }

    if (orderData.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'Order has been cancelled.');
    }

    const secretData = secretSnap.exists ? secretSnap.data()! : null;
    const isLocked = secretData?.isLockedForInvestigation || orderData.isLockedForInvestigation;
    if (isLocked || storedFailedAttempts(orderData, secretData) >= 3) {
      throw new HttpsError('permission-denied', 'Order is locked for security. Please present physical ID to manager.');
    }
    if (secretData?.qrConsumedAt || orderData.qrConsumedAt) {
      throw new HttpsError('permission-denied', 'This QR pickup token has already been consumed.');
    }

    const now = Timestamp.now();
    const currentUnix = Math.floor(Date.now() / 1000);
    let qrNonce = secretData?.qrNonce;
    let qrExpiresAt = secretData?.qrExpiresAt;

    // Missing, malformed and expired credentials are rotated and persisted in the
    // same transaction. A failed commit never releases an unstored signed token.
    if (!validQrNonce(qrNonce) || !validQrExpiry(qrExpiresAt) || currentUnix >= qrExpiresAt) {
      qrNonce = crypto.randomBytes(16).toString('hex');
      qrExpiresAt = currentUnix + 14400; // 4 hours from now

      transaction.set(secretRef, {
        orderId,
        studentId: request.auth!.uid,
        qrNonce,
        qrExpiresAt,
        updatedAt: now,
        ...(!secretSnap.exists ? {
          createdAt: now,
          failedPinAttempts: storedFailedAttempts(orderData, secretData),
          isLockedForInvestigation: false,
        } : {}),
      }, { merge: true });
    }

    const qrSigningSecret = getRequiredSecret('QR_SIGNING_SECRET');
    const qrSignature = crypto.createHmac('sha256', qrSigningSecret)
      .update(`${orderId}:${orderData.studentId}:${qrNonce}:${qrExpiresAt}`)
      .digest('hex');

    const signedQrPayload = `${orderId}.${orderData.studentId}.${qrNonce}.${qrExpiresAt}.${qrSignature}`;

    return {
      success: true,
      orderId,
      signedQrPayload,
      qrExpiresAt,
      tokenNumber: orderData.tokenNumber,
      status: orderData.status,
    };
  });
});
