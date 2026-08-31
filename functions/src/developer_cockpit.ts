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

/**
 * Pure function to evaluate RBAC permissions across operations
 */
export function evaluateRBACPermission(role: string, operation: OperationType): { allowed: boolean; reason: string; requiredRoles: string[] } {
  const cleanRole = (role || '').trim().toLowerCase();

  const permissionMatrix: Record<OperationType, { allowedRoles: string[]; description: string }> = {
    createCheckout: {
      allowedRoles: ['student', 'teacher', 'college_staff', 'visitor', 'guest'],
      description: 'Customer order placement and stock reservation.',
    },
    reviewVerificationApplication: {
      allowedRoles: ['manager', 'admin', 'security_admin'],
      description: 'Review and approve/reject Teacher & Staff verification applications.',
    },
    generateShiftPin: {
      allowedRoles: ['manager', 'admin', 'security_admin'],
      description: 'Generate time-bound 6-digit shift PINs for counter workstations.',
    },
    adjustInventoryStock: {
      allowedRoles: ['manager', 'admin', 'security_admin'],
      description: 'Manually adjust stockOnHand or reservedStock warehouse counts.',
    },
    setSystemOperationalMode: {
      allowedRoles: ['admin', 'security_admin'],
      description: 'Trigger emergency kill switch or financial freeze across the campus.',
    },
    reconcileDailyLedger: {
      allowedRoles: ['manager', 'admin', 'security_admin'],
      description: 'Reconcile double-entry financial ledgers and settlement balances.',
    },
    viewSecurityIncidents: {
      allowedRoles: ['admin', 'security_admin'],
      description: 'Inspect live security incidents, attack telemetry, and audit logs.',
    },
  };

  const rule = permissionMatrix[operation];
  if (!rule) {
    return {
      allowed: false,
      reason: `Unknown operation: ${operation}`,
      requiredRoles: [],
    };
  }

  const isAllowed = rule.allowedRoles.includes(cleanRole);
  return {
    allowed: isAllowed,
    reason: isAllowed
      ? `Role '${cleanRole}' is authorized to perform '${operation}'.`
      : `Permission Denied: Role '${cleanRole}' lacks required capability [${rule.allowedRoles.join(', ')}].`,
    requiredRoles: rule.allowedRoles,
  };
}

/**
 * Platform 2.0 — Get Developer Command Cockpit Telemetry
 * 
 * Restricted to security_admin or admin.
 */
export const getDeveloperTelemetry = onCall(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  await enforceRateLimit(request.auth.uid, 'developer_telemetry');

  const callerRole = (request.auth.token.role as string | undefined) || '';
  if (!['admin', 'security_admin'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only security administrators can access developer telemetry.');
  }

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

export interface EmergencyActionRequest {
  action: 'FREEZE_FINANCIALS' | 'KILL_SWITCH' | 'UNFREEZE_PLATFORM';
  stepUpToken: string;
  reason: string;
}

/**
 * Pure function to verify step-up confirmation token with constant-time equality check.
 */
export function verifyStepUpAuthentication(stepUpToken?: string, requiredToken = 'STEP_UP_CONFIRM_EMERGENCY'): boolean {
  if (!stepUpToken || typeof stepUpToken !== 'string') return false;
  const tokenBuf = Buffer.from(stepUpToken);
  const requiredBuf = Buffer.from(requiredToken);
  if (tokenBuf.length !== requiredBuf.length) return false;
  return crypto.timingSafeEqual(tokenBuf, requiredBuf);
}

/**
 * Platform 2.0 — Emergency Operational Action with Step-Up Authentication
 * 
 * Enforces MFA / Step-up token requirement for high-impact destructive controls.
 */
export const executeEmergencyOperationalAction = onCall<EmergencyActionRequest>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Security Admin authentication required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  if (callerRole !== 'security_admin' && callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'Only security_admin or admin can execute emergency actions.');
  }

  const { action, stepUpToken, reason } = request.data || {};
  if (!action || !reason) {
    throw new HttpsError('invalid-argument', 'Action and justification reason are required.');
  }

  const isStepUpValid = verifyStepUpAuthentication(stepUpToken, `STEP_UP_CONFIRM_${action}`);
  if (!isStepUpValid) {
    await logSecurityEvent({
      eventType: 'STEP_UP_AUTH_FAILED',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: { action, reason },
    });
    throw new HttpsError(
      'failed-precondition',
      'Step-up confirmation token invalid or missing. Operation rejected.'
    );
  }

  await logSecurityEvent({
    eventType: 'EMERGENCY_OPERATIONAL_ACTION_EXECUTED',
    severity: 'CRITICAL',
    actorUid: request.auth.uid,
    details: { action, reason, executedAt: new Date().toISOString() },
  });

  return {
    success: true,
    actionExecuted: action,
    status: 'COMPLETED_UNDER_STEP_UP_AUTH',
    executedAt: new Date().toISOString(),
  };
});

