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
  shiftDate?: string; // YYYY-MM-DD (defaults to today)
  maxDevices?: number;
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

function hashPin(pin: string, salt: string): string {
  return crypto.createHash('sha256').update(`${pin.trim()}_${salt}`).digest('hex');
}

function getTodayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Platform 2.0 — Generate Shift PIN
 * 
 * Restricted to manager, admin, or security_admin.
 * Generates a 6-digit CSPRNG shift PIN, hashes it with salt, and stores it in Firestore.
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

  const { role, shiftWindow, shiftDate = getTodayDateStr(), maxDevices = 2 } = request.data || {};

  if (!role || !['kitchen', 'pickup', 'cashier'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Valid staff role (kitchen, pickup, cashier) is required.');
  }

  if (!shiftWindow || !['MORNING', 'AFTERNOON', 'FULL_DAY'].includes(shiftWindow)) {
    throw new HttpsError('invalid-argument', 'Valid shiftWindow is required.');
  }

  const pinId = `${role}_${shiftDate}_${shiftWindow}`;
  const pinRef = db.collection('shiftPins').doc(pinId);

  // Generate 6-digit CSPRNG PIN
  const rawPin = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = hashPin(rawPin, salt);

  // Calculate expiration time (End of shift + 1 hour buffer)
  const expiresAt = new Date();
  if (shiftWindow === 'MORNING') {
    expiresAt.setHours(15, 30, 0, 0); // 3:30 PM
  } else if (shiftWindow === 'AFTERNOON') {
    expiresAt.setHours(22, 0, 0, 0); // 10:00 PM
  } else {
    expiresAt.setHours(23, 59, 59, 999);
  }

  const now = admin.firestore.Timestamp.now();

  await pinRef.set({
    pinId,
    role,
    shiftDate,
    shiftWindow,
    pinHash,
    salt,
    boundDevices: [],
    maxDevices: Math.min(5, Math.max(1, maxDevices)),
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
    details: { pinId, role, shiftWindow, shiftDate },
  });

  return {
    success: true,
    pinId,
    role,
    shiftWindow,
    shiftDate,
    pin: rawPin, // Returned ONCE to manager for physical distribution/printing
    expiresAt: expiresAt.toISOString(),
  };
});

/**
 * Platform 2.0 — Verify Shift PIN and Authenticate Staff Workstation
 * 
 * Verifies 6-digit PIN against salt & hash, enforces shift window & device binding,
 * and creates a custom Firebase Auth session with appropriate staff claims.
 */
