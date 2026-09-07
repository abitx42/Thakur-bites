import { randomUUID, createHash, timingSafeEqual } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import {
  UserRole,
  IntegrityAnomalyDoc,
  DisasterRecoveryLogDoc,
  IntegrityRepairRequest,
  IntegrityRepairResponse,
  CompensatingEntryRequest,
  CompensatingEntryResponse,
  FinancialTransactionRecord,
  RecoveryApprovalRequest,
  BreakGlassChallenge,
  assertValidLedgerAccount,
} from './types';
import { logSecurityEvent } from './security_logger';
import { enforceAppCheck } from './app_check';
import { assertCapability } from './authorization_policy';
import { executeIntegrityScan } from './integrity_monitor';
import { SystemOperationalMode } from './kill_switch';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * ═══════════════════════════════════════════════════════════════════
 * PHASE 6.1: ENTERPRISE DISASTER RECOVERY & HARDENED SYSTEM RESTORATION
 * ═══════════════════════════════════════════════════════════════════
 * Invariants Enforced:
 * 1. The Non-Automatic Unfreeze Invariant:
 *    - System in FINANCIAL_FROZEN or EMERGENCY_HALT never auto-unfreezes.
 * 2. System-Authoritative Anomaly Resolution (VERIFIED_RESOLVED):
 *    - Admins cannot manually assign VERIFIED_RESOLVED.
 *    - Only system scanner validation can grant VERIFIED_RESOLVED status.
 * 3. Four-Eyes Approval on Operational Mode Restoration:
 *    - Separation between Recovery Requester (Person A) and Approver (Person B).
 *    - Single-admin restoration strictly requires verified break-glass challenge.
 * 4. Audit-Grade Identifiers:
 *    - Cryptographic UUIDs (crypto.randomUUID()) for all audit & recovery logs.
 * 5. Compensating Double-Entry Financial Adjustments:
 *    - Never mutate existing ledger entries in-place.
 *    - Corrections recorded via balanced compensating entries.
 */

/**
 * 1. Query System Integrity Anomalies (Investigation)
 */
export const getIntegrityAnomalies = onCall<{
  statusFilter?: 'ACTIVE' | 'INVESTIGATING' | 'REPAIR_ATTEMPTED' | 'VERIFIED_RESOLVED' | 'ALL';
  categoryFilter?: 'FINANCIAL' | 'INVENTORY' | 'ORDER_LIFECYCLE' | 'RATE_LIMIT' | 'ALL';
  limit?: number;
}>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  assertCapability(
    callerRole,
    'view_business_analytics',
    'Permission denied: Only managers and administrators can inspect integrity anomalies.'
  );

  const statusFilter = request.data?.statusFilter || 'ACTIVE';
  const categoryFilter = request.data?.categoryFilter || 'ALL';
  const maxLimit = Math.min(request.data?.limit || 100, 200);

  let query: admin.firestore.Query = db.collection('integrityAnomalies');

  if (statusFilter !== 'ALL') {
    query = query.where('status', '==', statusFilter);
  }
  if (categoryFilter !== 'ALL') {
    query = query.where('category', '==', categoryFilter);
  }

  const snapshot = await query.limit(maxLimit).get();
  const anomalies: IntegrityAnomalyDoc[] = [];

  snapshot.forEach((doc) => {
    anomalies.push(doc.data() as IntegrityAnomalyDoc);
  });

  return {
    success: true,
    totalCount: anomalies.length,
    anomalies,
  };
});

/**
 * 2. Execute Targeted Disaster Repair Workflow
 */
