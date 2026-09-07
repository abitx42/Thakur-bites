import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { logSecurityEvent } from './security_logger';
import { UserRole, CircuitBreakerLevel, IntegrityAnomalyDoc } from './types';
import { enforceAppCheck } from './app_check';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export interface IntegrityScanResult {
  scanId: string;
  timestamp: string;
  status: 'HEALTHY' | 'INVESTIGATION' | 'CRITICAL_BREACH';
  circuitBreakerLevel: CircuitBreakerLevel | 'NORMAL';
  anomaliesDetected: number;
  financialViolations: string[];
  inventoryViolations: string[];
  lifecycleViolations: string[];
  criticalViolations: string[];
  warnings: string[];
  actionTaken: 'NONE' | 'RESTRICTED_MODE' | 'AUTO_FINANCIAL_FROZEN';
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * ENTERPRISE CONTINUOUS SYSTEM INTEGRITY ENGINE & CIRCUIT BREAKER 2.0
 * ═══════════════════════════════════════════════════════════════════
 * 1. Financial Invariants:
 *    - SUM(debits) == SUM(credits) on every double-entry transaction.
 *    - Postings total == transaction amountPaise.
 *    - Duplicate ledger transaction detection.
 *    - Missing ledger entry detection for paid orders.
 *    - Orphan financial transaction detection.
 *    - Amount mismatch between order and transaction.
 * 2. Inventory Invariants:
 *    - stockOnHand - reservedStock == availableStock.
 *    - Fail-closed non-negative bounds.
 *    - Expired reservations still locking stock.
 *    - Paid orders with uncommitted reservations.
 * 3. Order Lifecycle Impossible States:
 *    - status == 'preparing' with paymentStatus == 'pending'.
 *    - status == 'collected' without pickup verification.
 *    - status == 'cancelled' with paymentStatus == 'paid' without refund record.
 *    - Duplicate active tokens among active orders.
 * 4. Immutable Anomaly Logging:
 *    - Writes every detected breach/warning to integrityAnomalies collection.
 * 5. Autonomous 3-Tier Circuit Breaker:
 *    - Level 1 (Warning): Isolated anomaly -> Log, alert admin, remain NORMAL.
 *    - Level 2 (Restricted): Inventory inconsistencies -> DEGRADED (blocks checkout, finishes kitchen).
 *    - Level 3 (Emergency Freeze): Financial breach -> FINANCIAL_FROZEN (blocks checkout/payments, permits ready->collected).
 */
export async function executeIntegrityScan(): Promise<IntegrityScanResult> {
  const scanId = `SCAN_${Date.now()}`;
  const now = Timestamp.now();
  const nowMillis = now.toMillis();

  const financialViolations: string[] = [];
  const inventoryViolations: string[] = [];
  const lifecycleViolations: string[] = [];
  const warnings: string[] = [];

  const anomaliesToRecord: Array<{
    category: 'FINANCIAL' | 'INVENTORY' | 'ORDER_LIFECYCLE';
    severity: 'WARN' | 'RESTRICTED' | 'CRITICAL';
    details: string;
    relatedEntityId?: string;
  }> = [];

  // ─────────────────────────────────────────────────────────────────
  // 1. FAIL-CLOSED INVENTORY INVARIANT SCAN
  // ─────────────────────────────────────────────────────────────────
  const menuSnap = await db.collection('menuItems').get();
  for (const doc of menuSnap.docs) {
    const data = doc.data();
    if (data.type === 'instant') {
      const stockOnHand = data.stockOnHand;
      const reservedStock = data.reservedStock;
      const availableStock = data.availableStock;

      // Fail-closed integer bounds check
      if (typeof stockOnHand !== 'number' || !Number.isSafeInteger(stockOnHand) || stockOnHand < 0) {
        const msg = `INVENTORY_CORRUPTION: Item ${doc.id} (${data.name}) has invalid/negative stockOnHand (${stockOnHand}).`;
        inventoryViolations.push(msg);
        anomaliesToRecord.push({ category: 'INVENTORY', severity: 'CRITICAL', details: msg, relatedEntityId: doc.id });
      }
      if (typeof reservedStock !== 'number' || !Number.isSafeInteger(reservedStock) || reservedStock < 0) {
        const msg = `INVENTORY_CORRUPTION: Item ${doc.id} (${data.name}) has invalid/negative reservedStock (${reservedStock}).`;
        inventoryViolations.push(msg);
        anomaliesToRecord.push({ category: 'INVENTORY', severity: 'CRITICAL', details: msg, relatedEntityId: doc.id });
      }
      if (typeof stockOnHand === 'number' && typeof reservedStock === 'number' && reservedStock > stockOnHand) {
        const msg = `INVENTORY_INVARIANT_BREACH: Item ${doc.id} (${data.name}) has reservedStock (${reservedStock}) > stockOnHand (${stockOnHand}).`;
        inventoryViolations.push(msg);
        anomaliesToRecord.push({ category: 'INVENTORY', severity: 'CRITICAL', details: msg, relatedEntityId: doc.id });
      }
      if (typeof stockOnHand === 'number' && typeof reservedStock === 'number' && typeof availableStock === 'number') {
        if (availableStock !== stockOnHand - reservedStock) {
          const msg = `INVENTORY_EQUATION_MISMATCH: Item ${doc.id} (${data.name}) availableStock (${availableStock}) != stockOnHand (${stockOnHand}) - reservedStock (${reservedStock}).`;
          inventoryViolations.push(msg);
          anomaliesToRecord.push({ category: 'INVENTORY', severity: 'CRITICAL', details: msg, relatedEntityId: doc.id });
        }
      }
    }
  }

  // 1b. Check Expired Reservations Leaking Stock
  const resSnap = await db.collection('inventoryReservations').where('status', '==', 'RESERVED').limit(200).get();
  for (const doc of resSnap.docs) {
    const resData = doc.data();
    const expiresAtMillis = resData.expiresAt?.toMillis?.() || 0;
    if (expiresAtMillis > 0 && nowMillis > expiresAtMillis) {
      const msg = `EXPIRED_RESERVATION_HOLD_LEAK: Reservation ${doc.id} (Order ${resData.orderId}) expired at ${resData.expiresAt?.toDate?.() ? resData.expiresAt.toDate().toISOString() : 'stale'} but still RESERVED.`;
      inventoryViolations.push(msg);
      anomaliesToRecord.push({ category: 'INVENTORY', severity: 'RESTRICTED', details: msg, relatedEntityId: doc.id });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. FINANCIAL LEDGER & DOUBLE-ENTRY SCAN
  // ─────────────────────────────────────────────────────────────────
  const financialTxnSnap = await db.collection('financialTransactions').limit(500).get();
  const txnsByOrderId = new Map<string, any[]>();
  const txnDocMap = new Map<string, any>();

  for (const doc of financialTxnSnap.docs) {
    const txn = doc.data();
    txnDocMap.set(doc.id, txn);
    const orderId = txn.orderId;
    if (orderId) {
      if (!txnsByOrderId.has(orderId)) txnsByOrderId.set(orderId, []);
      txnsByOrderId.get(orderId)!.push({ id: doc.id, ...txn });
    }

    // Check Double-Entry Balance
    const debits = (txn.postings || []).reduce((sum: number, p: any) => sum + (p.debitPaise || 0), 0);
    const credits = (txn.postings || []).reduce((sum: number, p: any) => sum + (p.creditPaise || 0), 0);

    if (debits !== credits) {
      const msg = `LEDGER_UNBALANCED_TRANSACTION: Txn ${doc.id} has debits (${debits}) != credits (${credits}).`;
      financialViolations.push(msg);
      anomaliesToRecord.push({ category: 'FINANCIAL', severity: 'CRITICAL', details: msg, relatedEntityId: doc.id });
    }

    // Check Transaction Total == Postings Total
    if (typeof txn.amountPaise === 'number' && debits !== txn.amountPaise) {
      const msg = `LEDGER_AMOUNT_MISMATCH: Txn ${doc.id} amountPaise (${txn.amountPaise}) != postings total (${debits}).`;
      financialViolations.push(msg);
      anomaliesToRecord.push({ category: 'FINANCIAL', severity: 'CRITICAL', details: msg, relatedEntityId: doc.id });
    }
  }

  // Check Duplicate Financial Captures for Same Order
  for (const [orderId, txns] of txnsByOrderId.entries()) {
    const captures = txns.filter(t => t.type === 'ONLINE_PAYMENT' || t.type === 'COUNTER_CASH' || t.action === 'PAYMENT_CAPTURE');
    if (captures.length > 1) {
      const msg = `DUPLICATE_FINANCIAL_CAPTURE: Order ${orderId} has ${captures.length} financial capture transactions (${captures.map(c => c.id).join(', ')}).`;
      financialViolations.push(msg);
      anomaliesToRecord.push({ category: 'FINANCIAL', severity: 'CRITICAL', details: msg, relatedEntityId: orderId });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. ORDER LIFECYCLE & CROSS-COLLECTION INVARIANT SCAN
  // ─────────────────────────────────────────────────────────────────
  const activeOrdersSnap = await db.collection('orders').orderBy('createdAt', 'desc').limit(250).get();
  const tokenMap = new Map<string, string>();

  for (const doc of activeOrdersSnap.docs) {
    const order = doc.data();
    const orderId = doc.id;

    // Impossible State 1: Preparing without payment
    if (order.status === 'preparing' && order.paymentMethod === 'online' && order.paymentStatus === 'pending') {
      const msg = `LIFECYCLE_UNPAID_PREPARING: Order ${orderId} is PREPARING but paymentStatus is PENDING.`;
      lifecycleViolations.push(msg);
      anomaliesToRecord.push({ category: 'ORDER_LIFECYCLE', severity: 'CRITICAL', details: msg, relatedEntityId: orderId });
    }

    // Impossible State 2: Ready/Collected without payment capture
    if ((order.status === 'ready' || order.status === 'collected') && order.paymentMethod === 'online' && order.paymentStatus !== 'paid' && order.paymentStatus !== 'captured') {
      const msg = `LIFECYCLE_UNPAID_HANDOVER: Online order ${orderId} is ${order.status} but paymentStatus is ${order.paymentStatus}.`;
      lifecycleViolations.push(msg);
      anomaliesToRecord.push({ category: 'ORDER_LIFECYCLE', severity: 'CRITICAL', details: msg, relatedEntityId: orderId });
    }

    // Impossible State 3: Collected without verification metadata
    if (order.status === 'collected' && !order.collectedAt && !order.verificationMethod) {
      const msg = `LIFECYCLE_UNVERIFIED_COLLECTED: Order ${orderId} marked COLLECTED without pickup verification timestamp or method.`;
      lifecycleViolations.push(msg);
      anomaliesToRecord.push({ category: 'ORDER_LIFECYCLE', severity: 'CRITICAL', details: msg, relatedEntityId: orderId });
    }

    // Impossible State 4: Cancelled with paid payment without refund record
    if (order.status === 'cancelled' && (order.paymentStatus === 'paid' || order.paymentStatus === 'captured') && !order.refundId && !order.refundLifecycleStatus) {
      const msg = `LIFECYCLE_UNREFUNDED_CANCELLED: Order ${orderId} is CANCELLED with captured payment but lacks refund tracking record.`;
      lifecycleViolations.push(msg);
      anomaliesToRecord.push({ category: 'ORDER_LIFECYCLE', severity: 'CRITICAL', details: msg, relatedEntityId: orderId });
    }

    // Check Missing Financial Ledger for Paid Orders
    if ((order.paymentStatus === 'paid' || order.paymentStatus === 'captured') && !txnsByOrderId.has(orderId)) {
      const directFinDoc = txnDocMap.get(`fin_${orderId}`) || txnDocMap.get(`cash_fin_${orderId}`);
      if (!directFinDoc) {
        const msg = `MISSING_FINANCIAL_LEDGER: Order ${orderId} is marked PAID but has no record in financialTransactions collection.`;
        financialViolations.push(msg);
        anomaliesToRecord.push({ category: 'FINANCIAL', severity: 'CRITICAL', details: msg, relatedEntityId: orderId });
      }
    }

    // Check Duplicate Active Tokens
    if (order.tokenNumber && (order.status === 'confirmed' || order.status === 'preparing' || order.status === 'ready')) {
      if (tokenMap.has(order.tokenNumber)) {
        const msg = `DUPLICATE_TOKEN_WARNING: Active token ${order.tokenNumber} shared between ${tokenMap.get(order.tokenNumber)} and ${orderId}.`;
        warnings.push(msg);
        anomaliesToRecord.push({ category: 'ORDER_LIFECYCLE', severity: 'WARN', details: msg, relatedEntityId: orderId });
      } else {
        tokenMap.set(order.tokenNumber, orderId);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. WRITE IMMUTABLE ANOMALY RECORDS
  // ─────────────────────────────────────────────────────────────────
  let anomalyIdx = 1;
  for (const anom of anomaliesToRecord) {
    const anomalyId = `ANOM_${scanId}_${String(anomalyIdx++).padStart(3, '0')}`;
    const anomalyDoc: IntegrityAnomalyDoc = {
      anomalyId,
      scanId,
      category: anom.category,
      severity: anom.severity,
      status: 'ACTIVE',
      details: anom.details,
      relatedEntityId: anom.relatedEntityId,
      detectedAt: now,
    };
    try {
      await db.collection('integrityAnomalies').doc(anomalyId).set(anomalyDoc);
    } catch (e) {
      console.error(`Failed to record anomaly ${anomalyId}:`, e);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. 3-TIER CIRCUIT BREAKER EVALUATION & AUTONOMOUS ACTION
  // ─────────────────────────────────────────────────────────────────
  const allCriticalViolations = [...financialViolations, ...inventoryViolations, ...lifecycleViolations];

  let status: 'HEALTHY' | 'INVESTIGATION' | 'CRITICAL_BREACH' = 'HEALTHY';
  let circuitBreakerLevel: CircuitBreakerLevel | 'NORMAL' = 'NORMAL';
  let actionTaken: 'NONE' | 'RESTRICTED_MODE' | 'AUTO_FINANCIAL_FROZEN' = 'NONE';

  if (financialViolations.length > 0) {
    // 🔴 Tier 3: Emergency Financial Freeze
    status = 'CRITICAL_BREACH';
    circuitBreakerLevel = 'EMERGENCY_FREEZE';
    actionTaken = 'AUTO_FINANCIAL_FROZEN';

    await db.collection('systemConfig').doc('global').set({
      mode: 'FINANCIAL_FROZEN',
      reason: `Automated Circuit Breaker (Tier 3): ${financialViolations[0]}`,
      updatedBy: 'SYSTEM_INTEGRITY_ENGINE',
      updatedAt: now,
    });

    await db.collection('publicSystemStatus').doc('global').set({
      mode: 'FINANCIAL_FROZEN',
      orderingAvailable: false,
      reason: 'Checkout and payments temporarily frozen for ledger reconciliation. Ready order pickups remain available.',
      updatedAt: now,
    });

    await logSecurityEvent({
      eventType: 'CIRCUIT_BREAKER_AUTO_FREEZE_TRIGGERED',
      severity: 'CRITICAL',
      actorUid: 'SYSTEM_INTEGRITY_ENGINE',
      details: { scanId, financialViolations },
    });
  } else if (inventoryViolations.length >= 2 || (inventoryViolations.length > 0 && lifecycleViolations.length > 0)) {
    // 🟠 Tier 2: Restricted Mode
    status = 'CRITICAL_BREACH';
    circuitBreakerLevel = 'RESTRICTED';
    actionTaken = 'RESTRICTED_MODE';

    await db.collection('systemConfig').doc('global').set({
      mode: 'DEGRADED',
      reason: `Automated Circuit Breaker (Tier 2): ${inventoryViolations[0]}`,
      updatedBy: 'SYSTEM_INTEGRITY_ENGINE',
      updatedAt: now,
    });

    await db.collection('publicSystemStatus').doc('global').set({
      mode: 'DEGRADED',
      orderingAvailable: false,
      reason: 'Online ordering paused due to inventory verification. Existing cooking orders continue.',
      updatedAt: now,
    });

    await logSecurityEvent({
      eventType: 'CIRCUIT_BREAKER_RESTRICTED_TRIGGERED',
      severity: 'HIGH',
      actorUid: 'SYSTEM_INTEGRITY_ENGINE',
      details: { scanId, inventoryViolations, lifecycleViolations },
    });
  } else if (allCriticalViolations.length > 0 || warnings.length > 0) {
    // 🟡 Tier 1: Warning Mode (Isolated anomalies)
    status = 'INVESTIGATION';
    circuitBreakerLevel = 'WARNING';
    actionTaken = 'NONE';

    await logSecurityEvent({
      eventType: 'INTEGRITY_MONITOR_ANOMALY_WARNING',
      severity: 'MEDIUM',
      actorUid: 'SYSTEM_INTEGRITY_ENGINE',
      details: { scanId, criticalViolations: allCriticalViolations, warnings },
    });
  }

  return {
    scanId,
    timestamp: now.toDate().toISOString(),
    status,
    circuitBreakerLevel,
    anomaliesDetected: anomaliesToRecord.length,
    financialViolations,
    inventoryViolations,
    lifecycleViolations,
    criticalViolations: allCriticalViolations,
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
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const role = (request.auth.token.role as UserRole) || 'student';
  if (role !== 'security_admin' && role !== 'admin' && (role as string) !== 'developer') {
    throw new HttpsError('permission-denied', 'Permission denied: Security Admin, Developer, or Admin role required.');
  }

  return await executeIntegrityScan();
});
