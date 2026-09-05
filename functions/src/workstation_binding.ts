import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { enforceAppCheck } from './app_check';
import { enforceRateLimit } from './rate_limiter';
import { logSecurityEvent } from './security_logger';
import { assertCapability, isManagerOrAdmin } from './authorization_policy';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export type WorkstationRole = 'kitchen' | 'pickup' | 'cashier';

export interface CreateWorkstationInviteRequest {
  stationType: WorkstationRole;
  stationName: string;
}

export interface EnrollWorkstationRequest {
  inviteCode: string;
  deviceName?: string;
}

/**
 * Derives cryptographic SHA-256 hash of a workstation secret token.
 */
export function hashWorkstationToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Platform 2.0 — Generate Workstation Enrollment Invite Code
 * Restricted to managers and administrators (manage_shift_pins capability).
 * Issues a 15-minute one-time code for enrolling a physical counter tablet or PC.
 */
export const createWorkstationInvite = onCall<CreateWorkstationInviteRequest>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  assertCapability(callerRole, 'manage_shift_pins', 'Only managers or administrators can enroll workstations.');

  const { stationType, stationName } = request.data || {};
  if (!stationType || !['kitchen', 'pickup', 'cashier'].includes(stationType)) {
    throw new HttpsError('invalid-argument', 'Valid stationType (kitchen, pickup, cashier) is required.');
  }

  const cleanName = String(stationName || `${stationType.toUpperCase()} Terminal`).trim().slice(0, 60);

  // Generate 8-character uppercase invite code: WS-XXXXXX
  const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  const inviteCode = `WS-${randomSuffix}`;

  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + 15 * 60 * 1000); // 15 mins

  await db.collection('workstationInvites').doc(inviteCode).set({
    inviteCode,
    stationType,
    stationName: cleanName,
    createdBy: request.auth.uid,
    createdAt: now,
    expiresAt,
    status: 'ACTIVE',
  });

  await logSecurityEvent({
    eventType: 'WORKSTATION_INVITE_CREATED',
    severity: 'INFO',
    actorUid: request.auth.uid,
    details: { inviteCode, stationType, stationName: cleanName },
  });

  return {
    success: true,
    inviteCode,
    stationType,
    stationName: cleanName,
    expiresAt: expiresAt.toDate().toISOString(),
  };
});

/**
 * Platform 2.0 — Enroll Workstation Terminal
 * Invoked from the terminal browser using the one-time invite code.
 * Issues a cryptographic workstation ID and secret token, bound into Firestore.
 */
