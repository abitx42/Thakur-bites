import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import {
  PaymentSessionRequest,
  PaymentSessionResponse,
  PaymentVerificationRequest,
  PaymentRecord,
  DailyReconciliationRecord,
  FinancialTransactionRecord,
} from './types';
import { enforceRateLimit } from './rate_limiter';
import { getRequiredSecret } from './secrets';

const db = admin.firestore();

/**
 * ═══════════════════════════════════════════════════════════════════
 * PAYMENT GATEWAY ADAPTER ARCHITECTURE
 * ═══════════════════════════════════════════════════════════════════
 */
export interface PaymentGatewayAdapter {
  verifyPaymentSignature(gatewayOrderId: string, gatewayPaymentId: string, signature: string): boolean;
  verifyWebhookSignature(payloadRaw: string, signature: string): boolean;
}

/**
 * Standard Production Gateway Adapter for Razorpay / Institutional UPI.
 */
export class RazorpayPaymentAdapter implements PaymentGatewayAdapter {
  private secret: string;
  private webhookSecret: string;

  constructor() {
    this.secret = getRequiredSecret('PAYMENT_GATEWAY_SECRET');
    this.webhookSecret = getRequiredSecret('RAZORPAY_WEBHOOK_SECRET');
  }

  verifyPaymentSignature(gatewayOrderId: string, gatewayPaymentId: string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', this.secret)
      .update(`${gatewayOrderId}|${gatewayPaymentId}`)
      .digest('hex');

    const cleanSig = typeof signature === 'string' ? signature.trim() : '';
    try {
      const expBuf = Buffer.from(expected, 'utf8');
      const actBuf = Buffer.from(cleanSig, 'utf8');
      if (expBuf.length === actBuf.length) {
        return crypto.timingSafeEqual(expBuf, actBuf);
      }
    } catch (_) {
      return false;
    }
    return false;
  }

  verifyWebhookSignature(payloadRaw: string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payloadRaw)
      .digest('hex');

    const cleanSig = typeof signature === 'string' ? signature.trim() : '';
    try {
      const expBuf = Buffer.from(expected, 'utf8');
      const actBuf = Buffer.from(cleanSig, 'utf8');
      if (expBuf.length === actBuf.length) {
        return crypto.timingSafeEqual(expBuf, actBuf);
      }
    } catch (_) {
      return false;
    }
    return false;
  }
}

export function computeGatewaySignature(gatewayOrderId: string, gatewayPaymentId: string): string {
  const secret = getRequiredSecret('PAYMENT_GATEWAY_SECRET');
  return crypto
    .createHmac('sha256', secret)
    .update(`${gatewayOrderId}|${gatewayPaymentId}`)
    .digest('hex');
}

/**
 * 1. Creates an authoritative, idempotent payment session for checkout.
 */
export const createPaymentSession = onCall<PaymentSessionRequest>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Student must be authenticated to initiate payment.');
  }

  const studentId = request.auth.uid;
  await enforceRateLimit(studentId, 'payment_session');

  const { orderId } = request.data;
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId is required.');
  }

  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) {
    throw new HttpsError('not-found', 'Order not found.');
  }

  const orderData = orderDoc.data()!;
  if (orderData.studentId !== studentId) {
    throw new HttpsError('permission-denied', 'Cannot pay for another student’s order.');
  }

  if (orderData.paymentStatus === 'paid') {
    throw new HttpsError('already-exists', 'Order is already paid.');
  }

  // Idempotency: If an active gatewayOrderId exists on the order, reuse it
  let gatewayOrderId = orderData.gatewayOrderId;
  if (!gatewayOrderId || typeof gatewayOrderId !== 'string') {
    gatewayOrderId = `order_${crypto.randomBytes(8).toString('hex')}`;
    await db.collection('orders').doc(orderId).update({
      paymentStatus: 'pending',
      status: 'payment_pending',
      gatewayOrderId,
      paymentSessionCreatedAt: admin.firestore.Timestamp.now(),
    });
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const response: PaymentSessionResponse = {
    orderId,
    gatewayOrderId,
    amount: orderData.totalAmount,
    currency: orderData.currency || 'INR',
    keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_tcet_canteen',
    adapterMode: isProduction ? 'PRODUCTION_GATEWAY' : 'SIMULATION_ADAPTER',
    notes: {
      studentId,
      tokenNumber: orderData.tokenNumber,
      college: 'TCET Mumbai',
    },
  };

  return response;
});

/**
 * 2. Cryptographically verifies payment signature, captures transaction,
 * and transitions order state from payment_pending -> confirmed.
 */
