'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const crypto = require('node:crypto');

// Executes both actual handlers against a real, explicitly local database.
const emulator = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'}`);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(emulator.hostname));
process.env.FIRESTORE_EMULATOR_HOST = emulator.host;
process.env.NODE_ENV = 'test';
process.env.GCLOUD_PROJECT = 'demo-checkout-session';
process.env.SIMULATE_PAYMENTS = 'true';
delete process.env.K_SERVICE;
delete process.env.ENFORCE_APP_CHECK;
const app = admin.initializeApp({ projectId: 'demo-checkout-session' });
const db = app.firestore();
db.settings({ ignoreUndefinedProperties: true });
const { createCheckout } = require('../../lib/checkout');
const { createPaymentSession } = require('../../lib/payments');
const uid = 'integration-customer';
const request = data => ({ data: { appVersion: '1.0.0', ...data },
  auth: { uid, token: { role: 'student', email: 'integration@example.test', email_verified: true } },
  rawRequest: { headers: {}, ip: '127.0.0.1' } });
before(async () => {
  await db.doc(`users/${uid}`).set({ uid, displayName: 'Test Customer', accountType: 'VISITOR', priorityLevel: 0, accountDisabled: false });
  await db.doc('menuItems/integration-meal').set({ name: 'Integration Meal', type: 'instant', price: 50,
    stockOnHand: 10, reservedStock: 0, available: true, prepMinutes: 1 });
});
after(async () => { await app.delete(); });
test('real checkout produces no placeholder and creates/reuses one immutable payment session', async () => {
  const key = crypto.randomUUID();
  const checkoutRequest = request({ idempotencyKey: key, items: [{ itemId: 'integration-meal', quantity: 1 }], paymentMethod: 'online' });
  const receipt = await createCheckout.run(checkoutRequest);
  assert.equal(receipt.amountPaise, 5000);
  const stored = (await db.doc(`orders/${receipt.orderId}`).get()).data();
  assert.equal(stored.gatewayOrderId, undefined);
  assert.equal(stored.paymentStatus, 'pending');
  const session = await createPaymentSession.run(request({ orderId: receipt.orderId }));
  assert.match(session.gatewayOrderId, /^sim_order_/);
  assert.equal(session.amountPaise, 5000);
  assert.equal((await createPaymentSession.run(request({ orderId: receipt.orderId }))).gatewayOrderId, session.gatewayOrderId);
  const replay = await createCheckout.run(checkoutRequest);
  assert.equal(replay.orderId, receipt.orderId);
  assert.equal(replay.isReplay, true);
  assert.equal((await db.doc('menuItems/integration-meal').get()).data().reservedStock, 1);
  await db.doc(`users/${uid}`).update({ accountDisabled: true });
  await assert.rejects(createCheckout.run(checkoutRequest), { code: 'permission-denied' });
});
test('malformed cart entries fail with invalid-argument before any order writes', async () => {
  for (const entry of [null, false, {}, { itemId: 'a/b/c', quantity: 1 }]) {
    await assert.rejects(createCheckout.run(request({ idempotencyKey: crypto.randomUUID(), items: [entry] })), { code: 'invalid-argument' });
  }
});
test('a committed cash checkout and its one-time PIN survive a failed public projection', async () => {
  await db.doc(`users/${uid}`).update({ accountDisabled: false });
  const projection = require('../../lib/tv_projection');
  const secrets = require('../../lib/secrets');
  const originalProjection = projection.updatePublicLiveQueueProjection;
  const originalSecret = secrets.getRequiredSecret;
  projection.updatePublicLiveQueueProjection = async () => { throw new Error('synthetic projection outage'); };
  secrets.getRequiredSecret = name => {
    assert.equal(name, 'QR_SIGNING_SECRET', 'Cash checkout must not require gateway credentials');
    return originalSecret(name);
  };
  try {
    const input = request({ idempotencyKey: crypto.randomUUID(), items: [{ itemId: 'integration-meal', quantity: 1 }], paymentMethod: 'counter_cash' });
    const receipt = await createCheckout.run(input);
    assert.match(receipt.rawPin, /^\d{4}$/);
    assert.equal(receipt.order.paymentStatus, 'pending');
    assert.equal((await db.doc(`orders/${receipt.orderId}`).get()).data().paymentMethod, 'counter_cash');
    assert.equal((await createCheckout.run(input)).orderId, receipt.orderId);
  } finally {
    projection.updatePublicLiveQueueProjection = originalProjection;
    secrets.getRequiredSecret = originalSecret;
  }
});
