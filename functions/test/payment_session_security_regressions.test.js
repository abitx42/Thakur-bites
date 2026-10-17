'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const { Timestamp } = require('firebase-admin/firestore');

const orderId = 'session-security-order';
const owner = 'session-security-customer';
const gatewayOrderId = 'order_SessionSecurity01';
const amountPaise = 10000;
const fixtureKeyId = `rzp_test_${crypto.randomBytes(8).toString('hex')}`;
const fixtureSecret = crypto.randomBytes(32).toString('hex');
const originalFetch = globalThis.fetch;

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object' && !(value instanceof Timestamp)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function checkpoint(predicate) {
  for (let i = 0; i < 30 && !predicate(); i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'Expected asynchronous checkpoint was not reached');
}

function harness(t, options = {}) {
  const expiresAt = Timestamp.fromMillis(Date.now() + 900000);
  const docs = new Map([
    [`orders/${orderId}`, { id: orderId, studentId: owner, tokenNumber: 'TB-503', status: 'payment_pending',
      paymentStatus: 'pending', paymentMethod: 'online', totalAmountPaise: amountPaise, currency: 'INR',
      reservationExpiresAt: expiresAt, ...options.order }],
    [`inventoryReservations/${orderId}`, { reservationId: orderId, orderId, studentId: owner,
      status: 'RESERVED', expiresAt, ...options.reservation }],
    [`users/${owner}`, { accountDisabled: false, ...options.user }],
  ]);
  if (options.missingReservation) docs.delete(`inventoryReservations/${orderId}`);
  const effects = { calls: [], writes: [], logs: [], requestedSecrets: [], authMatches: [] };
  let sequence = Promise.resolve();
  const snapshot = ref => ({ id: ref.id, exists: docs.has(ref.path), data: () => clone(docs.get(ref.path)) });
  const db = {
    collection(name) {
      return { doc(id) {
        assert.ok(typeof id === 'string' && id && !id.includes('/'), 'Invalid Firestore document ID');
        const ref = { id, path: `${name}/${id}` };
        ref.get = async () => snapshot(ref);
        ref.update = async data => db.runTransaction(async transaction => {
          await transaction.get(ref);
          transaction.update(ref, data);
        });
        return ref;
      } };
    },
    runTransaction(callback) {
      const run = sequence.then(async () => {
        let writes = [];
        let writing = false;
        const transaction = {
          async get(ref) { assert.equal(writing, false, 'Firestore read after write'); return snapshot(ref); },
          update(ref, data) { writing = true; writes.push({ path: ref.path, data: clone(data), merge: true }); },
          set(ref, data, setOptions) { writing = true; writes.push({ path: ref.path, data: clone(data), merge: !!setOptions?.merge }); },
        };
        let result = await callback(transaction);
        if (options.retryCallbacks) {
          writes = [];
          writing = false;
          result = await callback(transaction);
        }
        if (options.beforeCommit) options.beforeCommit(writes, docs);
        const committed = new Map(docs);
        for (const write of writes) {
          assert.ok(committed.has(write.path));
          committed.set(write.path, write.merge ? { ...committed.get(write.path), ...write.data } : write.data);
        }
        docs.clear();
        for (const [path, data] of committed) docs.set(path, data);
        effects.writes.push(...writes);
        if (options.afterCommit) options.afterCommit(writes, docs);
        return result;
      });
      sequence = run.catch(() => {});
      return run;
    },
  };
  const target = require.resolve('../lib/payments');
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === target) {
      if (request === 'firebase-admin') return { firestore: () => db };
      const stubs = {
        './secrets': { getRequiredSecret(name) {
          effects.requestedSecrets.push(name);
          if (options.missingSecret === name) throw new Error('private-config-error-must-not-leak');
          if (name === 'PAYMENT_GATEWAY_KEY_ID') return options.keyId || fixtureKeyId;
          if (name === 'PAYMENT_GATEWAY_SECRET') return fixtureSecret;
          throw new Error(`Unexpected configuration request: ${name}`);
        } },
        './env_config': { isProduction: () => options.production !== false, isSimulationAllowed: () => options.simulation === true },
        './app_check': { enforceAppCheck() {} }, './version_policy': { async enforceAppVersionPolicy() {} },
        './rate_limiter': { async enforceRateLimit() {} }, './kill_switch': { async assertOperationalMode() {} },
        './shift_pins': {}, './inventory_reservation': {}, './payment_finalize': {}, './security_responses': {},
        './honeypot_defense': { inspectPayloadForHoneytokens: () => ({ hasHoneytoken: false }) },
        './security_logger': { async logSecurityEvent(event) { effects.logs.push(clone(event)); } },
      };
      if (Object.hasOwn(stubs, request)) return stubs[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let handler;
  try {
    delete require.cache[target];
    handler = require(target).createPaymentSession;
  } finally {
    Module._load = originalLoad;
    delete require.cache[target];
  }
  globalThis.fetch = async (url, request) => {
    assert.equal(url, 'https://api.razorpay.com/v1/orders');
    const body = JSON.parse(request.body);
    effects.calls.push({ url, method: request.method, body });
    effects.authMatches.push(request.headers.Authorization === `Basic ${Buffer.from(`${options.keyId || fixtureKeyId}:${fixtureSecret}`).toString('base64')}`);
    const outcome = options.gateway ? await options.gateway(docs, body) : {};
    if (outcome?.error) throw outcome.error;
    return { ok: outcome?.httpStatus === undefined || outcome.httpStatus < 400, status: outcome?.httpStatus || 200,
      async json() {
        if (outcome?.malformedJson) throw new Error('private-malformed-provider-response');
        return outcome && Object.hasOwn(outcome, 'json') ? outcome.json : {
          id: gatewayOrderId, amount: body.amount, currency: body.currency, status: 'created', receipt: body.receipt,
          ...options.response,
        };
      },
      async text() { return 'private-provider-body-must-not-leak'; },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return {
    options, docs, effects,
    order: () => docs.get(`orders/${orderId}`),
    reservation: () => docs.get(`inventoryReservations/${orderId}`),
    create(input = {}, uid = owner, token = { email_verified: true }) {
      return handler.run({ data: { orderId, ...input }, auth: { uid, token } });
    },
    raw(data) { return handler.run({ data, auth: { uid: owner, token: { email_verified: true } } }); },
  };
}

function rejected(error) {
  assert.equal(error.code, 'failed-precondition');
  assert.ok(!/private-|rzp_test_|Basic /.test(error.message));
  return true;
}

describe('Payment session exported-handler security regressions (offline atomic claims and gateway fixtures)', () => {
  it('uses canonical required configuration and publishes only a validated real gateway binding', async t => {
    const h = harness(t, { retryCallbacks: true });
    const response = await h.create();
    assert.equal(response.gatewayOrderId, gatewayOrderId);
    assert.equal(response.razorpayOrderId, gatewayOrderId);
    assert.equal(response.amountPaise, amountPaise);
    assert.equal(response.keyId, fixtureKeyId);
    assert.equal(response.adapterMode, 'PRODUCTION_GATEWAY');
    assert.deepEqual(h.effects.requestedSecrets, ['PAYMENT_GATEWAY_KEY_ID', 'PAYMENT_GATEWAY_SECRET']);
    assert.deepEqual(h.effects.authMatches, [true]);
    assert.equal(h.effects.calls.length, 1);
    assert.equal(h.effects.calls[0].body.amount, amountPaise);
    assert.equal(h.effects.calls[0].body.currency, 'INR');
    assert.equal(h.effects.calls[0].body.notes.orderId, orderId);
    assert.equal(h.order().paymentSession.state, 'CREATED');
    assert.equal(h.order().gatewayOrderId, gatewayOrderId);
    assert.equal(h.order().status, 'payment_pending');
  });

  it('non-OK, timeout and malformed responses never return a successful session or permit a second gateway call', async t => {
    for (const outcome of [{ httpStatus: 400 }, { httpStatus: 503 }, { error: new Error('private-network-timeout') },
      { malformedJson: true }, { json: null }, { json: [] }]) {
      const h = harness(t, { gateway: async () => outcome });
      await assert.rejects(h.create(), rejected);
      assert.equal(h.order().gatewayOrderId, undefined);
      assert.equal(h.order().status, 'payment_pending');
      assert.equal(h.order().paymentSession.state, 'OUTCOME_UNKNOWN');
      h.order().paymentSession.claimedAt = Timestamp.fromMillis(1);
      await assert.rejects(h.create(), rejected);
      assert.equal(h.effects.calls.length, 1);
      assert.ok(!/private-|Basic /.test(JSON.stringify(h.effects.logs)));
      assert.ok(!JSON.stringify(h.effects.logs).includes(fixtureSecret));
    }
  });

  it('rejects missing canonical key or secret before writing a claim or contacting the gateway', async t => {
    for (const missingSecret of ['PAYMENT_GATEWAY_KEY_ID', 'PAYMENT_GATEWAY_SECRET']) {
      const h = harness(t, { missingSecret });
      await assert.rejects(h.create(), rejected);
      assert.equal(h.effects.calls.length, 0);
      assert.equal(h.effects.writes.length, 0);
      assert.equal(h.order().paymentSession, undefined);
    }
  });

  it('bounds order IDs and payload types before database writes or gateway calls', async t => {
    for (const input of [{ orderId: 1 }, { orderId: {} }, { orderId: '' }, { orderId: 'nested/path' },
      { orderId: 'x'.repeat(129) }, { orderId: '.' }, { orderId: '..' }]) {
      const h = harness(t);
      await assert.rejects(h.create(input), error => error.code === 'invalid-argument');
      assert.equal(h.effects.calls.length, 0);
      assert.equal(h.effects.writes.length, 0);
    }
    for (const payload of [null, [], 'payload', 42]) {
      const h = harness(t);
      await assert.rejects(h.raw(payload), error => error.code === 'invalid-argument');
    }
  });

  it('rejects unowned, disabled and unverified accounts without creating a session', async t => {
    const unowned = harness(t);
    await assert.rejects(unowned.create({}, 'another-customer'), error => error.code === 'permission-denied');
    assert.equal(unowned.effects.calls.length, 0);
    const disabled = harness(t, { user: { accountDisabled: true } });
    await assert.rejects(disabled.create(), error => error.code === 'permission-denied');
    const unverified = harness(t);
    await assert.rejects(unverified.create({}, owner, { email_verified: false }), error => error.code === 'permission-denied');
    assert.equal(unverified.effects.calls.length, 0);
  });

  it('never resurrects terminal/paid orders or creates sessions for other payment flows', async t => {
    for (const order of [{ status: 'cancelled' }, { status: 'expired' }, { status: 'collected' }, { status: 'confirmed' },
      { paymentStatus: 'paid' }, { paymentStatus: 'captured' }, { paymentStatus: 'refunded' }, { paymentStatus: 'partially_refunded' },
      { paymentMethod: 'counter_cash' }, { paymentMethod: undefined }, { isCancellationPending: true }, { gatewayPaymentId: 'pay_already_recorded' }]) {
      const h = harness(t, { order });
      const before = clone(h.order());
      await assert.rejects(h.create());
      assert.deepEqual(h.order(), before);
      assert.equal(h.effects.calls.length, 0);
    }
  });

  it('requires authoritative positive integer paise and supported currency', async t => {
    for (const order of [{ totalAmountPaise: 0 }, { totalAmountPaise: -1 }, { totalAmountPaise: '10000' },
      { totalAmountPaise: 1.5 }, { totalAmountPaise: undefined, totalAmount: 100 }, { totalAmountPaise: Number.MAX_SAFE_INTEGER + 1 },
      { currency: 'USD' }, { currency: undefined }]) {
      const h = harness(t, { order });
      await assert.rejects(h.create(), rejected);
      assert.equal(h.effects.calls.length, 0);
      assert.equal(h.effects.writes.length, 0);
    }
  });

  it('requires a matching unexpired inventory reservation and order reservation expiry', async t => {
    for (const options of [{ missingReservation: true }, { reservation: { status: 'RELEASED' } },
      { reservation: { status: 'COMMITTED' } }, { reservation: { studentId: 'another-customer' } },
      { reservation: { orderId: 'another-order' } }, { reservation: { expiresAt: Timestamp.fromMillis(1) } },
      { reservation: { expiresAt: undefined } }, { order: { reservationExpiresAt: Timestamp.fromMillis(1) } },
      { order: { reservationExpiresAt: undefined } }]) {
      const h = harness(t, options);
      await assert.rejects(h.create(), rejected);
      assert.equal(h.effects.calls.length, 0);
      assert.equal(h.effects.writes.length, 0);
    }
  });

  it('validates response ID, exact amount and currency and rejects contradictory provider metadata', async t => {
    for (const response of [{ id: undefined }, { id: 'nested/order' }, { id: 'order_' + 'x'.repeat(60) },
      { id: 'sim_order_fabricated' }, { amount: 1 }, { amount: '10000' }, { currency: 'USD' },
      { currency: undefined }, { status: 'paid' }, { receipt: 'another-receipt' }]) {
      const h = harness(t, { response });
      await assert.rejects(h.create(), rejected);
      assert.equal(h.order().gatewayOrderId, undefined);
      assert.equal(h.effects.calls.length, 1);
      await assert.rejects(h.create(), rejected);
      assert.equal(h.effects.calls.length, 1);
    }
  });

  it('concurrent workers share one creation claim and perform at most one remote request', async t => {
    const gate = deferred();
    const h = harness(t, { retryCallbacks: true, gateway: () => gate.promise });
    const first = h.create();
    await checkpoint(() => h.effects.calls.length === 1);
    assert.equal(h.order().gatewayOrderId, undefined, 'No placeholder may be published during remote work');
    const nonce = h.order().paymentSession.nonce;
    h.order().paymentSession.claimedAt = Timestamp.fromMillis(1);
    await assert.rejects(h.create(), rejected);
    assert.equal(h.order().paymentSession.nonce, nonce);
    assert.equal(h.effects.calls.length, 1);
    gate.resolve({});
    assert.equal((await first).gatewayOrderId, gatewayOrderId);
    assert.equal((await h.create()).gatewayOrderId, gatewayOrderId);
    assert.equal(h.effects.calls.length, 1);
  });

  it('reuses a fully created immutable binding without any additional gateway work', async t => {
    const h = harness(t);
    const first = await h.create();
    const binding = clone(h.order().paymentSession);
    assert.deepEqual(await h.create(), first);
    assert.deepEqual(h.order().paymentSession, binding);
    assert.equal(h.effects.calls.length, 1);
  });

  it('cannot reuse or overwrite unproven legacy bindings, including checkout placeholders', async t => {
    for (const existing of ['order_0123456789abcdef', gatewayOrderId]) {
      const h = harness(t, { order: { gatewayOrderId: existing } });
      await assert.rejects(h.create(), rejected);
      assert.equal(h.order().gatewayOrderId, existing);
      assert.equal(h.order().paymentSession, undefined);
      assert.equal(h.effects.calls.length, 0);
    }
  });

  it('rechecks claim nonce, ownership, eligibility and reservation before storing the gateway response', async t => {
    for (const mutate of [
      h => { h.order().status = 'cancelled'; }, h => { h.order().studentId = 'another-customer'; },
      h => { h.order().totalAmountPaise = 1; }, h => { h.order().paymentStatus = 'paid'; },
      h => { h.order().paymentSession.nonce = 'b'.repeat(32); }, h => { h.order().gatewayOrderId = 'order_AnotherBinding'; },
      h => { h.reservation().status = 'RELEASED'; }, h => { h.reservation().expiresAt = Timestamp.fromMillis(1); },
      h => { h.docs.get(`users/${owner}`).accountDisabled = true; },
    ]) {
      let h;
      h = harness(t, { gateway: async () => { mutate(h); return {}; } });
      await assert.rejects(h.create(), rejected);
      assert.notEqual(h.order().gatewayOrderId, gatewayOrderId);
      assert.equal(h.effects.calls.length, 1);
      assert.notEqual(h.order().paymentSession.state, 'CREATED');
    }
  });

  it('a failed claim commit performs no remote work and an uncertain claim acknowledgement is not reclaimed', async t => {
    const before = harness(t, { beforeCommit(writes) { if (writes.length) throw new Error('private-claim-database-error'); } });
    await assert.rejects(before.create(), rejected);
    assert.equal(before.order().paymentSession, undefined);
    assert.equal(before.effects.calls.length, 0);
    let fail = true;
    const after = harness(t, { afterCommit(writes) {
      if (fail && writes.some(write => write.data.paymentSession?.state === 'CREATING')) {
        fail = false;
        throw new Error('private-claim-acknowledgement-lost');
      }
    } });
    await assert.rejects(after.create(), rejected);
    await assert.rejects(after.create(), rejected);
    assert.equal(after.effects.calls.length, 0);
    assert.equal(after.order().paymentSession.state, 'CREATING');
  });

  it('gateway success followed by a failed binding commit is held for reconciliation without a second gateway order', async t => {
    let fail = true;
    const h = harness(t, { beforeCommit(writes) {
      if (fail && writes.some(write => write.data.paymentSession?.state === 'CREATED')) {
        fail = false;
        throw new Error('private-binding-persistence-failure');
      }
    } });
    await assert.rejects(h.create(), rejected);
    assert.equal(h.order().gatewayOrderId, undefined);
    assert.equal(h.order().paymentSession.state, 'OUTCOME_UNKNOWN');
    await assert.rejects(h.create(), rejected);
    assert.equal(h.effects.calls.length, 1);
  });

  it('a lost binding acknowledgement confirms/reuses the committed binding without another gateway call', async t => {
    let fail = true;
    const h = harness(t, { afterCommit(writes) {
      if (fail && writes.some(write => write.data.paymentSession?.state === 'CREATED')) {
        fail = false;
        throw new Error('private-binding-acknowledgement-lost');
      }
    } });
    assert.equal((await h.create()).gatewayOrderId, gatewayOrderId);
    assert.equal((await h.create()).gatewayOrderId, gatewayOrderId);
    assert.equal(h.order().paymentSession.state, 'CREATED');
    assert.equal(h.effects.calls.length, 1);
  });

  it('changed completed-session metadata or a changed gateway account cannot cause a new creation', async t => {
    for (const mutate of [h => { h.order().paymentSession.amountPaise = 1; },
      h => { h.order().gatewayOrderId = 'order_AnotherBinding'; },
      h => { h.options.keyId = 'rzp_test_other_account'; }]) {
      const h = harness(t);
      await h.create();
      mutate(h);
      await assert.rejects(h.create(), rejected);
      assert.equal(h.effects.calls.length, 1);
    }
  });

  it('supports only explicit isolated simulation and never simulates in production or K_SERVICE', async t => {
    const previousService = process.env.K_SERVICE;
    delete process.env.K_SERVICE;
    t.after(() => {
      if (previousService === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = previousService;
    });
    const simulation = harness(t, { production: false, simulation: true });
    const response = await simulation.create();
    assert.equal(response.adapterMode, 'SIMULATION_ADAPTER');
    assert.match(response.gatewayOrderId, /^sim_order_/);
    assert.equal(simulation.effects.calls.length, 0);
    const production = harness(t, { production: true, simulation: true });
    assert.equal((await production.create()).adapterMode, 'PRODUCTION_GATEWAY');
    assert.equal(production.effects.calls.length, 1);
    process.env.K_SERVICE = 'payment-session-runtime';
    const cloud = harness(t, { production: false, simulation: true });
    assert.equal((await cloud.create()).adapterMode, 'PRODUCTION_GATEWAY');
    assert.equal(cloud.effects.calls.length, 1);
  });
});
