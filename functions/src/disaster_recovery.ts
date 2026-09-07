import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import {
  UserRole,
  IntegrityAnomalyDoc,
  DisasterRecoveryLogDoc,
  IntegrityRepairRequest,
  IntegrityRepairResponse,
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
 * PHASE 6: DISASTER RECOVERY & CONTROLLED SYSTEM RESTORATION ENGINE
 * ═══════════════════════════════════════════════════════════════════
 * Contract:
 * 1. The Non-Automatic Unfreeze Invariant:
 *    - A system placed into FINANCIAL_FROZEN or EMERGENCY_HALT must NEVER
 *      automatically restore itself to NORMAL mode.
 * 2. Explicit Administrative Recovery Workflow:
 *    - Step 1: Query & investigate active anomalies (getIntegrityAnomalies).
 *    - Step 2: Execute targeted repair (executeIntegrityRepair).
 *    - Step 3: Run pre-condition validation. If unresolved CRITICAL anomalies remain,
 *      mode restoration fails closed.
 *    - Step 4: Admin explicitly restores NORMAL mode with an immutable audit trail
 *      written to disasterRecoveryLogs.
 * 3. Separation of Duties:
 *    - Only Security Admins, Developers, or Admins are authorized to execute
 *      restoration from frozen states.
 */

/**
 * 1. Query System Integrity Anomalies (Investigation)
 */
export const getIntegrityAnomalies = onCall<{
  statusFilter?: 'ACTIVE' | 'INVESTIGATING' | 'RESOLVED' | 'ALL';
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

    const { repairType, anomalyIds, resolutionNotes } = request.data;
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
    } else if (repairType === 'RESOLVE_ANOMALIES') {
      if (!Array.isArray(anomalyIds) || anomalyIds.length === 0) {
        throw new HttpsError('invalid-argument', 'anomalyIds array must be provided.');
      }

      const safeNotes = typeof resolutionNotes === 'string' && resolutionNotes.trim().length > 0
        ? resolutionNotes.trim()
        : 'Administrative repair and manual verification completed.';

      const batch = db.batch();
      for (const anomId of anomalyIds) {
        const ref = db.collection('integrityAnomalies').doc(anomId);
        batch.update(ref, {
          status: 'RESOLVED',
          resolvedAt: now,
          resolvedBy: request.auth.uid,
          resolutionNotes: safeNotes,
        });
        repairedCount++;
        details.push(`Marked anomaly ${anomId} as RESOLVED`);
      }
      await batch.commit();

      await logSecurityEvent({
        eventType: 'DISASTER_REPAIR_ANOMALIES_RESOLVED',
        severity: 'INFO',
        actorUid: request.auth.uid,
        details: { repairedCount, safeNotes, anomalyIds },
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
 * 3. Controlled Administrative Operational Mode Restoration
 * 
 * Enforces:
 * - Role separation: only Security Admin, Admin, Developer.
 * - Non-automatic unfreeze invariant.
 * - Pre-condition validation: Mode restoration to NORMAL fails closed if any
 *   unresolved CRITICAL anomalies remain in the system.
 * - Writes immutable disasterRecoveryLogs entry.
 */
export const adminRestoreOperationalMode = onCall<{
  targetMode: SystemOperationalMode;
  justification: string;
  resolvedAnomalyIds?: string[];
}>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  if (callerRole !== 'security_admin' && callerRole !== 'admin' && (callerRole as string) !== 'developer') {
    throw new HttpsError(
      'permission-denied',
      'Permission denied: Only Security Administrators or Admins are authorized to restore operational modes.'
    );
  }

  const { targetMode, justification, resolvedAnomalyIds = [] } = request.data;
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

  // 2. Pre-Condition Verification for Restoration to NORMAL
  if (targetMode === 'NORMAL') {
    // Check if there are active CRITICAL anomalies
    const activeCriticalSnap = await db
      .collection('integrityAnomalies')
      .where('status', '==', 'ACTIVE')
      .where('severity', '==', 'CRITICAL')
      .get();

    if (!activeCriticalSnap.empty) {
      const openCount = activeCriticalSnap.size;
      throw new HttpsError(
        'failed-precondition',
        `Disaster recovery rejected: ${openCount} unresolved CRITICAL integrity anomalies remain active. Please inspect and resolve all critical anomalies before restoring NORMAL operations.`
      );
    }

    // Run a fresh post-repair scan to verify that system state is genuinely clean
    const postRepairScan = await executeIntegrityScan();
    if (postRepairScan.circuitBreakerLevel === 'EMERGENCY_FREEZE') {
      throw new HttpsError(
        'failed-precondition',
        `Disaster recovery pre-flight validation failed: A fresh scan detected financial integrity violations: ${postRepairScan.financialViolations.join('; ')}`
      );
    }
  }

  const now = Timestamp.now();
  const logId = `REC_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  // 3. Append Immutable Disaster Recovery Audit Log
  const recoveryLogDoc: DisasterRecoveryLogDoc = {
    logId,
    previousMode: currentMode,
    newMode: targetMode,
    restoredBy: request.auth.uid,
    restoredRole: callerRole,
    justification: safeJustification,
    resolvedAnomalyIds,
    timestamp: now,
  };

  await db.collection('disasterRecoveryLogs').doc(logId).set(recoveryLogDoc);

  // 4. Update Internal System Configuration
  await db.collection('systemConfig').doc('global').set({
    mode: targetMode,
    reason: `Disaster Recovery Restoration: ${safeJustification}`,
    recoveryLogId: logId,
    updatedBy: request.auth.uid,
    updatedAt: now,
  });

  // 5. Update Public Status
  await db.collection('publicSystemStatus').doc('global').set({
    mode: targetMode,
    orderingAvailable: targetMode === 'NORMAL',
    updatedAt: now,
  });

  // 6. Security Event Logging
  await logSecurityEvent({
    eventType: 'DISASTER_RECOVERY_OPERATIONAL_MODE_RESTORED',
    severity: targetMode === 'NORMAL' ? 'INFO' : 'HIGH',
    actorUid: request.auth.uid,
    details: {
      logId,
      previousMode: currentMode,
      restoredMode: targetMode,
      justification: safeJustification,
      resolvedAnomalyIds,
    },
  });

  return {
    success: true,
    logId,
    previousMode: currentMode,
    newMode: targetMode,
    restoredBy: request.auth.uid,
    timestamp: now.toDate().toISOString(),
  };
});
