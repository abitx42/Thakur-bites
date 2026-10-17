import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import {
  PaymentSessionRequest,
  PaymentSessionResponse,
  PaymentVerificationRequest,
  ReconcilePaymentRequest,
  ReconcilePaymentResponse,
  DailyReconciliationRecord,
  UserRole,
} from './types';
import { enforceRateLimit } from './rate_limiter';
import { getRequiredSecret } from './secrets';
import { finalizeSuccessfulPayment } from './payment_finalize';
import { releaseInventoryInTransaction } from './inventory_reservation';
import { assertOperationalMode } from './kill_switch';
import { logSecurityEvent } from './security_logger';
import { enforceAppCheck } from './app_check';
import { assertActiveWorkstationSession } from './shift_pins';
import { enforceAppVersionPolicy } from './version_policy';
import { assertCapability, isOperationalStaffRole } from './authorization_policy';
import { isProduction, isSimulationAllowed } from './env_config';
import { createSanitizedHttpsError } from './security_responses';
import { inspectPayloadForHoneytokens, handleHoneypotTripwire, assertNoHoneytokens } from './honeypot_defense';

const db = admin.firestore();

/**
 * ═══════════════════════════════════════════════════════════════════
 * PAYMENT GATEWAY ADAPTER ARCHITECTURE
 * ═══════════════════════════════════════════════════════════════════
 */
export interface RefundResult {
  refundId: string;
  status: 'processed' | 'pending';
  amountPaise: number;
  gatewayPaymentId: string;
  currency: string;
}

/** Only an explicit gateway rejection proves that no refund was executed. */
export class RefundGatewayError extends Error {
  constructor(message: string, readonly gatewayOutcome: 'rejected' | 'unknown') {
    super(message);
    this.name = 'RefundGatewayError';
  }
}

function validPaymentDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !!value.trim() &&
    value !== '.' && value !== '..' && !/[/\u0000-\u001f\u007f]/.test(value);
}

function validGatewayId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(value);
}

export interface PaymentGatewayAdapter {
  verifyPaymentSignature(gatewayOrderId: string, gatewayPaymentId: string, signature: string): boolean;
  verifyWebhookSignature(payloadRaw: string | Buffer, signature: string): boolean;
  createRefund(gatewayPaymentId: string, amountPaise: number, reason: string): Promise<RefundResult>;
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

  isProduction(): boolean {
    return isProduction() || !isSimulationAllowed();
  }

