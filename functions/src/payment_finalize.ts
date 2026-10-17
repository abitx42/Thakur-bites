import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { PaymentRecord, FinancialTransactionRecord } from './types';
import { commitInventoryInTransaction } from './inventory_reservation';
import { logSecurityEvent } from './security_logger';
import { updatePublicLiveQueueProjection } from './tv_projection';

const db = admin.firestore();

export interface FinalizePaymentParams {
  orderId: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  amountPaise: number;
  currency: string;
  source: 'client_verification' | 'webhook' | 'cashier_counter';
  actorId: string;
  signatureOrRef?: string;
}

export interface FinalizePaymentResult {
  success: boolean;
  alreadyCaptured: boolean;
  orderId: string;
  tokenNumber: string;
  amountPaise: number;
  status: 'confirmed' | 'ready' | 'cancelled';
  orphaned?: boolean;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * SINGLE AUTHORITATIVE PAYMENT FINALIZATION ENGINE (Phase 1 Hardened)
 * ═══════════════════════════════════════════════════════════════════
 * Invariant Guarantee:
 * 1. Validate payment method: Counter-cash cannot settle online orders & vice-versa.
 * 2. Validate gatewayOrderId, integer amount (paise), and currency.
 * 3. ONLY THEN return idempotent success if already paid.
 * 4. Atomically post exactly one payment and one financial ledger transaction.
 */
export async function finalizeSuccessfulPayment(params: FinalizePaymentParams): Promise<FinalizePaymentResult> {
  const {
    orderId,
    gatewayOrderId,
    gatewayPaymentId,
    amountPaise,
    currency,
    source,
    actorId,
    signatureOrRef = '',
  } = params;

  const boundedId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !!value.trim() && value !== '.' && value !== '..' && !/[/\u0000-\u001f\u007f]/.test(value);
  if (!boundedId(orderId) || !boundedId(gatewayOrderId) || !boundedId(gatewayPaymentId) || !boundedId(actorId) ||
      !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || currency !== 'INR' ||
      !['client_verification', 'webhook', 'cashier_counter'].includes(source)) {
    throw new HttpsError('invalid-argument', 'Valid payment identifiers, positive integer paise, currency and source are required.');
  }

  const now = Timestamp.now();
  const orderRef = db.collection('orders').doc(orderId);
  const isCash = source === 'cashier_counter';
  const finTxId = isCash ? `cash_fin_${orderId}` : `pay_fin_${gatewayPaymentId}`;
  const finTxRef = db.collection('financialTransactions').doc(finTxId);

  const result = await db.runTransaction(async (transaction) => {
    // ═════════════════════════════════════════════════════════════
    // PHASE 1: ALL READS FIRST (Strict Firestore Transaction Invariant)
    // ═════════════════════════════════════════════════════════════
    const [orderSnap, finTxSnap] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(finTxRef),
    ]);

    if (!orderSnap.exists) {
      throw new Error(`Order ${orderId} not found.`);
    }

    const orderData = orderSnap.data()!;

    if (source === 'client_verification' && orderData.studentId !== actorId) {
      throw new HttpsError('permission-denied', 'Cannot finalize another customer’s payment.');
    }

    // 1. Strict Payment Method Cross-Validation (Phase 1 Fix: Cash cannot settle online orders)
    if (source === 'cashier_counter' && orderData.paymentMethod !== 'counter_cash') {
      logSecurityEvent({
        eventType: 'CASH_SETTLEMENT_ATTEMPTED_ON_ONLINE_ORDER',
        orderId,
        actorUid: actorId,
        severity: 'CRITICAL',
        details: { source },
      }).catch(() => {});
      throw new Error(`Invalid payment flow: Order ${orderId} was placed as an online payment order and cannot be settled as counter-cash.`);
    }

    if (source !== 'cashier_counter' && orderData.paymentMethod !== 'online') {
      logSecurityEvent({
        eventType: 'GATEWAY_PAYMENT_ATTEMPTED_ON_CASH_ORDER',
        orderId,
        actorUid: actorId,
        severity: 'CRITICAL',
        details: { source },
      }).catch(() => {});
      throw new Error(`Invalid payment flow: Order ${orderId} is a counter-cash order and cannot be verified via digital gateway.`);
    }

    // 2. Strict Gateway Order ID Validation
    if ((!isCash && (!boundedId(orderData.gatewayOrderId) || orderData.gatewayOrderId !== gatewayOrderId)) ||
        (isCash && orderData.gatewayOrderId !== undefined && orderData.gatewayOrderId !== gatewayOrderId)) {
      logSecurityEvent({
        eventType: 'GATEWAY_ORDER_MISMATCH',
        orderId,
        actorUid: actorId,
        severity: 'CRITICAL',
        details: { expectedGatewayOrderId: orderData.gatewayOrderId, receivedGatewayOrderId: gatewayOrderId },
      }).catch(() => {});
      throw new Error(`Gateway Order ID mismatch. Expected ${orderData.gatewayOrderId}, received ${gatewayOrderId}.`);
    }

    // 3. Strict Integer Paise Amount & Currency Validation
    const expectedPaise = orderData.totalAmountPaise !== undefined
      ? orderData.totalAmountPaise
      : (typeof orderData.totalAmount === 'number' ? Math.round(orderData.totalAmount * 100) : NaN);

    const expectedCurrency = orderData.currency ?? 'INR';

    if (!Number.isSafeInteger(expectedPaise) || expectedPaise <= 0 || amountPaise !== expectedPaise || currency !== expectedCurrency) {
      logSecurityEvent({
        eventType: 'PAYMENT_AMOUNT_TAMPERING_FLAGGED',
        orderId,
        actorUid: actorId,
        severity: 'CRITICAL',
        details: { expectedPaise, receivedPaise: amountPaise, expectedCurrency, receivedCurrency: currency, source },
      }).catch(() => {});
      throw new Error(`Payment amount or currency mismatch. Expected ${expectedPaise} ${expectedCurrency}, received ${amountPaise} ${currency}.`);
    }

    if (orderData.gatewayPaymentId && orderData.gatewayPaymentId !== gatewayPaymentId) {
      throw new Error('Gateway payment ID mismatch with the payment already recorded on this order.');
    }
    const assertLedgerBinding = (record: Record<string, any>, type: string): void => {
      if (record.type !== type || record.orderId !== orderId || record.amountPaise !== amountPaise ||
          record.currency !== currency || record.gatewayOrderId !== gatewayOrderId || record.gatewayTransactionId !== gatewayPaymentId) {
        throw new Error('Existing payment ledger binding mismatch; reconciliation required.');
      }
    };
    // Immutable validation must precede every idempotent-success path, including
    // payment IDs that already have a deterministic financial transaction.
    if (finTxSnap.exists) {
      if (orderData.gatewayPaymentId !== gatewayPaymentId) {
        throw new Error('Existing capture is not bound to the recorded order payment; reconciliation required.');
      }
      assertLedgerBinding(finTxSnap.data()!, 'PAYMENT_CAPTURE');
      return {
        success: true,
        alreadyCaptured: true,
        orderId,
        tokenNumber: orderData.tokenNumber || '',
        amountPaise: expectedPaise,
        status: (orderData.status === 'cancelled' || orderData.status === 'expired' ? 'cancelled' :
          orderData.status === 'ready' ? 'ready' : 'confirmed') as 'cancelled' | 'ready' | 'confirmed',
      };
    }

    // 4. Cancelled Order / Orphaned Payment Handling (TB-003 & TB-NEW-002 Remediation)
    // Invariant: Cancelled orders are NEVER resurrected. Late payment is recorded as ORPHANED for automated refund.
    // Invariant TB-NEW-002 & TB-R2-006: Deterministic transaction ID orphan_fin_${gatewayPaymentId} guarantees exactly 1 ledger posting.
    if (orderData.status === 'cancelled' || orderData.paymentStatus === 'cancelled' || orderData.status === 'expired' || orderData.paymentStatus === 'expired') {
      const paymentId = `orphan_${gatewayPaymentId}`;
      const orphanRef = db.collection('orphanedPayments').doc(paymentId);
      const orphanFinRef = db.collection('financialTransactions').doc(`orphan_fin_${gatewayPaymentId}`);

      const [orphanSnap, orphanFinSnap] = await Promise.all([transaction.get(orphanRef), transaction.get(orphanFinRef)]);
      if (orphanSnap.exists || orphanFinSnap.exists) {
        if (!orphanSnap.exists || !orphanFinSnap.exists) throw new Error('Incomplete orphaned payment record; reconciliation required.');
        assertLedgerBinding(orphanFinSnap.data()!, 'ORPHANED_PAYMENT_CAPTURE');
        const orphan = orphanSnap.data()!;
        if (orphan.orderId !== orderId || orphan.gatewayOrderId !== gatewayOrderId || orphan.gatewayPaymentId !== gatewayPaymentId ||
            orphan.amountPaise !== amountPaise || orphan.currency !== currency) {
          throw new Error('Existing orphaned payment binding mismatch.');
        }
      } else {
        const isCash = source === 'cashier_counter';
        const orphanRecord = {
          paymentId,
          orderId,
          studentId: orderData.studentId || 'unknown',
          gateway: isCash ? 'counter_cash' : (source === 'webhook' ? 'razorpay_webhook' : 'razorpay_direct'),
          gatewayOrderId,
          gatewayPaymentId,
          amountPaise: expectedPaise,
          amount: expectedPaise / 100,
          currency: expectedCurrency,
          orderStatusAtCapture: orderData.status,
          capturedAt: now,
          refundStatus: isCash ? 'MANUAL_CASH_REFUND_REQUIRED' : 'REFUND_QUEUED',
        };
        transaction.set(orphanRef, orphanRecord);

        transaction.set(orphanFinRef, {
          transactionId: orphanFinRef.id,
          orderId,
          type: 'ORPHANED_PAYMENT_CAPTURE',
          amount: expectedPaise / 100,
          amountPaise: expectedPaise,
          currency: 'INR',
          postings: [
            {
              account: isCash ? 'CASH_ON_HAND' : 'GATEWAY_RECEIVABLE',
              debitPaise: expectedPaise,
              creditPaise: 0,
            },
            {
              account: 'ORPHAN_SUSPENSE',
              debitPaise: 0,
              creditPaise: expectedPaise,
            },
          ],
          gatewayTransactionId: gatewayPaymentId,
          gatewayOrderId,
          actorId,
          timestamp: now,
          status: 'ORPHANED',
        });

        logSecurityEvent({
          eventType: 'ORPHANED_PAYMENT_ON_CANCELLED_ORDER',
          orderId,
          actorUid: actorId,
          severity: 'HIGH',
          details: { gatewayPaymentId, amountPaise: expectedPaise, reason: 'Payment arrived after order cancellation' },
        }).catch(() => {});
      }

      return {
        success: true,
        alreadyCaptured: orphanSnap.exists,
        orderId,
        tokenNumber: orderData.tokenNumber || '',
        amountPaise: expectedPaise,
        status: 'cancelled' as const,
        orphaned: true,
      };
    }

    if (['paid', 'captured', 'partially_refunded', 'refunded'].includes(orderData.paymentStatus)) {
      throw new Error('Paid order has no matching capture ledger; reconciliation required.');
    }

    // 5. Commit inventory reservation (Phase 2 Two-Phase Inventory Lifecycle)
    // STRICT FIRESTORE INVARIANT: All reads inside commitInventoryInTransaction must precede all writes.
    await commitInventoryInTransaction(transaction, db, orderId, actorId);

    // 6. Create immutable payments collection record
    const paymentId = `pay_${gatewayPaymentId}`;
    const paymentRef = db.collection('payments').doc(paymentId);
    const paymentRecord: PaymentRecord = {
      paymentId,
      orderId,
      studentId: orderData.studentId,
      gateway: source === 'webhook' ? 'razorpay_webhook' : (source === 'cashier_counter' ? 'counter_cash' : 'razorpay_direct'),
      gatewayOrderId,
      gatewayPaymentId,
      amount: expectedPaise / 100,
      currency: expectedCurrency,
      status: 'captured',
      verifiedAt: now,
      auditSignature: signatureOrRef,
    };
    transaction.set(paymentRef, paymentRecord);

    // 7. Create immutable double-entry financial transaction record (Deterministic ID prevents duplicate postings)
    const finRecord: FinancialTransactionRecord = {
      transactionId: finTxId,
      orderId,
      type: 'PAYMENT_CAPTURE',
      amount: expectedPaise / 100,
      amountPaise: expectedPaise,
      currency: 'INR',
      postings: [
        {
          account: isCash ? 'CASH_ON_HAND' : 'GATEWAY_RECEIVABLE',
          debitPaise: expectedPaise,
          creditPaise: 0,
        },
        {
          account: 'SALES_REVENUE',
          debitPaise: 0,
          creditPaise: expectedPaise,
        },
      ],
      gatewayTransactionId: gatewayPaymentId,
      gatewayOrderId,
      actorId,
      timestamp: now,
      status: isCash ? 'SETTLED' : 'CAPTURED',
    };
    transaction.set(finTxRef, finRecord);

    // 8. Update order state machine: payment_pending -> confirmed (or ready for pure ready-made)
    const nextStatus = orderData.isOnlyReadyMade === true ? 'ready' : 'confirmed';
    const updatePayload: Record<string, any> = {
      paymentStatus: 'paid',
      status: nextStatus,
      gatewayPaymentId,
      // These are the authoritative financial values consumed by every refund path.
      amountPaidPaise: expectedPaise,
      amountRefundedPaise: 0,
      amountRefundablePaise: expectedPaise,
      paidAt: now,
      updatedAt: now,
    };
    if (nextStatus === 'ready') {
      updatePayload.readyAt = now;
    }
    transaction.update(orderRef, updatePayload);

    // 8. Create immutable orderEvent
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: orderData.status || 'payment_pending',
      toStatus: nextStatus,
      actorId,
      actorRole: source === 'webhook' ? 'system' : (source === 'cashier_counter' ? 'cashier' : 'student'),
      timestamp: now,
      reason: `PAYMENT_FINALIZED_${source.toUpperCase()}`,
      metadata: { gatewayPaymentId, amountPaise: expectedPaise },
    });

    return {
      success: true,
      alreadyCaptured: false,
      orderId,
      tokenNumber: orderData.tokenNumber,
      amountPaise: expectedPaise,
      status: nextStatus as 'confirmed' | 'ready',
    };
  });

  // Synchronize TV queue projection immediately upon payment finalization (BUG-01)
  if (!result.alreadyCaptured && (result.status === 'confirmed' || result.status === 'ready')) {
    try {
      await updatePublicLiveQueueProjection(db);
    } catch (_) {
      console.warn('[payment_finalize] Payment committed; public queue projection sync failed.', { orderId });
      logSecurityEvent({
        eventType: 'PAYMENT_PROJECTION_SYNC_FAILED', severity: 'MEDIUM', orderId, actorUid: actorId,
        details: { projection: 'publicLiveQueue/current' },
      }).catch(() => {});
    }
  }

  return result;
}
