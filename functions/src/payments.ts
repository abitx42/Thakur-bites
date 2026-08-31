import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import {
  PaymentSessionRequest,
  PaymentSessionResponse,
  PaymentVerificationRequest,
  PaymentRecord,
  DailyReconciliationRecord,
  UserRole
} from './types';

const db = admin.firestore();

// Server-side Webhook / Gateway secret (fallback for development / test)
const GATEWAY_SECRET = process.env.PAYMENT_GATEWAY_SECRET || 'tcet_thakur_bites_secret_key_2026';
const GATEWAY_KEY_ID = process.env.PAYMENT_GATEWAY_KEY_ID || 'rzp_live_tb_canteen_tcet';

/**
 * Helper to compute HMAC-SHA256 signature for payment verification.
 */
export function computeGatewaySignature(orderId: string, paymentId: string, secret = GATEWAY_SECRET): string {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

/**
 * 1. Creates an authoritative payment session for an order.
 * Prevents client price tampering by generating the session directly from the database snapshot.
 */
export const createPaymentSession = onCall<PaymentSessionRequest>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Student must be authenticated.');
  }

  const { orderId, gateway = 'razorpay' } = request.data;
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId is required.');
  }

  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) {
    throw new HttpsError('not-found', `Order ${orderId} not found.`);
  }

  const orderData = orderDoc.data()!;
  if (orderData.studentId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Cannot initiate payment for another student.');
  }

  if (orderData.paymentStatus === 'paid') {
    throw new HttpsError('failed-precondition', 'Order is already paid.');
  }

  const amountInPaise = Math.round(Number(orderData.totalAmount || 0) * 100);
  const gatewayOrderId = `order_${gateway}_${orderId.slice(0, 8)}_${Date.now()}`;

  const response: PaymentSessionResponse = {
    orderId,
    gatewayOrderId,
    amount: amountInPaise,
    currency: 'INR',
    keyId: GATEWAY_KEY_ID,
  };

  // Log payment session creation
  await db.collection('orders').doc(orderId).update({
    paymentStatus: 'pending',
    gatewayOrderId,
  });

  return response;
});

/**
 * 2. Cryptographically verifies payment signature and captures transaction.
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

  // Timing-safe buffer comparison to prevent timing attacks
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  const actualBuf = Buffer.from(gatewaySignature, 'utf8');

  const isValid = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);

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
      return { success: true, alreadyPaid: true, message: 'Order was already verified.' };
    }

    // 1. Update order payment & status
    transaction.update(orderRef, {
      paymentStatus: 'paid',
      status: 'confirmed',
      paidAt: now,
      gatewayPaymentId,
    });

    // 2. Write immutable payment record
    const paymentRef = db.collection('payments').doc(gatewayPaymentId);
    const paymentRecord: PaymentRecord = {
      paymentId: gatewayPaymentId,
      orderId,
      studentId: request.auth!.uid,
      amount: orderData.totalAmount,
      currency: 'INR',
      gateway: 'razorpay',
      gatewayOrderId,
      gatewayPaymentId,
      signatureVerified: true,
      status: 'captured',
      createdAt: now,
    };
    transaction.set(paymentRef, paymentRecord);

    // 3. Append immutable orderEvent
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: 'payment_pending',
      toStatus: 'paid',
      actorId: request.auth!.uid,
      actorRole: 'student',
      timestamp: now,
      metadata: { gatewayPaymentId, amount: orderData.totalAmount },
    });

    return {
      success: true,
      alreadyPaid: false,
      orderId,
      amount: orderData.totalAmount,
      tokenNumber: orderData.tokenNumber,
    };
  });
});

/**
 * 3. Daily Financial Reconciliation Engine.
 * Aggregates all orders, payments, and stock changes to produce an authoritative daily settlement ledger.
 */
export const reconcileDailyLedger = onCall<{ dateStr?: string }>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const role = (request.auth.token.role as UserRole) || 'student';
  if (role !== 'admin' && role !== 'manager' && role !== 'security_admin') {
    throw new HttpsError('permission-denied', 'Only managers or administrators can perform financial reconciliation.');
  }

  const targetDate = request.data.dateStr || new Date().toISOString().split('T')[0];
  const now = admin.firestore.Timestamp.now();

  // Fetch all orders for the target date
  const ordersSnap = await db.collection('orders').get();
  const dayOrders = ordersSnap.docs.filter(d => {
    const data = d.data();
    if (!data.createdAt) return false;
    const dt = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
    const orderDate = dt.toISOString().split('T')[0];
    return orderDate === targetDate;
  });

  let totalOrders = dayOrders.length;
  let totalRevenue = 0;
  let onlineCollected = 0;
  let cashCollected = 0;
  let totalItemsSold = 0;
  let discrepanciesCount = 0;

  for (const doc of dayOrders) {
    const data = doc.data();
    const amount = Number(data.totalAmount || 0);
    totalRevenue += amount;

    if (data.paymentStatus === 'paid') {
      onlineCollected += amount;
    } else {
      cashCollected += amount;
    }

    if (data.items && Array.isArray(data.items)) {
      totalItemsSold += data.items.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0);
    }

    // Check discrepancy: if collected but unpaid
    if (data.status === 'collected' && data.paymentStatus !== 'paid') {
      discrepanciesCount++;
    }
  }

  const record: DailyReconciliationRecord = {
    date: targetDate,
    totalOrders,
    totalRevenue,
    onlineCollected,
    cashCollected,
    totalItemsSold,
    discrepanciesCount,
    reconciledAt: now,
    status: discrepanciesCount === 0 ? 'balanced' : 'investigation_required',
  };

  await db.collection('dailyReconciliations').doc(targetDate).set(record);

  return { success: true, reconciliation: record };
});
