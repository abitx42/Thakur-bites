'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const { Timestamp } = require('firebase-admin/firestore');

// A process-local fixture secret; no environment files or live services are read.
const signingKey = crypto.randomBytes(32).toString('hex');
const orderId = 'pickup-regression-order';
const studentId = 'pickup-regression-customer';
const staffUid = 'pickup-regression-staff';
const pin = '7391';
const salt = 'pickup-regression-salt';

function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === 'object' && !(value instanceof Timestamp)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  }
  return value;
}

function fixture(orderOverrides = {}, secretOverrides = {}) {
  return {
    order: {
      studentId,
      tokenNumber: 'TB-042',
      status: 'ready',
      paymentStatus: 'paid',
      isOnlyReadyMade: false,
      ...orderOverrides,
    },
    secret: {
      orderId,
      studentId,
      pickupPinHash: crypto.pbkdf2Sync(pin, salt, 10000, 32, 'sha256').toString('hex'),
      salt,
      qrNonce: crypto.randomBytes(16).toString('hex'),
      qrExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      failedPinAttempts: 0,
      isLockedForInvestigation: false,
      ...secretOverrides,
    },
  };
}

function signedToken(secret, overrides = {}) {
  const values = {
    order: orderId,
    student: studentId,
    nonce: secret.qrNonce,
    expiry: String(secret.qrExpiresAt),
    ...overrides,
  };
  const signature = crypto.createHmac('sha256', signingKey)
    .update(`${values.order}:${values.student}:${values.nonce}:${values.expiry}`)
    .digest('hex');
  return `${values.order}.${values.student}.${values.nonce}.${values.expiry}.${signature}`;
}

