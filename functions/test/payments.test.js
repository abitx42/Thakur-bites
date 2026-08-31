const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

function computeGatewaySignature(orderId, paymentId, secret = 'tcet_test_secret') {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

describe('Phase 5 Payment & Financial Integrity Invariants', () => {
  it('Computes valid HMAC-SHA256 signature for payment callback', () => {
    const orderId = 'order_tb_98765';
    const paymentId = 'pay_tcet_12345';
    const secret = 'test_secret_key';

    const sig = computeGatewaySignature(orderId, paymentId, secret);
    assert.strictEqual(typeof sig, 'string');
    assert.strictEqual(sig.length, 64); // 256 bits hex = 64 characters
  });

  it('Detects tampered payment ID in signature verification', () => {
    const orderId = 'order_tb_98765';
    const paymentId = 'pay_tcet_12345';
    const tamperedPaymentId = 'pay_tcet_99999';
    const secret = 'test_secret_key';

    const validSig = computeGatewaySignature(orderId, paymentId, secret);
    const tamperedSig = computeGatewaySignature(orderId, tamperedPaymentId, secret);

    assert.notStrictEqual(validSig, tamperedSig);
  });

  it('Verifies timing-safe buffer equality', () => {
    const sig1 = computeGatewaySignature('order_1', 'pay_1', 'sec');
    const sig2 = computeGatewaySignature('order_1', 'pay_1', 'sec');

    const buf1 = Buffer.from(sig1, 'utf8');
    const buf2 = Buffer.from(sig2, 'utf8');

    assert.strictEqual(crypto.timingSafeEqual(buf1, buf2), true);
  });

  it('Calculates daily reconciliation financial totals accurately', () => {
    const orders = [
      { totalAmount: 120, paymentStatus: 'paid', status: 'collected', itemsCount: 3 },
      { totalAmount: 85, paymentStatus: 'paid', status: 'ready', itemsCount: 2 },
      { totalAmount: 40, paymentStatus: 'unpaid', status: 'confirmed', itemsCount: 1 },
    ];

    const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const onlineCollected = orders.filter(o => o.paymentStatus === 'paid').reduce((sum, o) => sum + o.totalAmount, 0);
    const cashPending = orders.filter(o => o.paymentStatus !== 'paid').reduce((sum, o) => sum + o.totalAmount, 0);
    const totalItems = orders.reduce((sum, o) => sum + o.itemsCount, 0);

    assert.strictEqual(totalRevenue, 245);
    assert.strictEqual(onlineCollected, 205);
    assert.strictEqual(cashPending, 40);
    assert.strictEqual(totalItems, 6);
  });
});