  verifyPaymentSignature(gatewayOrderId: string, gatewayPaymentId: string, signature: string): boolean {
    if (typeof gatewayOrderId !== 'string' || typeof gatewayPaymentId !== 'string' || typeof signature !== 'string') {
      return false;
    }
    if (!gatewayOrderId || !gatewayPaymentId || !signature) {
      return false;
    }

    const expected = crypto
      .createHmac('sha256', this.secret)
      .update(`${gatewayOrderId}|${gatewayPaymentId}`)
      .digest('hex');

    const cleanSig = signature.trim();
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

  verifyWebhookSignature(payloadRaw: Buffer | string, signature: string): boolean {
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

  async getPaymentDetails(gatewayPaymentId: string): Promise<any> {
    if (typeof gatewayPaymentId !== 'string' || !/^[a-zA-Z0-9_-]{4,64}$/.test(gatewayPaymentId)) {
      throw new Error('INVALID_GATEWAY_PAYMENT_ID: Format mismatch or forbidden characters');
    }
    const keyId = getRequiredSecret('PAYMENT_GATEWAY_KEY_ID');
    const authHeader = `Basic ${Buffer.from(`${keyId}:${this.secret}`).toString('base64')}`;
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(gatewayPaymentId)}`, {
      method: 'GET',
      headers: { 'Authorization': authHeader },
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GATEWAY_FETCH_PAYMENT_FAILED: HTTP ${res.status} - ${errBody}`);
    }
    return await res.json();
  }

  async capturePayment(gatewayPaymentId: string, amountPaise: number, currency: string = 'INR'): Promise<any> {
    if (typeof gatewayPaymentId !== 'string' || !/^[a-zA-Z0-9_-]{4,64}$/.test(gatewayPaymentId)) {
      throw new Error('INVALID_GATEWAY_PAYMENT_ID: Format mismatch or forbidden characters');
    }
    const keyId = getRequiredSecret('PAYMENT_GATEWAY_KEY_ID');
    const authHeader = `Basic ${Buffer.from(`${keyId}:${this.secret}`).toString('base64')}`;
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(gatewayPaymentId)}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GATEWAY_CAPTURE_FAILED: HTTP ${res.status} - ${errBody}`);
    }
    return await res.json();
  }

  async ensurePaymentCaptured(gatewayPaymentId: string, amountPaise: number, currency: string, gatewayOrderId: string): Promise<void> {
    if (!validGatewayId(gatewayPaymentId) || !validGatewayId(gatewayOrderId) ||
        !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error('INVALID_CAPTURE_ARGUMENTS');
    }
    // Client verification always checks the real gateway, including test-mode keys.
    // Explicit simulation has a separate, environment-gated callable.
    const assertBinding = (details: any): void => {
      if (!details || details.id !== gatewayPaymentId || details.order_id !== gatewayOrderId ||
          details.amount !== amountPaise || details.currency !== currency) {
        throw new Error('GATEWAY_PAYMENT_BINDING_MISMATCH');
      }
    };
    let details = await this.getPaymentDetails(gatewayPaymentId);
    assertBinding(details);
    if (details.status === 'authorized') {
      details = await this.capturePayment(gatewayPaymentId, amountPaise, currency);
      assertBinding(details);
    }
    if (details.status !== 'captured' || details.captured !== true) {
      throw new Error('GATEWAY_PAYMENT_NOT_CAPTURED');
    }
  }

  async createRefund(
    gatewayPaymentId: string,
    amountPaise: number,
    reason: string,
    idempotencyKey?: string,
    currency: string = 'INR'
  ): Promise<RefundResult> {
    if (!validGatewayId(gatewayPaymentId) || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 ||
        !/^[A-Z]{3}$/.test(currency)) {
      throw new RefundGatewayError('INVALID_REFUND_ARGUMENTS', 'rejected');
    }
    if (this.isProduction()) {
      if (typeof gatewayPaymentId !== 'string' || !/^[a-zA-Z0-9_-]{4,64}$/.test(gatewayPaymentId)) {
        throw new Error('INVALID_GATEWAY_PAYMENT_ID: Format mismatch or forbidden characters');
      }
      const keyId = getRequiredSecret('PAYMENT_GATEWAY_KEY_ID');
      const authHeader = `Basic ${Buffer.from(`${keyId}:${this.secret}`).toString('base64')}`;

      const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(gatewayPaymentId)}/refund`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'X-Razorpay-Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify({
          amount: amountPaise,
          speed: 'optimum',
          receipt: idempotencyKey || undefined,
          notes: { reason, idempotencyKey: idempotencyKey || '' },
        }),
      });

      if (!res.ok) {
        const definiteRejection = res.status >= 400 && res.status < 500 && ![408, 409, 429].includes(res.status);
        throw new RefundGatewayError(`GATEWAY_REFUND_FAILED: HTTP ${res.status}`, definiteRejection ? 'rejected' : 'unknown');
      }

      const json = await res.json() as any;
      if (!json || !validGatewayId(json.id) || json.payment_id !== gatewayPaymentId ||
          json.amount !== amountPaise || json.currency !== currency || !['processed', 'pending'].includes(json.status)) {
        throw new RefundGatewayError('GATEWAY_REFUND_RESPONSE_MISMATCH', 'unknown');
      }
      return {
        refundId: json.id,
        status: json.status,
        amountPaise: json.amount,
        gatewayPaymentId: json.payment_id,
        currency: json.currency,
      };
    }

    // In staging / test / simulation mode: return deterministic simulated refund record based on idempotencyKey
    const refundId = idempotencyKey
      ? `rfnd_${crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16)}`
      : `rfnd_${crypto.randomBytes(8).toString('hex')}`;
    return {
      refundId,
      status: 'processed',
      amountPaise,
      gatewayPaymentId,
      currency,
    };
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
  if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data) || !validPaymentDocumentId(request.data.orderId)) {
    throw new HttpsError('invalid-argument', 'A valid orderId (one document ID, max 128 characters) is required.');
  }
  enforceAppCheck(request);
  await enforceAppVersionPolicy((request.data as any)?.appVersion);
  await assertOperationalMode('payment');

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Student must be authenticated to initiate payment.');
  }

  const studentId = request.auth.uid;

  // Active Deception / Honeypot Defense: Detect adversarial AI probes & tampering
  const honeypotCheck = inspectPayloadForHoneytokens(request.data);
  if (honeypotCheck.hasHoneytoken) {
    const forwardedFor = request.rawRequest.headers['x-forwarded-for'];
    const clientIp = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0].trim() || request.rawRequest.ip;
    await handleHoneypotTripwire(studentId, 'createPaymentSession', honeypotCheck.detectedTokens, clientIp);
  }

  if (request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Institutional email must be verified before making payment.');
  }

  await enforceRateLimit(studentId, 'payment_session');

  const { orderId } = request.data;
  const orderRef = db.collection('orders').doc(orderId);
  const reservationRef = db.collection('inventoryReservations').doc(orderId);
  const userRef = db.collection('users').doc(studentId);
  const simulation = !isProduction() && isSimulationAllowed() && process.env.K_SERVICE === undefined;
  const adapterMode: PaymentSessionResponse['adapterMode'] = simulation ? 'SIMULATION_ADAPTER' : 'PRODUCTION_GATEWAY';
  const sessionError = (phase: string, gatewayOrderId?: string): HttpsError => {
    logSecurityEvent({ eventType: 'PAYMENT_SESSION_RECONCILIATION_REQUIRED', severity: 'HIGH', orderId, actorUid: studentId,
      details: { phase, ...(gatewayOrderId ? { gatewayOrderId } : {}) } }).catch(() => {});
    // failed-precondition also prevents older clients from treating this as an
    // undeployed function and launching an unbound client-side checkout.
    return new HttpsError('failed-precondition', 'Payment session could not be confirmed. Please contact the counter for reconciliation before starting another payment.');
  };

  let keyId: string;
  let gatewaySecret: string;
  try {
    keyId = getRequiredSecret('PAYMENT_GATEWAY_KEY_ID');
    gatewaySecret = getRequiredSecret('PAYMENT_GATEWAY_SECRET');
    if (typeof keyId !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(keyId) ||
        typeof gatewaySecret !== 'string' || !gatewaySecret.trim()) throw new Error('Invalid gateway configuration');
  } catch (_) {
    throw sessionError('configuration');
  }

  const readEligibleOrder = async (transaction: admin.firestore.Transaction) => {
    const [orderSnap, reservationSnap, userSnap] = await Promise.all([
      transaction.get(orderRef), transaction.get(reservationRef), transaction.get(userRef),
    ]);
    if (!orderSnap.exists) throw new HttpsError('not-found', 'Order not found.');
    const order = orderSnap.data()!;
    if (order.studentId !== studentId) throw new HttpsError('permission-denied', 'Cannot pay for another customer’s order.');
    if (userSnap.exists && userSnap.data()?.accountDisabled === true) throw new HttpsError('permission-denied', 'Account has been deactivated.');
    if (order.paymentMethod !== 'online' || order.status !== 'payment_pending' ||
        !['unpaid', 'pending', 'initiated'].includes(order.paymentStatus) || order.isCancellationPending === true || order.gatewayPaymentId) {
      throw new HttpsError('failed-precondition', 'Order is not eligible for a new online payment session.');
    }
    if (!Number.isSafeInteger(order.totalAmountPaise) || order.totalAmountPaise <= 0 || order.currency !== 'INR') {
      throw new HttpsError('failed-precondition', 'Order has invalid authoritative payment amount or currency.');
    }
    const reservation = reservationSnap.exists ? reservationSnap.data()! : null;
    const orderExpiresAtMs = order.reservationExpiresAt?.toMillis?.();
    const reservationExpiresAtMs = reservation?.expiresAt?.toMillis?.();
    if (!reservation || reservation.orderId !== orderId || reservation.studentId !== studentId || reservation.status !== 'RESERVED' ||
        !Number.isSafeInteger(orderExpiresAtMs) || orderExpiresAtMs <= Date.now() ||
        !Number.isSafeInteger(reservationExpiresAtMs) || reservationExpiresAtMs <= Date.now()) {
      throw new HttpsError('failed-precondition', 'The matching stock reservation is missing, invalid or expired.');
    }
    return { order, amountPaise: order.totalAmountPaise as number, currency: 'INR', orderExpiresAtMs: orderExpiresAtMs as number,
      reservationExpiresAtMs: reservationExpiresAtMs as number,
      tokenNumber: typeof order.tokenNumber === 'string' ? order.tokenNumber : '' };
  };
  type EligibleOrder = Awaited<ReturnType<typeof readEligibleOrder>>;
  const assertSessionBinding = (session: Record<string, any> | undefined, current: EligibleOrder): void => {
    if (!session || session.version !== 1 || typeof session.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(session.nonce) ||
        session.ownerId !== studentId || session.amountPaise !== current.amountPaise || session.currency !== current.currency ||
        session.adapterMode !== adapterMode || session.keyId !== keyId || session.tokenNumber !== current.tokenNumber ||
        session.orderExpiresAtMs !== current.orderExpiresAtMs || session.reservationExpiresAtMs !== current.reservationExpiresAtMs) {
      throw sessionError('binding');
    }
  };
  const validCreatedId = (id: unknown): id is string => typeof id === 'string' &&
    (simulation ? /^sim_order_[a-f0-9]{32}$/.test(id) : /^order_[A-Za-z0-9]{1,58}$/.test(id));
  const responseFor = (session: Record<string, any>): PaymentSessionResponse => ({
    orderId, gatewayOrderId: session.gatewayOrderId, razorpayOrderId: session.gatewayOrderId,
    amount: session.amountPaise / 100, amountPaise: session.amountPaise, currency: session.currency,
    keyId, adapterMode, notes: { orderId, studentId, tokenNumber: session.tokenNumber, college: 'TCET Mumbai' },
  });

  const nonce = crypto.randomBytes(16).toString('hex');
  let claim: { reused: boolean; session: Record<string, any> };
  try {
    claim = await db.runTransaction(async transaction => {
      const current = await readEligibleOrder(transaction);
      const existing = current.order.paymentSession;
      if (existing !== undefined && existing !== null) {
        assertSessionBinding(existing, current);
        if (existing.state !== 'CREATED' || !validCreatedId(existing.gatewayOrderId) || current.order.gatewayOrderId !== existing.gatewayOrderId) {
          throw sessionError('existing_claim');
        }
        return { reused: true, session: existing };
      }
      // Older checkout/session code published placeholders indistinguishably from
      // unrecorded remote orders. Neither may be reused or overwritten on trust.
      if (current.order.gatewayOrderId !== undefined && current.order.gatewayOrderId !== null) throw sessionError('legacy_binding');
      const session = {
        version: 1, state: 'CREATING', nonce, ownerId: studentId, amountPaise: current.amountPaise, currency: current.currency,
        adapterMode, keyId, tokenNumber: current.tokenNumber, orderExpiresAtMs: current.orderExpiresAtMs,
        reservationExpiresAtMs: current.reservationExpiresAtMs,
        receipt: `TB-PAY-${crypto.createHash('sha256').update(`${orderId}:${nonce}`).digest('hex').slice(0, 32)}`,
        claimedAt: Timestamp.now(),
      };
      // No fabricated gateway ID or operational/payment status is published.
      transaction.update(orderRef, { paymentSession: session });
      return { reused: false, session };
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw sessionError('claim');
  }
  if (claim.reused) return responseFor(claim.session);

  const markUnknown = async (phase: string): Promise<void> => {
    try {
      await db.runTransaction(async transaction => {
        const snap = await transaction.get(orderRef);
        const session = snap.exists ? snap.data()?.paymentSession : null;
        if (session?.nonce === nonce && session.ownerId === studentId && session.state === 'CREATING') {
          transaction.update(orderRef, { paymentSession: { ...session, state: 'OUTCOME_UNKNOWN', failurePhase: phase, updatedAt: Timestamp.now() } });
        }
      });
    } catch (_) {
      // The original CREATING claim also blocks retries if this marker cannot persist.
    }
  };

  let gatewayOrderId: string;
  try {
    if (simulation) {
      gatewayOrderId = `sim_order_${nonce}`;
    } else {
      const result = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${gatewaySecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: claim.session.amountPaise, currency: claim.session.currency, receipt: claim.session.receipt,
          payment_capture: 1, notes: { orderId, studentId, tokenNumber: claim.session.tokenNumber } }),
      });
      if (!result.ok) throw new Error('Gateway creation rejected');
      const created = await result.json() as any;
      if (!created || !validCreatedId(created.id) || created.amount !== claim.session.amountPaise || created.currency !== claim.session.currency ||
          (created.status !== undefined && created.status !== 'created') || (created.entity !== undefined && created.entity !== 'order') ||
          (created.receipt !== undefined && created.receipt !== claim.session.receipt) ||
          (created.amount_paid !== undefined && created.amount_paid !== 0) ||
          (created.amount_due !== undefined && created.amount_due !== claim.session.amountPaise)) throw new Error('Gateway creation response mismatch');
      gatewayOrderId = created.id;
    }
  } catch (_) {
    await markUnknown('gateway');
    throw sessionError('gateway');
  }

  try {
    const completed = await db.runTransaction(async transaction => {
      const current = await readEligibleOrder(transaction);
      const session = current.order.paymentSession;
      assertSessionBinding(session, current);
      if (session.nonce !== nonce || session.state !== 'CREATING' ||
          (current.order.gatewayOrderId !== undefined && current.order.gatewayOrderId !== null)) throw sessionError('publication_claim');
      const completedSession = { ...session, state: 'CREATED', gatewayOrderId, completedAt: Timestamp.now() };
      transaction.update(orderRef, { gatewayOrderId, paymentSession: completedSession, paymentSessionCreatedAt: completedSession.completedAt });
      return completedSession;
    });
    return responseFor(completed);
  } catch (_) {
    // A lost commit acknowledgement is resolved by an independent read, not by
    // another gateway call or by overwriting a different worker's binding.
    try {
      const confirmed = await db.runTransaction(async transaction => {
        const current = await readEligibleOrder(transaction);
        const session = current.order.paymentSession;
        assertSessionBinding(session, current);
        if (session.nonce !== nonce || session.state !== 'CREATED' || session.gatewayOrderId !== gatewayOrderId ||
            current.order.gatewayOrderId !== gatewayOrderId) throw sessionError('publication_unconfirmed');
        return session;
      });
      return responseFor(confirmed);
    } catch (_) {
      await markUnknown('publication');
      throw sessionError('publication', gatewayOrderId);
    }
  }
});