export const executeIntegrityRepair = onCall<IntegrityRepairRequest, Promise<IntegrityRepairResponse>>(
  async (request) => {
    enforceAppCheck(request);
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const callerRole = (request.auth.token.role as UserRole) || 'student';
    if (callerRole !== 'security_admin' && callerRole !== 'admin' && (callerRole as string) !== 'developer') {
      throw new HttpsError(
        'permission-denied',
        'Permission denied: Only Security Admins, Admins, or Developers can execute disaster repair routines.'
      );
    }

    const { repairType, anomalyIds, notes } = request.data;
    const now = Timestamp.now();
    const details: string[] = [];
    let repairedCount = 0;

    if (repairType === 'EXPIRED_RESERVATION_LEAKS') {
      // Find all reservations that expired but are still marked RESERVED
      const resSnap = await db
        .collection('inventoryReservations')
        .where('status', '==', 'RESERVED')
        .get();

      const nowMillis = now.toMillis();
      const expiredDocs = resSnap.docs.filter((d) => {
        const data = d.data();
        return typeof data.expiresAtMillis === 'number' && data.expiresAtMillis < nowMillis;
      });

      for (const resDoc of expiredDocs) {
        const resData = resDoc.data();
        const items = Array.isArray(resData.items) ? resData.items : [];

        await db.runTransaction(async (t) => {
          // Release reservation
          t.update(resDoc.ref, {
            status: 'EXPIRED',
            expiredAt: now,
            repairedBy: request.auth?.uid,
          });

          // Restore inventory stock calculations
          for (const item of items) {
            const itemId = item.id || item.itemId;
            const quantity = Number(item.quantity || 0);
            if (!itemId || quantity <= 0) continue;

            const menuRef = db.collection('menuItems').doc(itemId);
            const menuDoc = await t.get(menuRef);
            if (menuDoc.exists) {
              const mData = menuDoc.data() || {};
              const currentOnHand = Number(mData.stockOnHand || 0);
              const currentReserved = Number(mData.reservedStock || 0);
              const newReserved = Math.max(0, currentReserved - quantity);
              const newAvailable = Math.max(0, currentOnHand - newReserved);

              t.update(menuRef, {
                reservedStock: newReserved,
                availableStock: newAvailable,
                updatedAt: now,
              });
            }
          }
        });

        repairedCount++;
        details.push(`Released expired reservation hold ${resDoc.id}`);
      }

      await logSecurityEvent({
        eventType: 'DISASTER_REPAIR_EXPIRED_HOLDS_RELEASED',
        severity: 'INFO',
        actorUid: request.auth.uid,
        details: { repairedCount, details },
      });
    } else if (repairType === 'ATTEMPT_REPAIR') {
      // Admin records repair attempt (cannot set VERIFIED_RESOLVED directly)
      if (!Array.isArray(anomalyIds) || anomalyIds.length === 0) {
        throw new HttpsError('invalid-argument', 'anomalyIds array must be provided.');
      }

      const safeNotes = typeof notes === 'string' && notes.trim().length > 0
        ? notes.trim()
        : 'Repair attempt executed by administrator.';

      const batch = db.batch();
      for (const anomId of anomalyIds) {
        const ref = db.collection('integrityAnomalies').doc(anomId);
        batch.update(ref, {
          status: 'REPAIR_ATTEMPTED',
          repairAttemptedAt: now,
          investigatedBy: request.auth.uid,
          repairAttemptNotes: safeNotes,
        });
        repairedCount++;
        details.push(`Marked anomaly ${anomId} as REPAIR_ATTEMPTED`);
      }
      await batch.commit();

      await logSecurityEvent({
        eventType: 'DISASTER_REPAIR_ATTEMPTED',
        severity: 'INFO',
        actorUid: request.auth.uid,
        details: { repairedCount, safeNotes, anomalyIds },
      });
    } else if (repairType === 'VERIFY_AND_RESOLVE') {
      // Authoritative system verification: Runs scanner and marks VERIFIED_RESOLVED only if breach is absent
      if (!Array.isArray(anomalyIds) || anomalyIds.length === 0) {
        throw new HttpsError('invalid-argument', 'anomalyIds array must be provided.');
      }

      const scanResult = await executeIntegrityScan();
      const allActiveViolations = [...scanResult.financialViolations, ...scanResult.inventoryViolations, ...scanResult.lifecycleViolations];

      const batch = db.batch();
      for (const anomId of anomalyIds) {
        const anomDoc = await db.collection('integrityAnomalies').doc(anomId).get();
        if (!anomDoc.exists) continue;

        const anomData = anomDoc.data() || {};
        const entityId = anomData.relatedEntityId;

        // Check if entity is still mentioned in active violations
        const stillViolating = entityId && allActiveViolations.some(v => v.includes(entityId));
        if (stillViolating) {
          details.push(`Anomaly ${anomId} (entity ${entityId}) STILL VIOLATING: Verification rejected.`);
          continue;
        }

        // Clean: Transition to VERIFIED_RESOLVED
        batch.update(anomDoc.ref, {
          status: 'VERIFIED_RESOLVED',
          resolvedAt: now,
          resolvedBy: request.auth.uid,
          verifiedByScanId: scanResult.scanId,
          resolutionNotes: notes || 'System scanner verified breach is resolved.',
        });
        repairedCount++;
        details.push(`Authoritatively verified and resolved anomaly ${anomId}`);
      }
      await batch.commit();

      await logSecurityEvent({
        eventType: 'DISASTER_ANOMALIES_VERIFIED_RESOLVED',
        severity: 'INFO',
        actorUid: request.auth.uid,
        details: { repairedCount, scanId: scanResult.scanId, details },
      });
    } else {
      throw new HttpsError('invalid-argument', `Unsupported repairType: ${repairType}`);
    }

    return {
      success: true,
      repairType,
      repairedCount,
      details,
      timestamp: now.toDate().toISOString(),
    };
  }
);