export const verifyPayment = onCall<PaymentVerificationRequest>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Student must be authenticated.');
  }

  const { orderId, gatewayOrderId, gatewayPaymentId, gatewaySignature } = request.data;
  if (!orderId || !gatewayOrderId || !gatewayPaymentId || !gatewaySignature) {
    throw new HttpsError('invalid-argument', 'All payment verification arguments are required.');
  }

  const adapter = new RazorpayPaymentAdapter();
  const isValid = adapter.verifyPaymentSignature(gatewayOrderId, gatewayPaymentId, gatewaySignature);

  const now = admin.firestore.Timestamp.now();
  const orderRef = db.collection('orders').doc(orderId);

  if (!isValid) {
    await db.collection('securityEvents').doc().set({
      eventType: 'PAYMENT_SIGNATURE_MISMATCH',
      orderId,
      gatewayOrderId,
      gatewayPaymentId,
      actorUid: request.auth.uid,
      severity: 'critical',
      timestamp: now,
    });

    throw new HttpsError('permission-denied', 'Payment verification failed: Invalid cryptographic signature.');
  }

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(orderRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Order not found.');
    }

    const orderData = snap.data()!;
    if (orderData.paymentStatus === 'paid') {
      return { success: true, alreadyCaptured: true, orderId };
    }

    // 1. Immutable payments collection record
    const paymentId = `pay_${crypto.randomBytes(8).toString('hex')}`;
    const paymentRef = db.collection('payments').doc(paymentId);
    const paymentRecord: PaymentRecord = {
      paymentId,
      orderId,
      studentId: request.auth!.uid,
      gateway: 'razorpay',
      gatewayOrderId,
      gatewayPaymentId,
      amount: orderData.totalAmount,
      currency: orderData.currency || 'INR',
      status: 'captured',
      verifiedAt: now,
      auditSignature: gatewaySignature,
    };
    transaction.set(paymentRef, paymentRecord);

    // 2. Double-Entry Financial Ledger entry
    const finTxRef = db.collection('financialTransactions').doc();
    const finRecord: FinancialTransactionRecord = {
      transactionId: finTxRef.id,
      orderId,
      type: 'PAYMENT_CAPTURE',
      amount: orderData.totalAmount,
      currency: 'INR',
      gatewayTransactionId: gatewayPaymentId,
      gatewayOrderId,
      actorId: request.auth!.uid,
      timestamp: now,
      status: 'settled',
    };
    transaction.set(finTxRef, finRecord);

    // 3. Update Order State Machine: payment_pending -> confirmed
    transaction.update(orderRef, {
      paymentStatus: 'paid',
      status: 'confirmed',
      gatewayPaymentId,
      paidAt: now,
      updatedAt: now,
    });

    // 4. Immutable orderEvent
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: 'payment_pending',
      toStatus: 'confirmed',
      actorId: request.auth!.uid,
      actorRole: 'student',
      timestamp: now,
      metadata: { gatewayPaymentId, amount: orderData.totalAmount },
    });

    return {
      success: true,
      alreadyCaptured: false,
      orderId,
      tokenNumber: orderData.tokenNumber,
      amount: orderData.totalAmount,
      status: 'confirmed',
    };
  });
});

/**
 * 3. Server-to-Server Razorpay Webhook Handler with Idempotency & Amount Cross-Verification
 */
