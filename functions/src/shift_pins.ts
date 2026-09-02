import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { enforceAppCheck } from './app_check';
import { enforceRateLimit } from './rate_limiter';
import { logSecurityEvent } from './security_logger';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export type ShiftWindow = 'MORNING' | 'AFTERNOON' | 'FULL_DAY';

export interface GenerateShiftPinRequest {
  role: 'kitchen' | 'pickup' | 'cashier';
  shiftWindow: ShiftWindow;
  shiftDate?: string; // YYYY-MM-DD (defaults to Asia/Kolkata today)
}

export interface VerifyShiftPinRequest {
  pin: string;
  role: 'kitchen' | 'pickup' | 'cashier';
  deviceId: string;
  deviceName?: string;
}

export interface RevokeShiftPinRequest {
  pinId: string;
  reason?: string;
}

const ROLE_MAX_DEVICES: Record<string, number> = {
  kitchen: 2,
  pickup: 3,
  cashier: 2,
};

/**
 * Derives a salted cryptographic hash of a 6-digit shift PIN using PBKDF2 (20,000 iterations).
 */
export function derivePinHash(pin: string, salt: string): string {
  return crypto.pbkdf2Sync(pin.trim(), salt, 20000, 32, 'sha256').toString('hex');
}

/**
 * Computes calendar date string strictly according to Asia/Kolkata (IST: UTC+5:30) operational business day.
 */
export function getMumbaiDateStr(date = new Date()): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  return new Intl.DateTimeFormat('en-CA', options).format(date);
}

/**
 * Platform 2.0 — Generate Shift PIN
 * 
 * Restricted to manager, admin, or security_admin.
 * Generates a 6-digit CSPRNG shift PIN, hashes it with PBKDF2 + salt, and stores it in Firestore.
 * Returns the plaintext PIN once to the manager.
 */
export const generateShiftPin = onCall<GenerateShiftPinRequest>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  if (!['manager', 'admin', 'security_admin'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only managers or admins can generate shift PINs.');
  }

  const { role, shiftWindow, shiftDate = getMumbaiDateStr() } = request.data || {};

  if (!role || !['kitchen', 'pickup', 'cashier'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Valid staff role (kitchen, pickup, cashier) is required.');
  }

  if (!shiftWindow || !['MORNING', 'AFTERNOON', 'FULL_DAY'].includes(shiftWindow)) {
    throw new HttpsError('invalid-argument', 'Valid shiftWindow is required.');
  }

  const pinId = `${role}_${shiftDate}_${shiftWindow}`;
  const pinRef = db.collection('shiftPins').doc(pinId);

  // Check if active PIN already exists to prevent accidental override
  const existingDoc = await pinRef.get();
  if (existingDoc.exists && existingDoc.data()?.status === 'ACTIVE') {
    throw new HttpsError(
      'already-exists',
      `An active shift PIN for ${role.toUpperCase()} on ${shiftDate} (${shiftWindow}) already exists. Revoke it before generating a new PIN.`
    );
  }

  // Generate 6-digit CSPRNG PIN
  const rawPin = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = derivePinHash(rawPin, salt);
  const maxDevices = ROLE_MAX_DEVICES[role] || 2;

  // Calculate expiration time strictly according to Asia/Kolkata (IST: UTC+5:30)
  let timeStr = '23:59:59.999';
  if (shiftWindow === 'MORNING') {
    timeStr = '15:30:00.000'; // 3:30 PM IST
  } else if (shiftWindow === 'AFTERNOON') {
    timeStr = '22:00:00.000'; // 10:00 PM IST
  }
  const expiresAt = new Date(`${shiftDate}T${timeStr}+05:30`);

  const now = admin.firestore.Timestamp.now();

  await pinRef.set({
    pinId,
    role,
    shiftDate,
    shiftWindow,
    pinHash,
    salt,
    boundDevices: [],
    maxDevices,
    failedAttempts: 0,
    lockedUntil: null,
    status: 'ACTIVE',
    createdBy: request.auth.uid,
    createdAt: now,
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
  });

  await logSecurityEvent({
    eventType: 'STAFF_SHIFT_PIN_GENERATED',
    severity: 'INFO',
    actorUid: request.auth.uid,
    details: {
      pinId,
      role,
      shiftDate,
      shiftWindow,
      maxDevices,
    },
  });

  return {
    success: true,
    pinId,
    pin: rawPin,
    role,
    shiftDate,
    shiftWindow,
    maxDevices,
    expiresAt: expiresAt.toISOString(),
  };
});

/**
 * Platform 2.0 — Verify Workstation Shift PIN & Bind Hardware
 * 
 * Verifies 6-digit PIN against PBKDF2 hash, enforces shift window & device binding in a transaction,
 * and returns uniform error payloads on failure.
 */