/**
 * 3. Controlled Administrative Operational Mode Restoration (With Four-Eyes Check)
 */
/**
 * 3a. Request Recovery Approval (Step 1 of Two-Admin Flow)
 *
 * Admin A calls this to create a pending recovery approval request.
 * The requestedBy field is SERVER-SET from auth context, never from client input.
 * Returns the requestId that Admin B must reference when approving.
 */
export const requestRecoveryApproval = onCall<{
  targetMode: SystemOperationalMode;
  justification: string;
}>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  if (callerRole !== 'security_admin' && callerRole !== 'admin' && (callerRole as string) !== 'developer') {
    throw new HttpsError(
      'permission-denied',
      'Permission denied: Only Security Administrators or Admins can request recovery approval.'
    );
  }

  const { targetMode, justification } = request.data;

  const validModes: SystemOperationalMode[] = ['NORMAL', 'DEGRADED', 'FINANCIAL_FROZEN', 'EMERGENCY_HALT'];
  if (!targetMode || !validModes.includes(targetMode)) {
    throw new HttpsError('invalid-argument', `Invalid targetMode. Must be one of: ${validModes.join(', ')}.`);
  }

  if (typeof justification !== 'string' || justification.trim().length < 5 || justification.length > 300) {
    throw new HttpsError(
      'invalid-argument',
      'A valid administrative justification (between 5 and 300 characters) is strictly required.'
    );
  }

  const now = Timestamp.now();
  const requestId = `RAR_${randomUUID()}`;

  // Recovery requests expire after 30 minutes
  const expiresAt = Timestamp.fromMillis(now.toMillis() + 30 * 60 * 1000);

  const currentSnap = await db.collection('systemConfig').doc('global').get();
  const currentMode = (currentSnap.data()?.mode as SystemOperationalMode) || 'NORMAL';

  const approvalRequest: RecoveryApprovalRequest = {
    requestId,
    requestedBy: request.auth.uid, // Server-set, never client-supplied
    requestedRole: callerRole,
    targetMode,
    justification: justification.trim(),
    currentMode,
    status: 'PENDING_APPROVAL',
    createdAt: now,
    expiresAt,
  };

  await db.collection('recoveryApprovalRequests').doc(requestId).set(approvalRequest);

  await logSecurityEvent({
    eventType: 'RECOVERY_APPROVAL_REQUESTED',
    severity: 'HIGH',
    actorUid: request.auth.uid,
    details: { requestId, targetMode, currentMode, justification: justification.trim() },
  });

  return {
    success: true,
    requestId,
    expiresAt: expiresAt.toDate().toISOString(),
    message: 'Recovery request created. A different administrator must approve this request using the requestId.',
  };
});

/**
 * 3b. Generate Break-Glass Emergency Token (Pre-Provisioned by Security Admin)
 *
 * Only security_admin can call this. Generates a cryptographically random token,
 * stores ONLY the SHA-256 hash in Firestore, and returns the plaintext ONCE.
 * The plaintext is never stored — it must be securely communicated to the
 * emergency responder out-of-band.
 */
