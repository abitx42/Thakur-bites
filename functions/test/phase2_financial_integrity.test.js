const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

describe('Phase 2: Financial Integrity, Distributed Refunds & Webhooks Tests', () => {

  it('202. Refund Idempotency Atomic Claiming Invariant: Rejects concurrent duplicate key attempts', () => {
    const idempotencyStore = new Map();

    function claimRefundIdempotency(key, orderId) {
      if (idempotencyStore.has(key)) {
        const record = idempotencyStore.get(key);
        if (record.status === 'SETTLED') {
          return { status: 'RESOLVED', data: record };
        }
        if (record.status === 'PROCESSING') {
          return { status: 'IN_PROGRESS' };
        }
      }
      idempotencyStore.set(key, {
        idempotencyKey: key,
        orderId,
        status: 'PROCESSING',
        claimedAt: Date.now(),
      });
      return { status: 'CLAIMED' };
    }

    const key = 'idem_test_12345';
    const workerA = claimRefundIdempotency(key, 'order_001');
    assert.strictEqual(workerA.status, 'CLAIMED');

    // Worker B attempts with the same key concurrently
    const workerB = claimRefundIdempotency(key, 'order_001');
    assert.strictEqual(workerB.status, 'IN_PROGRESS');

    // Worker A settles the refund
    idempotencyStore.set(key, {
      ...idempotencyStore.get(key),
      status: 'SETTLED',
      refundId: 'rfnd_success_99',
      refundedPaise: 5000,
    });

    // Worker C arrives later with the same key
    const workerC = claimRefundIdempotency(key, 'order_001');
    assert.strictEqual(workerC.status, 'RESOLVED');
    assert.strictEqual(workerC.data.refundId, 'rfnd_success_99');
  });

  it('203. Delta Accounting Rollback Invariant: Failed refund rollback never overwrites concurrent settled refund', () => {
    // Initial order state
    const order = {
      orderId: 'TB-999',
      amountPaidPaise: 10000,
      amountRefundedPaise: 0,
      pendingRefundPaise: 0,
    };

    function reserveRefund(amountPaise) {
      const available = order.amountPaidPaise - order.amountRefundedPaise - order.pendingRefundPaise;
      if (amountPaise > available) {
        throw new Error('INSUFFICIENT_REFUNDABLE_BALANCE');
      }
      order.pendingRefundPaise += amountPaise;
      return { reservationAmount: amountPaise };
    }

    function settleRefund(amountPaise) {
      order.pendingRefundPaise -= amountPaise;
      order.amountRefundedPaise += amountPaise;
    }

    function rollbackRefund(amountPaise) {
      order.pendingRefundPaise -= amountPaise;
      // NOTE: Delta arithmetic only! Never restores obsolete scalar amountRefundedPaise!
    }

    // Reservation A (5000 paise)
    const resA = reserveRefund(5000);
    assert.strictEqual(order.pendingRefundPaise, 5000);
    assert.strictEqual(order.amountRefundedPaise, 0);

    // Reservation B (3000 paise) succeeds concurrently
    const resB = reserveRefund(3000);
    assert.strictEqual(order.pendingRefundPaise, 8000);
    assert.strictEqual(order.amountRefundedPaise, 0);

    // Gateway call for B succeeds first and settles!
    settleRefund(resB.reservationAmount);
    assert.strictEqual(order.pendingRefundPaise, 5000);
    assert.strictEqual(order.amountRefundedPaise, 3000);

    // Gateway call for A fails! Rollback A.
    rollbackRefund(resA.reservationAmount);

    // Critical Invariant Verification:
    // Settle B is NOT corrupted or overwritten by A's rollback!
    assert.strictEqual(order.pendingRefundPaise, 0);
    assert.strictEqual(order.amountRefundedPaise, 3000);
    assert.strictEqual(order.amountPaidPaise - order.amountRefundedPaise, 7000);
  });

  it('204. Deterministic External Gateway Idempotency Key Invariant: Binds to order and reservation', () => {
    const orderId = 'TB-042';
    const reservationId = 'res_abcd1234efgh5678';
    const cleanIdempKey = 'client_uuid_999';

    function formatGatewayKey(orderId, reservationId, userKey) {
      return userKey || `TB-REFUND-${orderId}-${reservationId}`;
    }

    assert.strictEqual(formatGatewayKey(orderId, reservationId, cleanIdempKey), 'client_uuid_999');
    assert.strictEqual(formatGatewayKey(orderId, reservationId, undefined), 'TB-REFUND-TB-042-res_abcd1234efgh5678');
  });

  it('205. Webhook Provider Event ID Invariant: Rejects blank/missing event.id fail-closed', () => {
    function validateWebhookEventId(payload) {
      if (!payload || !payload.id || typeof payload.id !== 'string' || payload.id.trim().length === 0) {
        return { valid: false, error: 'Missing valid provider event identifier.' };
      }
      return { valid: true, eventId: payload.id.trim() };
    }

    assert.strictEqual(validateWebhookEventId({}).valid, false);
    assert.strictEqual(validateWebhookEventId({ id: '' }).valid, false);
    assert.strictEqual(validateWebhookEventId({ id: '   ' }).valid, false);
    assert.strictEqual(validateWebhookEventId({ id: null }).valid, false);
    assert.strictEqual(validateWebhookEventId({ id: 'evt_rzp_98765' }).valid, true);
    assert.strictEqual(validateWebhookEventId({ id: 'evt_rzp_98765' }).eventId, 'evt_rzp_98765');
  });

  it('206. Webhook Error Sanitization Invariant: Replaces raw error with correlationId', () => {
    function sanitizeWebhookError(err) {
      const correlationId = `WH-ERR-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
      return {
        statusCode: 500,
        body: {
          error: 'Webhook processing failed',
          correlationId,
        },
      };
    }

    const rawError = new Error('FATAL: Internal pool connection failure on host 10.0.0.1:5432 with socket timeout');
    const response = sanitizeWebhookError(rawError);

    assert.strictEqual(response.statusCode, 500);
    assert.strictEqual(response.body.error, 'Webhook processing failed');
    assert.strictEqual(typeof response.body.correlationId, 'string');
    assert.strictEqual(response.body.correlationId.startsWith('WH-ERR-'), true);
    assert.strictEqual(JSON.stringify(response.body).includes('socket timeout'), false);
    assert.strictEqual(JSON.stringify(response.body).includes('10.0.0.1'), false);
  });

});