export const handlePaymentWebhook = onRequest({ cors: false }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const webhookSignature = req.headers['x-razorpay-signature'] as string;
  if (!webhookSignature) {
    res.status(400).send('Missing webhook signature header.');
    return;
  }

  const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const adapter = new RazorpayPaymentAdapter();
  const isSignatureValid = adapter.verifyWebhookSignature(bodyStr, webhookSignature);

  if (!isSignatureValid) {
    await db.collection('securityEvents').doc().set({
      eventType: 'INVALID_WEBHOOK_SIGNATURE',
      severity: 'critical',
      timestamp: admin.firestore.Timestamp.now(),
    });
    res.status(400).send('Invalid webhook signature.');
    return;
  }

  const eventPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const eventId = eventPayload.id || `evt_${crypto.randomBytes(8).toString('hex')}`;
  const eventType = eventPayload.event;

  // Webhook Idempotency: processedGatewayEvents collection
  const eventProcessedRef = db.collection('processedGatewayEvents').doc(eventId);
  const now = admin.firestore.Timestamp.now();

  try {
    const isAlreadyProcessed = await db.runTransaction(async (transaction) => {
      const eventSnap = await transaction.get(eventProcessedRef);
      if (eventSnap.exists) {
        return true;
      }

      transaction.set(eventProcessedRef, {
        eventId,
        eventType,
        receivedAt: now,
      });
      return false;
    });

    if (isAlreadyProcessed) {
      res.status(200).json({ received: true, alreadyProcessed: true });
      return;
    }

    if (eventType === 'payment.captured') {
      const paymentEntity = eventPayload.payload?.payment?.entity;
      if (!paymentEntity) {
        res.status(400).send('Invalid payment payload.');
        return;
      }

      const orderId = paymentEntity.notes?.orderId;
      const gatewayPaymentAmountPaise = Number(paymentEntity.amount || 0);
      const gatewayCurrency = paymentEntity.currency || 'INR';
      const gatewayOrderId = paymentEntity.order_id;
      const gatewayPaymentId = paymentEntity.id;

      if (!orderId) {
        res.status(400).send('Missing orderId in payment notes.');
        return;
      }

      const orderRef = db.collection('orders').doc(orderId);

      await db.runTransaction(async (transaction) => {
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists) {
          throw new Error(`Order ${orderId} not found.`);
        }

        const orderData = orderSnap.data()!;
        const expectedPaise = Math.round(Number(orderData.totalAmount || 0) * 100);

        // Strict Amount & Currency Cross-Verification
        if (gatewayPaymentAmountPaise !== expectedPaise || gatewayCurrency !== (orderData.currency || 'INR')) {
          const secRef = db.collection('securityEvents').doc();
          transaction.set(secRef, {
            eventType: 'PAYMENT_AMOUNT_TAMPERING_FLAGGED',
            orderId,
            expectedPaise,
            receivedPaise: gatewayPaymentAmountPaise,
            expectedCurrency: orderData.currency || 'INR',
            receivedCurrency: gatewayCurrency,
            severity: 'critical',
            timestamp: now,
          });
          throw new Error('Payment amount mismatch between gateway and database snapshot.');
        }

        if (orderData.paymentStatus !== 'paid') {
          // 1. Create payment record
          const paymentId = `pay_${gatewayPaymentId}`;
          const paymentRef = db.collection('payments').doc(paymentId);
          transaction.set(paymentRef, {
            paymentId,
            orderId,
            studentId: orderData.studentId,
            gateway: 'razorpay_webhook',
            gatewayOrderId,
            gatewayPaymentId,
            amount: orderData.totalAmount,
            currency: gatewayCurrency,
            status: 'captured',
            verifiedAt: now,
            auditSignature: webhookSignature,
          });

          // 2. Double-entry financial transaction
          const finTxRef = db.collection('financialTransactions').doc();
          transaction.set(finTxRef, {
            transactionId: finTxRef.id,
            orderId,
            type: 'PAYMENT_CAPTURE',
            amount: orderData.totalAmount,
            currency: gatewayCurrency,
            gatewayTransactionId: gatewayPaymentId,
            gatewayOrderId,
            actorId: 'system_webhook',
            timestamp: now,
            status: 'settled',
          });

          // 3. Update order state: payment_pending -> confirmed
          transaction.update(orderRef, {
            paymentStatus: 'paid',
            status: 'confirmed',
            gatewayPaymentId,
            paidAt: now,
            updatedAt: now,
          });

          // 4. Immutable orderEvent
          const eventRef = db.collection('orderEvents').doc();
          transaction.set(eventRef, {
            orderId,
            fromStatus: 'payment_pending',
            toStatus: 'confirmed',
            actorId: 'system_webhook',
            actorRole: 'system',
            timestamp: now,
            reason: 'WEBHOOK_PAYMENT_CAPTURED',
          });
        }
      });
    }

    res.status(200).json({ received: true, processed: true });
  } catch (err: any) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4. Authoritative Daily Financial Reconciliation Engine
 */
export async function reconcileDailyLedger(dateStr: string): Promise<DailyReconciliationRecord> {
  const startOfDay = new Date(`${dateStr}T00:00:00Z`);
  const endOfDay = new Date(`${dateStr}T23:59:59Z`);

  const startTimestamp = admin.firestore.Timestamp.fromDate(startOfDay);
  const endTimestamp = admin.firestore.Timestamp.fromDate(endOfDay);

  const ordersSnap = await db.collection('orders')
    .where('createdAt', '>=', startTimestamp)
    .where('createdAt', '<=', endTimestamp)
    .get();

  const paymentsSnap = await db.collection('payments')
    .where('verifiedAt', '>=', startTimestamp)
    .where('verifiedAt', '<=', endTimestamp)
    .get();

  let totalOrdersCount = ordersSnap.size;
  let totalRevenueCalculated = 0;
  let onlinePaymentsCaptured = 0;
  let counterCashEstimated = 0;
  const auditNotes: string[] = [];
  let discrepanciesCount = 0;

  const capturedPaymentOrderIds = new Set<string>();
  paymentsSnap.forEach(doc => {
    const p = doc.data() as PaymentRecord;
    onlinePaymentsCaptured += Number(p.amount || 0);
    capturedPaymentOrderIds.add(p.orderId);
  });

  ordersSnap.forEach(doc => {
    const order = doc.data();
    const amount = Number(order.totalAmount || 0);
    totalRevenueCalculated += amount;

    if (order.paymentStatus === 'paid') {
      if (!capturedPaymentOrderIds.has(doc.id) && order.status !== 'cancelled') {
        discrepanciesCount++;
        auditNotes.push(`Order ${doc.id} marked paid but missing verified payment ledger record.`);
      }
    } else {
      counterCashEstimated += amount;
      if (order.status === 'collected') {
        discrepanciesCount++;
        auditNotes.push(`Order ${doc.id} marked collected but paymentStatus is unpaid/pending.`);
      }
    }
  });

  const reconciliation: DailyReconciliationRecord = {
    date: dateStr,
    totalOrdersCount,
    totalRevenueCalculated,
    onlinePaymentsCaptured,
    counterCashEstimated,
    discrepanciesCount,
    reconciledAt: admin.firestore.Timestamp.now(),
    status: discrepanciesCount === 0 ? 'BALANCED' : 'DISCREPANCY_FLAGGED',
    auditNotes,
  };

  await db.collection('dailyReconciliations').doc(dateStr).set(reconciliation);

  return reconciliation;
}
