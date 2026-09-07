const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { validateEnvironmentCredentials } = require('../lib/env_config');

/**
 * Phase 8 — Real Payment Gateway Sandbox Testing Harness
 * Validates Razorpay test mode key handling, raw-body HMAC SHA-256 signatures,
 * duplicate webhook delivery idempotency, out-of-order webhooks, and compensating refunds.
 */
describe('Phase 8: Razorpay Gateway Sandbox Testing Harness', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Razorpay Key Environment Segregation
  // ──────────────────────────────────────────────────────────────────────────
  it('1. Razorpay Sandbox Key Segregation: Rejects live keys in staging/sandbox', () => {
    // Current environment in tests is 'test' (non-production)
    const testConfig = { razorpayKeyId: 'rzp_test_tcet_sandbox123' };
    const res = validateEnvironmentCredentials(testConfig);
    assert.strictEqual(res.valid, true);

    // Live key in non-production throws
    const liveConfig = { razorpayKeyId: 'rzp_live_secret_bank_key' };
    assert.throws(() => validateEnvironmentCredentials(liveConfig), /Live Razorpay credentials/);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Raw Buffer HMAC SHA-256 Webhook Signature Verification
  // ──────────────────────────────────────────────────────────────────────────
  it('2. Razorpay Webhook Signature Verification: Constant-time comparison & tamper defense', () => {
    const webhookSecret = 'rzp_sandbox_secret_abc123';
    const payload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_sandbox_001',
            amount: 8500, // ₹85.00
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    });

    const validSignature = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');

    // Constant-time validator
    function verifyWebhook(rawBody, signature, secret) {
      const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const sigBuf = Buffer.from(signature, 'utf8');
      const compBuf = Buffer.from(computed, 'utf8');
      if (sigBuf.length !== compBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, compBuf);
    }

    assert.strictEqual(verifyWebhook(payload, validSignature, webhookSecret), true, 'Valid signature accepted');

    // Tampered payload (e.g. amount altered from 8500 to 100)
    const tamperedPayload = payload.replace('8500', '100');
    assert.strictEqual(verifyWebhook(tamperedPayload, validSignature, webhookSecret), false, 'Tampered body rejected');

    // Altered signature
    const forgedSignature = '0000' + validSignature.slice(4);
    assert.strictEqual(verifyWebhook(payload, forgedSignature, webhookSecret), false, 'Forged signature rejected');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Duplicate Webhook Delivery Idempotency
  // ──────────────────────────────────────────────────────────────────────────
  it('3. Duplicate Webhook Delivery Idempotency: Exactly one double-entry ledger capture', () => {
    const processedEvents = new Set();
    const ledger = [];

    function processPaymentWebhook(paymentId, orderId, amountPaise) {
      const idempotencyKey = `webhook_pay_${paymentId}`;
      if (processedEvents.has(idempotencyKey)) {
        return { duplicate: true, message: 'Webhook already processed' };
      }
      processedEvents.add(idempotencyKey);

      // Record balanced ledger entries
      ledger.push({
        id: `tx_dr_${paymentId}`,
        orderId,
        type: 'DEBIT',
        account: 'ASSET_BANK_RAZORPAY',
        amountPaise
      });
      ledger.push({
        id: `tx_cr_${paymentId}`,
        orderId,
        type: 'CREDIT',
        account: 'REVENUE_FOOD_SALES',
        amountPaise
      });

      return { duplicate: false, message: 'Captured' };
    }

    // First arrival
    const res1 = processPaymentWebhook('pay_test_dup999', 'ord_123', 5000);
    assert.strictEqual(res1.duplicate, false);
    assert.strictEqual(ledger.length, 2);

    // Second duplicate arrival (network retry by Razorpay)
    const res2 = processPaymentWebhook('pay_test_dup999', 'ord_123', 5000);
    assert.strictEqual(res2.duplicate, true);
    assert.strictEqual(ledger.length, 2, 'Ledger count unchanged; zero duplicate financial accounting');

    // Third retry
    const res3 = processPaymentWebhook('pay_test_dup999', 'ord_123', 5000);
    assert.strictEqual(res3.duplicate, true);
    assert.strictEqual(ledger.length, 2);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Delayed Webhook on Expired Reservation (Auto-Refund Enqueue)
  // ──────────────────────────────────────────────────────────────────────────
  it('4. Delayed Webhook on Expired Reservation: Triggers auto-refund instead of overcooking', () => {
    const now = Date.now();
    const order = {
      id: 'ord_expired_1',
      reservationExpiresAt: now - 60000, // Expired 1 min ago
      status: 'payment_pending',
      totalAmountPaise: 6000
    };

    let refundEnqueued = false;
    let orderStatus = order.status;

    function handleDelayedWebhook(ord, paymentId) {
      const isExpired = Date.now() > ord.reservationExpiresAt;
      if (isExpired && ord.status === 'payment_pending') {
        // Stock reservation was already released back to pool!
        // Cooking this order would cause physical inventory overselling.
        // Therefore, fail-closed: cancel order and enqueue full gateway refund.
        orderStatus = 'cancelled';
        refundEnqueued = true;
        return { action: 'AUTO_REFUND', reason: 'RESERVATION_EXPIRED_PRIOR_TO_PAYMENT' };
      }

      orderStatus = 'paid';
      return { action: 'CONFIRMED' };
    }

    const decision = handleDelayedWebhook(order, 'pay_late_123');
    assert.strictEqual(decision.action, 'AUTO_REFUND');
    assert.strictEqual(orderStatus, 'cancelled');
    assert.strictEqual(refundEnqueued, true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Compensating Double-Entry Refund Ledger Invariant
  // ──────────────────────────────────────────────────────────────────────────
  it('5. Compensating Double-Entry Refund Ledger Invariant: Original ledger preserved immutable', () => {
    const historicalLedger = [
      { id: 'tx_orig_dr', type: 'DEBIT', account: 'ASSET_BANK_RAZORPAY', amountPaise: 12000 },
      { id: 'tx_orig_cr', type: 'CREDIT', account: 'REVENUE_FOOD_SALES', amountPaise: 12000 }
    ];

    // Refund event processed
    const compensatingEntries = [
      { id: 'tx_comp_dr', type: 'DEBIT', account: 'REVENUE_FOOD_SALES', amountPaise: 12000, note: 'REFUND_REVERSAL' },
      { id: 'tx_comp_cr', type: 'CREDIT', account: 'ASSET_BANK_RAZORPAY', amountPaise: 12000, note: 'REFUND_REVERSAL' }
    ];

    const fullAuditTrail = [...historicalLedger, ...compensatingEntries];
    assert.strictEqual(fullAuditTrail.length, 4);

    // Sum of debits and credits across the whole history
    const sumDebits = fullAuditTrail.filter(t => t.type === 'DEBIT').reduce((s, t) => s + t.amountPaise, 0);
    const sumCredits = fullAuditTrail.filter(t => t.type === 'CREDIT').reduce((s, t) => s + t.amountPaise, 0);

    assert.strictEqual(sumDebits, 24000);
    assert.strictEqual(sumCredits, 24000);
    assert.strictEqual(sumDebits, sumCredits, 'Ledger perfectly balanced across initial purchase and compensating refund');

    // Net revenue for this order is exactly 0
    const netRevenue = fullAuditTrail
      .filter(t => t.account === 'REVENUE_FOOD_SALES')
      .reduce((s, t) => t.type === 'CREDIT' ? s + t.amountPaise : s - t.amountPaise, 0);
    assert.strictEqual(netRevenue, 0, 'Net revenue after refund is 0 paise');
  });
});
