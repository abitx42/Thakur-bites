import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { UserRole, FinancialTransactionRecord } from './types';
import { logSecurityEvent } from './security_logger';
import { enforceRateLimit } from './rate_limiter';
import { assertOperationalMode } from './kill_switch';
import { enforceAppCheck } from './app_check';
import { RazorpayPaymentAdapter, RefundGatewayError, RefundResult } from './payments';
import { enforceAppVersionPolicy } from './version_policy';
import { assertCapability } from './authorization_policy';
import { assertNoHoneytokens } from './honeypot_defense';
import { assertActiveWorkstationSession } from './shift_pins';
import { updatePublicLiveQueueProjection } from './tv_projection';

const db = admin.firestore();

export interface RefundRequest {
  orderId: string;
  reason: string;
  amountPaise?: number; // Optional partial refund amount in paise
  idempotencyKey?: string; // Caller-supplied idempotency key
  appVersion?: string;
}

export interface RefundResponse {
  success: boolean;
  refundId: string;
  orderId: string;
  refundedPaise: number;
  totalRefundedPaise: number;
  remainingRefundablePaise: number;
  status: 'refunded' | 'partially_refunded';
}

export interface ExecuteRefundParams {
  orderId: string;
  reason: string;
  amountPaise?: number;
  actorId: string;
  actorRole: UserRole;
  idempotencyKey?: string;
  cancellation?: boolean;
}

export interface ExecuteRefundResult {
  success: boolean;
  refundId: string;
  reservationId: string;
  orderId: string;
  refundedPaise: number;
  totalRefundedPaise: number;
  remainingRefundablePaise: number;
  status: 'refunded' | 'partially_refunded';
  isCash: boolean;
  amountPaidPaise: number;
  previousRefundedPaise: number;
}

function refundDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !!value.trim() &&
    value !== '.' && value !== '..' && !/[/\u0000-\u001f\u007f]/.test(value);
}

function refundBalances(order: Record<string, any>): { paid: number; settled: number; pending: number } {
  const paid = order.amountPaidPaise;
  const settled = order.amountRefundedPaise === undefined ? 0 : order.amountRefundedPaise;
  const pending = order.pendingRefundPaise === undefined ? 0 : order.pendingRefundPaise;
  if (!Number.isSafeInteger(paid) || paid <= 0 || !Number.isSafeInteger(settled) || settled < 0 ||
      !Number.isSafeInteger(pending) || pending < 0 || !Number.isSafeInteger(settled + pending) || settled + pending > paid) {
    throw new HttpsError('failed-precondition', 'FINANCIAL_INTEGRITY_ERROR: Invalid paid, settled or pending refund balance. Reconciliation required.');
  }
  return { paid, settled, pending };
}

/**
 * One immutable request -> one reservation -> at most one gateway attempt.
 * The claim and pending-funds reservation commit together. An expired lease is
 * never proof that a remote refund failed, so ambiguous attempts are not retried.
 */
