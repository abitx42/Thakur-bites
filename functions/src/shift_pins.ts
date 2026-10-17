import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { enforceAppCheck } from './app_check';
import {
  enforceRateLimit,
  enforceExponentialBackoff,
  recordAuthFailure,
  recordAuthSuccess,
} from './rate_limiter';
import { logSecurityEvent } from './security_logger';
import { assertCapability, isOperationalStaffRole } from './authorization_policy';
import { hashWorkstationToken, verifyWorkstationCredentials } from './workstation_binding';
import { assertNoHoneytokens } from './honeypot_defense';
import { normalizeTimestampToMillis } from './privileged_guard';
import { assertCurrentStaffAuthority } from './staff_authority';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export type ShiftWindow = 'MORNING' | 'AFTERNOON' | 'FULL_DAY';

export interface GenerateShiftPinRequest {
  role: 'kitchen' | 'pickup' | 'cashier';
  shiftWindow: ShiftWindow;
  shiftDate?: string; // YYYY-MM-DD (defaults to Asia/Kolkata today)
  forceRegenerate?: boolean;
}

export interface VerifyShiftPinRequest {
  pin: string;
  role: 'kitchen' | 'pickup' | 'cashier';
  deviceId: string;
  deviceName?: string;
  workstationToken?: string;
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
const WORKSTATION_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

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

function isWorkstationRole(role: unknown): role is VerifyShiftPinRequest['role'] {
  return typeof role === 'string' && ['kitchen', 'pickup', 'cashier'].includes(role);
}

function isDeviceId(deviceId: unknown): deviceId is string {
  return typeof deviceId === 'string' && /^[A-Za-z0-9_-]{4,100}$/.test(deviceId);
}

function shiftExpiryMillis(shiftDate: unknown, shiftWindow: unknown): number {
  if (typeof shiftDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(shiftDate) ||
      !['MORNING', 'AFTERNOON', 'FULL_DAY'].includes(shiftWindow as string)) return 0;
  const day = new Date(`${shiftDate}T00:00:00+05:30`);
  if (!Number.isFinite(day.getTime()) || getMumbaiDateStr(day) !== shiftDate) return 0;
  const endTime = shiftWindow === 'MORNING' ? '15:30:00.000' : shiftWindow === 'AFTERNOON' ? '22:00:00.000' : '23:59:59.999';
  return new Date(`${shiftDate}T${endTime}+05:30`).getTime();
}

function equalHashes(left: unknown, right: unknown): boolean {
  return typeof left === 'string' && typeof right === 'string' && /^[a-fA-F0-9]{64}$/.test(left) &&
    /^[a-fA-F0-9]{64}$/.test(right) && crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

/** A session is bound to this PIN issuance, not just its reusable document ID. */
function activePinState(
  data: admin.firestore.DocumentData,
  pinId: string,
  role: string,
  nowMs: number,
  requireUnlocked = false
): { createdMs: number; expiresMs: number; generation: string } | null {
  const createdMs = normalizeTimestampToMillis(data.createdAt);
  const expiresMs = normalizeTimestampToMillis(data.expiresAt);
  const shiftEndMs = shiftExpiryMillis(data.shiftDate, data.shiftWindow);
  if (!isWorkstationRole(role) || data.pinId !== pinId || data.status !== 'ACTIVE' || data.role !== role ||
      data.shiftDate !== getMumbaiDateStr(new Date(nowMs)) || !shiftEndMs ||
      pinId !== `${role}_${data.shiftDate}_${data.shiftWindow}` || !createdMs || createdMs > nowMs ||
      !expiresMs || expiresMs <= nowMs || expiresMs <= createdMs || expiresMs > shiftEndMs ||
      typeof data.salt !== 'string' || !/^[a-fA-F0-9]{32}$/.test(data.salt) ||
      typeof data.pinHash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(data.pinHash) ||
      !Array.isArray(data.boundDevices) || !data.boundDevices.every(isDeviceId) ||
      new Set(data.boundDevices).size !== data.boundDevices.length ||
      !Number.isSafeInteger(data.maxDevices) || data.maxDevices < 1 || data.maxDevices > ROLE_MAX_DEVICES[role] ||
      data.boundDevices.length > data.maxDevices) return null;
  if (data.lockedUntil !== undefined && data.lockedUntil !== null) {
    const lockedMs = normalizeTimestampToMillis(data.lockedUntil);
    if (!lockedMs || (requireUnlocked && lockedMs > nowMs)) return null;
  }
  const generation = crypto.createHash('sha256')
    .update(JSON.stringify([pinId, data.pinHash, data.salt, createdMs])).digest('hex');
  return { createdMs, expiresMs, generation };
}

function isActiveRegisteredWorkstation(data: admin.firestore.DocumentData, deviceId: string, role: string): boolean {
  return data.workstationId === deviceId && data.status === 'ACTIVE' && data.stationType === role &&
    typeof data.tokenHash === 'string' && /^[a-fA-F0-9]{64}$/.test(data.tokenHash);
}

/**
 * Platform 2.0 — Generate Shift PIN
 * 
 * Restricted to manager, admin, or security_admin.
 * Generates a 6-digit CSPRNG shift PIN, hashes it with PBKDF2 + salt, and stores it in Firestore.
 * Returns the plaintext PIN once to the manager.
 */
export const generateShiftPin = onCall<GenerateShiftPinRequest>(async (request) => {
  await assertNoHoneytokens(request.data, request.auth?.uid, 'generateShiftPin');
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = await assertCurrentStaffAuthority(request.auth.uid, request.auth.token);
  assertCapability(callerRole, 'generate_shift_pin', 'Only managers or admins can generate shift PINs.');

  const { role, shiftWindow, shiftDate = getMumbaiDateStr(), forceRegenerate = false } = request.data || {};

  if (!role || !['kitchen', 'pickup', 'cashier'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Valid staff role (kitchen, pickup, cashier) is required.');
  }

  if (!shiftWindow || !['MORNING', 'AFTERNOON', 'FULL_DAY'].includes(shiftWindow)) {
    throw new HttpsError('invalid-argument', 'Valid shiftWindow is required.');
  }

  const expiresMs = shiftExpiryMillis(shiftDate, shiftWindow);
  if (!expiresMs || expiresMs <= Date.now() || typeof forceRegenerate !== 'boolean') {
    throw new HttpsError('invalid-argument', 'A valid unexpired YYYY-MM-DD shift date and boolean forceRegenerate are required.');
  }

  const pinId = `${role}_${shiftDate}_${shiftWindow}`;
  const pinRef = db.collection('shiftPins').doc(pinId);

  // Check if active PIN already exists to prevent accidental override
  const existingDoc = await pinRef.get();
  if (existingDoc.exists && existingDoc.data()?.status === 'ACTIVE') {
    if (!forceRegenerate) {
      throw new HttpsError(
        'already-exists',
        `An active shift PIN for ${role.toUpperCase()} on ${shiftDate} (${shiftWindow}) already exists. Revoke it before generating a new PIN.`
      );
    }
  }

  // Generate 6-digit CSPRNG PIN
  const rawPin = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = derivePinHash(rawPin, salt);
  const maxDevices = ROLE_MAX_DEVICES[role] || 2;

  const expiresAt = new Date(expiresMs);

  const now = Timestamp.now();

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
    expiresAt: Timestamp.fromDate(expiresAt),
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
  await assertNoHoneytokens(request.data, request.auth?.uid, 'verifyShiftPin');
  enforceAppCheck(request);

  const { pin, role, deviceId, workstationToken } = request.data || {};

  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    throw new HttpsError('invalid-argument', 'Valid 6-digit shift PIN is required.');
  }

  if (!isWorkstationRole(role)) {
    throw new HttpsError('invalid-argument', 'Valid staff role is required.');
  }

  if (!isDeviceId(deviceId)) {
    throw new HttpsError('invalid-argument', 'Valid device identifier is required for workstation binding.');
  }
  const cleanDeviceId = deviceId;
  if (typeof workstationToken !== 'string' || !workstationToken || workstationToken.length > 200 || workstationToken !== workstationToken.trim()) {
    throw new HttpsError('permission-denied', 'Registered workstation credentials are required. Enroll this terminal before signing in.');
  }

  // Authoritative Workstation Hardware Binding: Verify registered workstation token
  const wsResult = await verifyWorkstationCredentials(cleanDeviceId, workstationToken, role);
  if (!wsResult.valid) {
    await logSecurityEvent({
      eventType: 'UNREGISTERED_WORKSTATION_BLOCKED',
      severity: 'HIGH',
      actorUid: cleanDeviceId,
      details: { role, reason: wsResult.reason },
    });
    throw new HttpsError('permission-denied', wsResult.reason || 'Workstation hardware authorization failed.');
  }

  const hashedDeviceId = crypto.createHash('sha256').update(`DEVICE_${cleanDeviceId}`).digest('hex').slice(0, 16);
  await enforceExponentialBackoff(hashedDeviceId, 'staff_pin');
  await enforceRateLimit(cleanDeviceId, 'shift_pin_verification');
  // Device IDs are client controlled before authentication. Pair them with a
  // pseudonymous network bucket so rotating a device ID cannot reset the limit.
  const forwardedFor = request.rawRequest.headers['x-forwarded-for'];
  const clientIp = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0].trim()
    || request.rawRequest.ip
    || 'unknown';
  const ipBucket = crypto.createHash('sha256').update(`SHIFT_PIN_IP_${clientIp}`).digest('hex').slice(0, 32);
  await enforceExponentialBackoff(ipBucket, 'staff_pin');
  await enforceRateLimit(ipBucket, 'shift_pin_verification', { isIpBased: true, natMultiplier: 3 });

  const todayStr = getMumbaiDateStr();

  // Find active candidate PINs for this role today
  const pinsSnap = await db
    .collection('shiftPins')
    .where('role', '==', role)
    .where('shiftDate', '==', todayStr)
    .where('status', '==', 'ACTIVE')
    .get();

  if (pinsSnap.empty) {
    await recordAuthFailure(hashedDeviceId, 'staff_pin');
    await recordAuthFailure(ipBucket, 'staff_pin');
    await logSecurityEvent({
      eventType: 'SHIFT_PIN_VERIFICATION_NO_ACTIVE_SHIFT',
      severity: 'LOW',
      actorUid: `DEV-${hashedDeviceId}`,
      details: { role, deviceHash: hashedDeviceId, actorType: 'WORKSTATION_DEVICE' },
    });
    // Uniform response to prevent operational reconnaissance
    throw new HttpsError('unauthenticated', 'Invalid staff credentials.');
  }

  // Check active candidates for matching PBKDF2 hash (Resolves TB-SESSION-MED-014 multi-window ambiguity)
  let candidateDoc: admin.firestore.QueryDocumentSnapshot | null = null;

  for (const doc of pinsSnap.docs) {
    const data = doc.data();
    if (!activePinState(data, doc.id, role, Date.now(), true)) continue;

    const testHash = derivePinHash(pin, data.salt);
    if (equalHashes(testHash, data.pinHash)) {
      candidateDoc = doc;
      break;
    }
  }

  // If no active candidate matched the PIN, record failed attempt and fail closed
  if (!candidateDoc) {
    await recordAuthFailure(hashedDeviceId, 'staff_pin');
    await recordAuthFailure(ipBucket, 'staff_pin');
    const targetRef = pinsSnap.docs[0].ref;
    await db.runTransaction(async (t) => {
      const snap = await t.get(targetRef);
      if (snap.exists) {
        const data = snap.data()!;
        const newFails = (data.failedAttempts || 0) + 1;
        const updates: any = { failedAttempts: newFails };
        if (newFails >= 5) {
          updates.lockedUntil = Timestamp.fromDate(new Date(Date.now() + 15 * 60000));
        }
        t.update(targetRef, updates);
      }
    }).catch(() => {});

    await logSecurityEvent({
      eventType: 'SHIFT_PIN_VERIFICATION_FAILED',
      severity: 'MEDIUM',
      actorUid: `DEV-${hashedDeviceId}`,
      details: { role, deviceHash: hashedDeviceId, actorType: 'WORKSTATION_DEVICE' },
    });
    throw new HttpsError('unauthenticated', 'Invalid staff credentials.');
  }

  const pinRef = candidateDoc.ref;
  const selectedGeneration = activePinState(candidateDoc.data(), candidateDoc.id, role, Date.now(), true)?.generation;
  const workstationUid = `staff_${role}_${todayStr}_${hashedDeviceId}`;
  const sessionGeneration = crypto.randomBytes(16).toString('hex');
  const sessionDocRef = db.collection('workstationSessions').doc(workstationUid);
  const workstationRef = db.collection('registeredWorkstations').doc(cleanDeviceId);
  const providedWorkstationHash = hashWorkstationToken(workstationToken);
  let boundDeviceList: string[] = [];
  let finalShiftWindow: ShiftWindow;

  try {
    const verified = await db.runTransaction(async (transaction) => {
      const freshSnap = await transaction.get(pinRef);
      const workstationSnap = await transaction.get(workstationRef);
      if (!freshSnap.exists || !workstationSnap.exists) {
        throw new HttpsError('unauthenticated', 'Invalid staff credentials.');
      }

      const data = freshSnap.data()!;
      const workstation = workstationSnap.data()!;
      const nowMs = Date.now();
      const pinState = activePinState(data, freshSnap.id, role, nowMs, true);
      if (!pinState || !selectedGeneration || pinState.generation !== selectedGeneration ||
          !isActiveRegisteredWorkstation(workstation, cleanDeviceId, role) ||
          !equalHashes(providedWorkstationHash, workstation.tokenHash)) {
        throw new HttpsError('unauthenticated', 'Invalid staff credentials.');
      }

      // Verify PBKDF2 hash
      const testHash = derivePinHash(pin, data.salt);
      const isMatch = equalHashes(testHash, data.pinHash);

      if (!isMatch) {
        const newFails = (data.failedAttempts || 0) + 1;
        const updates: any = { failedAttempts: newFails };
        if (newFails >= 5) {
          updates.lockedUntil = Timestamp.fromDate(new Date(Date.now() + 15 * 60000));
        }
        transaction.update(pinRef, updates);
        // Resolve so the failure commits; throwing here would roll it back.
        return false;
      }

      // Enforce Device Binding
      const boundDevices: string[] = [...data.boundDevices];
      const maxDevices = data.maxDevices;

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
        lastLoginAt: FieldValue.serverTimestamp(),
      });

      // PIN consumption, hardware binding and session issuance share one fresh
      // transaction. Regeneration/revocation cannot race a later session set.
      transaction.set(sessionDocRef, {
        sessionId: workstationUid,
        sessionGeneration,
        pinId: freshSnap.id,
        pinGeneration: pinState.generation,
        role,
        staffUid: request.auth?.uid || workstationUid,
        deviceId: cleanDeviceId,
        deviceHash: hashedDeviceId,
        workstationTokenHash: workstation.tokenHash,
        shiftDate: data.shiftDate,
        shiftWindow: data.shiftWindow,
        status: 'ACTIVE',
        createdAt: Timestamp.fromMillis(nowMs),
        expiresAt: Timestamp.fromMillis(Math.min(nowMs + WORKSTATION_SESSION_LIFETIME_MS, pinState.expiresMs)),
      });
      finalShiftWindow = data.shiftWindow;
      boundDeviceList = boundDevices;
      return true;
    });
    if (!verified) {
      throw new HttpsError('unauthenticated', 'Invalid staff credentials.');
    }
  } catch (err: any) {
    await recordAuthFailure(hashedDeviceId, 'staff_pin');
    await recordAuthFailure(ipBucket, 'staff_pin');
    await logSecurityEvent({
      eventType: 'STAFF_SHIFT_PIN_FAILED',
      severity: 'MEDIUM',
      actorUid: `DEV-${hashedDeviceId}`,
      details: { role, deviceHash: hashedDeviceId, actorType: 'WORKSTATION_DEVICE' },
    });
    throw err instanceof HttpsError ? err : new HttpsError('unauthenticated', 'Invalid staff credentials.');
  }

