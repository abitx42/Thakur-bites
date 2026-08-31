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

const db = admin.firestore();

/**
 * Returns gateway secret with strict production safety (no insecure fallback in production).
 */
function getGatewaySecret(): string {
  const secret = process.env.PAYMENT_GATEWAY_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: PAYMENT_GATEWAY_SECRET environment variable is missing in production.');
    }
    return 'tcet_thakur_bites_dev_secret_2026';
  }
  return secret;
}

/**
 * Computes standard HMAC-SHA256 signature for payment verification.
 */
export function computeGatewaySignature(gatewayOrderId: string, gatewayPaymentId: string): string {
  const secret = getGatewaySecret();
  return crypto
    .createHmac('sha256', secret)
    .update(`${gatewayOrderId}|${gatewayPaymentId}`)
    .digest('hex');
}

/**
 * 1. Creates an authoritative payment session for checkout.
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

  const gatewayOrderId = `order_${crypto.randomBytes(8).toString('hex')}`;
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

  // Log payment session creation
  await db.collection('orders').doc(orderId).update({
    paymentStatus: 'pending',
    status: 'payment_pending',
    gatewayOrderId,
  });

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

  const expectedSignature = computeGatewaySignature(gatewayOrderId, gatewayPaymentId);
  const cleanSignature = typeof gatewaySignature === 'string' ? gatewaySignature.trim() : '';

  let isValid = false;
  try {
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const actualBuf = Buffer.from(cleanSignature, 'utf8');
    if (expectedBuf.length === actualBuf.length) {
      isValid = crypto.timingSafeEqual(expectedBuf, actualBuf);
    }
  } catch (_) {
    isValid = false;
  }

  const now = admin.firestore.Timestamp.now();
  const orderRef = db.collection('orders').doc(orderId);

  if (!isValid) {
    // Record security alert
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
      auditSignature: expectedSignature,
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
 * 3. Server-to-Server Razorpay Webhook Handler
 */
export const handlePaymentWebhook = onRequest({ cors: false }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const webhookSignature = req.headers['x-razorpay-signature'] as string;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || getGatewaySecret();

  if (!webhookSignature) {
    res.status(400).send('Missing webhook signature');
    return;
  }

  const bodyStr = JSON.stringify(req.body);
  const expectedSig = crypto.createHmac('sha256', webhookSecret).update(bodyStr).digest('hex');

  if (webhookSignature !== expectedSig) {
    await db.collection('securityEvents').doc().set({
      eventType: 'INVALID_WEBHOOK_SIGNATURE',
      severity: 'critical',
      timestamp: admin.firestore.Timestamp.now(),
    });
    res.status(400).send('Invalid signature');
    return;
  }

  const event = req.body.event;
  if (event === 'payment.captured') {
    const paymentEntity = req.body.payload.payment.entity;
    const orderId = paymentEntity.notes?.orderId;
    if (orderId) {
      await db.collection('orders').doc(orderId).update({
        paymentStatus: 'paid',
        status: 'confirmed',
        gatewayPaymentId: paymentEntity.id,
        updatedAt: admin.firestore.Timestamp.now(),
      }).catch(() => {});
    }
  }

  res.status(200).json({ received: true });
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
