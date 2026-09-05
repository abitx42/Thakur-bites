import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { enforceAppCheck } from './app_check';
import { enforceRateLimit } from './rate_limiter';
import { logSecurityEvent } from './security_logger';
import { assertCapability, hasCapability, ROLE_CAPABILITY_MATRIX, SystemCapability } from './authorization_policy';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export type OperationType =
  | 'createCheckout'
  | 'reviewVerificationApplication'
  | 'generateShiftPin'
  | 'adjustInventoryStock'
  | 'setSystemOperationalMode'
  | 'reconcileDailyLedger'
  | 'viewSecurityIncidents';

export interface SimulatePermissionRequest {
  simulatedRole: string;
  operation: OperationType;
  targetResourceId?: string;
}

export interface SimulatePermissionResponse {
  simulatedRole: string;
  operation: OperationType;
  allowed: boolean;
  reason: string;
  requiredRoles: string[];
}

const OPERATION_CAPABILITY_MAP: Record<OperationType, { capability: SystemCapability; description: string }> = {
  createCheckout: {
    capability: 'create_checkout',
    description: 'Customer order placement and stock reservation.',
  },
  reviewVerificationApplication: {
    capability: 'review_verification',
    description: 'Review and approve/reject Teacher & Staff verification applications.',
  },
  generateShiftPin: {
    capability: 'generate_shift_pin',
    description: 'Generate time-bound 6-digit shift PINs for counter workstations.',
  },
  adjustInventoryStock: {
    capability: 'adjust_inventory',
    description: 'Manually adjust stockOnHand or reservedStock warehouse counts.',
  },
  setSystemOperationalMode: {
    capability: 'manage_kill_switch',
    description: 'Trigger emergency kill switch or financial freeze across the campus.',
  },
  reconcileDailyLedger: {
    capability: 'view_business_analytics',
    description: 'Reconcile double-entry financial ledgers and settlement balances.',
  },
  viewSecurityIncidents: {
    capability: 'view_telemetry',
    description: 'Inspect live security incidents, attack telemetry, and audit logs.',
  },
};

/**
 * Pure function to evaluate RBAC permissions across operations, unified with SystemCapability registry
 */
export function evaluateRBACPermission(role: string, operation: OperationType): { allowed: boolean; reason: string; requiredRoles: string[] } {
  const cleanRole = (role || '').trim().toLowerCase();

  const rule = OPERATION_CAPABILITY_MAP[operation];
  if (!rule) {
    return {
      allowed: false,
      reason: `Unknown operation: ${operation}`,
      requiredRoles: [],
    };
  }

  const isAllowed = hasCapability(cleanRole, rule.capability);
  const requiredRoles = Object.entries(ROLE_CAPABILITY_MATRIX)
    .filter(([_, caps]) => caps.has(rule.capability))
    .map(([r]) => r);

  return {
    allowed: isAllowed,
    reason: isAllowed
      ? `Role '${cleanRole}' is authorized to perform '${operation}'.`
      : `Permission Denied: Role '${cleanRole}' lacks required capability [${requiredRoles.join(', ')}].`,
    requiredRoles,
  };
}

/**
 * Platform 2.0 — Get Developer Command Cockpit Telemetry
 * 
 * Restricted to developer, security_admin or admin.
 */
export const getDeveloperTelemetry = onCall(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  await enforceRateLimit(request.auth.uid, 'developer_telemetry');

  const callerRole = (request.auth.token.role as string | undefined) || '';
  assertCapability(callerRole, 'view_telemetry', 'Only developers or administrators can access developer telemetry.');

  // 1. Fetch recent security incidents
  const incidentsSnap = await db
    .collection('securityIncidents')
    .orderBy('lastSeenAt', 'desc')
    .limit(30)
    .get();

  const incidents = incidentsSnap.docs.map(d => ({
    id: d.id,
    ...d.data(),
    firstSeenAt: d.data().firstSeenAt?.toDate?.()?.toISOString() || null,
    lastSeenAt: d.data().lastSeenAt?.toDate?.()?.toISOString() || null,
  }));

  // 2. Fetch System Status
  const statusDoc = await db.collection('publicSystemStatus').doc('global').get();
  const systemStatus = statusDoc.data() || { mode: 'NORMAL' };

  // 3. Telemetry Metrics
  const telemetry = {
    serverTimestamp: new Date().toISOString(),
    nodeVersion: process.version,
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    uptimeSeconds: Math.round(process.uptime()),
    activeSecurityIncidents: incidents.length,
    operationalMode: systemStatus.mode || 'NORMAL',
    incidents,
  };

  return {
    success: true,
    telemetry,
  };
});

