'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');

function clone(value) {
  if (!value || typeof value !== 'object' || value instanceof Timestamp || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function harness(t, options = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-17T06:00:00.000Z') });
  const docs = new Map();
  const effects = { transactions: [], issued: [], failures: [], successes: [], events: [], hashMismatches: 0 };
  let attempt = -1;
  let inTransaction = false;
  let beforeTransaction;
  let retry;
  const snapshot = ref => {
    const data = clone(docs.get(ref.path));
    return { id: ref.id, ref, exists: data !== undefined, data: () => clone(data) };
  };
  function collection(name, filters = []) {
    return {
      doc(id) {
        const ref = { id, path: `${name}/${id}` };
        ref.get = async () => snapshot(ref);
        ref.update = async data => {
          assert.ok(docs.has(ref.path));
          docs.set(ref.path, { ...docs.get(ref.path), ...clone(data) });
        };
        return ref;
      },
      where(field, operator, value) {
        assert.equal(operator, '==');
        return collection(name, [...filters, [field, value]]);
      },
      async get() {
        const matches = [...docs.keys()].filter(key => key.startsWith(`${name}/`))
          .map(key => snapshot(collection(name).doc(key.slice(name.length + 1))))
          .filter(doc => filters.every(([field, value]) => doc.data()[field] === value));
        return { docs: matches, empty: matches.length === 0 };
      },
    };
  }
  const db = {
    collection,
    async runTransaction(callback) {
      if (beforeTransaction) {
        const hook = beforeTransaction;
        beforeTransaction = undefined;
        await hook();
      }
      for (;;) {
        attempt += 1;
        const writes = [];
        const transaction = {
          async get(ref) {
            assert.equal(writes.length, 0, 'Firestore transactions must read before writing');
            return snapshot(ref);
          },
          update(ref, data) { writes.push({ path: ref.path, data: clone(data), update: true }); },
          set(ref, data) { writes.push({ path: ref.path, data: clone(data) }); },
        };
        let result;
        try {
          inTransaction = true;
          result = await callback(transaction);
          inTransaction = false;
          if (retry) {
            const hook = retry;
            retry = undefined;
            effects.transactions.push({ status: 'retry', writes });
            await hook();
            continue;
          }
          if (options.failCommit) throw new Error('Simulated Firestore commit failure');
          const committed = new Map(docs);
          for (const write of writes) {
            if (write.update) assert.ok(committed.has(write.path));
            committed.set(write.path, write.update ? { ...committed.get(write.path), ...write.data } : write.data);
          }
          docs.clear();
          for (const [key, data] of committed) docs.set(key, data);
          effects.transactions.push({ status: 'committed', writes });
          return result;
        } catch (error) {
          effects.transactions.push({ status: 'rolled-back', writes });
          throw error;
        } finally {
          inTransaction = false;
        }
      }
    },
  };
  const admin = {
    apps: [{}], firestore: Object.assign(() => db, { Timestamp, FieldValue }),
    auth: () => ({
      async createCustomToken(uid, claims) {
        assert.equal(inTransaction, false);
        assert.equal(docs.get(`workstationSessions/${uid}`)?.sessionGeneration, claims.sessionGeneration,
          'A token must only be issued after its session commits');
        effects.issued.push({ uid, claims });
        return 'local-shift-token';
      },
    }),
  };
  const root = path.resolve(__dirname, '../lib');
  const modules = new Map();
  function load(filename) {
    filename = path.resolve(root, filename);
    if (modules.has(filename)) return modules.get(filename).exports;
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    modules.set(filename, loaded);
    const realRequire = Module.createRequire(filename);
    loaded.require = specifier => {
      if (specifier === 'firebase-admin') return admin;
      if (specifier === 'firebase-admin/firestore') return { Timestamp, FieldValue };
      if (specifier === './rate_limiter') return {
        enforceRateLimit: async () => {}, enforceExponentialBackoff: async () => {},
        recordAuthFailure: async (...args) => { effects.failures.push(args); },
        recordAuthSuccess: async (...args) => { effects.successes.push(args); },
      };
      if (specifier === './security_logger') return { logSecurityEvent: async event => { effects.events.push(event); } };
      if (specifier === 'crypto' && filename === path.join(root, 'shift_pins.js')) return {
        ...crypto,
        pbkdf2Sync(...args) {
          const hash = crypto.pbkdf2Sync(...args);
          // With deterministic PBKDF2 and an unchanged issuance, this defensive
          // branch cannot naturally diverge. Fault only the fresh derivation;
          // candidate selection, generation checks and the callable stay real.
          if (inTransaction && (typeof options.mismatch === 'function' ? options.mismatch(attempt) : options.mismatch)) {
            hash[0] ^= 1;
            effects.hashMismatches += 1;
          }
          return hash;
        },
      };
      if (specifier.startsWith('.')) return load(realRequire.resolve(specifier));
      return realRequire(specifier);
    };
    loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
    return loaded.exports;
  }
  const shift = load('shift_pins.js');
  const today = shift.getMumbaiDateStr();
  const deviceId = 'TB_WS_KITCHEN_LOCKOUT';
  const workstationToken = `wstok_${'ab'.repeat(24)}`;
  const salt = 'cd'.repeat(16);
  const pinId = `kitchen_${today}_FULL_DAY`;
  const pinPath = `shiftPins/${pinId}`;
  docs.set(`registeredWorkstations/${deviceId}`, {
    workstationId: deviceId, status: 'ACTIVE', stationType: 'kitchen',
    tokenHash: crypto.createHash('sha256').update(workstationToken).digest('hex'),
  });
  docs.set(pinPath, {
    pinId, role: 'kitchen', shiftDate: today, shiftWindow: 'FULL_DAY', status: 'ACTIVE',
    pinHash: shift.derivePinHash('123456', salt), salt, createdAt: Timestamp.fromMillis(Date.now() - 60000),
    expiresAt: Timestamp.fromDate(new Date(`${today}T23:59:59.999+05:30`)),
    boundDevices: [], maxDevices: 2, failedAttempts: options.failedAttempts || 0, lockedUntil: null,
  });
  return {
    docs, db, shift, deviceId, pinPath, effects,
    pin: () => docs.get(pinPath),
    sessions: () => [...docs.keys()].filter(key => key.startsWith('workstationSessions/')),
    beforeTransaction(hook) { beforeTransaction = hook; },
    retry(hook = () => {}) { retry = hook; },
    verify(pin = '123456') {
      return shift.verifyShiftPin.run({
        app: { appId: 'lockout-regression' }, rawRequest: { headers: {}, ip: '192.0.2.25' },
        data: { pin, role: 'kitchen', deviceId, workstationToken },
      });
    },
  };
}

async function denied(h, pin) {
  await assert.rejects(h.verify(pin), error => error.code === 'unauthenticated' && error.message === 'Invalid staff credentials.');
  assert.equal(h.effects.issued.length, 0);
  assert.equal(h.sessions().length, 0);
  assert.deepEqual(h.pin().boundDevices, []);
  assert.equal(h.pin().lastLoginAt, undefined);
  assert.equal(h.effects.successes.length, 0);
}

describe('Shift PIN lockout regressions (real callable, rollback-aware transactions)', () => {
  it('the transaction double discards buffered writes when a callback throws', async t => {
    const h = harness(t);
    const error = new Error('abort');
    await assert.rejects(h.db.runTransaction(async transaction => {
      const ref = h.db.collection('shiftPins').doc(h.pin().pinId);
      await transaction.get(ref);
      transaction.update(ref, { failedAttempts: 5 });
      throw error;
    }), failure => failure === error);
    assert.equal(h.pin().failedAttempts, 0);
    assert.equal(h.effects.transactions[0].status, 'rolled-back');
  });

  it('ordinary wrong PINs commit the existing no-candidate counter and lock on the fifth attempt', async t => {
    const h = harness(t);
    for (let failures = 1; failures <= 5; failures += 1) {
      await denied(h, '999999');
      assert.equal(h.pin().failedAttempts, failures);
      if (failures < 5) assert.equal(h.pin().lockedUntil, null);
      else assert.equal(h.pin().lockedUntil.toMillis(), Date.now() + 15 * 60000);
    }
    assert.equal(h.effects.transactions.filter(tx => tx.status === 'committed').length, 5);
    assert.equal(h.effects.failures.length, 10);
    assert.equal(h.effects.hashMismatches, 0);
  });

  for (const initialFailures of [3, 4]) {
    it(`fresh hash mismatch commits failure ${initialFailures + 1} before returning a uniform denial`, async t => {
      const h = harness(t, { mismatch: true, failedAttempts: initialFailures });
      await denied(h);
      assert.equal(h.effects.hashMismatches, 1, 'The fresh mismatch branch must be exercised');
      assert.equal(h.pin().failedAttempts, initialFailures + 1);
      if (initialFailures === 3) assert.equal(h.pin().lockedUntil, null);
      else assert.equal(h.pin().lockedUntil.toMillis(), Date.now() + 15 * 60000);
      assert.equal(h.effects.transactions.length, 1);
      assert.equal(h.effects.transactions[0].status, 'committed');
      assert.deepEqual(h.effects.transactions[0].writes.map(write => write.path), [h.pinPath]);
      assert.equal(h.effects.failures.length, 2);
      assert.equal(h.effects.events.at(-1).eventType, 'STAFF_SHIFT_PIN_FAILED');
    });
  }

  it('retries a conflicting failure against fresh counters and commits only the final increment', async t => {
    const h = harness(t, { mismatch: true, failedAttempts: 3 });
    h.retry(() => { h.pin().failedAttempts = 4; });
    await denied(h);
    assert.equal(h.pin().failedAttempts, 5);
    assert.equal(h.pin().lockedUntil.toMillis(), Date.now() + 15 * 60000);
    assert.deepEqual(h.effects.transactions.map(tx => tx.status), ['retry', 'committed']);
    assert.equal(h.effects.hashMismatches, 2);
    assert.equal(h.effects.failures.length, 2, 'Auth failure telemetry must run once outside transaction retries');
  });

  it('a retried success followed by a mismatch never leaks its discarded session or token', async t => {
    const h = harness(t, { mismatch: attempt => attempt === 1, failedAttempts: 4 });
    h.retry();
    await denied(h);
    assert.equal(h.pin().failedAttempts, 5);
    assert.equal(h.effects.transactions[0].writes.some(write => write.path.startsWith('workstationSessions/')), true);
    assert.deepEqual(h.effects.transactions[1].writes.map(write => write.path), [h.pinPath]);
    assert.deepEqual(h.effects.transactions.map(tx => tx.status), ['retry', 'committed']);
  });

  it('a retried mismatch followed by a valid match uses the final committed outcome', async t => {
    const h = harness(t, { mismatch: attempt => attempt === 0, failedAttempts: 4 });
    h.retry();
    const result = await h.verify();
    assert.equal(result.success, true);
    assert.equal(h.pin().failedAttempts, 0);
    assert.equal(h.pin().lockedUntil, null);
    assert.equal(h.sessions().length, 1);
    assert.equal(h.effects.issued.length, 1);
    assert.equal(h.effects.failures.length, 0);
    assert.deepEqual(h.effects.transactions.map(tx => tx.status), ['retry', 'committed']);
  });

  for (const duringRetry of [false, true]) {
    it(`does not penalize a replacement issuance ${duringRetry ? 'after a conflicting mismatch' : 'between candidate selection and verification'}`, async t => {
      const h = harness(t, { mismatch: true, failedAttempts: 4 });
      // Even a regenerated issuance using the same PIN/salt has a new epoch.
      const replace = () => Object.assign(h.pin(), { createdAt: Timestamp.fromMillis(Date.now() - 1000), failedAttempts: 0 });
      if (duringRetry) h.retry(replace);
      else h.beforeTransaction(replace);
      await denied(h);
      assert.equal(h.pin().failedAttempts, 0);
      assert.equal(h.pin().lockedUntil, null);
      assert.equal(h.effects.hashMismatches, duringRetry ? 1 : 0);
      assert.equal(h.effects.transactions.at(-1).status, 'rolled-back');
      assert.equal(h.effects.transactions.at(-1).writes.length, 0);
    });
  }

  for (const mismatch of [false, true]) {
    it(`a failed ${mismatch ? 'failure-counter' : 'login/session'} commit rolls back and never authorizes the caller`, async t => {
      const h = harness(t, { mismatch, failedAttempts: 4, failCommit: true });
      await denied(h);
      assert.equal(h.pin().failedAttempts, 4);
      assert.equal(h.pin().lockedUntil, null);
      assert.equal(h.effects.transactions[0].status, 'rolled-back');
      assert.ok(h.effects.transactions[0].writes.length > 0);
    });
  }

  it('a committed lock rejects a correct PIN until expiry, then a real login resets failures', async t => {
    const options = { mismatch: true, failedAttempts: 4 };
    const h = harness(t, options);
    await denied(h);
    const lockedUntil = h.pin().lockedUntil.toMillis();
    options.mismatch = false;
    await denied(h);
    t.mock.timers.setTime(lockedUntil + 1);
    const result = await h.verify();
    assert.equal(result.success, true);
    assert.equal(result.token, 'local-shift-token');
    assert.equal(h.pin().failedAttempts, 0);
    assert.equal(h.pin().lockedUntil, null);
    assert.deepEqual(h.pin().boundDevices, [h.deviceId]);
    assert.equal(h.sessions().length, 1);
    assert.equal(h.effects.issued.length, 1);
    assert.equal(h.effects.successes.length, 1);
  });
});