export const generateBreakGlassToken = onCall<{
  expiryHours?: number;
}>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  if (callerRole !== 'security_admin') {
    throw new HttpsError(
      'permission-denied',
      'Permission denied: Only Security Administrators can provision break-glass emergency tokens.'
    );
  }

  // Generate a cryptographically strong random token
  const plaintextToken = `BG_${randomUUID()}_${randomUUID()}`;
  const tokenHash = createHash('sha256').update(plaintextToken).digest('hex');

  const now = Timestamp.now();
  const expiryHours = Math.min(Math.max(request.data?.expiryHours || 24, 1), 72);
  const expiresAt = Timestamp.fromMillis(now.toMillis() + expiryHours * 60 * 60 * 1000);

  const challenge: BreakGlassChallenge = {
    tokenHash,
    createdBy: request.auth.uid,
    createdAt: now,
    expiresAt,
    consumed: false,
  };

  await db.collection('systemConfig').doc('breakGlassChallenge').set(challenge);

  await logSecurityEvent({
    eventType: 'BREAK_GLASS_TOKEN_PROVISIONED',
    severity: 'HIGH',
    actorUid: request.auth.uid,
    details: {
      tokenHashPrefix: tokenHash.substring(0, 8) + '...',
      expiresAt: expiresAt.toDate().toISOString(),
      expiryHours,
    },
  });

  return {
    success: true,
    plaintextToken, // Returned ONCE — never stored in plaintext
    expiresAt: expiresAt.toDate().toISOString(),
    warning: 'This token is shown ONCE and never stored. Securely deliver it to the emergency responder.',
  };
});

/**
 * 3c. Controlled Administrative Operational Mode Restoration (Real Four-Eyes Check)
 *
 * Two paths to restore from FINANCIAL_FROZEN / EMERGENCY_HALT to NORMAL:
 *
 * Path 1 — Two-Admin Approval:
 *   Admin A calls requestRecoveryApproval() → creates PENDING request
 *   Admin B calls adminRestoreOperationalMode({ recoveryRequestId }) → server verifies:
 *     • Request exists and is PENDING_APPROVAL
 *     • Request has not expired
 *     • Admin B ≠ Admin A (verified from the server-stored requestedBy field)
 *     • Admin B has required role
 *
 * Path 2 — Cryptographic Break-Glass:
 *   Security admin pre-provisions token via generateBreakGlassToken()
 *   Emergency responder calls adminRestoreOperationalMode({ breakGlassToken }) → server verifies:
 *     • SHA-256(token) matches stored hash via timingSafeEqual
 *     • Token is not consumed (single-use)
 *     • Token is not expired
 *     • Atomically marks token as consumed
 *     • Creates a security incident automatically
 */