/**
 * Platform 2.0 — Interactive RBAC Permission Simulator
 */
export const simulatePermissionCheck = onCall<SimulatePermissionRequest>(async (request): Promise<SimulatePermissionResponse> => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  await enforceRateLimit(request.auth.uid, 'permission_simulation');

  const callerRole = (request.auth.token.role as string | undefined) || '';
  if (!['manager', 'admin', 'security_admin'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only staff can execute the permission simulator.');
  }

  const { simulatedRole, operation } = request.data || {};
  if (!simulatedRole || !operation) {
    throw new HttpsError('invalid-argument', 'Both simulatedRole and operation are required.');
  }

  const result = evaluateRBACPermission(simulatedRole, operation);

  await logSecurityEvent({
    eventType: 'RBAC_PERMISSION_SIMULATION_EXECUTED',
    severity: 'INFO',
    actorUid: request.auth.uid,
    details: { simulatedRole, operation, allowed: result.allowed },
  });

  return {
    simulatedRole,
    operation,
    allowed: result.allowed,
    reason: result.reason,
    requiredRoles: result.requiredRoles,
  };
});

export type EmergencyActionType = 'FREEZE_FINANCIALS' | 'KILL_SWITCH' | 'UNFREEZE_PLATFORM';

export interface RequestStepUpChallengeData {
  action: EmergencyActionType;
  reason: string;
}

export interface RequestStepUpChallengeResponse {
  challengeId: string;
  challengeNonce: string;
  expiresAt: string;
  action: EmergencyActionType;
}

export interface EmergencyActionRequest {
  action: EmergencyActionType;
  challengeId: string;
  challengeNonce: string;
  reason: string;
}

/**
 * Pure function to verify challenge nonce against stored hash with constant-time equality.
 */