export const verifyShiftPin = onCall<VerifyShiftPinRequest>(async (request) => {
  enforceAppCheck(request);

  const { pin, role, deviceId, deviceName } = request.data || {};

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

  await enforceRateLimit(cleanDeviceId, 'shift_pin_verification');

  const todayStr = getTodayDateStr();
  const now = new Date();

  // Find active PIN for this role today
  const pinsSnap = await db
    .collection('shiftPins')
    .where('role', '==', role)
    .where('shiftDate', '==', todayStr)
    .where('status', '==', 'ACTIVE')
    .get();

  if (pinsSnap.empty) {
    throw new HttpsError('not-found', `No active shift PIN found for ${role} today.`);
  }

  // Find matching valid PIN document
  let matchedDoc: admin.firestore.DocumentSnapshot | null = null;
  let matchedData: any = null;

  for (const doc of pinsSnap.docs) {
    const data = doc.data();

    // Check expiration
    if (data.expiresAt && data.expiresAt.toDate() < now) {
      continue;
    }

    // Check account lockout
    if (data.lockedUntil && data.lockedUntil.toDate() > now) {
      throw new HttpsError('resource-exhausted', 'PIN is temporarily locked due to too many failed attempts.');
    }

    const testHash = hashPin(pin, data.salt);
    if (testHash === data.pinHash) {
      matchedDoc = doc;
      matchedData = data;
      break;
    }
  }

  if (!matchedDoc || !matchedData) {
    // Record failed attempt on all candidate PINs to prevent brute forcing
    for (const doc of pinsSnap.docs) {
      const data = doc.data();
      const newFails = (data.failedAttempts || 0) + 1;
      const updates: any = { failedAttempts: newFails };

      if (newFails >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60000); // 15 min lock
        updates.lockedUntil = admin.firestore.Timestamp.fromDate(lockUntil);
      }
      await doc.ref.update(updates);
    }

    await logSecurityEvent({
      eventType: 'STAFF_SHIFT_PIN_FAILED',
      severity: 'MEDIUM',
      actorUid: cleanDeviceId,
      details: { role, deviceId: cleanDeviceId },
    });

    throw new HttpsError('unauthenticated', 'Incorrect shift PIN or shift has expired.');
  }

  // Enforce Device Binding Invariant
  const boundDevices: string[] = matchedData.boundDevices || [];
  const maxDevices = matchedData.maxDevices || 2;

  if (!boundDevices.includes(cleanDeviceId)) {
    if (boundDevices.length >= maxDevices) {
      await logSecurityEvent({
        eventType: 'UNAUTHORIZED_DEVICE_BIND_ATTEMPT',
        severity: 'HIGH',
        actorUid: cleanDeviceId,
        details: { pinId: matchedDoc.id, role, boundDevices, attemptedDevice: cleanDeviceId },
      });
      throw new HttpsError(
        'permission-denied',
        `This shift PIN is already bound to the maximum allowed workstations (${maxDevices}). Please contact manager to reset binding.`
      );
    }

    // Bind this new device
    boundDevices.push(cleanDeviceId);
    await matchedDoc.ref.update({
      boundDevices,
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: admin.firestore.Timestamp.now(),
    });
  } else {
    // Reset failed attempts on successful login
    await matchedDoc.ref.update({
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: admin.firestore.Timestamp.now(),
    });
  }

  // Generate Custom Token for staff session
  const staffUid = `workstation_${role}_${cleanDeviceId.substring(0, 16)}`;
  const customToken = await admin.auth().createCustomToken(staffUid, {
    role,
    accountType: 'COLLEGE_STAFF',
    workstationId: cleanDeviceId,
    shiftPinId: matchedDoc.id,
  });

  await logSecurityEvent({
    eventType: 'STAFF_SHIFT_LOGIN_SUCCESS',
    severity: 'INFO',
    actorUid: staffUid,
    details: {
      role,
      pinId: matchedDoc.id,
      deviceId: cleanDeviceId,
      deviceName: deviceName || 'Workstation',
    },
  });

  return {
    success: true,
    token: customToken,
    role,
    pinId: matchedDoc.id,
    deviceId: cleanDeviceId,
  };
});

/**
 * Platform 2.0 — List Active Shift PINs (Manager Dashboard)
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

  const todayStr = getTodayDateStr();
  const pinsSnap = await db
    .collection('shiftPins')
    .where('shiftDate', '==', todayStr)
    .orderBy('createdAt', 'desc')
    .get();

  const pins = pinsSnap.docs.map(doc => {
    const data = doc.data();
    return {
      pinId: doc.id,
      role: data.role,
      shiftDate: data.shiftDate,
      shiftWindow: data.shiftWindow,
      boundDevices: data.boundDevices || [],
      maxDevices: data.maxDevices || 2,
      failedAttempts: data.failedAttempts || 0,
      status: data.status || 'ACTIVE',
      createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
    };
  });

  return {
    success: true,
    pins,
  };
});

/**
 * Platform 2.0 — Revoke a Shift PIN
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

  const { pinId, reason } = request.data || {};
  if (!pinId) {
    throw new HttpsError('invalid-argument', 'Valid pinId is required.');
  }

  const pinRef = db.collection('shiftPins').doc(pinId);
  const pinSnap = await pinRef.get();
  if (!pinSnap.exists) {
    throw new HttpsError('not-found', `Shift PIN ${pinId} not found.`);
  }

  await pinRef.update({
    status: 'REVOKED',
    revokedAt: admin.firestore.Timestamp.now(),
    revokedBy: request.auth.uid,
    revokeReason: reason || 'Revoked by manager',
  });

  await logSecurityEvent({
    eventType: 'STAFF_SHIFT_PIN_REVOKED',
    severity: 'MEDIUM',
    actorUid: request.auth.uid,
    details: { pinId, reason },
  });

  return {
    success: true,
    pinId,
    message: `Shift PIN ${pinId} has been revoked.`,
  };
});