export async function reserveAndExecuteRefund(params: ExecuteRefundParams): Promise<ExecuteRefundResult> {
  const { orderId, reason, amountPaise, actorId, actorRole, idempotencyKey, cancellation = false } = params;
  if (!refundDocumentId(orderId) || !refundDocumentId(actorId) || typeof actorRole !== 'string' ||
      typeof cancellation !== 'boolean' || typeof reason !== 'string' || !reason.trim() || reason.length > 200 ||
      (amountPaise !== undefined && (!Number.isSafeInteger(amountPaise) || amountPaise <= 0))) {
    throw new HttpsError('invalid-argument', 'Valid bounded identifiers, reason and positive integer refund paise are required.');
  }
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey))) {
    throw new HttpsError('invalid-argument', 'idempotencyKey must be 1-128 letters, digits, underscores or hyphens; it is never trimmed or truncated.');
  }
  const cleanReason = reason.trim();
  const binding = { orderId, actorUid: actorId, requestAmountPaise: amountPaise ?? null, reason: cleanReason, cancellation };
  const requestFingerprint = crypto.createHash('sha256').update(JSON.stringify(binding)).digest('hex');
  // Cancellation callers without a key still get a stable request identity.
  const key = idempotencyKey ?? `auto_${requestFingerprint}`;
  const idempRef = db.collection('refundIdempotency').doc(key);
  const orderRef = db.collection('orders').doc(orderId);
  const newReservationId = crypto.randomBytes(16).toString('hex');
  const assertBinding = (record: Record<string, any>): void => {
    if (record.requestFingerprint !== requestFingerprint || record.orderId !== orderId || record.actorUid !== actorId ||
        record.requestAmountPaise !== binding.requestAmountPaise || record.reason !== cleanReason || record.cancellation !== cancellation) {
      throw new HttpsError('failed-precondition', 'Refund idempotency key conflicts with another request or an unbound legacy record. Reconciliation required.');
    }
  };
  const reconciliationError = (reservationId: string): HttpsError => new HttpsError('failed-precondition',
    'Refund execution is in progress or uncertain. Reconcile this reservation with the gateway; do not issue another refund.', { reservationId });

  const claim = await db.runTransaction(async transaction => {
    const [idempSnap, orderSnap] = await Promise.all([transaction.get(idempRef), transaction.get(orderRef)]);
    if (!orderSnap.exists) throw new HttpsError('not-found', 'Order not found.');
    if (idempSnap.exists) {
      const existing = idempSnap.data()!;
      assertBinding(existing);
      if (!refundDocumentId(existing.reservationId)) throw reconciliationError('unrecorded');
      if (existing.status === 'FAILED') throw reconciliationError(existing.reservationId);
      const reservationSnap = await transaction.get(db.collection('refundReservations').doc(existing.reservationId));
      if (!reservationSnap.exists) throw reconciliationError(existing.reservationId);
      const reservation = reservationSnap.data()!;
      assertBinding(reservation);
      if (reservation.idempotencyKey !== key || reservation.reservationId !== existing.reservationId) throw reconciliationError(existing.reservationId);
      // Pending/unknown outcomes require trusted provider reconciliation. Only a
      // recorded, validated success can resume settlement with the original key.
      if (!['GATEWAY_SUCCEEDED', 'GATEWAY_SKIPPED_CASH', 'FINALIZED'].includes(reservation.status)) {
        throw reconciliationError(existing.reservationId);
      }
      return { isNew: false, reservation };
    }

    const order = orderSnap.data()!;
    if (cancellation && ['preparing', 'ready', 'collected'].includes(order.status)) {
      throw new HttpsError('failed-precondition', 'Order is already being prepared or ready. Cancellation locked.');
    }
    if (order.status === 'cancelled' || (order.status === 'collected' && actorRole !== 'admin' && actorRole !== 'manager')) {
      throw new HttpsError('failed-precondition', 'Order is not eligible for this refund.');
    }
    if (!['paid', 'captured', 'partially_refunded'].includes(order.paymentStatus)) {
      throw new HttpsError('failed-precondition', 'Order is not eligible for a refund.');
    }
    const balances = refundBalances(order);
    if (balances.pending > 0) {
      // A UI retry may generate a different key. Do not let that turn an
      // unresolved partial refund into a second gateway disbursement.
      throw new HttpsError('failed-precondition', 'An earlier refund reservation is unresolved. Reuse its original key or reconcile it before requesting another refund.');
    }
    const available = balances.paid - balances.settled - balances.pending;
    const requestedRefundPaise = amountPaise ?? available;
    if (requestedRefundPaise <= 0 || requestedRefundPaise > available ||
        (cancellation && (balances.pending !== 0 || requestedRefundPaise !== available))) {
      throw new HttpsError('failed-precondition', 'Insufficient unreserved refundable balance or another cancellation refund is pending.');
    }
    const isCash = order.paymentMethod === 'counter_cash';
    if ((!isCash && order.paymentMethod !== 'online') || (order.currency ?? 'INR') !== 'INR' ||
        (!isCash && (typeof order.gatewayPaymentId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(order.gatewayPaymentId)))) {
      throw new HttpsError('failed-precondition', 'Refund requires a valid recorded payment and supported currency.');
    }
    const now = Timestamp.now();
    const gatewayKey = `TB-REFUND-${crypto.createHash('sha256').update(`${orderId}:${newReservationId}`).digest('hex').slice(0, 30)}`;
    const reservation = {
      ...binding, requestFingerprint, reservationId: newReservationId, idempotencyKey: key,
      requestedRefundPaise, amountPaidPaise: balances.paid, actorRole, isCash, currency: 'INR',
      gatewayPaymentId: isCash ? null : order.gatewayPaymentId,
      gatewayOrderId: order.gatewayOrderId ?? null, gatewayKey,
      status: isCash ? 'GATEWAY_SKIPPED_CASH' : 'GATEWAY_IN_FLIGHT',
      ...(isCash ? { gatewayRefundId: `rfnd_cash_${newReservationId}`, gatewayResponseStatus: 'processed',
        gatewayResponseAmountPaise: requestedRefundPaise, gatewayResponseCurrency: 'INR', gatewayResponsePaymentId: null } : {}),
      createdAt: now,
    };
    transaction.set(db.collection('refundReservations').doc(newReservationId), reservation);
    transaction.set(idempRef, { ...binding, requestFingerprint, idempotencyKey: key, reservationId: newReservationId,
      status: 'PROCESSING', claimedAt: now, createdAt: now });
    transaction.update(orderRef, { pendingRefundPaise: balances.pending + requestedRefundPaise, refundLifecycleStatus: 'REFUND_REQUESTED', updatedAt: now });
    return { isNew: true, reservation };
  });

  const reservationId = claim.reservation.reservationId as string;
  const reservationRef = db.collection('refundReservations').doc(reservationId);
  const reportRecovery = (gatewayRefundId?: string): void => {
    console.warn('[refunds] Refund requires reconciliation; this reservation will not retry the gateway.', { orderId, reservationId });
    logSecurityEvent({ eventType: 'REFUND_RECONCILIATION_REQUIRED', severity: 'HIGH', orderId, actorUid: actorId,
      details: { reservationId, ...(gatewayRefundId ? { gatewayRefundId } : {}) } }).catch(() => {});
  };

  if (claim.isNew && !claim.reservation.isCash) {
    let gatewayResult: RefundResult;
    try {
      gatewayResult = await new RazorpayPaymentAdapter().createRefund(claim.reservation.gatewayPaymentId,
        claim.reservation.requestedRefundPaise, cleanReason, claim.reservation.gatewayKey, claim.reservation.currency);
    } catch (error) {
      const confirmedFailure = error instanceof RefundGatewayError && error.gatewayOutcome === 'rejected';
      // A timeout/5xx is not a rejection. Only a positively rejected attempt can
      // release its own pending funds, after re-reading its immutable reservation.
      try {
        await db.runTransaction(async transaction => {
          const [resSnap, idempSnap, orderSnap] = await Promise.all([
            transaction.get(reservationRef), transaction.get(idempRef), transaction.get(orderRef),
          ]);
          if (!resSnap.exists || !idempSnap.exists || !orderSnap.exists) throw reconciliationError(reservationId);
          const reservation = resSnap.data()!;
          const idempotency = idempSnap.data()!;
          assertBinding(reservation);
          assertBinding(idempotency);
          if (reservation.status !== 'GATEWAY_IN_FLIGHT' || reservation.gatewayRefundId ||
              idempotency.reservationId !== reservationId || reservation.reservationId !== reservationId || reservation.idempotencyKey !== key ||
              reservation.requestedRefundPaise !== claim.reservation.requestedRefundPaise ||
              reservation.gatewayPaymentId !== claim.reservation.gatewayPaymentId || reservation.gatewayKey !== claim.reservation.gatewayKey) {
            throw reconciliationError(reservationId);
          }
          const balances = refundBalances(orderSnap.data()!);
          if (balances.paid !== reservation.amountPaidPaise || balances.pending < reservation.requestedRefundPaise) throw reconciliationError(reservationId);
          const now = Timestamp.now();
          transaction.update(reservationRef, { status: confirmedFailure ? 'GATEWAY_FAILED' : 'OUTCOME_UNKNOWN', failedAt: now });
          transaction.update(idempRef, { status: confirmedFailure ? 'FAILED' : 'OUTCOME_UNKNOWN', updatedAt: now });
          transaction.update(orderRef, {
            ...(confirmedFailure ? { pendingRefundPaise: balances.pending - reservation.requestedRefundPaise } : {}),
            refundLifecycleStatus: confirmedFailure ? 'GATEWAY_REFUND_FAILED' : 'REFUND_RECONCILIATION_REQUIRED', updatedAt: now,
          });
        });
      } catch (_) {
        reportRecovery();
        throw reconciliationError(reservationId);
      }
      if (!confirmedFailure) reportRecovery();
      throw confirmedFailure
        ? new HttpsError('failed-precondition', 'Gateway rejected this refund. The reservation was released; this request key is terminal.', { reservationId })
        : reconciliationError(reservationId);
    }

    if (!gatewayResult || typeof gatewayResult.refundId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(gatewayResult.refundId) ||
        gatewayResult.amountPaise !== claim.reservation.requestedRefundPaise || gatewayResult.currency !== claim.reservation.currency ||
        gatewayResult.gatewayPaymentId !== claim.reservation.gatewayPaymentId || !['processed', 'pending'].includes(gatewayResult.status)) {
      reportRecovery();
      throw reconciliationError(reservationId);
    }
    // Persistence is intentionally outside the gateway-failure catch. A successful
    // remote refund followed by a DB error MUST NOT release or re-reserve its funds.
    try {
      await db.runTransaction(async transaction => {
        const [resSnap, idempSnap] = await Promise.all([transaction.get(reservationRef), transaction.get(idempRef)]);
        if (!resSnap.exists || !idempSnap.exists) throw reconciliationError(reservationId);
        const reservation = resSnap.data()!;
        const idempotency = idempSnap.data()!;
        assertBinding(reservation);
        assertBinding(idempotency);
        if (reservation.status !== 'GATEWAY_IN_FLIGHT' || reservation.requestedRefundPaise !== gatewayResult.amountPaise ||
            idempotency.reservationId !== reservationId || reservation.reservationId !== reservationId || reservation.idempotencyKey !== key ||
            reservation.gatewayPaymentId !== gatewayResult.gatewayPaymentId || reservation.currency !== gatewayResult.currency ||
            reservation.gatewayKey !== claim.reservation.gatewayKey) throw reconciliationError(reservationId);
        const status = gatewayResult.status === 'processed' ? 'GATEWAY_SUCCEEDED' : 'GATEWAY_PENDING';
        transaction.update(reservationRef, { status, gatewayRefundId: gatewayResult.refundId,
          gatewayResponseStatus: gatewayResult.status, gatewayResponseAmountPaise: gatewayResult.amountPaise,
          gatewayResponseCurrency: gatewayResult.currency, gatewayResponsePaymentId: gatewayResult.gatewayPaymentId,
          gatewayExecutedAt: Timestamp.now() });
        transaction.update(idempRef, { status, gatewayRefundId: gatewayResult.refundId });
      });
    } catch (_) {
      reportRecovery(gatewayResult.refundId);
      throw reconciliationError(reservationId);
    }
    if (gatewayResult.status !== 'processed') throw reconciliationError(reservationId);
  }

  // Settlement reads the reservation AND deterministic gateway ledger every time.
  // It can resume a recorded success, but it can never execute the gateway again.
  const result = await db.runTransaction(async transaction => {
    const [resSnap, idempSnap, orderSnap] = await Promise.all([
      transaction.get(reservationRef), transaction.get(idempRef), transaction.get(orderRef),
    ]);
    if (!resSnap.exists || !idempSnap.exists || !orderSnap.exists) throw reconciliationError(reservationId);
    const reservation = resSnap.data()!;
    const idempotency = idempSnap.data()!;
    const order = orderSnap.data()!;
    assertBinding(reservation);
    assertBinding(idempotency);
    const refundPaise = reservation.requestedRefundPaise;
    const gatewayRefundId = reservation.gatewayRefundId;
    if (idempotency.status === 'FAILED' || idempotency.reservationId !== reservationId || reservation.reservationId !== reservationId || reservation.idempotencyKey !== key ||
        !Number.isSafeInteger(refundPaise) || refundPaise <= 0 || !refundDocumentId(gatewayRefundId) ||
        reservation.gatewayResponseStatus !== 'processed' || reservation.currency !== 'INR' ||
        reservation.gatewayResponseAmountPaise !== refundPaise || reservation.gatewayResponseCurrency !== reservation.currency ||
        reservation.gatewayResponsePaymentId !== reservation.gatewayPaymentId ||
        !['GATEWAY_SUCCEEDED', 'GATEWAY_SKIPPED_CASH', 'FINALIZED'].includes(reservation.status)) throw reconciliationError(reservationId);
    const balances = refundBalances(order);
    if (balances.paid !== reservation.amountPaidPaise || (order.paymentMethod === 'counter_cash') !== reservation.isCash ||
        (!reservation.isCash && order.gatewayPaymentId !== reservation.gatewayPaymentId) ||
        (order.gatewayOrderId ?? null) !== reservation.gatewayOrderId || (order.currency ?? 'INR') !== reservation.currency) throw reconciliationError(reservationId);
    const finRef = db.collection('financialTransactions').doc(`refund_fin_${gatewayRefundId}`);
    const finSnap = await transaction.get(finRef);
    if (finSnap.exists) {
      const ledger = finSnap.data()!;
      const recorded = reservation.result as ExecuteRefundResult | undefined;
      if (reservation.status !== 'FINALIZED' || idempotency.status !== 'SETTLED' || !recorded ||
          ledger.type !== 'REFUND_DISBURSEMENT' || ledger.orderId !== orderId || ledger.refundReservationId !== reservationId ||
          ledger.gatewayTransactionId !== gatewayRefundId || ledger.amountPaise !== refundPaise || ledger.currency !== reservation.currency ||
          ledger.gatewayOrderId !== (reservation.gatewayOrderId || 'direct') || ledger.actorId !== actorId || ledger.status !== 'REFUNDED' ||
          recorded.success !== true || recorded.orderId !== orderId || recorded.reservationId !== reservationId || recorded.refundId !== gatewayRefundId ||
          recorded.refundedPaise !== refundPaise || recorded.amountPaidPaise !== balances.paid || recorded.isCash !== reservation.isCash ||
          !Number.isSafeInteger(recorded.totalRefundedPaise) || recorded.totalRefundedPaise < refundPaise || recorded.totalRefundedPaise > balances.settled ||
          recorded.previousRefundedPaise !== recorded.totalRefundedPaise - refundPaise ||
          recorded.remainingRefundablePaise !== balances.paid - recorded.totalRefundedPaise ||
          recorded.status !== (recorded.totalRefundedPaise === balances.paid ? 'refunded' : 'partially_refunded') ||
          Object.entries(recorded).some(([field, value]) => idempotency.result?.[field] !== value)) throw reconciliationError(reservationId);
      return recorded;
    }
    if (reservation.status === 'FINALIZED' || idempotency.status === 'SETTLED' || balances.pending < refundPaise || balances.settled + refundPaise > balances.paid) {
      throw reconciliationError(reservationId);
    }
    const totalRefundedPaise = balances.settled + refundPaise;
    const fullRefund = totalRefundedPaise === balances.paid;
    const status = fullRefund ? 'refunded' : 'partially_refunded';
    const nextOrderStatus = fullRefund && order.status !== 'collected' ? 'cancelled' : order.status;
    const now = Timestamp.now();
    const settledResult: ExecuteRefundResult = { success: true, refundId: gatewayRefundId, reservationId, orderId,
      refundedPaise: refundPaise, totalRefundedPaise, remainingRefundablePaise: balances.paid - totalRefundedPaise,
      status, isCash: reservation.isCash, amountPaidPaise: balances.paid, previousRefundedPaise: balances.settled };
    const ledger: FinancialTransactionRecord & { refundReservationId: string } = {
      transactionId: finRef.id, orderId, type: 'REFUND_DISBURSEMENT', amount: refundPaise / 100, amountPaise: refundPaise,
      currency: 'INR', postings: [
        { account: 'SALES_REVENUE', debitPaise: refundPaise, creditPaise: 0 },
        { account: reservation.isCash ? 'CASH_ON_HAND' : 'GATEWAY_RECEIVABLE', debitPaise: 0, creditPaise: refundPaise },
      ], gatewayTransactionId: gatewayRefundId, gatewayOrderId: order.gatewayOrderId || 'direct',
      actorId, timestamp: now, status: 'REFUNDED', refundReservationId: reservationId,
    };
    transaction.set(finRef, ledger);
    transaction.update(orderRef, { pendingRefundPaise: balances.pending - refundPaise, amountRefundedPaise: totalRefundedPaise,
      paymentStatus: status, refundLifecycleStatus: 'GATEWAY_REFUNDED', status: nextOrderStatus,
      refundId: gatewayRefundId, refundedAt: now, amountRefundablePaise: balances.paid - totalRefundedPaise,
      lastRefundAmountPaise: refundPaise, refundReason: cleanReason, refundedByStaffId: actorId,
      refundReservationId: reservationId, updatedAt: now });
    transaction.update(reservationRef, { status: 'FINALIZED', finalizedAt: now, result: settledResult });
    transaction.update(idempRef, { status: 'SETTLED', settledAt: now, result: settledResult });
    transaction.set(db.collection('orderEvents').doc(), { orderId, fromStatus: order.status, toStatus: nextOrderStatus,
      actorId, actorRole, timestamp: now, reason: `REFUND_PROCESSED: ${cleanReason}`,
      metadata: { refundId: gatewayRefundId, reservationId, refundAmountPaise: refundPaise, totalRefundedPaise, isFullRefund: fullRefund, paymentMethod: order.paymentMethod } });
    return settledResult;
  }).catch(() => {
    reportRecovery(claim.reservation.gatewayRefundId);
    throw reconciliationError(reservationId);
  });
  if (result.status === 'refunded') {
    try {
      await updatePublicLiveQueueProjection(db);
    } catch (_) {
      console.warn('[refunds] Refund committed; public queue projection sync failed.', { orderId });
      logSecurityEvent({ eventType: 'REFUND_PROJECTION_SYNC_FAILED', severity: 'MEDIUM', orderId, actorUid: actorId,
        details: { projection: 'publicLiveQueue/current' } }).catch(() => {});
    }
  }
  return result;
}

