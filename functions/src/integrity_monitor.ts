import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { logSecurityEvent } from './security_logger';
import { UserRole } from './types';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export interface IntegrityScanResult {
  scanId: string;
  timestamp: string;
  status: 'HEALTHY' | 'INVESTIGATION' | 'CRITICAL_BREACH';
  anomaliesDetected: number;
  criticalViolations: string[];
  warnings: string[];
  actionTaken: 'NONE' | 'AUTO_FINANCIAL_FROZEN';
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * CONTINUOUS SECURITY INTEGRITY MONITOR (Stage 5 Hardened)
 * ═══════════════════════════════════════════════════════════════════
 * Authoritative cross-collection invariant scanner:
 * 1. Orders: Checks for impossible states (collected without payment, duplicate tokens).
 * 2. Inventory: Checks for corrupt/negative stock or reservedStock > stockOnHand.
 * 3. Financial: Checks double-entry ledger balance (sum debits == sum credits).
 * 4. Automatic Circuit Breaker: Automatically trips system to FINANCIAL_FROZEN if critical corruption is detected.
 */
export async function executeIntegrityScan(): Promise<IntegrityScanResult> {
  const scanId = `SCAN_${Date.now()}`;
  const now = admin.firestore.Timestamp.now();
  const criticalViolations: string[] = [];
  const warnings: string[] = [];

  // ─── 1. INVENTORY INVARIANTS SCAN ─────────────────────────────────
  const menuSnap = await db.collection('menuItems').get();
  for (const doc of menuSnap.docs) {
    const data = doc.data();
    if (data.type === 'instant') {
      const stockOnHand = data.stockOnHand;
      const reservedStock = data.reservedStock || 0;

      if (typeof stockOnHand !== 'number' || !Number.isSafeInteger(stockOnHand) || stockOnHand < 0) {
        criticalViolations.push(`INVENTORY_CORRUPTION: Item ${doc.id} (${data.name}) has negative or non-integer stockOnHand (${stockOnHand}).`);
      }
      if (typeof reservedStock !== 'number' || !Number.isSafeInteger(reservedStock) || reservedStock < 0) {
        criticalViolations.push(`INVENTORY_CORRUPTION: Item ${doc.id} (${data.name}) has negative or non-integer reservedStock (${reservedStock}).`);
      }
      if (typeof stockOnHand === 'number' && typeof reservedStock === 'number' && reservedStock > stockOnHand) {
        criticalViolations.push(`INVENTORY_INVARIANT_BREACH: Item ${doc.id} (${data.name}) has reservedStock (${reservedStock}) > stockOnHand (${stockOnHand}).`);
      }
    }
  }

  // ─── 2. ACTIVE ORDERS IMPOSSIBLE STATE SCAN ───────────────────────
  const recentOrdersSnap = await db.collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const tokenMap = new Map<string, string>();

  for (const doc of recentOrdersSnap.docs) {
    const order = doc.data();
    const orderId = doc.id;

    // Impossible State 1: Collected or Ready without payment
    if ((order.status === 'collected' || order.status === 'ready') && order.paymentMethod === 'online' && order.paymentStatus !== 'paid' && order.paymentStatus !== 'captured') {
      criticalViolations.push(`IMPOSSIBLE_ORDER_STATE: Online order ${orderId} is ${order.status} but paymentStatus is ${order.paymentStatus}.`);
    }

    // Impossible State 2: Duplicate Token on active orders
    if (order.tokenNumber && (order.status === 'confirmed' || order.status === 'preparing' || order.status === 'ready')) {
      if (tokenMap.has(order.tokenNumber)) {
        warnings.push(`DUPLICATE_TOKEN_WARNING: Token ${order.tokenNumber} shared between ${tokenMap.get(order.tokenNumber)} and ${orderId}.`);
      } else {
        tokenMap.set(order.tokenNumber, orderId);
      }
    }
  }

  // ─── 3. FINANCIAL DOUBLE-ENTRY BALANCE SCAN ───────────────────────
  const recentTxnSnap = await db.collection('financialTransactions')
    .orderBy('timestamp', 'desc')
    .limit(50)
    .get();

  for (const doc of recentTxnSnap.docs) {
    const txn = doc.data();
    const debits = (txn.postings || []).reduce((sum: number, p: any) => sum + (p.debitPaise || 0), 0);
    const credits = (txn.postings || []).reduce((sum: number, p: any) => sum + (p.creditPaise || 0), 0);

    if (debits !== credits) {
      criticalViolations.push(`LEDGER_UNBALANCED_TRANSACTION: Txn ${doc.id} has debits (${debits}) != credits (${credits}).`);
    }
  }

  // ─── 4. DETERMINE OVERALL STATUS & CIRCUIT BREAKER ACTION ─────────
  let status: 'HEALTHY' | 'INVESTIGATION' | 'CRITICAL_BREACH' = 'HEALTHY';
  let actionTaken: 'NONE' | 'AUTO_FINANCIAL_FROZEN' = 'NONE';

  if (criticalViolations.length > 0) {
    status = 'CRITICAL_BREACH';
  } else if (warnings.length > 0) {
    status = 'INVESTIGATION';
  }

  // Automatic Circuit Breaker Activation
  if (status === 'CRITICAL_BREACH') {
    actionTaken = 'AUTO_FINANCIAL_FROZEN';

    // 1. Freeze systemConfig (private)
    await db.collection('systemConfig').doc('global').set({
      mode: 'FINANCIAL_FROZEN',
      reason: `Automated Circuit Breaker: ${criticalViolations[0]}`,
      updatedBy: 'SECURITY_INTEGRITY_MONITOR',
      updatedAt: now,
    });

    // 2. Freeze publicSystemStatus (public sanitized)
    await db.collection('publicSystemStatus').doc('global').set({
      mode: 'FINANCIAL_FROZEN',
      orderingAvailable: false,
      updatedAt: now,
    });

    await logSecurityEvent({
      eventType: 'CIRCUIT_BREAKER_AUTO_FREEZE_TRIGGERED',
      severity: 'CRITICAL',
      actorUid: 'SECURITY_INTEGRITY_MONITOR',
      details: {
        scanId,
        criticalViolations,
      },
    });
  } else if (status === 'INVESTIGATION') {
    await logSecurityEvent({
      eventType: 'INTEGRITY_MONITOR_ANOMALY_WARNING',
      severity: 'HIGH',
      actorUid: 'SECURITY_INTEGRITY_MONITOR',
      details: {
        scanId,
        warnings,
      },
    });
  }

  return {
    scanId,
    timestamp: now.toDate().toISOString(),
    status,
    anomaliesDetected: criticalViolations.length + warnings.length,
    criticalViolations,
    warnings,
    actionTaken,
  };
}

/**
 * Hourly Scheduled Security Integrity Monitor.
 */
export const scheduledSecurityIntegrityMonitor = onSchedule(
  {
    schedule: '0 * * * *', // Every hour
    timeZone: 'Asia/Kolkata',
    retryCount: 2,
  },
  async () => {
    const result = await executeIntegrityScan();
    if (result.status === 'CRITICAL_BREACH') {
      throw new Error(`INTEGRITY_MONITOR_BREACH: ${result.criticalViolations.join('; ')}`);
    }
  }
);

/**
 * On-Demand Callable Security Integrity Scan (Security Admin / Admin only).
 */
export const runSecurityIntegrityScan = onCall<void, Promise<IntegrityScanResult>>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const role = (request.auth.token.role as UserRole) || 'student';
  if (role !== 'security_admin' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'Permission denied: Security Admin or Admin role required.');
  }

  return await executeIntegrityScan();
});