function harness(options = {}) {
  const data = options.fixture || fixture();
  const documents = new Map([
    [`orders/${orderId}`, copy(data.order)],
    [`facultyPriorityLocks/${studentId}`, { activeOrderId: orderId }],
  ]);
  if (data.secret !== null) documents.set(`orderSecrets/${orderId}`, copy(data.secret));
  const effects = { security: [], projections: 0, transactions: 0, commits: 0, writes: [] };
  let nextId = 0;
  const db = {
    collection(name) {
      return {
        doc(id = `event-${++nextId}`) {
          assert.equal(typeof id, 'string', 'Firestore document IDs must be strings');
          assert.ok(id && !id.includes('/'), 'Firestore document IDs must be single path segments');
          return { path: `${name}/${id}` };
        },
      };
    },
    async runTransaction(callback) {
      effects.transactions += 1;
      const pending = [];
      let writing = false;
      const transaction = {
        async get(ref) {
          assert.equal(writing, false, 'Firestore transactions must read before writing');
          const value = documents.get(ref.path);
          return { exists: value !== undefined, data: () => copy(value) };
        },
        update(ref, values) {
          writing = true;
          pending.push({ kind: 'update', path: ref.path, values: copy(values) });
        },
        set(ref, values, setOptions) {
          writing = true;
          pending.push({ kind: 'set', path: ref.path, values: copy(values), merge: !!setOptions?.merge });
        },
        delete(ref) {
          writing = true;
          pending.push({ kind: 'delete', path: ref.path });
        },
      };
      // Deliberately apply NOTHING when the real handler throws from its callback.
      let result = await callback(transaction);
      if (options.retryCallback) {
        pending.length = 0;
        writing = false;
        result = await callback(transaction);
      }
      if (options.rejectCommit) throw new Error('Transaction commit rejected');
      const committed = new Map(documents);
      for (const write of pending) {
        if (write.kind === 'delete') committed.delete(write.path);
        else {
          if (write.kind === 'update') assert.ok(committed.has(write.path), 'Cannot update a missing document');
          committed.set(write.path, write.kind === 'update' || write.merge
            ? { ...committed.get(write.path), ...write.values }
            : write.values);
        }
      }
      documents.clear();
      for (const [key, value] of committed) documents.set(key, value);
      effects.commits += 1;
      effects.writes.push(...pending);
      return result;
    },
  };

  const target = require.resolve('../lib/pickup_verify');
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === target) {
      if (request === 'firebase-admin') return { firestore: () => db };
      const stubs = {
        './app_check': { enforceAppCheck() {} },
        './version_policy': { async enforceAppVersionPolicy() {} },
        './honeypot_defense': { async assertNoHoneytokens() {} },
        './shift_pins': { async assertActiveWorkstationSession() {} },
        './rate_limiter': { async enforceRateLimit() {} },
        './secrets': {
          getRequiredSecret(name) {
            assert.equal(name, 'QR_SIGNING_SECRET');
            if (options.missingSigningKey) throw new Error('QR signing key unavailable');
            return signingKey;
          },
        },
        './security_logger': {
          async logSecurityEvent(event) {
            effects.security.push(copy(event));
            if (options.rejectLog) throw new Error('Telemetry unavailable');
          },
        },
        './tv_projection': {
          async updatePublicLiveQueueProjection() {
            effects.projections += 1;
            if (options.rejectProjection) throw new Error('Projection failed: sensitive-token-must-not-be-logged');
          },
        },
      };
      if (Object.hasOwn(stubs, request)) return stubs[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let handlers;
  try {
    delete require.cache[target];
    handlers = require(target);
  } finally {
    Module._load = originalLoad;
    delete require.cache[target];
  }

  return {
    db,
    documents,
    effects,
    order: () => documents.get(`orders/${orderId}`),
    secret: () => documents.get(`orderSecrets/${orderId}`),
    verify(data, role = 'pickup') {
      return handlers.verifyPickup.run({ data: { orderId, ...data }, auth: { uid: staffUid, token: { role } } });
    },
    refresh(data = {}, uid = studentId) {
      return handlers.getStudentPickupQr.run({ data: { orderId, ...data }, auth: { uid, token: { role: 'student' } } });
    },
    unlock(data = {}, role = 'manager') {
      return handlers.unlockOrderPickupVerification.run({
        data: { orderId, reason: 'Customer presented physical ID', ...data },
        auth: { uid: staffUid, token: { role } },
      });
    },
    handlers,
  };
}

function errorCode(code, message) {
  return (error) => {
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  };
}

describe('Pickup exported callable regressions (offline, rollback-faithful transactions)', () => {
  it('the transaction fixture discards writes if its callback throws', async () => {
    const h = harness();
    await assert.rejects(h.db.runTransaction(async (transaction) => {
      transaction.update(h.db.collection('orders').doc(orderId), { status: 'collected' });
      throw new Error('abort');
    }), /abort/);
    assert.equal(h.order().status, 'ready');
    assert.equal(h.effects.commits, 0);
  });

  it('staffVerified alone cannot collect an order', async () => {
    const h = harness();
    await assert.rejects(h.verify({ staffVerified: true }), errorCode('invalid-argument'));
    assert.equal(h.order().status, 'ready');
    assert.equal(h.effects.writes.length, 0);
  });

  it('staffVerified cannot override a wrong PIN or QR token', async () => {
    for (const credential of [{ pinCode: '0000' }, { qrToken: 'invalid.token' }]) {
      const h = harness();
      await assert.rejects(h.verify({ ...credential, staffVerified: true }), errorCode('permission-denied'));
      assert.equal(h.order().status, 'ready');
      assert.equal(h.secret().failedPinAttempts, 1);
    }
  });

  it('uses canonical verify_pickup capability rather than kitchen/cashier roles', async () => {
    for (const role of ['kitchen', 'cashier', 'student', 'unknown']) {
      const h = harness();
      await assert.rejects(h.verify({ pinCode: pin }, role), errorCode('permission-denied'));
      assert.equal(h.effects.transactions, 0);
    }
    for (const role of ['pickup', 'manager', 'admin', 'developer', 'security_admin']) {
      const h = harness();
      assert.equal((await h.verify({ pinCode: pin }, role)).success, true);
    }
  });

  it('rejects non-string/path/oversized order IDs and non-boolean staffVerified before Firestore', async () => {
    for (const input of [
      { orderId: 123 }, { orderId: [] }, { orderId: {} }, { orderId: true },
      { orderId: '' }, { orderId: '   ' }, { orderId: '.' }, { orderId: '..' },
      { orderId: 'orders/injected' }, { orderId: 'x'.repeat(129) },
      { staffVerified: 'true' }, { staffVerified: 1 }, { staffVerified: {} }, { staffVerified: null },
      { appVersion: {} }, { appVersion: '1'.repeat(65) },
    ]) {
      const h = harness();
      await assert.rejects(h.verify({ pinCode: pin, ...input }), errorCode('invalid-argument'));
      assert.equal(h.effects.transactions, 0);
    }
  });

  it('bounds all credential types, including legacy pin, and rejects non-object data', async () => {
    for (const input of [
      { pinCode: 7391 }, { pinCode: null }, { pinCode: [] }, { pinCode: '1'.repeat(9) },
      { pin: 7391 }, { pin: {} }, { qrToken: null }, { qrToken: [] },
      { qrToken: '' }, { qrToken: '   ' }, { qrToken: 'a'.repeat(2049) },
    ]) {
      const h = harness();
      await assert.rejects(h.verify(input), errorCode('invalid-argument'));
      assert.equal(h.effects.transactions, 0);
    }
    for (const data of [null, [], 'payload', 42]) {
      const h = harness();
      await assert.rejects(h.handlers.verifyPickup.run({ data, auth: { uid: staffUid, token: { role: 'pickup' } } }), errorCode('invalid-argument'));
    }
  });

  it('three wrong PINs commit attempts and QR lockout across separate calls', async () => {
    const h = harness();
    const originalQr = signedToken(h.secret());
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await assert.rejects(h.verify({ pinCode: '0000' }), errorCode('permission-denied'));
      assert.equal(h.order().failedPinAttempts, attempt);
      assert.equal(h.secret().failedPinAttempts, attempt);
      assert.equal(h.secret().isLockedForInvestigation, attempt === 3);
    }
    assert.ok(h.secret().qrConsumedAt);
    assert.equal(h.secret().qrConsumedBy, 'SYSTEM_LOCKOUT');
    assert.equal(h.order().isLockedForInvestigation, true);
    assert.equal(h.effects.commits, 3);
    await assert.rejects(h.verify({ pinCode: pin }), errorCode('permission-denied', /locked/i));
    await assert.rejects(h.verify({ qrToken: originalQr }), errorCode('permission-denied', /locked/i));
    assert.equal(h.secret().failedPinAttempts, 3);
    assert.equal(h.order().status, 'ready');
    assert.equal(h.effects.projections, 0);
    assert.equal(h.effects.security.filter(event => event.eventType === 'ORDER_PICKUP_BRUTEFORCE_LOCKOUT').length, 1);
  });

  it('three bad QR signatures also commit a cross-call lockout', async () => {
    const h = harness();
    const invalid = signedToken(h.secret()).replace(/.$/, 'x');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await assert.rejects(h.verify({ qrToken: invalid }), errorCode('permission-denied'));
      assert.equal(h.secret().failedPinAttempts, attempt);
    }
    assert.equal(h.secret().isLockedForInvestigation, true);
    assert.ok(h.secret().qrConsumedAt);
  });

  it('transaction retries do not double-count failures or emit uncommitted failure events', async () => {
    const h = harness({ retryCallback: true });
    await assert.rejects(h.verify({ pinCode: '0000' }), errorCode('permission-denied'));
    assert.equal(h.secret().failedPinAttempts, 1);
    assert.equal(h.order().failedPinAttempts, 1);
    assert.equal(h.effects.security.filter(event => event.eventType === 'FAILED_PICKUP_VERIFICATION').length, 1);
    const rejected = harness({ rejectCommit: true });
    await assert.rejects(rejected.verify({ pinCode: '0000' }), /commit rejected/);
    assert.equal(rejected.secret().failedPinAttempts, 0);
    assert.equal(rejected.effects.security.length, 0);
  });

  it('lockout uses both persisted authorities and cannot be hidden by a false/zero secret field', async () => {
    for (const [order, secret] of [
      [{ failedPinAttempts: 3 }, { failedPinAttempts: 0 }],
      [{ isLockedForInvestigation: true }, { isLockedForInvestigation: false }],
      [{}, { failedPinAttempts: '2' }],
    ]) {
      const h = harness({ fixture: fixture(order, secret) });
      await assert.rejects(h.verify({ pinCode: pin }), errorCode('permission-denied', /locked/i));
      await assert.rejects(h.refresh(), errorCode('permission-denied', /locked/i));
      assert.equal(h.order().status, 'ready');
    }
  });

  it('manager unlock restores real PIN collection but cannot resurrect a revoked QR', async () => {
    const h = harness();
    const oldQr = signedToken(h.secret());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assert.rejects(h.verify({ pinCode: '0000' }), errorCode('permission-denied'));
    }
    await assert.rejects(h.unlock({}, 'pickup'), errorCode('permission-denied'));
    assert.equal((await h.unlock()).success, true);
    assert.equal(h.secret().failedPinAttempts, 0);
    assert.equal(h.secret().isLockedForInvestigation, false);
    await assert.rejects(h.refresh(), errorCode('permission-denied', /consumed/i));
    await assert.rejects(h.verify({ qrToken: oldQr }), errorCode('permission-denied', /consumed/i));
    assert.equal((await h.verify({ pinCode: pin })).success, true);
  });

  it('unpaid orders cannot be handed over even with valid credentials', async () => {
    for (const paymentStatus of ['pending', 'failed', 'unpaid', 'refunded', undefined]) {
      const h = harness({ fixture: fixture({ paymentStatus }) });
      await assert.rejects(h.verify({ pinCode: pin }), errorCode('failed-precondition', /payment/i));
      assert.equal(h.order().status, 'ready');
      assert.equal(h.effects.writes.length, 0);
    }
  });

  it('cooked orders in confirmed/preparing/placed/paid states are not ready', async () => {
    for (const status of ['confirmed', 'preparing', 'placed', 'paid', 'payment_pending']) {
      const h = harness({ fixture: fixture({ status }) });
      await assert.rejects(h.verify({ pinCode: pin }), errorCode('failed-precondition', /hand over/i));
      assert.equal(h.order().status, status);
      assert.equal(h.effects.writes.length, 0);
    }
  });

  it('permits paid ready-made orders only in legitimate active handover states', async () => {
    for (const status of ['confirmed', 'preparing', 'placed', 'paid']) {
      const h = harness({ fixture: fixture({ status, isOnlyReadyMade: true }) });
      assert.equal((await h.verify({ pinCode: pin })).status, 'collected');
    }
    for (const status of ['payment_pending', 'draft', 'expired', 'cancelled', 'unknown']) {
      const h = harness({ fixture: fixture({ status, isOnlyReadyMade: true }) });
      await assert.rejects(h.verify({ pinCode: pin }), errorCode('failed-precondition'));
      assert.equal(h.effects.writes.length, 0);
    }
    const h = harness({ fixture: fixture({ status: 'confirmed', isOnlyReadyMade: 'true' }) });
    await assert.rejects(h.verify({ pinCode: pin }), errorCode('failed-precondition'));
  });

  it('valid salted PIN collects once, releases the faculty lock, and records exactly one order event', async () => {
    const h = harness();
    const result = await h.verify({ pinCode: pin });
    assert.equal(result.success, true);
    assert.equal(result.verificationMethod, 'PIN');
    assert.equal(h.order().status, 'collected');
    assert.equal(h.order().collectedByStaffId, staffUid);
    assert.ok(h.secret().qrConsumedAt, 'PIN collection also retires outstanding QR tokens');
    assert.equal(h.documents.has(`facultyPriorityLocks/${studentId}`), false);
    assert.equal(h.effects.writes.filter(write => write.path.startsWith('orderEvents/')).length, 1);
    await assert.rejects(h.verify({ pinCode: pin }), errorCode('failed-precondition', /ALREADY_COLLECTED/));
    assert.equal(h.effects.writes.filter(write => write.path.startsWith('orderEvents/')).length, 1);
  });

  it('preserves the legacy pin input alias and isolated unsalted SHA-256 PIN hashes', async () => {
    const h = harness({ fixture: fixture({}, { salt: undefined, pickupPinHash: crypto.createHash('sha256').update(pin).digest('hex') }) });
    assert.equal((await h.verify({ pin })).verificationMethod, 'PIN');
  });

  it('a valid PIN clears previous failures in both documents without bypassing credentials', async () => {
    const h = harness({ fixture: fixture({ failedPinAttempts: 2 }, { failedPinAttempts: 1 }) });
    assert.equal((await h.verify({ pinCode: pin, staffVerified: true })).success, true);
    assert.equal(h.order().failedPinAttempts, 0);
    assert.equal(h.secret().failedPinAttempts, 0);
  });

  it('valid signed QR collects once and atomically consumes its isolated nonce', async () => {
    const h = harness();
    const qrToken = signedToken(h.secret());
    assert.equal((await h.verify({ qrToken })).verificationMethod, 'QR');
    assert.equal(h.order().status, 'collected');
    assert.ok(h.secret().qrConsumedAt);
    assert.equal(h.secret().qrConsumedBy, staffUid);
    await assert.rejects(h.verify({ qrToken }), errorCode('failed-precondition', /ALREADY_COLLECTED/));
  });

  it('QR requires an isolated stored nonce and exact numeric expiry, not public order fields', async () => {
    for (const missing of [{ qrNonce: undefined }, { qrExpiresAt: undefined }, { qrExpiresAt: '9999999999' }, { qrNonce: 123 }]) {
      const data = fixture();
      const qrToken = signedToken(data.secret);
      Object.assign(data.order, { qrNonce: data.secret.qrNonce, qrExpiresAt: data.secret.qrExpiresAt });
      Object.assign(data.secret, missing);
      const h = harness({ fixture: data });
      await assert.rejects(h.verify({ qrToken }), errorCode('permission-denied'));
      assert.equal(h.order().status, 'ready');
    }
    const data = fixture();
    const qrToken = signedToken(data.secret);
    Object.assign(data.order, data.secret);
    data.secret = null;
    const h = harness({ fixture: data });
    await assert.rejects(h.verify({ qrToken }), errorCode('permission-denied'));
    assert.equal(h.order().status, 'ready');
    assert.equal(h.secret().failedPinAttempts, 1);
  });

  it('rejects expired, mismatched, or noncanonical QR payloads even when correctly signed', async () => {
    for (const override of [
      { order: 'another-order' }, { student: 'another-customer' }, { nonce: 'another-nonce' },
      { expiry: '9999999999' }, { expiry: '123garbage' }, { expiry: '0' },
    ]) {
      const h = harness();
      await assert.rejects(h.verify({ qrToken: signedToken(h.secret(), override) }), errorCode('permission-denied'));
      assert.equal(h.order().status, 'ready');
    }
    const h = harness({ fixture: fixture({}, { qrExpiresAt: Math.floor(Date.now() / 1000) - 1 }) });
    await assert.rejects(h.verify({ qrToken: signedToken(h.secret()) }), errorCode('permission-denied'));
  });

  it('rejects consumed QR credentials and does not mint a replacement', async () => {
    for (const consumedInOrder of [false, true]) {
      const data = fixture();
      (consumedInOrder ? data.order : data.secret).qrConsumedAt = Timestamp.now();
      const h = harness({ fixture: data });
      await assert.rejects(h.verify({ qrToken: signedToken(h.secret()) }), errorCode('permission-denied', /consumed/i));
      await assert.rejects(h.refresh(), errorCode('permission-denied', /consumed/i));
      assert.equal(h.order().status, 'ready');
    }
  });

  it('refresh creates and commits isolated secrets before returning a usable QR', async () => {
    const data = fixture();
    data.secret = null;
    const h = harness({ fixture: data });
    const result = await h.refresh();
    assert.ok(h.secret(), 'Returned credentials must be persisted');
    assert.equal(h.secret().orderId, orderId);
    assert.equal(h.secret().studentId, studentId);
    assert.equal(result.signedQrPayload, signedToken(h.secret()));
    assert.equal(result.qrExpiresAt, h.secret().qrExpiresAt);
    assert.equal((await h.verify({ qrToken: result.signedQrPayload })).success, true);
  });

  it('refresh repairs missing/expired secret fields and invalidates old nonces', async () => {
    for (const override of [{ qrNonce: undefined }, { qrExpiresAt: undefined }, { qrExpiresAt: 1 }, { qrExpiresAt: '9999999999' }]) {
      const h = harness({ fixture: fixture({}, override) });
      const previousNonce = h.secret().qrNonce;
      const result = await h.refresh();
      assert.equal(result.signedQrPayload, signedToken(h.secret()));
      assert.notEqual(h.secret().qrNonce, previousNonce);
      assert.equal(typeof h.secret().qrExpiresAt, 'number');
      assert.ok(h.secret().qrExpiresAt > Math.floor(Date.now() / 1000));
      assert.equal(h.effects.commits, 1);
    }
  });

  it('refresh reuses a valid persisted credential without unnecessary rotation', async () => {
    const h = harness();
    const previous = signedToken(h.secret());
    assert.equal((await h.refresh()).signedQrPayload, previous);
    assert.equal(h.effects.writes.length, 0);
  });

  it('refresh fails closed on a failed commit or rejection by its signing-secret dependency', async () => {
    const data = fixture();
    data.secret = null;
    const h = harness({ fixture: data, rejectCommit: true });
    await assert.rejects(h.refresh(), /commit rejected/);
    assert.equal(h.secret(), undefined);
    const missingKey = harness({ fixture: data, missingSigningKey: true });
    await assert.rejects(missingKey.refresh(), /signing key unavailable/);
    assert.equal(missingKey.secret(), undefined);
  });

  it('refresh enforces ownership, terminal states, accumulated lockout, and bounded IDs', async () => {
    const h = harness();
    await assert.rejects(h.refresh({}, 'another-customer'), errorCode('permission-denied'));
    for (const status of ['collected', 'cancelled']) {
      await assert.rejects(harness({ fixture: fixture({ status }) }).refresh(), errorCode('failed-precondition'));
    }
    await assert.rejects(harness({ fixture: fixture({}, { failedPinAttempts: 3, isLockedForInvestigation: false }) }).refresh(), errorCode('permission-denied', /locked/i));
    for (const invalidId of [123, {}, [], '', '   ', 'nested/path', 'x'.repeat(129)]) {
      await assert.rejects(h.refresh({ orderId: invalidId }), errorCode('invalid-argument'));
    }
    for (const invalidReason of [123, {}, '', '   ', 'x'.repeat(501)]) {
      await assert.rejects(h.unlock({ reason: invalidReason }), errorCode('invalid-argument'));
    }
  });

  it('returns authoritative collection success if public projection and telemetry both fail', async () => {
    const h = harness({ rejectProjection: true, rejectLog: true });
    const result = await h.verify({ pinCode: pin });
    assert.equal(result.success, true);
    assert.equal(h.order().status, 'collected');
    assert.equal(h.effects.projections, 1);
    assert.ok(h.effects.security.some(event => event.eventType === 'PICKUP_PROJECTION_SYNC_FAILED'));
    assert.ok(!JSON.stringify(h.effects.security).includes('sensitive-token-must-not-be-logged'));
  });
});