export function verifyChallengeNonceConstantTime(incomingNonce: string, storedHash: string): boolean {
  if (!incomingNonce || !storedHash || typeof incomingNonce !== 'string' || typeof storedHash !== 'string') {
    return false;
  }
  const computedHash = crypto.createHash('sha256').update(incomingNonce.trim()).digest('hex');
  const bufA = Buffer.from(computedHash, 'hex');
  const bufB = Buffer.from(storedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Platform 2.0 — Request Ephemeral Step-Up Authentication Challenge
 * 
 * Issues a 60-second, single-use 32-byte cryptographic nonce for Security Admins.
 */
export const requestEmergencyStepUpChallenge = onCall<RequestStepUpChallengeData>(async (request): Promise<RequestStepUpChallengeResponse> => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Security Admin authentication required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  assertCapability(callerRole, 'emergency_freeze', 'Separation of Duties: Step-up challenges restricted strictly to authorized engineering administrators (developer / security_admin).');

  const { action, reason } = request.data || {};
  if (!action || !reason || typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 200 || !['FREEZE_FINANCIALS', 'KILL_SWITCH', 'UNFREEZE_PLATFORM'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Valid action and operational justification reason (1-200 chars) are required.');
  }

  const cleanReason = reason.trim().replace(/[\r\n\t]/g, ' ');

  // Generate 32-byte CSPRNG nonce
  const rawNonce = crypto.randomBytes(32).toString('hex');
  const nonceHash = crypto.createHash('sha256').update(rawNonce).digest('hex');
  const challengeId = `CHAL-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const expiresAtDate = new Date(Date.now() + 60 * 1000); // 60-second lifetime

  await db.collection('stepUpSessions').doc(challengeId).set({
    challengeId,
    actorUid: request.auth.uid,
    action,
    reason: cleanReason,
    nonceHash,
    used: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAtDate),
    ttl: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)), // Automated TTL cleanup
  });

  await logSecurityEvent({
    eventType: 'STEP_UP_CHALLENGE_ISSUED',
    severity: 'MEDIUM',
    actorUid: request.auth.uid,
    details: { challengeId, action, reason: cleanReason },
  });

  return {
    challengeId,
    challengeNonce: rawNonce,
    expiresAt: expiresAtDate.toISOString(),
    action,
  };
});

/**
 * Platform 2.0 — Execute Emergency Operational Action with Server-Issued Step-Up Verification
 * 
 * Atomically consumes the single-use challenge and transactionally modifies system operational state.
 */
export const executeEmergencyOperationalAction = onCall<EmergencyActionRequest>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Security Admin authentication required.');
  }

  const authUid = request.auth.uid;
  const callerRole = (request.auth.token.role as string | undefined) || '';
  assertCapability(callerRole, 'emergency_freeze', 'Separation of Duties: Emergency actions restricted strictly to authorized engineering administrators (developer / security_admin).');

  const { action, challengeId, challengeNonce, reason } = request.data || {};
  if (!action || !challengeId || !challengeNonce || !reason) {
    throw new HttpsError('invalid-argument', 'Action, challengeId, challengeNonce, and reason are required.');
  }

  const sessionRef = db.collection('stepUpSessions').doc(challengeId);
  const systemConfigRef = db.collection('systemConfig').doc('global');
  const publicStatusRef = db.collection('publicSystemStatus').doc('current');
  const publicStatusGlobalRef = db.collection('publicSystemStatus').doc('global');

  let newMode: 'NORMAL' | 'DEGRADED' | 'FINANCIAL_FROZEN' | 'EMERGENCY_HALT';

  await db.runTransaction(async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists) {
      throw new HttpsError('not-found', 'Step-up challenge session not found.');
    }

    const sessionData = sessionSnap.data()!;
    if (sessionData.used === true) {
      throw new HttpsError('failed-precondition', 'Step-up challenge has already been consumed (Replay detected).');
    }

    if (sessionData.actorUid !== authUid) {
      throw new HttpsError('permission-denied', 'Challenge session belongs to a different security administrator.');
    }

    if (sessionData.action !== action) {
      throw new HttpsError('invalid-argument', 'Challenge was issued for a different action.');
    }

    const expiresAtMs = sessionData.expiresAt ? sessionData.expiresAt.toMillis() : 0;
    if (Date.now() > expiresAtMs) {
      throw new HttpsError('deadline-exceeded', 'Step-up challenge has expired. Request a fresh challenge.');
    }

    const isNonceValid = verifyChallengeNonceConstantTime(challengeNonce, sessionData.nonceHash);
    if (!isNonceValid) {
      throw new HttpsError('permission-denied', 'Invalid challenge nonce. Authentication failed.');
    }

    // Atomically consume challenge
    transaction.update(sessionRef, {
      used: true,
      consumedAt: admin.firestore.FieldValue.serverTimestamp(),
      consumedBy: authUid,
    });

    // Transactionally update operational state using authoritative enum
    if (action === 'KILL_SWITCH') {
      newMode = 'EMERGENCY_HALT';
      transaction.set(systemConfigRef, {
        mode: 'EMERGENCY_HALT',
        killSwitchActive: true,
        financialOperationsFrozen: true,
        reason,
        updatedBy: authUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      transaction.set(publicStatusRef, {
        mode: 'EMERGENCY_HALT',
        orderingAvailable: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      transaction.set(publicStatusGlobalRef, {
        mode: 'EMERGENCY_HALT',
        orderingAvailable: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } else if (action === 'FREEZE_FINANCIALS') {
      newMode = 'FINANCIAL_FROZEN';
      transaction.set(systemConfigRef, {
        mode: 'FINANCIAL_FROZEN',
        killSwitchActive: false,
        financialOperationsFrozen: true,
        reason,
        updatedBy: authUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      transaction.set(publicStatusRef, {
        mode: 'FINANCIAL_FROZEN',
        orderingAvailable: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      transaction.set(publicStatusGlobalRef, {
        mode: 'FINANCIAL_FROZEN',
        orderingAvailable: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      // UNFREEZE_PLATFORM
      newMode = 'NORMAL';
      transaction.set(systemConfigRef, {
        mode: 'NORMAL',
        killSwitchActive: false,
        financialOperationsFrozen: false,
        reason,
        updatedBy: authUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      transaction.set(publicStatusRef, {
        mode: 'NORMAL',
        orderingAvailable: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      transaction.set(publicStatusGlobalRef, {
        mode: 'NORMAL',
        orderingAvailable: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  await logSecurityEvent({
    eventType: 'EMERGENCY_OPERATIONAL_ACTION_EXECUTED',
    severity: 'CRITICAL',
    actorUid: authUid,
    details: {
      action,
      newMode: newMode!,
      challengeId,
      reason,
      executedAt: new Date().toISOString(),
    },
  });

  return {
    success: true,
    actionExecuted: action,
    operationalMode: newMode!,
    status: 'COMPLETED_UNDER_EPHEMERAL_STEP_UP_AUTH',
    executedAt: new Date().toISOString(),
  };
});