/**
 * Formal, Audited Cumulative Refund Engine — Race-Condition-Safe & Idempotency-Hardened.
 */
export const processOrderRefund = onCall<RefundRequest>(async (request) => {
  await assertNoHoneytokens(request.data, request.auth?.uid, 'processOrderRefund');
  enforceAppCheck(request);
  await enforceAppVersionPolicy(request.data?.appVersion);
  await assertOperationalMode('refund');

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  await assertActiveWorkstationSession(request.auth.uid, request.auth.token);
  const actorRole = (typeof request.auth.token.role === 'string' ? request.auth.token.role : 'student') as UserRole;
  try {
    assertCapability(actorRole, 'process_refund');
  } catch (err) {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_REFUND_ATTEMPT',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: { role: actorRole },
    });
    throw new HttpsError('permission-denied', 'Only managers and administrators are authorized to process refunds.');
  }

  await enforceRateLimit(request.auth.uid, 'refund');

  const { orderId, reason, amountPaise, idempotencyKey } = request.data || {};
  const result = await reserveAndExecuteRefund({
    orderId,
    reason,
    amountPaise,
    actorId: request.auth.uid,
    actorRole,
    idempotencyKey,
    cancellation: false,
  });

  return {
    success: result.success,
    refundId: result.refundId,
    orderId: result.orderId,
    refundedPaise: result.refundedPaise,
    totalRefundedPaise: result.totalRefundedPaise,
    remainingRefundablePaise: result.remainingRefundablePaise,
    status: result.status,
  };
});
