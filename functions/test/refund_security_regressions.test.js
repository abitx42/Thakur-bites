'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const { Timestamp } = require('firebase-admin/firestore');
const https = require('firebase-functions/v2/https');

const orderId = 'refund-security-order';
const actorId = 'refund-security-manager';
const gatewayPaymentId = 'pay_refund_security';
const requestKey = 'refund-security-request';
const originalFetch = globalThis.fetch;
const fixtureSecret = crypto.randomBytes(32).toString('hex');

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

async function drainUntil(predicate) {
  for (let i = 0; i < 30 && !predicate(); i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'Expected asynchronous checkpoint was not reached');
}

function harness(t, options = {}) {
  const docs = new Map([[`orders/${orderId}`, {
    studentId: 'refund-security-customer', tokenNumber: 'TB-502', status: 'confirmed', paymentStatus: 'paid',
    paymentMethod: 'online', amountPaidPaise: 10000, amountRefundedPaise: 0, pendingRefundPaise: 0,
    amountRefundablePaise: 10000, currency: 'INR', gatewayPaymentId, gatewayOrderId: 'order_refund_security',
    ...options.order,
  }]]);
  for (const [path, data] of Object.entries(options.documents || {})) docs.set(path, clone(data));
  const effects = { calls: [], writes: [], security: [], projections: 0 };
  let nextDoc = 0;
  let sequence = Promise.resolve();
  const snapshot = ref => ({ id: ref.id, exists: docs.has(ref.path), data: () => clone(docs.get(ref.path)) });
  const db = {
    collection(name) {
      return { doc(id = `generated-${++nextDoc}`) {
        assert.ok(typeof id === 'string' && id && !id.includes('/'), 'Invalid Firestore document ID');
        const ref = { id, path: `${name}/${id}` };
        ref.get = async () => snapshot(ref);
        ref.update = async data => db.runTransaction(async transaction => {
          await transaction.get(ref);
          transaction.update(ref, data);
        });
        ref.set = async (data, opts) => db.runTransaction(async transaction => transaction.set(ref, data, opts));
        return ref;
      } };
    },
    runTransaction(callback) {
      const work = sequence.then(async () => {
        let pending = [];
        let writing = false;
        const transaction = {
          async get(ref) { assert.equal(writing, false, 'Firestore read after write'); return snapshot(ref); },
          update(ref, data) { writing = true; pending.push({ path: ref.path, data: clone(data), merge: true, update: true }); },
          set(ref, data, opts) { writing = true; pending.push({ path: ref.path, data: clone(data), merge: !!opts?.merge }); },
          delete(ref) { writing = true; pending.push({ path: ref.path, remove: true }); },
        };
        let result = await callback(transaction);
        if (options.retryCallbacks) {
          pending = [];
          writing = false;
          result = await callback(transaction);
        }
        if (options.beforeCommit) options.beforeCommit(pending, docs);
        const committed = new Map(docs);
        for (const write of pending) {
          if (write.remove) committed.delete(write.path);
          else {
            if (write.update) assert.ok(committed.has(write.path));
            const previous = committed.get(write.path) || {};
            const data = clone(write.data);
            for (const [field, value] of Object.entries(data)) {
              if (value && value.increment !== undefined) data[field] = (previous[field] || 0) + value.increment;
            }
            committed.set(write.path, write.merge ? { ...previous, ...data } : data);
          }
        }
        docs.clear();
        for (const [path, data] of committed) docs.set(path, data);
        effects.writes.push(...pending);
        if (options.afterCommit) options.afterCommit(pending, docs);
        return result;
      });
      sequence = work.catch(() => {});
      return work;
    },
  };
  const now = Math.floor(Date.now() / 1000);
  const shiftDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const revokedUid = 'staff_cashier_refund_security';
  if (options.revokedSession) docs.set(`workstationSessions/${revokedUid}`, { status: 'REVOKED' });
  const targets = [require.resolve('../lib/refunds'), require.resolve('../lib/payments'), require.resolve('../lib/shift_pins'),
    require.resolve('../lib/staff_authority')];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (targets.includes(parent?.filename)) {
      if (request === 'firebase-admin') return { apps: [{}], firestore: () => db, auth: () => ({ async getUser(uid) {
        return { uid, disabled: false, customClaims: uid === actorId ? { role: 'manager' } : {} };
      } }) };
      if (request === 'firebase-admin/firestore') return { Timestamp, FieldValue: { increment: value => ({ increment: value }) } };
      const stubs = {
        './secrets': { getRequiredSecret: () => fixtureSecret },
        './env_config': { isProduction: () => true, isSimulationAllowed: () => false },
        './app_check': { enforceAppCheck() {} }, './version_policy': { async enforceAppVersionPolicy() {} },
        './rate_limiter': { async enforceRateLimit() {} }, './kill_switch': { async assertOperationalMode() {} },
        './honeypot_defense': { async assertNoHoneytokens() {} },
        './security_logger': { async logSecurityEvent(event) { effects.security.push(clone(event)); } },
        './payment_finalize': { async finalizeSuccessfulPayment() { throw new Error('Unexpected payment finalization'); } },
        './inventory_reservation': {}, './security_responses': {}, './workstation_binding': {},
        './privileged_guard': { normalizeTimestampToMillis: value => value?.toMillis?.() || (typeof value === 'string' ? Date.parse(value) || 0 : 0) },
        './tv_projection': { async updatePublicLiveQueueProjection() { effects.projections += 1; if (options.rejectProjection) throw new Error('private gateway response'); } },
      };
      if (Object.hasOwn(stubs, request)) return stubs[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let handlers;
  try {
    for (const target of targets) delete require.cache[target];
    handlers = require(targets[0]);
  } finally {
    Module._load = originalLoad;
    for (const target of targets) delete require.cache[target];
  }
  globalThis.fetch = async (url, request) => {
    const body = JSON.parse(request.body);
    const index = effects.calls.length + 1;
    effects.calls.push({ url, method: request.method, body, key: request.headers['X-Razorpay-Idempotency-Key'] });
    const defaultBody = { id: `rfnd_security_${index}`, payment_id: gatewayPaymentId, amount: body.amount, currency: 'INR', status: 'processed' };
    const response = options.gateway ? await options.gateway({ index, body, defaultBody, docs }) : {};
    if (response?.error) throw response.error;
    return { ok: response?.httpStatus === undefined || response.httpStatus < 400, status: response?.httpStatus || 200,
      async json() { return { ...defaultBody, ...options.response, ...response?.body }; }, async text() { return 'provider rejected'; } };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const defaults = { orderId, reason: 'Customer requested refund', amountPaise: 3000, actorId, actorRole: 'manager', idempotencyKey: requestKey };
  return {
    docs, db, effects,
    execute(input = {}) { return handlers.reserveAndExecuteRefund({ ...defaults, ...input }); },
    call(input = {}, auth) {
      return handlers.processOrderRefund.run({ data: { orderId, reason: defaults.reason, amountPaise: 3000, idempotencyKey: requestKey, ...input },
        auth: auth || { uid: actorId, token: { uid: actorId, sub: actorId, role: 'manager', auth_time: now, iat: now } } });
    },
    revoked() {
      return handlers.processOrderRefund.run({ data: { orderId, reason: defaults.reason, amountPaise: 3000, idempotencyKey: requestKey },
        auth: { uid: revokedUid, token: { role: 'cashier', isWorkstationSession: true, deviceId: 'refund_security_device',
          sessionGeneration: 'a'.repeat(32), pinId: `cashier_${shiftDate}_FULL_DAY`, shiftDate, shiftWindow: 'FULL_DAY', auth_time: now, iat: now } } });
    },
    order: () => docs.get(`orders/${orderId}`),
    idempotency: () => docs.get(`refundIdempotency/${requestKey}`),
    reservations: () => [...docs].filter(([path]) => path.startsWith('refundReservations/')).map(([, data]) => data),
    ledgers: () => [...docs].filter(([path]) => path.startsWith('financialTransactions/')).map(([, data]) => data),
  };
}

describe('Refund real-handler security regressions (offline gateway, retry/rollback-aware transactions)', () => {
  it('the actual workstation guard rejects a revoked shift session before refund work', async t => {
    const h = harness(t, { revokedSession: true });
    await assert.rejects(h.revoked(), error => error.code === 'unauthenticated');
    assert.equal(h.effects.calls.length, 0);
    assert.equal(h.reservations().length, 0);
    assert.equal(h.order().pendingRefundPaise, 0);
  });

  it('strict keys, bounded identifiers and integer amounts are never coerced or truncated', async t => {
    for (const input of [{ idempotencyKey: 'x'.repeat(129) }, { idempotencyKey: ' key' }, { idempotencyKey: 'nested/key' },
      { idempotencyKey: 12 }, { idempotencyKey: null }, { idempotencyKey: '' }, { orderId: 'nested/order' },
      { orderId: {} }, { amountPaise: '3000' }, { amountPaise: -1 }, { amountPaise: 1.5 }]) {
      const h = harness(t);
      await assert.rejects(h.execute(input), error => error.code === 'invalid-argument');
      assert.equal(h.effects.calls.length, 0);
      assert.equal(h.reservations().length, 0);
    }
  });

  it('a settled key is immutably bound to order, actor, amount, reason and cancellation mode', async t => {
    const h = harness(t);
    await h.execute();
    h.docs.set('orders/another-order', { ...h.order(), status: 'confirmed' });
    for (const input of [{ orderId: 'another-order' }, { actorId: 'another-manager' }, { amountPaise: 2000 },
      { amountPaise: undefined }, { reason: 'Changed request' }, { cancellation: true }]) {
      await assert.rejects(h.execute(input), error => error.code === 'failed-precondition');
    }
    assert.equal(h.effects.calls.length, 1);
    assert.equal(h.order().amountRefundedPaise, 3000);
  });

  it('successful settlement and replay post exactly one reservation, gateway ledger and audit event', async t => {
    const h = harness(t, { retryCallbacks: true });
    const result = await h.execute();
    assert.deepEqual(await h.execute(), result);
    assert.equal(h.effects.calls.length, 1);
    assert.equal(h.reservations().length, 1);
    assert.equal(h.reservations()[0].status, 'FINALIZED');
    assert.equal(h.idempotency().status, 'SETTLED');
    assert.equal(h.ledgers().length, 1);
    assert.equal(h.order().amountRefundedPaise, 3000);
    assert.equal(h.order().pendingRefundPaise, 0);
    assert.equal([...h.docs.keys()].filter(path => path.startsWith('orderEvents/')).length, 1);
    assert.equal(h.effects.calls[0].method, 'POST');
    assert.ok(h.effects.calls[0].url.endsWith('/refund'));
    assert.equal(h.effects.calls[0].key, h.reservations()[0].gatewayKey);
  });

  it('requests without a caller key still reuse one recorded reservation/result', async t => {
    const h = harness(t);
    const first = await h.execute({ idempotencyKey: undefined });
    assert.deepEqual(await h.execute({ idempotencyKey: undefined }), first);
    assert.equal(h.effects.calls.length, 1);
    assert.equal(h.order().amountRefundedPaise, 3000);
  });

  it('expired in-flight claims are refused instead of creating another reservation or gateway call', async t => {
    const gate = deferred();
    const h = harness(t, { gateway: () => gate.promise });
    const first = h.execute();
    await drainUntil(() => h.effects.calls.length === 1);
    h.idempotency().claimedAt = Timestamp.fromMillis(Date.now() - 120000);
    await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
    assert.equal(h.reservations().length, 1);
    assert.equal(h.order().pendingRefundPaise, 3000);
    gate.resolve({});
    const result = await first;
    assert.deepEqual(await h.execute(), result);
    assert.equal(h.effects.calls.length, 1);
  });

  it('unbound legacy PROCESSING or settled records fail closed rather than being reclaimed', async t => {
    for (const status of ['PROCESSING', 'SETTLED', 'partially_refunded']) {
      const h = harness(t, { documents: { [`refundIdempotency/${requestKey}`]: {
        orderId, actorUid: actorId, status, claimedAt: Timestamp.fromMillis(1), refundedPaise: 3000,
      } } });
      await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
      assert.equal(h.effects.calls.length, 0);
      assert.equal(h.reservations().length, 0);
    }
  });

  it('timeouts and server errors retain pending funds and require reconciliation', async t => {
    for (const response of [{ error: new Error('network timeout') }, { httpStatus: 500 }]) {
      const h = harness(t, { gateway: async () => response });
      await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
      assert.equal(h.order().pendingRefundPaise, 3000);
      assert.equal(h.order().amountRefundedPaise, 0);
      assert.equal(h.reservations()[0].status, 'OUTCOME_UNKNOWN');
      h.idempotency().claimedAt = Timestamp.fromMillis(1);
      await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
      await assert.rejects(h.execute({ idempotencyKey: 'new-key', amountPaise: 3000 }));
      assert.equal(h.effects.calls.length, 1);
    }
  });

  it('confirmed gateway rejection releases only its reservation and makes the key terminal', async t => {
    const h = harness(t, { gateway: async () => ({ httpStatus: 400 }) });
    await assert.rejects(h.execute(), /rejected this refund/);
    assert.equal(h.order().pendingRefundPaise, 0);
    assert.equal(h.order().amountRefundedPaise, 0);
    assert.equal(h.reservations()[0].status, 'GATEWAY_FAILED');
    await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
    assert.equal(h.effects.calls.length, 1);
  });

  it('gateway success followed by checkpoint failure never releases funds or retries the gateway', async t => {
    let fail = true;
    const h = harness(t, { beforeCommit(writes) {
      if (fail && writes.some(write => write.path.startsWith('refundReservations/') && write.data?.status === 'GATEWAY_SUCCEEDED')) {
        fail = false;
        throw new Error('checkpoint persistence failed');
      }
    } });
    await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
    assert.equal(h.order().pendingRefundPaise, 3000);
    assert.equal(h.order().amountRefundedPaise, 0);
    assert.equal(h.reservations()[0].status, 'GATEWAY_IN_FLIGHT');
    await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
    await assert.rejects(h.execute({ idempotencyKey: 'new-ui-retry-key' }), error => error.code === 'failed-precondition');
    assert.equal(h.effects.calls.length, 1);
    // Model trusted operator reconciliation of the provider's recorded success.
    Object.assign(h.reservations()[0], { status: 'GATEWAY_SUCCEEDED', gatewayRefundId: 'rfnd_security_1', gatewayResponseStatus: 'processed',
      gatewayResponseAmountPaise: 3000, gatewayResponseCurrency: 'INR', gatewayResponsePaymentId: gatewayPaymentId });
    const recovered = await h.execute();
    assert.equal(recovered.refundedPaise, 3000);
    assert.equal(h.order().pendingRefundPaise, 0);
    assert.equal(h.effects.calls.length, 1);
  });

  it('a persisted gateway success resumes settlement after a rolled-back commit without another refund', async t => {
    let fail = true;
    const h = harness(t, { beforeCommit(writes) {
      if (fail && writes.some(write => write.path.startsWith('financialTransactions/'))) {
        fail = false;
        throw new Error('settlement commit failed');
      }
    } });
    await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
    assert.equal(h.reservations()[0].status, 'GATEWAY_SUCCEEDED');
    assert.equal(h.order().pendingRefundPaise, 3000);
    assert.equal(h.ledgers().length, 0);
    const result = await h.execute();
    assert.equal(result.totalRefundedPaise, 3000);
    assert.equal(h.ledgers().length, 1);
    assert.equal(h.effects.calls.length, 1);
  });

  it('a lost settlement acknowledgement replays the recorded result without incrementing funds again', async t => {
    let fail = true;
    const h = harness(t, { afterCommit(writes) {
      if (fail && writes.some(write => write.path.startsWith('financialTransactions/'))) {
        fail = false;
        throw new Error('settlement acknowledgement lost');
      }
    } });
    await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
    assert.equal(h.order().amountRefundedPaise, 3000);
    assert.equal(h.reservations()[0].status, 'FINALIZED');
    assert.equal((await h.execute()).totalRefundedPaise, 3000);
    assert.equal(h.order().amountRefundedPaise, 3000);
    assert.equal(h.ledgers().length, 1);
    assert.equal(h.effects.calls.length, 1);
  });

  it('gateway refund ID reuse cannot overwrite another reservation ledger or increment settled funds', async t => {
    const h = harness(t, { response: { id: 'rfnd_same_provider_id' } });
    await h.execute();
    await assert.rejects(h.execute({ idempotencyKey: 'another-key' }), error => error.code === 'failed-precondition');
    assert.equal(h.order().amountRefundedPaise, 3000);
    assert.equal(h.order().pendingRefundPaise, 3000);
    assert.equal(h.ledgers().length, 1);
    assert.equal(h.effects.calls.length, 2);
    await assert.rejects(h.execute({ idempotencyKey: 'another-key' }));
    assert.equal(h.effects.calls.length, 2);
  });

  it('settled replays recheck the ledger, reservation and recorded result', async t => {
    for (const corrupt of [
      h => { h.ledgers()[0].amountPaise = 1; },
      h => { h.reservations()[0].requestedRefundPaise = 1; },
      h => { h.idempotency().result.refundId = 'rfnd_fake'; },
    ]) {
      const h = harness(t);
      await h.execute();
      corrupt(h);
      await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
      assert.equal(h.order().amountRefundedPaise, 3000);
      assert.equal(h.effects.calls.length, 1);
    }
  });

  it('settlement refuses changed reservation amounts or missing pending funds after gateway success', async t => {
    for (const corrupt of [
      docs => {
        const reservation = [...docs].find(([path]) => path.startsWith('refundReservations/'))[1];
        reservation.requestedRefundPaise = 6000;
        docs.get(`orders/${orderId}`).pendingRefundPaise = 6000;
      },
      docs => { docs.get(`orders/${orderId}`).pendingRefundPaise = 1000; },
    ]) {
      const h = harness(t, { afterCommit(writes, docs) {
        if (writes.some(write => write.path.startsWith('refundReservations/') && write.data?.status === 'GATEWAY_SUCCEEDED')) corrupt(docs);
      } });
      await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
      assert.equal(h.order().amountRefundedPaise, 0);
      assert.equal(h.ledgers().length, 0);
      assert.equal(h.effects.calls.length, 1);
      await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
      assert.equal(h.effects.calls.length, 1);
    }
  });

  it('validates nonnegative safe-integer pending/settled balances before reserving', async t => {
    for (const order of [{ pendingRefundPaise: -1 }, { pendingRefundPaise: '0' }, { pendingRefundPaise: 1.5 },
      { amountRefundedPaise: -1 }, { amountRefundedPaise: '0' }, { amountRefundedPaise: 9000, pendingRefundPaise: 2000 },
      { amountPaidPaise: '10000' }]) {
      const h = harness(t, { order });
      await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
      assert.equal(h.effects.calls.length, 0);
      assert.equal(h.reservations().length, 0);
    }
  });

  it('validates gateway refund IDs, amount, currency, payment binding and status without fabricated defaults', async t => {
    for (const response of [{ id: undefined }, { amount: 1 }, { amount: '3000' }, { currency: 'USD' },
      { payment_id: 'pay_someone_else' }, { status: 'failed' }]) {
      const h = harness(t, { response });
      await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
      assert.equal(h.order().pendingRefundPaise, 3000);
      assert.equal(h.order().amountRefundedPaise, 0);
      assert.equal(h.ledgers().length, 0);
    }
  });

  it('a pending gateway response stays reserved until a confirmed processed outcome is reconciled', async t => {
    const h = harness(t, { response: { status: 'pending' } });
    await assert.rejects(h.execute(), error => error.code === 'failed-precondition');
    assert.equal(h.reservations()[0].status, 'GATEWAY_PENDING');
    assert.equal(h.order().pendingRefundPaise, 3000);
    assert.equal(h.order().amountRefundedPaise, 0);
    await assert.rejects(h.execute());
    Object.assign(h.reservations()[0], { status: 'GATEWAY_SUCCEEDED', gatewayResponseStatus: 'processed' });
    assert.equal((await h.execute()).success, true);
    assert.equal(h.effects.calls.length, 1);
  });

  it('a second partial request waits for the first reservation and can proceed after settlement', async t => {
    const firstGate = deferred();
    const h = harness(t, { gateway: ({ index }) => index === 1 ? firstGate.promise : {} });
    const first = h.execute();
    await drainUntil(() => h.effects.calls.length === 1);
    await assert.rejects(h.execute({ idempotencyKey: 'second-key', amountPaise: 2000 }), error => error.code === 'failed-precondition');
    assert.equal(h.effects.calls.length, 1);
    assert.equal(h.order().pendingRefundPaise, 3000);
    firstGate.resolve({});
    assert.equal((await first).totalRefundedPaise, 3000);
    const second = await h.execute({ idempotencyKey: 'second-key', amountPaise: 2000 });
    assert.equal(second.totalRefundedPaise, 5000);
    assert.equal(h.order().amountRefundedPaise, 5000);
    assert.equal(h.order().pendingRefundPaise, 0);
    assert.equal(h.ledgers().length, 2);
  });

  it('confirmed failure releases pending funds without clobbering previously settled partial refunds', async t => {
    const firstGate = deferred();
    const h = harness(t, { order: { paymentStatus: 'partially_refunded', amountRefundedPaise: 2000, amountRefundablePaise: 8000 },
      gateway: ({ index }) => index === 1 ? firstGate.promise : {} });
    const first = h.execute();
    await drainUntil(() => h.effects.calls.length === 1);
    firstGate.resolve({ httpStatus: 400 });
    await assert.rejects(first);
    assert.equal(h.order().amountRefundedPaise, 2000);
    assert.equal(h.order().pendingRefundPaise, 0);
    await h.execute({ idempotencyKey: 'second-key', amountPaise: 2000 });
    assert.equal(h.order().amountRefundedPaise, 4000);
    assert.equal(h.ledgers().length, 1);
  });

  it('cash refunds finalize/replay once and post CASH_ON_HAND without remote calls', async t => {
    const h = harness(t, { order: { paymentMethod: 'counter_cash', gatewayPaymentId: undefined, gatewayOrderId: undefined } });
    const result = await h.execute({ amountPaise: 10000 });
    assert.deepEqual(await h.execute({ amountPaise: 10000 }), result);
    assert.equal(h.reservations()[0].status, 'FINALIZED');
    assert.equal(h.ledgers()[0].postings[1].account, 'CASH_ON_HAND');
    assert.equal(h.order().amountRefundedPaise, 10000);
    assert.equal(h.effects.calls.length, 0);
  });

  it('full refund refreshes the public queue nonfatally after authoritative settlement', async t => {
    const h = harness(t, { rejectProjection: true });
    const result = await h.call({ amountPaise: 10000 });
    assert.equal(result.success, true);
    assert.equal(result.status, 'refunded');
    assert.equal(h.order().status, 'cancelled');
    assert.equal(h.effects.projections, 1);
    assert.ok(h.effects.security.some(event => event.eventType === 'REFUND_PROJECTION_SYNC_FAILED'));
    assert.ok(!JSON.stringify(h.effects.security).includes('private gateway response'));
  });
});
