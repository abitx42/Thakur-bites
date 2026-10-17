'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const orderId = 'state-regression-order';
const owner = 'state-customer';

function harness(options = {}) {
  const docs = new Map([
    [`orders/${orderId}`, { studentId: owner, status: 'payment_pending', paymentStatus: 'pending', paymentMethod: 'online',
      totalAmountPaise: 5000, currency: 'INR', tokenNumber: 'TB-STATE', ...options.order }],
    [`inventoryReservations/${orderId}`, { orderId, studentId: owner, status: 'RESERVED',
      expiresAt: Timestamp.fromMillis(Date.now() + 900000), items: [{ itemId: 'meal', quantity: 1 }] }],
    ['menuItems/meal', { name: 'Meal', type: 'instant', stockOnHand: 5, reservedStock: 1, availableStock: 4 }],
    [`facultyPriorityLocks/${owner}`, { activeOrderId: options.lockOrder || orderId }],
  ]);
  const effects = { guards: [], writes: [], queries: 0 };
  let generated = 0;
  let sequence = Promise.resolve();
  const snapshot = ref => ({ id: ref.id, exists: docs.has(ref.path), data: () => docs.get(ref.path) });
  const db = {
    collection(name) { return {
      doc(id = `generated-${++generated}`) {
        assert.ok(typeof id === 'string' && id && !id.includes('/'));
        const ref = { id, path: `${name}/${id}`, async get() { return snapshot(ref); },
          async update(data) { docs.set(ref.path, { ...docs.get(ref.path), ...data }); effects.writes.push(ref.path); } };
        return ref;
      },
      where() { effects.queries++; return { limit() { return { async get() {
        if (options.afterLedgerRead) options.afterLedgerRead(docs);
        return { empty: !options.ledger, docs: [{ data: () => options.ledger }] };
      } }; } }; },
    }; },
    runTransaction(callback) {
      const run = sequence.then(async () => {
        const writes = [];
        const result = await callback({
          async get(ref) { assert.equal(writes.length, 0, 'Firestore read after write'); return snapshot(ref); },
          update(ref, data) { writes.push([ref.path, data, true]); },
          set(ref, data) { writes.push([ref.path, data, false]); },
          delete(ref) { writes.push([ref.path, null]); },
        });
        for (const [path, data, merge] of writes) {
          if (data === null) docs.delete(path);
          else docs.set(path, merge ? { ...docs.get(path), ...data } : data);
          effects.writes.push(path);
        }
        return result;
      });
      sequence = run.catch(() => {});
      return run;
    },
  };
  const target = require.resolve('../lib/payments');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === target) {
      if (request === 'firebase-admin') return { firestore: () => db };
      const mocks = {
        './app_check': { enforceAppCheck() {} }, './version_policy': { async enforceAppVersionPolicy() {} },
        './honeypot_defense': { async assertNoHoneytokens() {} }, './rate_limiter': { async enforceRateLimit() {} },
        './shift_pins': { async assertActiveWorkstationSession(uid, token) {
          effects.guards.push({ uid, token });
          if (!options.authorizedStaff) throw new HttpsError('unauthenticated', 'Synthetic revoked staff authority');
        } },
        './kill_switch': {}, './security_logger': {}, './secrets': {}, './payment_finalize': {}, './env_config': {}, './security_responses': {},
      };
      if (Object.hasOwn(mocks, request)) return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let handlers;
  try { delete require.cache[target]; handlers = require(target); }
  finally { Module._load = originalLoad; delete require.cache[target]; }
  const call = (name, data = {}, uid = owner, role = 'student') => handlers[name].run({
    data: { orderId, ...data }, auth: { uid, token: { role } },
  });
  return { docs, effects, call, order: () => docs.get(`orders/${orderId}`) };
}

