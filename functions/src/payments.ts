import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import {
  PaymentSessionRequest,
  PaymentSessionResponse,
  PaymentVerificationRequest,
  PaymentRecord,
  DailyReconciliationRecord,
  UserRole,
} from './types';
import { enforceRateLimit } from './rate_limiter';
import { getRequiredSecret } from './secrets';
import { finalizeSuccessfulPayment } from './payment_finalize';

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

  const totalPaise = orderData.totalAmountPaise || Math.round(Number(orderData.totalAmount || 0) * 100);
  const isProduction = process.env.NODE_ENV === 'production';

  const response: PaymentSessionResponse = {
    orderId,
    gatewayOrderId,
    amount: totalPaise / 100,
    amountPaise: totalPaise,
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
 * 2. Cryptographically verifies payment signature and delegates to single authoritative payment finalizer.
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

  if (!isValid) {
    await db.collection('securityEvents').doc().set({
      eventType: 'PAYMENT_SIGNATURE_MISMATCH',
      orderId,
      gatewayOrderId,
      gatewayPaymentId,
      actorUid: request.auth.uid,
      severity: 'critical',
      timestamp: admin.firestore.Timestamp.now(),
    });

    throw new HttpsError('permission-denied', 'Payment verification failed: Invalid cryptographic signature.');
  }

  // Fetch order to get authoritative amountPaise and currency
  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) {
    throw new HttpsError('not-found', 'Order not found.');
  }
  const orderData = orderDoc.data()!;
  const amountPaise = orderData.totalAmountPaise || Math.round(Number(orderData.totalAmount || 0) * 100);

  // Single authoritative payment finalization (P0: 1)
  try {
    const result = await finalizeSuccessfulPayment({
      orderId,
      gatewayOrderId,
      gatewayPaymentId,
      amountPaise,
      currency: orderData.currency || 'INR',
      source: 'client_verification',
      actorId: request.auth.uid,
      signatureOrRef: gatewaySignature,
    });

    return result;
  } catch (error: any) {
    throw new HttpsError('internal', error.message);
  }
});

/**
 * 3. Server-to-Server Razorpay Webhook Handler with Retry-Safe Idempotency & Gateway Order Cross-Validation
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

  const eventDocRef = db.collection('processedGatewayEvents').doc(eventId);
  const now = admin.firestore.Timestamp.now();

  try {
    // Check if already processed
    const eventSnap = await eventDocRef.get();
    if (eventSnap.exists && eventSnap.data()?.status === 'PROCESSED') {
      res.status(200).json({ received: true, alreadyProcessed: true });
      return;
    }

    // Mark event as PROCESSING (P0: 2: Never permanently consume event before business effect succeeds)
    await eventDocRef.set({
      eventId,
      eventType,
      status: 'PROCESSING',
      attemptCount: admin.firestore.FieldValue.increment(1),
      lastAttemptAt: now,
    }, { merge: true });

    if (eventType === 'payment.captured') {
      const paymentEntity = eventPayload.payload?.payment?.entity;
      if (!paymentEntity) {
        throw new Error('Invalid payment payload in captured event.');
      }

      const orderId = paymentEntity.notes?.orderId;
      const gatewayPaymentAmountPaise = Number(paymentEntity.amount || 0);
      const gatewayCurrency = paymentEntity.currency || 'INR';
      const gatewayOrderId = paymentEntity.order_id;
      const gatewayPaymentId = paymentEntity.id;

      if (!orderId) {
        throw new Error('Missing orderId in payment notes.');
      }

      // Delegate to single authoritative payment finalizer
      await finalizeSuccessfulPayment({
        orderId,
        gatewayOrderId,
        gatewayPaymentId,
        amountPaise: gatewayPaymentAmountPaise,
        currency: gatewayCurrency,
        source: 'webhook',
        actorId: 'system_webhook',
        signatureOrRef: webhookSignature,
      });
    }

    // Mark event as successfully PROCESSED
    await eventDocRef.update({
      status: 'PROCESSED',
      processedAt: admin.firestore.Timestamp.now(),
    });

    res.status(200).json({ received: true, processed: true });
  } catch (err: any) {
    console.error('Webhook processing error:', err);
    // Mark as FAILED / RETRYABLE so gateway retries can be processed
    await eventDocRef.set({
      status: 'FAILED',
      errorMessage: err.message,
      failedAt: admin.firestore.Timestamp.now(),
    }, { merge: true }).catch(() => {});

    res.status(500).json({ error: err.message });
  }
});

/**
 * 4. Record Counter Cash Payment (P0: 9)
 * Restricted to cashier, manager, and admin roles.
 */
export const recordCashPayment = onCall<{ orderId: string }>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  if (actorRole !== 'manager' && actorRole !== 'admin' && actorRole !== 'security_admin' && actorRole !== 'pickup') {
    throw new HttpsError('permission-denied', 'Only authorized cashiers and managers can record cash payments.');
  }

  const { orderId } = request.data;
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId is required.');
  }

  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) {
    throw new HttpsError('not-found', 'Order not found.');
  }

  const orderData = orderDoc.data()!;
  const amountPaise = orderData.totalAmountPaise || Math.round(Number(orderData.totalAmount || 0) * 100);
  const gatewayOrderId = orderData.gatewayOrderId || `cash_ord_${orderId}`;
  const gatewayPaymentId = `cash_pay_${crypto.randomBytes(6).toString('hex')}`;

  return await finalizeSuccessfulPayment({
    orderId,
    gatewayOrderId,
    gatewayPaymentId,
    amountPaise,
    currency: orderData.currency || 'INR',
    source: 'cashier_counter',
    actorId: request.auth.uid,
    signatureOrRef: `CASH_VERIFIED_BY_${request.auth.uid}`,
  });
});

/**
 * 5. Authoritative Daily Financial Reconciliation Engine
 */
export async function reconcileDailyLedger(dateStr: string): Promise<DailyReconciliationRecord> {
  const startOfDay = new Date(`${dateStr}T00:00:00+05:30`);
  const endOfDay = new Date(`${dateStr}T23:59:59+05:30`);

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

  const totalRevenuePaise = Math.round(totalRevenueCalculated * 100);

  const reconciliation: DailyReconciliationRecord = {
    date: dateStr,
    totalOrdersCount,
    totalRevenueCalculated,
    totalRevenuePaise,
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