/**
 * 2. Cryptographically verifies payment signature and delegates to single authoritative payment finalizer.
 */
export const verifyPayment = onCall<PaymentVerificationRequest>(async (request) => {
  enforceAppCheck(request);
  await enforceAppVersionPolicy((request.data as any)?.appVersion);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Student must be authenticated.');
  }

  const userDoc = await db.collection('users').doc(request.auth.uid).get();
  if (userDoc.exists && userDoc.data()?.accountDisabled === true) {
    throw new HttpsError('permission-denied', 'Account has been deactivated.');
  }

  // Active Deception / Honeypot Defense: Detect adversarial AI probes & tampering
  const honeypotCheck = inspectPayloadForHoneytokens(request.data);
  if (honeypotCheck.hasHoneytoken) {
    const forwardedFor = request.rawRequest.headers['x-forwarded-for'];
    const clientIp = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0].trim() || request.rawRequest.ip;
    await handleHoneypotTripwire(request.auth.uid, 'verifyPayment', honeypotCheck.detectedTokens, clientIp);
  }

  if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data)) {
    throw new HttpsError('invalid-argument', 'Payment verification data must be an object.');
  }
  const rawData = request.data as any;
  const orderId = rawData.orderId;
  const alias = (primary: string, legacy: string): unknown => {
    if (rawData[primary] !== undefined && rawData[legacy] !== undefined && rawData[primary] !== rawData[legacy]) {
      throw new HttpsError('invalid-argument', 'Conflicting payment verification aliases.');
    }
    return rawData[primary] ?? rawData[legacy];
  };
  const gatewayOrderId = alias('gatewayOrderId', 'razorpayOrderId');
  const gatewayPaymentId = alias('gatewayPaymentId', 'razorpayPaymentId');
  const gatewaySignature = alias('gatewaySignature', 'razorpaySignature');

  if (
    !validPaymentDocumentId(orderId) || !validGatewayId(gatewayOrderId) || !validGatewayId(gatewayPaymentId) ||
    typeof gatewaySignature !== 'string' || gatewaySignature.length > 256 || !/^[a-fA-F0-9]{64}$/.test(gatewaySignature.trim())
  ) {
    throw new HttpsError('invalid-argument', 'All payment verification arguments must be non-empty strings within acceptable bounds.');
  }

  // Ownership and the immutable gateway binding precede gateway work and are
  // checked again transactionally by the finalizer after that work completes.
  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found.');
  const orderData = orderDoc.data()!;
  if (orderData.studentId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Cannot verify payment for another customer’s order.');
  }
  if (orderData.paymentMethod !== 'online' || !validGatewayId(orderData.gatewayOrderId) || orderData.gatewayOrderId !== gatewayOrderId) {
    throw new HttpsError('failed-precondition', 'Payment is not bound to this order and gateway session.');
  }
  const amountPaise = orderData.totalAmountPaise !== undefined
    ? orderData.totalAmountPaise
    : (typeof orderData.totalAmount === 'number' ? Math.round(orderData.totalAmount * 100) : NaN);
  const currency = orderData.currency ?? 'INR';
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || currency !== 'INR') {
    throw new HttpsError('failed-precondition', 'Order has invalid payment amount or currency.');
  }

  const adapter = new RazorpayPaymentAdapter();
  const isValid = adapter.verifyPaymentSignature(gatewayOrderId, gatewayPaymentId, gatewaySignature);

  if (!isValid) {
    await logSecurityEvent({
      eventType: 'PAYMENT_SIGNATURE_MISMATCH',
      severity: 'CRITICAL',
      actorUid: request.auth.uid,
      orderId,
      details: { gatewayOrderId, gatewayPaymentId },
    });

    throw new HttpsError('permission-denied', 'Payment verification failed: Invalid cryptographic signature.');
  }

  // Single authoritative payment finalization (Phase 1 Hardened)
  try {
    await adapter.ensurePaymentCaptured(gatewayPaymentId, amountPaise, currency, gatewayOrderId);
    const result = await finalizeSuccessfulPayment({
      orderId,
      gatewayOrderId,
      gatewayPaymentId,
      amountPaise,
      currency,
      source: 'client_verification',
      actorId: request.auth.uid,
      signatureOrRef: gatewaySignature,
    });

    return result;
  } catch (error: any) {
    throw createSanitizedHttpsError('PAYMENT', error, {
      orderId,
      actorUid: request.auth.uid,
      details: { gatewayOrderId, gatewayPaymentId },
    });
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

  const clientIp = (req.ip || (req.headers['x-forwarded-for'] as string) || '0.0.0.0').split(',')[0].trim();
  try {
    await enforceRateLimit(clientIp, 'webhook_ingress');
  } catch (_) {
    res.status(429).send('Too Many Requests');
    return;
  }

  const webhookSignature = req.headers['x-razorpay-signature'] as string;
  if (!webhookSignature) {
    res.status(400).send('Missing webhook signature header.');
    return;
  }

  const rawBody = (req as any).rawBody || (typeof req.body === 'string' ? Buffer.from(req.body, 'utf8') : Buffer.from(JSON.stringify(req.body), 'utf8'));
  const adapter = new RazorpayPaymentAdapter();
  const isSignatureValid = adapter.verifyWebhookSignature(rawBody, webhookSignature);

  if (!isSignatureValid) {
    await logSecurityEvent({
      eventType: 'INVALID_WEBHOOK_SIGNATURE',
      severity: 'CRITICAL',
      actorUid: 'external_webhook',
      details: { signatureLength: webhookSignature.length },
    });
    res.status(400).send('Invalid webhook signature.');
    return;
  }

  const eventPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (!eventPayload || !validPaymentDocumentId(eventPayload.id)) {
    await logSecurityEvent({
      eventType: 'MALFORMED_WEBHOOK_PAYLOAD',
      severity: 'HIGH',
      actorUid: 'external_webhook',
      details: { reason: 'Missing or invalid provider event ID' },
    });
    res.status(400).json({ error: 'Missing valid provider event identifier.' });
    return;
  }

  const eventId = eventPayload.id.trim();
  const eventType = eventPayload.event;

  const eventDocRef = db.collection('processedGatewayEvents').doc(eventId);
  const now = Timestamp.now();

  try {
    // Atomic Transaction Claiming with 30s Lease Timeout (TB-NEW-003 Remediation)
    const claimResult = await db.runTransaction(async (t) => {
      const snap = await t.get(eventDocRef);
      if (snap.exists) {
        const data = snap.data()!;
        if (data.status === 'PROCESSED') {
          return { status: 'ALREADY_PROCESSED' };
        }
        // Check if another worker is currently processing this event within 30s lease
        const lastAttemptMs = data.lastAttemptAt?.toMillis?.() || 0;
        const elapsedMs = Date.now() - lastAttemptMs;
        if (data.status === 'PROCESSING' && elapsedMs < 30000) {
          return { status: 'IN_FLIGHT_LOCKED' };
        }
        t.update(eventDocRef, {
          status: 'PROCESSING',
          attemptCount: FieldValue.increment(1),
          lastAttemptAt: now,
        });
        return { status: 'CLAIMED' };
      }

      t.set(eventDocRef, {
        eventId,
        eventType,
        status: 'PROCESSING',
        attemptCount: 1,
        lastAttemptAt: now,
        createdAt: now,
      });
      return { status: 'CLAIMED' };
    });

    if (claimResult.status === 'ALREADY_PROCESSED') {
      res.status(200).json({ received: true, alreadyProcessed: true, status: claimResult.status });
      return;
    }

    if (claimResult.status === 'IN_FLIGHT_LOCKED') {
      res.status(503).json({ received: false, inFlight: true, message: 'Event is currently being processed by another worker.' });
      return;
    }

    if (eventType === 'payment.captured') {
      const paymentEntity = eventPayload.payload?.payment?.entity;
      if (!paymentEntity) {
        throw new Error('Invalid payment payload in captured event.');
      }
      if (paymentEntity.status !== 'captured' || paymentEntity.captured !== true ||
          !validGatewayId(paymentEntity.id) || !validGatewayId(paymentEntity.order_id) ||
          !Number.isSafeInteger(paymentEntity.amount) || paymentEntity.amount <= 0 || paymentEntity.currency !== 'INR') {
        throw new Error('Captured webhook payment state or binding mismatch.');
      }

      let orderId = paymentEntity.notes?.orderId;
      const gatewayPaymentAmountPaise = paymentEntity.amount;
      const gatewayCurrency = paymentEntity.currency;
      const gatewayOrderId = paymentEntity.order_id;
      const gatewayPaymentId = paymentEntity.id;

      if (!orderId && gatewayOrderId) {
        const matchSnap = await db.collection('orders').where('gatewayOrderId', '==', gatewayOrderId).limit(1).get();
        if (!matchSnap.empty) {
          orderId = matchSnap.docs[0].id;
        }
      }

      if (!validPaymentDocumentId(orderId)) {
        throw new Error('Missing orderId in payment notes and no matching order found for gatewayOrderId.');
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
      processedAt: Timestamp.now(),
    });

    res.status(200).json({ received: true, processed: true });
  } catch (err: any) {
    const correlationId = `WH-ERR-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    console.error(`[handlePaymentWebhook][${correlationId}] Internal processing error:`, err);

    // Non-retryable domain errors must be acknowledged (HTTP 200) to stop gateway retry storms
    const msg = (err.message || '').toLowerCase();
    const isTerminalDomainError =
      msg.includes('invalid payment flow') ||
      msg.includes('not found') ||
      msg.includes('mismatch') ||
      msg.includes('tamper') ||
      msg.includes('cancelled') ||
      msg.includes('zero-paise');

    if (isTerminalDomainError) {
      await eventDocRef.set({
        status: 'TERMINAL_REJECTED',
        errorMessage: err.message,
        correlationId,
        rejectedAt: Timestamp.now(),
      }, { merge: true }).catch(() => {});

      res.status(200).json({
        received: true,
        acknowledged: true,
        status: 'TERMINAL_REJECTED',
        error: err.message,
        correlationId,
      });
      return;
    }

    // Transient infrastructure errors: mark as FAILED so gateway retries can be processed
    await eventDocRef.set({
      status: 'FAILED',
      errorMessage: err.message,
      correlationId,
      failedAt: Timestamp.now(),
    }, { merge: true }).catch(() => {});

    res.status(500).json({
      error: 'Webhook processing failed',
      correlationId,
    });
  }
});

/**
 * 4. Record Counter Cash Payment (Phase 1 Hardened)
 * Restricted strictly to Cashier, Manager, and Admin roles.
 */
export const recordCashPayment = onCall<{ orderId: string; idempotencyKey?: string }>(async (request) => {
  await assertNoHoneytokens(request.data, request.auth?.uid, 'recordCashPayment');
  enforceAppCheck(request);
  await enforceAppVersionPolicy((request.data as any)?.appVersion);
  await assertOperationalMode('payment');

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  await assertActiveWorkstationSession(request.auth.uid, request.auth.token);

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  assertCapability(actorRole, 'record_cash_payment', 'Only authorized cashiers and managers can record cash payments.');

  await enforceRateLimit(request.auth.uid, 'cash_payment');

  const { orderId, idempotencyKey } = request.data || {};
  if (!validPaymentDocumentId(orderId) || (idempotencyKey !== undefined &&
      (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)))) {
    throw new HttpsError('invalid-argument', 'Valid bounded orderId and optional idempotency key are required.');
  }

  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) {
    throw new HttpsError('not-found', 'Order not found.');
  }

  const orderData = orderDoc.data()!;

  // Phase 1 Invariants: Cash payment only on counter_cash orders that are unpaid
  if (orderData.paymentMethod !== 'counter_cash') {
    throw new HttpsError('failed-precondition', 'Cannot record cash payment on an online order.');
  }

  // Reject cash recording on cancelled or expired orders immediately (BUG-01)
  if (orderData.status === 'cancelled' || orderData.status === 'expired' || orderData.paymentStatus === 'cancelled' || orderData.paymentStatus === 'expired') {
    throw new HttpsError('failed-precondition', 'Cannot record cash payment on a cancelled or expired order.');
  }

  // Idempotency: If already marked as paid, return idempotent success response without duplicate ledger entries
  if (orderData.paymentStatus === 'paid' || orderData.paymentStatus === 'captured') {
    return {
      success: true,
      alreadyProcessed: true,
      orderId,
      status: orderData.status,
      paymentStatus: orderData.paymentStatus,
      paymentId: orderData.gatewayPaymentId || `cash_pay_recorded_${orderId}`,
    };
  }

  const amountPaise = orderData.totalAmountPaise || Math.round(Number(orderData.totalAmount || 0) * 100);
  const cashIdentity = crypto.createHash('sha256').update(orderId).digest('hex').slice(0, 32);
  const gatewayOrderId = orderData.gatewayOrderId || `cash_ord_${cashIdentity}`;
  // Cash settlement is once per order, independently of caller retry keys.
  const gatewayPaymentId = `cash_pay_${cashIdentity}`;

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
 * Simulated Payment Finalization Endpoint.
 * Strictly forbidden in production (TB-001 & TB-018 Fail-Closed Invariants).
 * Only accessible in test/staging/development when isSimulationAllowed() is true.
 */
export const simulateOnlinePaymentFinalization = onCall<{ orderId: string }>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  if (!isSimulationAllowed()) {
    throw new HttpsError(
      'permission-denied',
      'SIMULATION_DISABLED: Payment simulation is strictly prohibited in production environment.'
    );
  }

  const { orderId } = request.data || {};
  if (!orderId || typeof orderId !== 'string') {
    throw new HttpsError('invalid-argument', 'Valid orderId is required.');
  }

  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) {
    throw new HttpsError('not-found', 'Order not found.');
  }

  const orderData = orderDoc.data()!;
  if (orderData.studentId !== request.auth.uid && (request.auth.token.role as string) !== 'admin') {
    throw new HttpsError('permission-denied', 'Cannot simulate payment for another user’s order.');
  }

  if (orderData.paymentStatus === 'paid' || orderData.paymentStatus === 'captured') {
    return { success: true, alreadyCaptured: true, orderId, tokenNumber: orderData.tokenNumber };
  }

  const amountPaise = orderData.totalAmountPaise || Math.round(Number(orderData.totalAmount || 0) * 100);
  const gatewayOrderId = orderData.gatewayOrderId || `sim_ord_${orderId}`;
  const gatewayPaymentId = `sim_pay_${crypto.randomBytes(6).toString('hex')}`;

  return await finalizeSuccessfulPayment({
    orderId,
    gatewayOrderId,
    gatewayPaymentId,
    amountPaise,
    currency: orderData.currency || 'INR',
    source: 'client_verification',
    actorId: request.auth.uid,
    signatureOrRef: `SIMULATED_TEST_PAYMENT_${request.auth.uid}`,
  });
});


/**
 * 5. Authoritative Daily Financial Reconciliation Engine (Asia/Kolkata Timezone)
 */
export async function reconcileDailyLedger(dateStr: string): Promise<DailyReconciliationRecord> {
  const startOfDay = new Date(`${dateStr}T00:00:00+05:30`);
  const endOfDay = new Date(`${dateStr}T23:59:59+05:30`);

  const startTimestamp = Timestamp.fromDate(startOfDay);
  const endTimestamp = Timestamp.fromDate(endOfDay);

  const ordersSnap = await db.collection('orders')
    .where('createdAt', '>=', startTimestamp)
    .where('createdAt', '<=', endTimestamp)
    .get();

  const paymentsSnap = await db.collection('payments')
    .where('verifiedAt', '>=', startTimestamp)
    .where('verifiedAt', '<=', endTimestamp)
    .get();

  let totalOrdersCount = ordersSnap.size;
  let totalRevenuePaise = 0;
  let onlinePaymentsCapturedPaise = 0;
  let counterCashEstimatedPaise = 0;
  let cancelledOrdersCount = 0;
  const auditNotes: string[] = [];
  let discrepanciesCount = 0;

  const capturedPaymentOrderIds = new Set<string>();
  paymentsSnap.forEach(doc => {
    const p = doc.data();
    const pAmountPaise = p.amountPaise !== undefined ? Number(p.amountPaise) : Math.round(Number(p.amount || 0) * 100);
    // TB-R2-011: Segregate digital payments from counter cash so cash isn't double-counted
    if (p.gateway === 'counter_cash' || p.paymentMethod === 'counter_cash') {
      counterCashEstimatedPaise += pAmountPaise;
    } else {
      onlinePaymentsCapturedPaise += pAmountPaise;
    }
    capturedPaymentOrderIds.add(p.orderId);
  });

  ordersSnap.forEach(doc => {
    const order = doc.data();
    const orderPaise = order.totalAmountPaise !== undefined ? Number(order.totalAmountPaise) : Math.round(Number(order.totalAmount || 0) * 100);

    // Cancelled orders do NOT contribute to net sales revenue, but captured payments must be in gross sales to balance against refund disbursements
    if (order.status === 'cancelled') {
      cancelledOrdersCount++;
      const wasPaid = order.paymentStatus === 'refunded' || order.paymentStatus === 'partially_refunded' || order.paymentStatus === 'paid' || order.paymentStatus === 'captured' || capturedPaymentOrderIds.has(doc.id);
      if (wasPaid) {
        totalRevenuePaise += orderPaise;
      }
      return;
    }

    const isPaid = order.paymentStatus === 'paid' || order.paymentStatus === 'captured' || order.paymentStatus === 'partially_refunded';

    if (isPaid) {
      totalRevenuePaise += orderPaise;
      if (!capturedPaymentOrderIds.has(doc.id)) {
        discrepanciesCount++;
        auditNotes.push(`Order ${doc.id} marked paid but missing verified payment ledger record.`);
      }
    } else {
      if (order.status === 'collected') {
        discrepanciesCount++;
        auditNotes.push(`Order ${doc.id} marked collected but paymentStatus is unpaid/pending.`);
      }
    }
  });

  // Query financial refunds recorded on this date
  const refundsSnap = await db.collection('financialTransactions')
    .where('type', '==', 'REFUND_DISBURSEMENT')
    .where('timestamp', '>=', startTimestamp)
    .where('timestamp', '<=', endTimestamp)
    .get();

  let totalRefundsPaise = 0;
  refundsSnap.forEach(doc => {
    const rf = doc.data();
    totalRefundsPaise += Number(rf.amountPaise || Math.round(Number(rf.amount || 0) * 100));
  });

  // Query orphaned payments captured on cancelled orders on this date
  const orphanSnap = await db.collection('financialTransactions')
    .where('type', '==', 'ORPHANED_PAYMENT_CAPTURE')
    .where('timestamp', '>=', startTimestamp)
    .where('timestamp', '<=', endTimestamp)
    .get();

  let orphanSuspensePaise = 0;
  orphanSnap.forEach(doc => {
    const op = doc.data();
    orphanSuspensePaise += Number(op.amountPaise || Math.round(Number(op.amount || 0) * 100));
  });

  const netRevenuePaise = totalRevenuePaise - totalRefundsPaise;

  const reconciliation: DailyReconciliationRecord = {
    date: dateStr,
    totalOrdersCount,
    totalRevenueCalculated: totalRevenuePaise / 100,
    totalRevenuePaise,
    totalRefundsPaise,
    netRevenuePaise,
    orphanSuspensePaise,
    cancelledOrdersCount,
    onlinePaymentsCaptured: onlinePaymentsCapturedPaise / 100,
    counterCashEstimated: counterCashEstimatedPaise / 100,
    discrepanciesCount,
    reconciledAt: Timestamp.now(),
    status: discrepanciesCount === 0 ? 'BALANCED' : 'DISCREPANCY_FLAGGED',
    auditNotes,
  };

  await db.collection('dailyReconciliations').doc(dateStr).set(reconciliation);

  return reconciliation;
}

/**
 * 6. Cancel or Expire Payment Session & Automatically Release Inventory Reservation (Phase 2 Hardened)
 */
export const cancelOrExpirePaymentSession = onCall<{ orderId: string; reason?: string }>(async (request) => {
  await assertNoHoneytokens(request.data, request.auth?.uid, 'cancelOrExpirePaymentSession');
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  await enforceRateLimit(request.auth.uid, 'payment_session');

  const { orderId, reason = 'PAYMENT_SESSION_CANCELLED' } = request.data || {};
  if (!validPaymentDocumentId(orderId) || typeof reason !== 'string' || !reason.trim() || reason.length > 200) {
    throw new HttpsError('invalid-argument', 'A valid orderId and bounded cancellation reason are required.');
  }

  const orderRef = db.collection('orders').doc(orderId);
  const now = Timestamp.now();

  // Validate non-owner authority outside retryable transaction callbacks. This
  // includes current Auth revocation for permanent staff and live PIN/hardware
  // binding for operational workstation accounts.
  const initialOrder = await orderRef.get();
  if (!initialOrder.exists) throw new HttpsError('not-found', 'Order not found.');
  const actorRole = (request.auth.token.role as UserRole) || 'student';
  if (initialOrder.data()?.studentId !== request.auth.uid) {
    assertCapability(actorRole, 'cancel_staff_order', 'Only the owner or authorized staff can cancel a payment session.');
    await assertActiveWorkstationSession(request.auth.uid, request.auth.token);
  }

  return await db.runTransaction(async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) {
      throw new HttpsError('not-found', 'Order not found.');
    }

    const orderData = orderSnap.data()!;
    const isOwner = orderData.studentId === request.auth!.uid;
    const isStaff = initialOrder.data()?.studentId !== request.auth!.uid && isOperationalStaffRole(actorRole);

    if (!isOwner && !isStaff) {
      throw new HttpsError('permission-denied', 'Only order owner or staff can cancel payment session.');
    }

    if (['paid', 'captured', 'refunded', 'partially_refunded'].includes(orderData.paymentStatus) ||
        orderData.gatewayPaymentId || orderData.amountPaidPaise > 0 ||
        orderData.isCancellationPending === true || orderData.pendingRefundPaise > 0) {
      throw new HttpsError('failed-precondition', 'Cannot cancel a payment session for an already paid order.');
    }

    if (orderData.status === 'cancelled') {
      return { success: true, alreadyCancelled: true, orderId };
    }
    if (orderData.paymentMethod !== 'online' || orderData.status !== 'payment_pending' ||
        !['pending', 'initiated', 'failed'].includes(orderData.paymentStatus)) {
      throw new HttpsError('failed-precondition', 'Only an unpaid pending online payment session can be cancelled.');
    }

    const lockRef = db.collection('facultyPriorityLocks').doc(orderData.studentId);
    const lockSnap = await transaction.get(lockRef);

    // 1. Release Inventory Reservation (Phase 2 Invariant: Releases stock back to available pool)
    await releaseInventoryInTransaction(transaction, db, orderId, reason, request.auth!.uid);

    // 2. Update order state
    transaction.update(orderRef, {
      status: 'cancelled',
      paymentStatus: 'cancelled',
      cancelledAt: now,
      cancellationReason: reason.trim(),
      cancelledBy: request.auth!.uid,
      updatedAt: now,
    });

    // 2b. Release Faculty Priority Lock if held (TB-R2-013)
    if (lockSnap.exists && lockSnap.data()?.activeOrderId === orderId) {
      transaction.delete(lockRef);
    }

    // 3. Log order event
    const eventRef = db.collection('orderEvents').doc();
    transaction.set(eventRef, {
      orderId,
      fromStatus: orderData.status || 'payment_pending',
      toStatus: 'cancelled',
      actorId: request.auth!.uid,
      actorRole,
      timestamp: now,
      reason: reason.trim(),
    });

    return {
      success: true,
      alreadyCancelled: false,
      orderId,
      status: 'cancelled',
    };
  });
});

/**
 * 6. Authoritative Order Payment Reconciliation Callable (Phase 4 Hardened)
 * Resolves edge-cases where app crashed after gateway payment capture,
 * or where network dropped before client verification callback.
 */
export const reconcileOrderPayment = onCall<ReconcilePaymentRequest>(async (request): Promise<ReconcilePaymentResponse> => {
  await assertNoHoneytokens(request.data, request.auth?.uid, 'reconcileOrderPayment');
  enforceAppCheck(request);
  await enforceAppVersionPolicy((request.data as any)?.appVersion);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to reconcile payment.');
  }

  const actorUid = request.auth.uid;
  await enforceRateLimit(actorUid, 'payment_session');
  const { orderId } = request.data || {};
  if (!validPaymentDocumentId(orderId)) {
    throw new HttpsError('invalid-argument', 'Valid orderId is required.');
  }

  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HttpsError('not-found', `Order ${orderId} not found.`);
  }

  const orderData = orderSnap.data()!;
  const isOwner = orderData.studentId === actorUid;
  const callerRole = request.auth.token.role;
  const isStaff = typeof callerRole === 'string' && isOperationalStaffRole(callerRole);

  if (!isOwner && !isStaff) {
    throw new HttpsError('permission-denied', 'You do not have permission to inspect or reconcile this order.');
  }
  if (!isOwner) await assertActiveWorkstationSession(actorUid, request.auth.token);

  // 1. If order is already confirmed / paid
  if (['paid', 'captured', 'refunded', 'partially_refunded'].includes(orderData.paymentStatus)) {
    return {
      success: true,
      orderId,
      orderStatus: orderData.status,
      paymentStatus: orderData.paymentStatus,
      tokenNumber: orderData.tokenNumber,
      message: 'Returning the authoritative recorded payment state.',
      isReconciled: true,
    };
  }

  // 2. Check if order was cancelled
  if (orderData.status === 'cancelled' || orderData.paymentStatus === 'cancelled') {
    return {
      success: true,
      orderId,
      orderStatus: 'cancelled',
      paymentStatus: 'cancelled',
      tokenNumber: orderData.tokenNumber,
      message: 'Order has been cancelled.',
      isReconciled: true,
    };
  }

  // The payment finalizer commits capture, inventory and order state atomically.
  // A random ledger entry (including a refund) is NOT proof of a valid capture.
  // This polling endpoint must never race a cancellation/refund or bypass the
  // finalizer by rewriting an order from a stale snapshot. Legacy inconsistent
  // records require trusted reconciliation, not an unverified paid upgrade.

  // 4. Check inventory reservation expiration
  const reservationRef = db.collection('inventoryReservations').doc(orderId);
  const resSnap = await reservationRef.get();
  if (resSnap.exists) {
    const resData = resSnap.data()!;
    const nowMillis = Date.now();
    const expiresAtMillis = resData.expiresAt?.toMillis?.() || 0;
    if (expiresAtMillis > 0 && nowMillis > expiresAtMillis && (orderData.paymentStatus === 'pending' || orderData.paymentStatus === 'initiated')) {
      return {
        success: true,
        orderId,
        orderStatus: orderData.status,
        paymentStatus: 'expired',
        tokenNumber: orderData.tokenNumber,
        message: 'Stock reservation has expired. Please place a new order.',
        isReconciled: true,
        isExpired: true,
      };
    }
  }

  // 5. Payment still pending confirmation
  return {
    success: true,
    orderId,
    orderStatus: orderData.status,
    paymentStatus: (orderData.paymentStatus as any) || 'pending',
    tokenNumber: orderData.tokenNumber,
    message: 'Payment verification is pending gateway confirmation.',
    isReconciled: false,
  };
});