  const customToken = await admin.auth().createCustomToken(workstationUid, {
    role,
    isWorkstationSession: true,
    sessionGeneration,
    pinId: candidateDoc.id,
    deviceId: cleanDeviceId,
    shiftDate: todayStr,
    shiftWindow: finalShiftWindow!,
    permissionsVersion: 2,
  });

  await logSecurityEvent({
    eventType: 'STAFF_WORKSTATION_LOGIN_SUCCESS',
    severity: 'INFO',
    actorUid: workstationUid,
    details: {
      pinId: candidateDoc.id,
      role,
      deviceHash: hashedDeviceId,
      boundDevicesCount: boundDeviceList!.length,
      actorType: 'WORKSTATION_DEVICE',
    },
  });

  await recordAuthSuccess(hashedDeviceId, 'staff_pin');

  return {
    success: true,
    token: customToken,
    role,
    workstationUid,
    boundDevices: boundDeviceList!,
  };
});

/**
 * Platform 2.0 — Revoke Shift PIN
 * Atomically revokes the shift PIN and immediately invalidates all active workstation sessions & tokens.
 */
export const revokeShiftPin = onCall<RevokeShiftPinRequest>(async (request) => {
  await assertNoHoneytokens(request.data, request.auth?.uid, 'revokeShiftPin');
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = await assertCurrentStaffAuthority(request.auth.uid, request.auth.token);
  assertCapability(callerRole, 'revoke_shift_pin', 'Only managers or admins can revoke shift PINs.');

  const { pinId, reason = 'Administrative revocation' } = request.data || {};
  if (typeof pinId !== 'string' || !/^(kitchen|pickup|cashier)_\d{4}-\d{2}-\d{2}_(MORNING|AFTERNOON|FULL_DAY)$/.test(pinId) ||
      typeof reason !== 'string' || !reason.trim() || reason.length > 200) {
    throw new HttpsError('invalid-argument', 'Valid pinId is required.');
  }

  const pinRef = db.collection('shiftPins').doc(pinId);
  const pinDoc = await pinRef.get();

  if (!pinDoc.exists) {
    throw new HttpsError('not-found', 'Shift PIN document not found.');
  }

  await pinRef.update({
    status: 'REVOKED',
    revokedAt: FieldValue.serverTimestamp(),
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
      revokedAt: FieldValue.serverTimestamp(),
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
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) {
    throw new HttpsError('unauthenticated', 'A valid authenticated user is required.');
  }
  if (!uid.startsWith('staff_') && token?.isWorkstationSession !== true) {
    // Customers also call this shared guard (for example self-cancellation).
    // Check all staff-like claims, including forms capability checks normalize,
    // without imposing permanent staff authority on customers or workstations.
    if (typeof token?.role === 'string' && isOperationalStaffRole(token.role.trim().toLowerCase())) {
      await assertCurrentStaffAuthority(uid, token);
    }
    return;
  }

  const invalidSession = () => new HttpsError('unauthenticated', 'Workstation session authority is invalid or expired. Please re-authenticate with a shift PIN on an enrolled terminal.');
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!uid.startsWith('staff_') || !token || token.isWorkstationSession !== true || !isWorkstationRole(token.role) ||
      !isDeviceId(token.deviceId) || typeof token.sessionGeneration !== 'string' || !/^[a-f0-9]{32}$/.test(token.sessionGeneration) ||
      typeof token.pinId !== 'string' || !/^(kitchen|pickup|cashier)_\d{4}-\d{2}-\d{2}_(MORNING|AFTERNOON|FULL_DAY)$/.test(token.pinId) ||
      !Number.isSafeInteger(token.auth_time) || token.auth_time <= 0 || token.auth_time > nowSeconds ||
      !Number.isSafeInteger(token.iat) || token.iat < token.auth_time || token.iat > nowSeconds ||
      (token.uid !== undefined && token.uid !== uid) || (token.sub !== undefined && token.sub !== uid)) {
    throw invalidSession();
  }

  let authUser: admin.auth.UserRecord;
  try {
    authUser = await admin.auth().getUser(uid);
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') throw invalidSession();
    throw new HttpsError('unavailable', 'Current workstation account authority could not be verified. Please retry.');
  }
  // Operational roles are supplied by createCustomToken, so a newly signed-in
  // virtual workstation normally has no permanent Auth role. An explicit Auth
  // role change, however, must invalidate its former workstation authority.
  if (!authUser || authUser.uid !== uid || authUser.disabled !== false ||
      (authUser.customClaims?.role !== undefined && authUser.customClaims.role !== token.role) ||
      (authUser.customClaims?.isWorkstationSession !== undefined && authUser.customClaims.isWorkstationSession !== true)) {
    throw invalidSession();
  }
  const validAfterMs = normalizeTimestampToMillis(authUser.tokensValidAfterTime);
  const authCreatedMs = normalizeTimestampToMillis(authUser.metadata?.creationTime);
  if ((authUser.tokensValidAfterTime !== undefined && !validAfterMs) || token.auth_time * 1000 < validAfterMs) {
    throw invalidSession();
  }

  await db.runTransaction(async transaction => {
    const sessionSnap = await transaction.get(db.collection('workstationSessions').doc(uid));
    if (!sessionSnap.exists) throw invalidSession();
    const data = sessionSnap.data()!;
    const nowMs = Date.now();
    const createdMs = normalizeTimestampToMillis(data.createdAt);
    const expiresMs = normalizeTimestampToMillis(data.expiresAt);
    // A first signInWithCustomToken can create its Auth account after this
    // Firestore session. That initial validSince epoch is not a revocation.
    // Later epochs still invalidate the original issuance, even if its custom
    // token is exchanged again. Auth metadata/epochs have second precision.
    const initialAuthEpoch = authCreatedMs > 0 && authCreatedMs <= nowMs && createdMs <= authCreatedMs + 999 &&
      validAfterMs <= authCreatedMs + 999 && token.auth_time * 1000 + 999 >= authCreatedMs;
    const deviceHash = crypto.createHash('sha256').update(`DEVICE_${token.deviceId}`).digest('hex').slice(0, 16);
    if (data.sessionId !== uid || data.status !== 'ACTIVE' || data.sessionGeneration !== token.sessionGeneration ||
        data.role !== token.role || data.deviceId !== token.deviceId || data.deviceHash !== deviceHash ||
        data.pinId !== token.pinId || data.shiftDate !== token.shiftDate || data.shiftWindow !== token.shiftWindow ||
        data.shiftDate !== getMumbaiDateStr(new Date(nowMs)) ||
        !createdMs || createdMs > nowMs || (createdMs < validAfterMs && !initialAuthEpoch) || token.auth_time * 1000 + 999 < createdMs ||
        !expiresMs || expiresMs <= createdMs || expiresMs <= nowMs || expiresMs - createdMs > WORKSTATION_SESSION_LIFETIME_MS) {
      throw invalidSession();
    }
    const pinSnap = await transaction.get(db.collection('shiftPins').doc(data.pinId));
    const workstationSnap = await transaction.get(db.collection('registeredWorkstations').doc(data.deviceId));
    if (!pinSnap.exists || !workstationSnap.exists) throw invalidSession();
    const pin = pinSnap.data()!;
    const workstation = workstationSnap.data()!;
    const pinState = activePinState(pin, pinSnap.id, data.role, nowMs);
    if (!pinState || data.pinGeneration !== pinState.generation || data.shiftWindow !== pin.shiftWindow ||
        createdMs < pinState.createdMs || expiresMs > pinState.expiresMs || !pin.boundDevices.includes(data.deviceId) ||
        !isActiveRegisteredWorkstation(workstation, data.deviceId, data.role) ||
        !equalHashes(data.workstationTokenHash, workstation.tokenHash)) {
      throw invalidSession();
    }
  });
}

/**
 * Platform 2.0 — List Active Shift PINs for Today
 */
export const listActiveShiftPins = onCall(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = await assertCurrentStaffAuthority(request.auth.uid, request.auth.token);
  assertCapability(callerRole, 'manage_shift_pins', 'Only managers or admins can list shift PINs.');

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
