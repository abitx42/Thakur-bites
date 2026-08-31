const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildOrderNotification } = require('../lib/notifications');

describe('Order Push Notification Invariants', () => {
  it('1. Returns null when status is unchanged', () => {
    const notif = buildOrderNotification('ord_1', 'TB-001', 'preparing', 'preparing');
    assert.strictEqual(notif, null);
  });

  it('2. Formats CONFIRMED notification with token number and friendly title', () => {
    const notif = buildOrderNotification('ord_1', 'TB-012', 'payment_pending', 'confirmed');
    assert.ok(notif);
    assert.strictEqual(notif.status, 'confirmed');
    assert.ok(notif.body.includes('TB-012'));
    assert.ok(notif.title.includes('Placed'));
  });

  it('3. Formats PREPARING notification with kitchen context', () => {
    const notif = buildOrderNotification('ord_1', 'TB-012', 'confirmed', 'preparing');
    assert.ok(notif);
    assert.strictEqual(notif.status, 'preparing');
    assert.ok(notif.body.includes('hot station'));
  });

  it('4. Formats READY notification with high-priority pickup instructions', () => {
    const notif = buildOrderNotification('ord_1', 'TB-012', 'preparing', 'ready');
    assert.ok(notif);
    assert.strictEqual(notif.status, 'ready');
    assert.ok(notif.body.includes('pickup counter'));
    assert.ok(notif.body.includes('QR code or PIN'));
  });

  it('5. Formats CANCELLED notification with refund confirmation', () => {
    const notif = buildOrderNotification('ord_1', 'TB-012', 'payment_pending', 'cancelled');
    assert.ok(notif);
    assert.strictEqual(notif.status, 'cancelled');
    assert.ok(notif.body.includes('refund'));
  });
});
