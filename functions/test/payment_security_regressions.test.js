'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const { Timestamp } = require('firebase-admin/firestore');
const https = require('firebase-functions/v2/https');

const key = crypto.randomBytes(32).toString('hex');
const orderId = 'payment-security-order';
const owner = 'payment-security-customer';
const gatewayOrderId = 'order_payment_security';
const gatewayPaymentId = 'pay_payment_security';
const amount = 10000;
const originalFetch = globalThis.fetch;

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object' && !(value instanceof Timestamp)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function harness(t, options = {}) {
  const docs = new Map([[`orders/${orderId}`, {
    studentId: owner, tokenNumber: 'TB-501', status: 'payment_pending', paymentStatus: 'pending',
    paymentMethod: 'online', totalAmountPaise: amount, currency: 'INR', gatewayOrderId,
    ...options.order,
  }]]);
  for (const [path, data] of Object.entries(options.documents || {})) docs.set(path, clone(data));
  const effects = { calls: [], security: [], inventory: 0, projections: 0, writes: [] };
  let generated = 0;
  let queue = Promise.resolve();
  const snapshot = ref => ({ id: ref.id, exists: docs.has(ref.path), data: () => clone(docs.get(ref.path)) });
  const db = {
    collection(name) {
      const collection = {
        doc(id = `generated-${++generated}`) {
          assert.ok(typeof id === 'string' && id && !id.includes('/'));
          const ref = { id, path: `${name}/${id}` };
          ref.get = async () => snapshot(ref);
          ref.update = async data => db.runTransaction(async transaction => {
            await transaction.get(ref);
            transaction.update(ref, data);
          });
          ref.set = async (data, opts) => db.runTransaction(async transaction => transaction.set(ref, data, opts));
          return ref;
        },
        where(field, _op, value) {
          return { limit() { return { async get() {
            const matches = [...docs].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value);
            return { empty: matches.length === 0, docs: matches.map(([path]) => ({ id: path.split('/')[1] })) };
          } }; } };
        },
      };
      return collection;
    },
    runTransaction(callback) {
      const run = queue.then(async () => {
        const pending = [];
        let writing = false;
        const transaction = {
          async get(ref) { assert.equal(writing, false, 'read after write'); return snapshot(ref); },
          set(ref, data, opts) { writing = true; pending.push({ ref, data, merge: !!opts?.merge }); },
          update(ref, data) { writing = true; pending.push({ ref, data, merge: true, update: true }); },
          delete(ref) { writing = true; pending.push({ ref, remove: true }); },
        };
        let result = await callback(transaction);
        if (options.retryCallbacks) {
          pending.length = 0;
          writing = false;
          result = await callback(transaction);
        }
        if (options.rejectCommit) throw new Error('commit rejected');
        const committed = new Map(docs);
        for (const write of pending) {
          if (write.remove) committed.delete(write.ref.path);
          else {
            if (write.update) assert.ok(committed.has(write.ref.path));
            const previous = committed.get(write.ref.path) || {};
            const data = clone(write.data);
            for (const [field, value] of Object.entries(data)) {
              if (value && value.increment !== undefined) data[field] = (previous[field] || 0) + value.increment;
            }
            committed.set(write.ref.path, write.merge ? { ...previous, ...data } : data);
          }
        }
        docs.clear();
        for (const [path, data] of committed) docs.set(path, data);
        effects.writes.push(...pending.map(write => write.ref.path));
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
  const targets = [require.resolve('../lib/payments'), require.resolve('../lib/payment_finalize')];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (targets.includes(parent?.filename)) {
      if (request === 'firebase-admin') return { firestore: () => db };
      if (request === 'firebase-admin/firestore') return { Timestamp, FieldValue: { increment: value => ({ increment: value }) } };
      if (request === 'firebase-functions/v2/https') return { ...https, onRequest: (_options, callback) => callback };
      const stubs = {
        './secrets': { getRequiredSecret: () => key },
        './app_check': { enforceAppCheck() {} }, './version_policy': { async enforceAppVersionPolicy() {} },
        './kill_switch': { async assertOperationalMode() {} }, './rate_limiter': { async enforceRateLimit() {} },
        './shift_pins': { async assertActiveWorkstationSession() {} },
        './env_config': { isProduction: () => options.production !== false, isSimulationAllowed: () => options.production === false },
        './honeypot_defense': { inspectPayloadForHoneytokens: () => ({ hasHoneytoken: false }), async assertNoHoneytokens() {} },
        './security_logger': { async logSecurityEvent(event) { effects.security.push(event); } },
        './security_responses': { createSanitizedHttpsError: () => new https.HttpsError('internal', 'Payment rejected') },
        './inventory_reservation': { async commitInventoryInTransaction() { effects.inventory += 1; } },
        './tv_projection': { async updatePublicLiveQueueProjection() { effects.projections += 1; if (options.rejectProjection) throw new Error('sensitive provider response'); } },
      };
      if (Object.hasOwn(stubs, request)) return stubs[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let payments;
  let finalizer;
  try {
    for (const target of targets) delete require.cache[target];
    payments = require(targets[0]);
    finalizer = require(targets[1]);
  } finally {
    Module._load = originalLoad;
    for (const target of targets) delete require.cache[target];
  }
  globalThis.fetch = async (url, request) => {
    effects.calls.push({ url, method: request.method, body: request.body });
    if (options.fetchFailure) throw new Error('gateway network failure');
    const capture = url.endsWith('/capture');
    const detail = { id: gatewayPaymentId, order_id: gatewayOrderId, amount, currency: 'INR', status: 'captured', captured: true,
      ...(capture ? options.capture : options.details) };
    if (options.afterFetch) options.afterFetch(docs, capture);
    return { ok: capture ? options.captureRejected !== true : options.fetchRejected !== true, status: 400,
      async json() { return detail; }, async text() { return 'gateway rejected'; } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const signature = crypto.createHmac('sha256', key).update(`${gatewayOrderId}|${gatewayPaymentId}`).digest('hex');
  return {
    payments, docs, effects, db,
    order: () => docs.get(`orders/${orderId}`),
    verify(input = {}, uid = owner) {
      return payments.verifyPayment.run({ data: { orderId, gatewayOrderId, gatewayPaymentId, gatewaySignature: signature, ...input }, auth: { uid, token: {} } });
    },
    finalize(input = {}) {
      return finalizer.finalizeSuccessfulPayment({ orderId, gatewayOrderId, gatewayPaymentId, amountPaise: amount,
        currency: 'INR', source: 'client_verification', actorId: owner, ...input });
    },
    cash(input = {}) {
      return payments.recordCashPayment.run({ data: { orderId, ...input }, auth: { uid: 'cashier', token: { role: 'cashier' } } });
    },
    async webhook(input = {}) {
      const body = { id: 'evt_payment_security', event: 'payment.captured', payload: { payment: { entity: {
        id: gatewayPaymentId, order_id: gatewayOrderId, amount, currency: 'INR', status: 'captured', captured: true,
        notes: { orderId }, ...input,
      } } } };
      const rawBody = Buffer.from(JSON.stringify(body));
      const response = { code: null, body: null, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; }, send(data) { this.body = data; return this; } };
      await payments.handlePaymentWebhook({ method: 'POST', ip: '127.0.0.1', headers: { 'x-razorpay-signature': crypto.createHmac('sha256', key).update(rawBody).digest('hex') }, body, rawBody }, response);
      return response;
    },
  };
}

describe('Payment real-handler security regressions (offline gateway and atomic transaction mocks)', () => {
  it('rejects fetch/capture errors and never posts a capture ledger', async t => {
    for (const option of [{ fetchFailure: true }, { fetchRejected: true }, { details: { status: 'authorized', captured: false }, captureRejected: true }]) {
      const h = harness(t, option);
      await assert.rejects(h.verify());
      assert.equal(h.order().paymentStatus, 'pending');
      assert.equal(h.effects.writes.length, 0);
    }
  });

  it('requires exact gateway ID, order, amount, currency and captured state', async t => {
    for (const details of [{ id: 'pay_other' }, { order_id: 'order_other' }, { amount: 1 }, { amount: String(amount) },
      { currency: 'USD' }, { status: 'failed' }, { status: 'captured', captured: false }]) {
      const h = harness(t, { details });
      await assert.rejects(h.verify());
      assert.equal(h.effects.writes.length, 0);
      assert.equal(h.effects.inventory, 0);
    }
  });

  it('validates the capture response again after an authorized payment', async t => {
    for (const capture of [{ status: 'authorized', captured: false }, { amount: 1 }, { order_id: 'order_other' }]) {
      const h = harness(t, { details: { status: 'authorized', captured: false }, capture });
      await assert.rejects(h.verify());
      assert.equal(h.effects.calls.length, 2);
      assert.equal(h.effects.writes.length, 0);
    }
    const h = harness(t, { details: { status: 'authorized', captured: false } });
    assert.equal((await h.verify()).success, true);
    assert.equal(h.effects.calls.length, 2);
  });

  it('never attempts capture on an authorized payment with mismatched immutable fields', async t => {
    for (const details of [{ amount: 1 }, { currency: 'USD' }, { order_id: 'order_other' }]) {
      const h = harness(t, { details: { status: 'authorized', captured: false, ...details } });
      await assert.rejects(h.verify());
      assert.equal(h.effects.calls.length, 1);
      assert.equal(h.effects.calls[0].method, 'GET');
      assert.equal(h.effects.writes.length, 0);
    }
  });

  it('checks ownership and immutable gateway binding before any remote work', async t => {
    const unowned = harness(t);
    await assert.rejects(unowned.verify({}, 'another-customer'), error => error.code === 'permission-denied');
    assert.equal(unowned.effects.calls.length, 0);
    for (const order of [{ gatewayOrderId: undefined }, { gatewayOrderId: 'order_another' }, { paymentMethod: 'counter_cash' }]) {
      const h = harness(t, { order });
      await assert.rejects(h.verify());
      assert.equal(h.effects.calls.length, 0);
    }
  });

  it('bounds IDs and detects conflicting aliases before remote work', async t => {
    for (const input of [{ orderId: 12 }, { orderId: 'nested/path' }, { orderId: 'x'.repeat(129) },
      { gatewayOrderId: {} }, { gatewayPaymentId: 'pay/invalid' }, { gatewaySignature: 'x'.repeat(257) },
      { razorpayOrderId: 'order_other' }]) {
      const h = harness(t);
      await assert.rejects(h.verify(input), error => error.code === 'invalid-argument');
      assert.equal(h.effects.calls.length, 0);
    }
  });

  it('does not silently skip gateway capture verification in simulation-enabled environments', async t => {
    const h = harness(t, { production: false, details: { status: 'failed' } });
    await assert.rejects(h.verify());
    assert.equal(h.effects.calls.length, 1);
    assert.equal(h.effects.writes.length, 0);
  });

  it('finalizer rechecks owner and gateway binding after remote work', async t => {
    for (const change of [{ studentId: 'another-customer' }, { gatewayOrderId: 'order_changed' }]) {
      const h = harness(t, { afterFetch(docs) { Object.assign(docs.get(`orders/${orderId}`), change); } });
      await assert.rejects(h.verify());
      assert.equal(h.effects.writes.length, 0);
    }
  });

  it('a pre-existing financial transaction cannot bypass immutable validation', async t => {
    const ledger = { orderId, type: 'PAYMENT_CAPTURE', gatewayOrderId, gatewayTransactionId: gatewayPaymentId,
      amountPaise: amount, currency: 'INR' };
    for (const [order, record, params] of [
      [{}, { ...ledger, orderId: 'another-order' }, {}],
      [{ gatewayOrderId: undefined }, ledger, {}],
      [{}, ledger, { amountPaise: 1 }],
      [{}, ledger, { source: 'cashier_counter' }],
      [{}, ledger, { actorId: 'another-customer' }],
      [{}, { ...ledger, currency: 'USD' }, {}],
    ]) {
      const h = harness(t, { order, documents: { [`financialTransactions/pay_fin_${gatewayPaymentId}`]: record } });
      await assert.rejects(h.finalize(params));
      assert.equal(h.effects.writes.length, 0);
    }
  });

  it('valid payment finalization and replay post exactly one deterministic capture', async t => {
    const h = harness(t, { retryCallbacks: true });
    assert.equal((await h.verify()).alreadyCaptured, false);
    assert.equal((await h.finalize({ source: 'webhook', actorId: 'system_webhook' })).alreadyCaptured, true);
    assert.equal([...h.docs.keys()].filter(path => path.startsWith('financialTransactions/')).length, 1);
    assert.equal([...h.docs.keys()].filter(path => path.startsWith('payments/')).length, 1);
    assert.equal([...h.docs.keys()].filter(path => path.startsWith('orderEvents/')).length, 1);
    assert.equal(h.order().amountPaidPaise, amount);
    assert.equal(h.order().paymentStatus, 'paid');
  });

  it('failed finalization callbacks/commits discard all financial writes', async t => {
    const h = harness(t, { rejectCommit: true });
    await assert.rejects(h.finalize(), /commit rejected/);
    assert.equal(h.order().paymentStatus, 'pending');
    assert.equal(h.effects.writes.length, 0);
  });

  it('signed captured webhooks settle without a client capture fetch', async t => {
    const h = harness(t);
    assert.equal((await h.webhook()).code, 200);
    assert.equal(h.order().paymentStatus, 'paid');
    assert.equal(h.effects.calls.length, 0);
    assert.equal((await h.webhook()).body.alreadyProcessed, true);
  });

  it('even a correctly signed webhook cannot mislabel an uncaptured payment as captured', async t => {
    const h = harness(t);
    const response = await h.webhook({ status: 'authorized', captured: false });
    assert.equal(response.body.status, 'TERMINAL_REJECTED');
    assert.equal(h.order().paymentStatus, 'pending');
    assert.equal([...h.docs.keys()].filter(path => path.startsWith('financialTransactions/')).length, 0);
  });

  it('cancelled/expired payments remain orphaned and post suspense exactly once', async t => {
    for (const status of ['cancelled', 'expired']) {
      const h = harness(t, { order: { status, paymentStatus: status }, retryCallbacks: true });
      assert.equal((await h.finalize({ source: 'webhook', actorId: 'system_webhook' })).orphaned, true);
      const replay = await h.finalize({ source: 'webhook', actorId: 'system_webhook' });
      assert.equal(replay.orphaned, true);
      assert.equal(replay.alreadyCaptured, true);
      assert.equal(h.order().status, status);
      assert.equal([...h.docs.keys()].filter(path => path.startsWith('financialTransactions/')).length, 1);
      assert.equal(h.effects.inventory, 0);
    }
  });

  it('counter-cash finalization remains idempotent without an online gateway binding', async t => {
    const h = harness(t, { order: { paymentMethod: 'counter_cash', gatewayOrderId: undefined } });
    const data = { source: 'cashier_counter', actorId: 'cashier', gatewayOrderId: `cash_ord_${orderId}`, gatewayPaymentId: 'cash_pay_security' };
    assert.equal((await h.finalize(data)).alreadyCaptured, false);
    assert.equal((await h.finalize(data)).alreadyCaptured, true);
    assert.equal(h.docs.has(`financialTransactions/cash_fin_${orderId}`), true);
  });

  it('concurrent cash callable retries use one deterministic payment identity', async t => {
    const h = harness(t, { order: { paymentMethod: 'counter_cash', gatewayOrderId: undefined } });
    const results = await Promise.all([h.cash({ idempotencyKey: 'first' }), h.cash({ idempotencyKey: 'second' })]);
    assert.ok(results.every(result => result.success));
    assert.equal([...h.docs.keys()].filter(path => path.startsWith('financialTransactions/')).length, 1);
    assert.equal([...h.docs.keys()].filter(path => path.startsWith('payments/')).length, 1);
    assert.equal(h.effects.calls.length, 0);
  });

  it('a projection failure cannot turn committed payment into an error response', async t => {
    const h = harness(t, { rejectProjection: true });
    assert.equal((await h.verify()).success, true);
    assert.equal(h.order().paymentStatus, 'paid');
    assert.ok(h.effects.security.some(event => event.eventType === 'PAYMENT_PROJECTION_SYNC_FAILED'));
    assert.ok(!JSON.stringify(h.effects.security).includes('sensitive provider response'));
  });
});
