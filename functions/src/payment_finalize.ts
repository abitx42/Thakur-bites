import * as admin from 'firebase-admin';
import { PaymentRecord, FinancialTransactionRecord } from './types';
import { commitInventoryInTransaction } from './inventory_reservation';
import { logSecurityEvent } from './security_logger';

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
  status: 'confirmed';
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

  const now = admin.firestore.Timestamp.now();
  const orderRef = db.collection('orders').doc(orderId);

  return await db.runTransaction(async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) {
      throw new Error(`Order ${orderId} not found.`);
    }

    const orderData = orderSnap.data()!;

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

    if (source !== 'cashier_counter' && orderData.paymentMethod === 'counter_cash') {
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
    if (orderData.gatewayOrderId && orderData.gatewayOrderId !== gatewayOrderId) {
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
      ? Number(orderData.totalAmountPaise)
      : Math.round(Number(orderData.totalAmount || 0) * 100);

    const expectedCurrency = orderData.currency || 'INR';

    if (amountPaise !== expectedPaise || currency !== expectedCurrency) {
      logSecurityEvent({
        eventType: 'PAYMENT_AMOUNT_TAMPERING_FLAGGED',
        orderId,
        actorUid: actorId,
        severity: 'CRITICAL',
        details: { expectedPaise, receivedPaise: amountPaise, expectedCurrency, receivedCurrency: currency, source },
      }).catch(() => {});
      throw new Error(`Payment amount or currency mismatch. Expected ${expectedPaise} ${expectedCurrency}, received ${amountPaise} ${currency}.`);
    }

    // 4. Idempotency check: Evaluated AFTER all immutable validations pass (Phase 1 Fix)
    if (orderData.paymentStatus === 'paid' || orderData.paymentStatus === 'captured') {
      return {
        success: true,
        alreadyCaptured: true,
        orderId,
        tokenNumber: orderData.tokenNumber || '',
        amountPaise: expectedPaise,
        status: 'confirmed' as const,
      };
    }

    // 5. Create immutable payments collection record
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

    // 6. Create immutable double-entry financial transaction record (Phase 5 Invariant)
    const isCash = source === 'cashier_counter';
    const finTxRef = db.collection('financialTransactions').doc();
    const finRecord: FinancialTransactionRecord = {
      transactionId: finTxRef.id,
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

    // 7. Commit inventory reservation (Phase 2 Two-Phase Inventory Lifecycle)
    await commitInventoryInTransaction(transaction, db, orderId, actorId);

    // 8. Update order state machine: payment_pending -> confirmed
    transaction.update(orderRef, {
      paymentStatus: 'paid',
      status: 'confirmed',
      gatewayPaymentId,
      paidAt: now,
      updatedAt: now,
    });

    // 8. Create immutable orderEvent
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: orderData.status || 'payment_pending',
      toStatus: 'confirmed',
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
      status: 'confirmed' as const,
    };
  });
}