export const enrollWorkstation = onCall<EnrollWorkstationRequest>(async (request) => {
  enforceAppCheck(request);

  const { inviteCode, deviceName } = request.data || {};
  if (!inviteCode || typeof inviteCode !== 'string') {
    throw new HttpsError('invalid-argument', 'Valid inviteCode is required.');
  }

  const cleanCode = inviteCode.trim().toUpperCase();
  await enforceRateLimit(cleanCode, 'workstation_enrollment');

  const inviteRef = db.collection('workstationInvites').doc(cleanCode);

  const enrollmentResult = await db.runTransaction(async (transaction) => {
    const inviteDoc = await transaction.get(inviteRef);
    if (!inviteDoc.exists) {
      throw new HttpsError('not-found', 'Invalid or expired workstation enrollment code.');
    }

    const inviteData = inviteDoc.data()!;
    const now = Date.now();
    const expiresAtMs = inviteData.expiresAt ? inviteData.expiresAt.toMillis() : 0;

    if (inviteData.status !== 'ACTIVE' || now > expiresAtMs) {
      throw new HttpsError('failed-precondition', 'Workstation enrollment code has expired or was already used.');
    }

    // Mark invite as consumed
    transaction.update(inviteRef, {
      status: 'CONSUMED',
      consumedAt: admin.firestore.Timestamp.fromMillis(now),
    });

    const stationType: WorkstationRole = inviteData.stationType;
    const stationName: string = inviteData.stationName;

    // Generate authoritative workstation identity
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const workstationId = `TB_WS_${stationType.toUpperCase()}_${randomHex}`;
    const rawToken = `wstok_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = hashWorkstationToken(rawToken);

    const workstationRef = db.collection('registeredWorkstations').doc(workstationId);
    transaction.set(workstationRef, {
      workstationId,
      stationType,
      stationName,
      tokenHash,
      deviceName: String(deviceName || 'Canteen Terminal').trim().slice(0, 60),
      status: 'ACTIVE',
      enrolledAt: admin.firestore.Timestamp.fromMillis(now),
      lastSeenAt: admin.firestore.Timestamp.fromMillis(now),
      enrolledBy: inviteData.createdBy,
    });

    return {
      workstationId,
      workstationToken: rawToken,
      stationType,
      stationName,
    };
  });

  await logSecurityEvent({
    eventType: 'WORKSTATION_HARDWARE_ENROLLED',
    severity: 'MEDIUM',
    actorUid: enrollmentResult.workstationId,
    details: {
      workstationId: enrollmentResult.workstationId,
      stationType: enrollmentResult.stationType,
      stationName: enrollmentResult.stationName,
    },
  });

  return {
    success: true,
    ...enrollmentResult,
  };
});

/**
 * Platform 2.0 — List Registered Workstations
 * Restricted to managers and administrators.
 */
export const listRegisteredWorkstations = onCall(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  if (!isManagerOrAdmin(callerRole)) {
    throw new HttpsError('permission-denied', 'Access denied: Requires administrator or manager privileges.');
  }

  const snapshot = await db.collection('registeredWorkstations').get();
  const workstations = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      workstationId: doc.id,
      stationType: data.stationType,
      stationName: data.stationName,
      deviceName: data.deviceName,
      status: data.status,
      enrolledAt: data.enrolledAt ? data.enrolledAt.toDate().toISOString() : null,
      lastSeenAt: data.lastSeenAt ? data.lastSeenAt.toDate().toISOString() : null,
    };
  });

  return {
    success: true,
    workstations,
  };
});

/**
 * Platform 2.0 — Revoke Registered Workstation
 * Immediately marks workstation as REVOKED, barring all future Shift PIN verifications.
 */
export const revokeWorkstation = onCall(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  assertCapability(callerRole, 'revoke_shift_pin', 'Only managers or administrators can revoke workstations.');

  const { workstationId, reason } = request.data || {};
  if (!workstationId || typeof workstationId !== 'string') {
    throw new HttpsError('invalid-argument', 'Valid workstationId is required.');
  }

  const wsRef = db.collection('registeredWorkstations').doc(workstationId);
  const doc = await wsRef.get();
  if (!doc.exists) {
    throw new HttpsError('not-found', 'Workstation not found.');
  }

  await wsRef.update({
    status: 'REVOKED',
    revokedAt: admin.firestore.Timestamp.now(),
    revokedBy: request.auth.uid,
    revocationReason: String(reason || 'Administrative decommission').slice(0, 200),
  });

  await logSecurityEvent({
    eventType: 'WORKSTATION_REVOKED',
    severity: 'HIGH',
    actorUid: request.auth.uid,
    details: { workstationId, reason },
  });

  return {
    success: true,
    message: `Workstation '${workstationId}' has been revoked and disconnected.`,
  };
});

/**
 * Verifies that a workstation credentials pair is authentic, active, and matches the requested role.
 */
export async function verifyWorkstationCredentials(
  workstationId: string,
  workstationToken: string,
  requiredRole: string
): Promise<{ valid: boolean; reason?: string; stationName?: string }> {
  if (!workstationId || !workstationToken) {
    return { valid: false, reason: 'Workstation credentials missing.' };
  }

  const wsDoc = await db.collection('registeredWorkstations').doc(workstationId).get();
  if (!wsDoc.exists) {
    return { valid: false, reason: 'WORKSTATION_NOT_REGISTERED: Terminal is not an authorized canteen workstation.' };
  }

  const data = wsDoc.data()!;
  if (data.status !== 'ACTIVE') {
    return { valid: false, reason: 'WORKSTATION_REVOKED: This workstation has been revoked by administration.' };
  }

  if (data.stationType !== requiredRole) {
    return { valid: false, reason: `WORKSTATION_ROLE_MISMATCH: Terminal is registered for ${data.stationType}, cannot operate as ${requiredRole}.` };
  }

  const expectedHash = data.tokenHash;
  const providedHash = hashWorkstationToken(workstationToken);

  try {
    if (!crypto.timingSafeEqual(Buffer.from(providedHash, 'hex'), Buffer.from(expectedHash, 'hex'))) {
      return { valid: false, reason: 'WORKSTATION_INVALID_TOKEN: Cryptographic workstation token invalid.' };
    }
  } catch (_) {
    return { valid: false, reason: 'Workstation authentication failure.' };
  }

  // Update terminal activity timestamp
  await db.collection('registeredWorkstations').doc(workstationId).update({
    lastSeenAt: admin.firestore.Timestamp.now(),
  }).catch(() => {});

  return { valid: true, stationName: data.stationName };
}