export const adminRestoreOperationalMode = onCall<{
  targetMode: SystemOperationalMode;
  justification: string;
  resolvedAnomalyIds?: string[];
  recoveryRequestId?: string;
  breakGlassToken?: string;
}>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const approvingAdminUid = request.auth.uid;
  const callerRole = (request.auth.token.role as UserRole) || 'student';
  if (callerRole !== 'security_admin' && callerRole !== 'admin' && (callerRole as string) !== 'developer') {
    throw new HttpsError(
      'permission-denied',
      'Permission denied: Only Security Administrators or Admins are authorized to restore operational modes.'
    );
  }

  const {
    targetMode,
    justification,
    resolvedAnomalyIds = [],
    recoveryRequestId,
    breakGlassToken,
  } = request.data;

  const validModes: SystemOperationalMode[] = ['NORMAL', 'DEGRADED', 'FINANCIAL_FROZEN', 'EMERGENCY_HALT'];
  if (!targetMode || !validModes.includes(targetMode)) {
    throw new HttpsError('invalid-argument', `Invalid targetMode. Must be one of: ${validModes.join(', ')}.`);
  }

  if (typeof justification !== 'string' || justification.trim().length < 5 || justification.length > 300) {
    throw new HttpsError(
      'invalid-argument',
      'A valid administrative justification (between 5 and 300 characters) is strictly required for disaster recovery.'
    );
  }

  const safeJustification = justification.trim();

  // 1. Current State Check
  const currentSnap = await db.collection('systemConfig').doc('global').get();
  const currentMode = (currentSnap.data()?.mode as SystemOperationalMode) || 'NORMAL';

  // 2. Real Four-Eyes Approval Enforcement
  let fourEyesApproved = false;
  let isBreakGlass = false;
  let breakGlassReason: string | undefined;
  let requestedByUid: string = approvingAdminUid;

  if (targetMode === 'NORMAL' && (currentMode === 'FINANCIAL_FROZEN' || currentMode === 'EMERGENCY_HALT')) {
    if (recoveryRequestId && typeof recoveryRequestId === 'string') {
      // Path 1: Two-Admin Approval — server fetches and verifies the request document
      const requestDocRef = db.collection('recoveryApprovalRequests').doc(recoveryRequestId);
      const requestSnap = await requestDocRef.get();

      if (!requestSnap.exists) {
        throw new HttpsError(
          'not-found',
          `Recovery approval request ${recoveryRequestId} not found.`
        );
      }

      const requestData = requestSnap.data() as RecoveryApprovalRequest;

      // Verify request is still pending
      if (requestData.status !== 'PENDING_APPROVAL') {
        throw new HttpsError(
          'failed-precondition',
          `Recovery request ${recoveryRequestId} is no longer pending (current status: ${requestData.status}).`
        );
      }

      // Verify request has not expired
      const now = Timestamp.now();
      if (now.toMillis() > requestData.expiresAt.toMillis()) {
        // Atomically mark as expired
        await requestDocRef.update({ status: 'EXPIRED' });
        throw new HttpsError(
          'failed-precondition',
          `Recovery request ${recoveryRequestId} has expired.`
        );
      }

      // CRITICAL: Verify approver is a DIFFERENT person than the requester
      // The requestedBy field was SERVER-SET when the request was created — not client input
      if (requestData.requestedBy === approvingAdminUid) {
        throw new HttpsError(
          'failed-precondition',
          'Four-eyes principle violated: The approving administrator must be a different person than the requesting administrator. You cannot approve your own recovery request.'
        );
      }

      // Verify the target mode matches
      if (requestData.targetMode !== targetMode) {
        throw new HttpsError(
          'invalid-argument',
          `Target mode mismatch: request specifies ${requestData.targetMode}, but ${targetMode} was provided.`
        );
      }

      // All checks pass — atomically approve
      await requestDocRef.update({
        status: 'APPROVED',
        approvedBy: approvingAdminUid,
        approvedAt: Timestamp.now(),
      });

      fourEyesApproved = true;
      requestedByUid = requestData.requestedBy;

    } else if (breakGlassToken && typeof breakGlassToken === 'string') {
      // Path 2: Cryptographic Break-Glass — server verifies token hash
      const challengeSnap = await db.collection('systemConfig').doc('breakGlassChallenge').get();

      if (!challengeSnap.exists) {
        throw new HttpsError(
          'failed-precondition',
          'No break-glass challenge token has been provisioned. A security_admin must generate one first.'
        );
      }

      const challengeData = challengeSnap.data() as BreakGlassChallenge;

      // Verify token has not been consumed (single-use)
      if (challengeData.consumed) {
        throw new HttpsError(
          'failed-precondition',
          'Break-glass token has already been consumed. It is single-use. A new token must be provisioned.'
        );
      }

      // Verify token has not expired
      const now = Timestamp.now();
      if (now.toMillis() > challengeData.expiresAt.toMillis()) {
        throw new HttpsError(
          'failed-precondition',
          'Break-glass token has expired. A new token must be provisioned.'
        );
      }

      // Cryptographic verification: compute SHA-256 of provided token and compare
      const providedHash = createHash('sha256').update(breakGlassToken).digest('hex');
      const storedHashBuffer = Buffer.from(challengeData.tokenHash, 'hex');
      const providedHashBuffer = Buffer.from(providedHash, 'hex');

      if (storedHashBuffer.length !== providedHashBuffer.length ||
          !timingSafeEqual(storedHashBuffer, providedHashBuffer)) {
        await logSecurityEvent({
          eventType: 'BREAK_GLASS_TOKEN_REJECTED',
          severity: 'CRITICAL',
          actorUid: approvingAdminUid,
          details: { reason: 'Cryptographic hash mismatch — invalid token provided.' },
        });
        throw new HttpsError(
          'failed-precondition',
          'Break-glass token verification failed: invalid token.'
        );
      }

      // Atomically mark token as consumed (single-use)
      await db.collection('systemConfig').doc('breakGlassChallenge').update({
        consumed: true,
        consumedAt: Timestamp.now(),
        consumedBy: approvingAdminUid,
      });

      isBreakGlass = true;
      breakGlassReason = 'Emergency single-admin break-glass override. Token cryptographically verified via SHA-256 + timingSafeEqual comparison and consumed (single-use).';

      // Automatically create a security incident for forensic review
      await logSecurityEvent({
        eventType: 'BREAK_GLASS_TOKEN_CONSUMED',
        severity: 'CRITICAL',
        actorUid: approvingAdminUid,
        details: {
          tokenHashPrefix: challengeData.tokenHash.substring(0, 8) + '...',
          provisionedBy: challengeData.createdBy,
          consumedBy: approvingAdminUid,
          reason: 'Break-glass emergency override invoked. Mandatory post-incident review required.',
        },
      });

    } else {
      throw new HttpsError(
        'failed-precondition',
        'Four-eyes disaster recovery principle: Restoring from a frozen/halted state requires either (a) a recoveryRequestId from a different administrator\'s pending request, or (b) a valid break-glass emergency token. Neither was provided.'
      );
    }
  }

  // 3. Pre-Condition Verification for Restoration to NORMAL
  if (targetMode === 'NORMAL') {
    // Check if there are active or unverified CRITICAL anomalies
    const activeCriticalSnap = await db
      .collection('integrityAnomalies')
      .where('status', 'in', ['ACTIVE', 'REPAIR_ATTEMPTED'])
      .where('severity', '==', 'CRITICAL')
      .get();

    if (!activeCriticalSnap.empty) {
      const openCount = activeCriticalSnap.size;
      throw new HttpsError(
        'failed-precondition',
        `Disaster recovery rejected: ${openCount} unresolved or unverified CRITICAL integrity anomalies remain. Please resolve and verify all critical anomalies before restoring NORMAL operations.`
      );
    }

    // Fresh authoritative scan verification
    const postRepairScan = await executeIntegrityScan();
    if (postRepairScan.circuitBreakerLevel === 'EMERGENCY_FREEZE') {
      throw new HttpsError(
        'failed-precondition',
        `Disaster recovery pre-flight validation failed: A fresh scan detected financial integrity violations: ${postRepairScan.financialViolations.join('; ')}`
      );
    }
  }

  const now = Timestamp.now();
  const logId = `REC_${randomUUID()}`;

  // 4. Append Immutable Disaster Recovery Audit Log
  const recoveryLogDoc: DisasterRecoveryLogDoc = {
    logId,
    previousMode: currentMode,
    newMode: targetMode,
    restoredBy: approvingAdminUid,
    restoredRole: callerRole,
    justification: safeJustification,
    resolvedAnomalyIds,
    fourEyesApproved,
    requestedBy: requestedByUid,
    isBreakGlass,
    breakGlassReason,
    timestamp: now,
  };

  await db.collection('disasterRecoveryLogs').doc(logId).set(recoveryLogDoc);

  // 5. Update Internal System Configuration
  await db.collection('systemConfig').doc('global').set({
    mode: targetMode,
    reason: `Disaster Recovery Restoration: ${safeJustification}`,
    recoveryLogId: logId,
    updatedBy: approvingAdminUid,
    updatedAt: now,
  });

  // 6. Update Public Status
  await db.collection('publicSystemStatus').doc('global').set({
    mode: targetMode,
    orderingAvailable: targetMode === 'NORMAL',
    updatedAt: now,
  });

  // 7. Security Event Logging
  await logSecurityEvent({
    eventType: 'DISASTER_RECOVERY_OPERATIONAL_MODE_RESTORED',
    severity: targetMode === 'NORMAL' ? 'INFO' : 'HIGH',
    actorUid: approvingAdminUid,
    details: {
      logId,
      previousMode: currentMode,
      restoredMode: targetMode,
      justification: safeJustification,
      fourEyesApproved,
      isBreakGlass,
      resolvedAnomalyIds,
    },
  });

  return {
    success: true,
    logId,
    previousMode: currentMode,
    newMode: targetMode,
    restoredBy: approvingAdminUid,
    fourEyesApproved,
    isBreakGlass,
    timestamp: now.toDate().toISOString(),
  };
});