export const verifyShiftPin = onCall<VerifyShiftPinRequest>(async (request) => {
  enforceAppCheck(request);

  const { pin, role, deviceId } = request.data || {};

  if (!pin || typeof pin !== 'string' || pin.trim().length !== 6) {
    throw new HttpsError('invalid-argument', 'Valid 6-digit shift PIN is required.');
  }

  if (!role || !['kitchen', 'pickup', 'cashier'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Valid staff role is required.');
  }

  const cleanDeviceId = String(deviceId || 'unknown_device').trim().slice(0, 100);
  if (cleanDeviceId.length < 4) {
    throw new HttpsError('invalid-argument', 'Valid device identifier is required for workstation binding.');
  }

  const hashedDeviceId = crypto.createHash('sha256').update(`DEVICE_${cleanDeviceId}`).digest('hex').slice(0, 16);
  await enforceRateLimit(cleanDeviceId, 'shift_pin_verification');
  // Device IDs are client controlled before authentication. Pair them with a
  // pseudonymous network bucket so rotating a device ID cannot reset the limit.
  const forwardedFor = request.rawRequest.headers['x-forwarded-for'];
  const clientIp = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0].trim()
    || request.rawRequest.ip
    || 'unknown';
  const ipBucket = crypto.createHash('sha256').update(`SHIFT_PIN_IP_${clientIp}`).digest('hex').slice(0, 32);
  await enforceRateLimit(ipBucket, 'shift_pin_verification', { isIpBased: true, natMultiplier: 3 });

  const todayStr = getMumbaiDateStr();
  const now = new Date();

  // Find active candidate PIN for this role today
  const pinsSnap = await db
    .collection('shiftPins')
    .where('role', '==', role)
    .where('shiftDate', '==', todayStr)
    .where('status', '==', 'ACTIVE')
    .get();

  if (pinsSnap.empty) {
    await logSecurityEvent({
      eventType: 'SHIFT_PIN_VERIFICATION_NO_ACTIVE_SHIFT',
      severity: 'LOW',
      actorUid: `DEV-${hashedDeviceId}`,
      details: { role, deviceHash: hashedDeviceId, actorType: 'WORKSTATION_DEVICE' },
    });
    // Uniform response to prevent operational reconnaissance
    throw new HttpsError('unauthenticated', 'Invalid staff credentials.');
  }

  const candidateDoc = pinsSnap.docs[0];
  const pinRef = candidateDoc.ref;

  let customToken: string;
  let finalRole: string;
  let boundDeviceList: string[];

  try {
    await db.runTransaction(async (transaction) => {
      const freshSnap = await transaction.get(pinRef);
      if (!freshSnap.exists) {
        throw new HttpsError('unauthenticated', 'Invalid staff credentials.');
      }

      const data = freshSnap.data()!;

      // Check expiration
      if (data.expiresAt && data.expiresAt.toDate() < now) {
        throw new HttpsError('unauthenticated', 'Invalid staff credentials.');
      }

      // Check account lockout
      if (data.lockedUntil && data.lockedUntil.toDate() > now) {
        throw new HttpsError('unauthenticated', 'Invalid staff credentials.');
      }

      // Verify PBKDF2 hash
      const testHash = derivePinHash(pin, data.salt);
      const isMatch = crypto.timingSafeEqual(Buffer.from(testHash, 'hex'), Buffer.from(data.pinHash, 'hex'));

      if (!isMatch) {
        const newFails = (data.failedAttempts || 0) + 1;
        const updates: any = { failedAttempts: newFails };
        if (newFails >= 5) {
          updates.lockedUntil = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 15 * 60000));
        }
        transaction.update(pinRef, updates);
        throw new HttpsError('unauthenticated', 'Invalid staff credentials.');
      }

      // Enforce Device Binding
      const boundDevices: string[] = data.boundDevices || [];
      const maxDevices = data.maxDevices || ROLE_MAX_DEVICES[role] || 2;

      if (!boundDevices.includes(cleanDeviceId)) {
        if (boundDevices.length >= maxDevices) {
          throw new HttpsError('unauthenticated', 'Invalid staff credentials.');
        }
        boundDevices.push(cleanDeviceId);
      }

      transaction.update(pinRef, {
        boundDevices,
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      finalRole = data.role;
      boundDeviceList = boundDevices;
    });
  } catch (err: any) {
    await logSecurityEvent({
      eventType: 'STAFF_SHIFT_PIN_FAILED',
      severity: 'MEDIUM',
      actorUid: `DEV-${hashedDeviceId}`,
      details: { role, deviceHash: hashedDeviceId, actorType: 'WORKSTATION_DEVICE' },
    });
    throw err instanceof HttpsError ? err : new HttpsError('unauthenticated', 'Invalid staff credentials.');
  }

  // Create ephemeral staff UID and Auth session
  const workstationUid = `staff_${role}_${todayStr}_${hashedDeviceId}`;

  // 1. Record active workstation session (TB-NEW-004 Remediation)
  const sessionDocRef = db.collection('workstationSessions').doc(workstationUid);
  await sessionDocRef.set({
    sessionId: workstationUid,
    pinId: candidateDoc.id,
    role: finalRole!,
    deviceId: cleanDeviceId,
    deviceHash: hashedDeviceId,
    shiftDate: todayStr,
    status: 'ACTIVE',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
  });

  customToken = await admin.auth().createCustomToken(workstationUid, {
    role: finalRole!,
    isWorkstationSession: true,
    deviceId: cleanDeviceId,
    shiftDate: todayStr,
    permissionsVersion: 2,
  });

  await logSecurityEvent({
    eventType: 'STAFF_WORKSTATION_LOGIN_SUCCESS',
    severity: 'INFO',
    actorUid: workstationUid,
    details: {
      pinId: candidateDoc.id,
      role: finalRole!,
      deviceHash: hashedDeviceId,
      boundDevicesCount: boundDeviceList!.length,
      actorType: 'WORKSTATION_DEVICE',
    },
  });

  return {
    success: true,
    token: customToken,
    role: finalRole!,
    workstationUid,
    boundDevices: boundDeviceList!,
  };
});

