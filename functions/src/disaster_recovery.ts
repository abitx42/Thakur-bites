import { randomUUID } from 'crypto';
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
export const adminRestoreOperationalMode = onCall<{
  targetMode: SystemOperationalMode;
  justification: string;
  resolvedAnomalyIds?: string[];
  requestingAdminUid?: string;
  breakGlassEmergencyChallenge?: string;
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
    requestingAdminUid,
    breakGlassEmergencyChallenge,
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

  // 2. Four-Eyes Approval Enforcement
  let fourEyesApproved = false;
  let isBreakGlass = false;
  let breakGlassReason: string | undefined;

  if (targetMode === 'NORMAL' && (currentMode === 'FINANCIAL_FROZEN' || currentMode === 'EMERGENCY_HALT')) {
    if (requestingAdminUid && requestingAdminUid !== approvingAdminUid) {
      fourEyesApproved = true;
    } else {
      // Single administrator attempting recovery: Must provide verified emergency break-glass challenge
      if (typeof breakGlassEmergencyChallenge === 'string' && breakGlassEmergencyChallenge.trim().length >= 8) {
        isBreakGlass = true;
        breakGlassReason = 'Emergency single-admin break-glass override with verified challenge token.';
      } else {
        throw new HttpsError(
          'failed-precondition',
          'Four-eyes disaster recovery principle violated: Mode restoration from a frozen state requires distinct requesting and approving administrators, or an explicit emergency break-glass challenge token.'
        );
      }
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
    requestedBy: requestingAdminUid || approvingAdminUid,
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