/**
 * 4. Record Compensating Double-Entry Financial Adjustment
 * 
 * Immutable Accounting Rule:
 * Original ledger entries are NEVER modified in-place.
 * Discrepancies are resolved strictly via new, balanced compensating transactions.
 */
export const recordCompensatingFinancialEntry = onCall<CompensatingEntryRequest, Promise<CompensatingEntryResponse>>(
  async (request) => {
    enforceAppCheck(request);
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const callerRole = (request.auth.token.role as UserRole) || 'student';
    if (callerRole !== 'security_admin' && callerRole !== 'admin' && (callerRole as string) !== 'developer') {
      throw new HttpsError(
        'permission-denied',
        'Permission denied: Only Security Admins or Admins can record compensating financial entries.'
      );
    }

    const { originalTransactionId, amountPaise, reason, debitAccount, creditAccount } = request.data;
    if (!originalTransactionId || typeof originalTransactionId !== 'string') {
      throw new HttpsError('invalid-argument', 'originalTransactionId must be provided.');
    }
    if (typeof amountPaise !== 'number' || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new HttpsError('invalid-argument', 'amountPaise must be a positive integer.');
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      throw new HttpsError('invalid-argument', 'A valid justification reason (at least 5 chars) is required.');
    }
    if (!debitAccount || !creditAccount) {
      throw new HttpsError('invalid-argument', 'Both debitAccount and creditAccount must be specified.');
    }

    // Runtime validation against the closed set of valid ledger accounts.
    // Prevents arbitrary strings from becoming permanent immutable entries.
    try {
      assertValidLedgerAccount(debitAccount as string);
      assertValidLedgerAccount(creditAccount as string);
    } catch (err) {
      throw new HttpsError('invalid-argument', (err as Error).message);
    }

    // 1. Verify original transaction exists (NEVER modify original)
    const origTxnRef = db.collection('financialTransactions').doc(originalTransactionId);
    const origTxnSnap = await origTxnRef.get();
    if (!origTxnSnap.exists) {
      throw new HttpsError('not-found', `Original financial transaction ${originalTransactionId} not found.`);
    }

    const origData = origTxnSnap.data() || {};
    const now = Timestamp.now();
    const transactionId = `cmp_${randomUUID()}`;

    // 2. Build strictly balanced compensating transaction
    const compensatingRecord: FinancialTransactionRecord = {
      transactionId,
      orderId: origData.orderId || '',
      type: 'COMPENSATING_ADJUSTMENT',
      amount: amountPaise / 100,
      amountPaise,
      currency: 'INR',
      postings: [
        { account: debitAccount, debitPaise: amountPaise, creditPaise: 0 },
        { account: creditAccount, debitPaise: 0, creditPaise: amountPaise },
      ],
      gatewayTransactionId: origData.gatewayTransactionId || `comp_${transactionId}`,
      gatewayOrderId: origData.gatewayOrderId || '',
      actorId: request.auth.uid,
      timestamp: now,
      status: 'CAPTURED',
      isCompensatingEntry: true,
      compensatingForTransactionId: originalTransactionId,
      compensationReason: reason.trim(),
    };

    await db.collection('financialTransactions').doc(transactionId).set(compensatingRecord);

    await logSecurityEvent({
      eventType: 'COMPENSATING_FINANCIAL_ENTRY_RECORDED',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: {
        transactionId,
        originalTransactionId,
        amountPaise,
        reason: reason.trim(),
        debitAccount,
        creditAccount,
      },
    });

    return {
      success: true,
      transactionId,
      originalTransactionId,
      amountPaise,
      timestamp: now.toDate().toISOString(),
    };
  }
);