test('unpaid online cancellation releases the real reservation exactly once under concurrent retries', async () => {
  const h = harness();
  const results = await Promise.all([h.call('cancelOrExpirePaymentSession'), h.call('cancelOrExpirePaymentSession')]);
  assert.equal(results.filter(result => result.alreadyCancelled === false).length, 1);
  assert.equal(h.order().paymentStatus, 'cancelled');
  assert.equal(h.docs.get('menuItems/meal').stockOnHand, 5);
  assert.equal(h.docs.get('menuItems/meal').reservedStock, 0);
  assert.equal(h.docs.get(`inventoryReservations/${orderId}`).status, 'RELEASED');
  assert.equal(h.docs.has(`facultyPriorityLocks/${owner}`), false);
  assert.equal(h.effects.writes.filter(path => path === 'menuItems/meal').length, 1);
});
test('cancelling an old session never releases another order’s faculty lock', async () => {
  const h = harness({ lockOrder: 'newer-active-order' });
  await h.call('cancelOrExpirePaymentSession', { reason: '  Customer cancelled  ' });
  assert.equal(h.docs.get(`facultyPriorityLocks/${owner}`).activeOrderId, 'newer-active-order');
  assert.equal(h.order().cancellationReason, 'Customer cancelled');
});
for (const order of [
  { paymentStatus: 'paid' }, { paymentStatus: 'captured' }, { paymentStatus: 'refunded' },
  { paymentStatus: 'partially_refunded' }, { gatewayPaymentId: 'pay_recorded' }, { amountPaidPaise: 5000 },
  { pendingRefundPaise: 100 }, { isCancellationPending: true }, { status: 'collected' },
  { status: 'expired' }, { status: 'ready' }, { paymentMethod: 'counter_cash' },
]) {
  test(`session cancellation rejects financial/terminal state ${JSON.stringify(order)}`, async () => {
    const h = harness({ order });
    await assert.rejects(h.call('cancelOrExpirePaymentSession'), { code: 'failed-precondition' });
    assert.equal(h.effects.writes.length, 0);
    assert.equal(h.docs.get('menuItems/meal').reservedStock, 1);
  });
}
for (const name of ['cancelOrExpirePaymentSession', 'reconcileOrderPayment']) {
  test(`${name} bounds IDs before database access`, async () => {
    for (const value of [1, {}, '', 'nested/path', '.', '..', 'x'.repeat(129), 'bad\nvalue']) {
      const h = harness();
      await assert.rejects(h.call(name, { orderId: value }), { code: 'invalid-argument' });
      assert.equal(h.effects.writes.length, 0);
    }
  });
  test(`${name} denies unrelated customers and revoked staff, accepts current guarded staff`, async () => {
    const denied = harness();
    await assert.rejects(denied.call(name, {}, 'someone-else', 'student'), { code: 'permission-denied' });
    await assert.rejects(denied.call(name, {}, 'demoted-manager', 'manager'), { code: 'unauthenticated' });
    assert.equal(denied.effects.guards.length, 1);
    assert.equal(denied.effects.writes.length, 0);
    const accepted = harness({ authorizedStaff: true });
    assert.equal((await accepted.call(name, {}, 'current-manager', 'manager')).success, true);
    assert.equal(accepted.effects.guards.length, 1);
  });
}
test('cancellation validates reason types and lengths instead of persisting arbitrary payloads', async () => {
  for (const reason of [{}, false, '', '   ', 'x'.repeat(201)]) {
    const h = harness();
    await assert.rejects(h.call('cancelOrExpirePaymentSession', { reason }), { code: 'invalid-argument' });
    assert.equal(h.effects.writes.length, 0);
  }
});
for (const paymentStatus of ['paid', 'captured', 'refunded', 'partially_refunded']) {
  test(`reconciliation preserves authoritative ${paymentStatus} without any writes`, async () => {
    const h = harness({ order: { status: 'confirmed', paymentStatus } });
    const result = await h.call('reconcileOrderPayment');
    assert.equal(result.paymentStatus, paymentStatus);
    assert.equal(result.isReconciled, true);
    assert.equal(h.effects.writes.length, 0);
  });
}
for (const ledger of [
  { type: 'REFUND', status: 'SETTLED' }, { type: 'PAYMENT_CAPTURE', status: 'CAPTURED', amountPaise: 1 },
  { type: 'PAYMENT_CAPTURE', status: 'CAPTURED', orderId: 'different-order' },
]) {
  test(`reconciliation cannot convert arbitrary ${JSON.stringify(ledger)} ledger into paid authority`, async () => {
    const h = harness({ ledger });
    const response = await h.call('reconcileOrderPayment');
    assert.equal(response.paymentStatus, 'pending');
    assert.equal(response.isReconciled, false);
    assert.equal(h.order().paymentStatus, 'pending');
    assert.equal(h.effects.writes.length, 0);
  });
}