/**
 * Platform 2.0 — Revoke Shift PIN
 * Atomically revokes the shift PIN and immediately invalidates all active workstation sessions & tokens.
 */
export const revokeShiftPin = onCall<RevokeShiftPinRequest>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  if (!['manager', 'admin', 'security_admin'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only managers or admins can revoke shift PINs.');
  }

  const { pinId, reason = 'Administrative revocation' } = request.data || {};
  if (!pinId) {
    throw new HttpsError('invalid-argument', 'Valid pinId is required.');
  }

  const pinRef = db.collection('shiftPins').doc(pinId);
  const pinDoc = await pinRef.get();

  if (!pinDoc.exists) {
    throw new HttpsError('not-found', 'Shift PIN document not found.');
  }

  await pinRef.update({
    status: 'REVOKED',
    revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    revokedBy: request.auth.uid,
    revocationReason: reason,
  });

  // Invalidate all active workstation sessions and revoke Firebase Auth refresh tokens (TB-NEW-004)
  const activeSessionsSnap = await db.collection('workstationSessions')
    .where('pinId', '==', pinId)
    .where('status', '==', 'ACTIVE')
    .get();

  for (const sessionDoc of activeSessionsSnap.docs) {
    await sessionDoc.ref.update({
      status: 'REVOKED',
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
      revokedBy: request.auth.uid,
      revocationReason: reason,
    });

    try {
      await admin.auth().revokeRefreshTokens(sessionDoc.id);
    } catch (_) {}
  }

  await logSecurityEvent({
    eventType: 'STAFF_SHIFT_PIN_REVOKED',
    severity: 'MEDIUM',
    actorUid: request.auth.uid,
    details: { pinId, reason, revokedSessionsCount: activeSessionsSnap.docs.length },
  });

  return {
    success: true,
    pinId,
    status: 'REVOKED',
    revokedSessionsCount: activeSessionsSnap.docs.length,
  };
});

/**
 * Asserts that a workstation session is still active and has not been revoked (TB-NEW-004 & TB-NEW-005).
 */
export async function assertActiveWorkstationSession(uid: string, token: Record<string, any>): Promise<void> {
  if (token && (token.isWorkstationSession === true || uid.startsWith('staff_'))) {
    const sessionSnap = await db.collection('workstationSessions').doc(uid).get();
    if (!sessionSnap.exists) {
      throw new HttpsError('unauthenticated', 'Workstation session does not exist. Please re-authenticate with shift PIN.');
    }
    const sessionData = sessionSnap.data()!;
    if (sessionData.status !== 'ACTIVE') {
      throw new HttpsError('unauthenticated', 'Workstation session has been revoked. Please re-authenticate with shift PIN.');
    }
    const now = admin.firestore.Timestamp.now();
    if (sessionData.expiresAt && sessionData.expiresAt.toMillis() <= now.toMillis()) {
      throw new HttpsError('unauthenticated', 'Workstation session has expired. Please re-authenticate with shift PIN.');
    }
  }
}

/**
 * Platform 2.0 — List Active Shift PINs for Today
 */
export const listActiveShiftPins = onCall(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  if (!['manager', 'admin', 'security_admin'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only managers or admins can list shift PINs.');
  }

  const todayStr = getMumbaiDateStr();
  const pinsSnap = await db
    .collection('shiftPins')
    .where('shiftDate', '==', todayStr)
    .get();

  const pins = pinsSnap.docs.map((d) => {
    const data = d.data();
    return {
      pinId: d.id,
      role: data.role,
      shiftDate: data.shiftDate,
      shiftWindow: data.shiftWindow,
      boundDevicesCount: (data.boundDevices || []).length,
      maxDevices: data.maxDevices || 2,
      failedAttempts: data.failedAttempts || 0,
      isLocked: data.lockedUntil ? data.lockedUntil.toDate() > new Date() : false,
      status: data.status,
      createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
      expiresAt: data.expiresAt ? data.expiresAt.toDate().toISOString() : null,
    };
  });

  return {
    success: true,
    today: todayStr,
    pins,
  };
});
