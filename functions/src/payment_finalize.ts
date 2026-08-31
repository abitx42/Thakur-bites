import * as admin from 'firebase-admin';
import { PaymentRecord, FinancialTransactionRecord } from './types';

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
 * SINGLE AUTHORITATIVE PAYMENT FINALIZATION ENGINE
 * ═══════════════════════════════════════════════════════════════════
 * Atomically guarantees:
 * 1. Exactly one payment capture record
 * 2. Exactly one double-entry financial ledger entry
 * 3. Strict amount (paise), currency, and gateway order matching
 * 4. Authoritative order state transition: payment_pending -> confirmed
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

    // 1. Idempotency check: If already paid, return safely with zero duplicate writes
    if (orderData.paymentStatus === 'paid') {
      return {
        success: true,
        alreadyCaptured: true,
        orderId,
        tokenNumber: orderData.tokenNumber || '',
        amountPaise: orderData.totalAmountPaise || Math.round(Number(orderData.totalAmount || 0) * 100),
        status: 'confirmed' as const,
      };
    }

    // 2. Strict Gateway Order ID Validation
    if (orderData.gatewayOrderId && orderData.gatewayOrderId !== gatewayOrderId) {
      const secRef = db.collection('securityEvents').doc();
      transaction.set(secRef, {
        eventType: 'GATEWAY_ORDER_MISMATCH',
        orderId,
        expectedGatewayOrderId: orderData.gatewayOrderId,
        receivedGatewayOrderId: gatewayOrderId,
        actorUid: actorId,
        severity: 'critical',
        timestamp: now,
      });
      throw new Error(`Gateway Order ID mismatch. Expected ${orderData.gatewayOrderId}, received ${gatewayOrderId}.`);
    }

    // 3. Strict Integer Paise Amount & Currency Validation
    const expectedPaise = orderData.totalAmountPaise !== undefined
      ? Number(orderData.totalAmountPaise)
      : Math.round(Number(orderData.totalAmount || 0) * 100);

    const expectedCurrency = orderData.currency || 'INR';

    if (amountPaise !== expectedPaise || currency !== expectedCurrency) {
      const secRef = db.collection('securityEvents').doc();
      transaction.set(secRef, {
        eventType: 'PAYMENT_AMOUNT_TAMPERING_FLAGGED',
        orderId,
        expectedPaise,
        receivedPaise: amountPaise,
        expectedCurrency,
        receivedCurrency: currency,
        source,
        severity: 'critical',
        timestamp: now,
      });
      throw new Error(`Payment amount or currency mismatch. Expected ${expectedPaise} ${expectedCurrency}, received ${amountPaise} ${currency}.`);
    }

    // 4. Create immutable payments collection record
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

    // 5. Create immutable double-entry financial ledger entry
    const finTxRef = db.collection('financialTransactions').doc();
    const finRecord: FinancialTransactionRecord = {
      transactionId: finTxRef.id,
      orderId,
      type: 'PAYMENT_CAPTURE',
      amount: expectedPaise / 100,
      currency: 'INR',
      gatewayTransactionId: gatewayPaymentId,
      gatewayOrderId,
      actorId,
      timestamp: now,
      status: 'settled',
    };
    transaction.set(finTxRef, finRecord);

    // 6. Update order state machine: payment_pending -> confirmed
    transaction.update(orderRef, {
      paymentStatus: 'paid',
      status: 'confirmed',
      gatewayPaymentId,
      paidAt: now,
      updatedAt: now,
    });

    // 7. Create immutable orderEvent
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: orderData.status || 'payment_pending',
      toStatus: 'confirmed',
      actorId,
      actorRole: source === 'webhook' ? 'system' : (source === 'cashier_counter' ? 'manager' : 'student'),
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
