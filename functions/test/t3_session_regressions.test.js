const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');

// Each harness loads the real compiled modules in its own CommonJS module graph.
// Only Auth, Firestore, rate-limit storage and telemetry are replaced. No global
// require hooks, SDK mutations, environment changes, emulator or credentials.
function harness() {
  const docs = new Map();
  const users = new Map();
  const authErrors = new Map();
  const issued = [];
  const revoked = [];
  const events = [];
  let beforeTransaction;
  const clone = value => {
    if (!value || typeof value !== 'object' || value instanceof Timestamp || value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(clone);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  };
  function ref(collection, id) {
    assert.equal(typeof id, 'string');
    assert.ok(id && !id.includes('/'), 'Document IDs must be single path segments');
    const key = `${collection}/${id}`;
    return {
      id, path: key,
      async get() { return snapshot(this); },
      async set(data, options) {
        docs.set(key, options?.merge ? { ...docs.get(key), ...clone(data) } : clone(data));
      },
      async update(data) {
        assert.ok(docs.has(key), `Cannot update missing ${key}`);
        docs.set(key, { ...docs.get(key), ...clone(data) });
      },
    };
  }
  function snapshot(docRef) {
    const data = clone(docs.get(docRef.path));
    return { id: docRef.id, ref: docRef, exists: data !== undefined, data: () => clone(data) };
  }
  function collection(name, filters = []) {
    return {
      doc: id => ref(name, id),
      where: (key, operator, value) => collection(name, [...filters, [key, operator, value]]),
      async get() {
        const matches = [...docs.keys()].filter(key => key.startsWith(`${name}/`)).map(key => snapshot(ref(name, key.slice(name.length + 1))))
          .filter(doc => filters.every(([key, operator, value]) => {
            assert.ok(['==', 'in'].includes(operator));
            return operator === 'in' ? value.includes(doc.data()[key]) : doc.data()[key] === value;
          }));
        return { docs: matches, empty: matches.length === 0, size: matches.length };
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
      const writes = [];
      const result = await callback({
        async get(docRef) {
          assert.equal(writes.length, 0, 'Firestore transactions must read before writing');
          return snapshot(docRef);
        },
        set(docRef, data, options) { writes.push(() => docRef.set(data, options)); },
        update(docRef, data) { writes.push(() => docRef.update(data)); },
        create(docRef, data) {
          writes.push(async () => {
            assert.equal(docs.has(docRef.path), false, `Cannot create existing ${docRef.path}`);
            await docRef.set(data);
          });
        },
      });
      for (const write of writes) await write();
      return result;
    },
  };
  const auth = {
    async getUser(uid) {
      if (authErrors.has(uid)) throw authErrors.get(uid);
      if (!users.has(uid)) throw Object.assign(new Error('No such test account'), { code: 'auth/user-not-found' });
      return clone(users.get(uid));
    },
    async createCustomToken(uid, claims) {
      issued.push({ uid, claims: clone(claims) });
      return `local-token-${issued.length}`;
    },
    async setCustomUserClaims(uid, claims) {
      const user = await auth.getUser(uid);
      users.set(uid, { ...user, customClaims: clone(claims) });
    },
    async revokeRefreshTokens(uid) {
      const user = await auth.getUser(uid);
      revoked.push(uid);
      users.set(uid, { ...user, tokensValidAfterTime: new Date().toUTCString() });
    },
  };
  const firestore = Object.assign(() => db, { Timestamp, FieldValue });
  const admin = { apps: [{}], firestore, auth: () => auth, initializeApp() {} };
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
        recordAuthFailure: async () => {}, recordAuthSuccess: async () => {},
      };
      if (specifier === './security_logger') return { logSecurityEvent: async event => { events.push(event); } };
      if (specifier.startsWith('.')) return load(realRequire.resolve(specifier));
      return realRequire(specifier);
    };
    loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
    return loaded.exports;
  }
  return {
    docs, users, authErrors, issued, revoked, events, load,
    beforeTransaction(hook) { beforeTransaction = hook; },
    put(collectionName, id, data) { docs.set(`${collectionName}/${id}`, clone(data)); },
    get(collectionName, id) { return docs.get(`${collectionName}/${id}`); },
    user(uid, role, patch = {}) {
      users.set(uid, { uid, disabled: false, customClaims: role ? { role } : {},
        tokensValidAfterTime: new Date(Date.now() - 86400000).toUTCString(), ...patch });
    },
    staffAuth(uid, role) {
      const now = Math.floor(Date.now() / 1000);
      return { uid, token: { uid, sub: uid, role, auth_time: now, iat: now } };
    },
  };
}

function privilegedFixture() {
  const h = harness();
  const now = Date.now();
  const sessionId = 'psess_t3_valid_session';
  h.user('admin-caller', 'admin');
  h.put('privilegedSessions', sessionId, {
    sessionId, userId: 'admin-caller', role: 'admin', status: 'ACTIVE', mfaVerified: true, mfaMethod: 'TOTP',
    createdAt: Timestamp.fromMillis(now - 60000), expiresAt: Timestamp.fromMillis(now - 60000 + 21600000),
    lastActivityAt: Timestamp.fromMillis(now - 1000),
  });
  const guard = h.load('privileged_guard.js');
  return { ...h, sessionId, guard, check: () => guard.assertPrivilegedSession('admin-caller', sessionId, 'manage_staff_roles') };
}

function workstationFixture() {
  const h = harness();
  h.user('admin-caller', 'admin');
  const shift = h.load('shift_pins.js');
  const today = shift.getMumbaiDateStr();
  const deviceId = 'TB_WS_KITCHEN_A1B2C3D4';
  const workstationToken = `wstok_${'ab'.repeat(24)}`;
  const salt = 'cd'.repeat(16);
  const pinId = `kitchen_${today}_FULL_DAY`;
  h.put('registeredWorkstations', deviceId, {
    workstationId: deviceId, status: 'ACTIVE', stationType: 'kitchen',
    tokenHash: crypto.createHash('sha256').update(workstationToken).digest('hex'),
    enrolledAt: Timestamp.fromMillis(Date.now() - 3600000),
  });
  h.put('shiftPins', pinId, {
    pinId, role: 'kitchen', shiftDate: today, shiftWindow: 'FULL_DAY', status: 'ACTIVE',
    pinHash: shift.derivePinHash('123456', salt), salt, boundDevices: [], maxDevices: 2,
    failedAttempts: 0, lockedUntil: null, createdBy: 'admin-caller',
    createdAt: Timestamp.fromMillis(Date.now() - 60000),
    expiresAt: Timestamp.fromDate(new Date(`${today}T23:59:59.999+05:30`)),
  });
  const request = {
    app: { appId: 'local-test' },
    data: { pin: '123456', role: 'kitchen', deviceId, workstationToken },
    rawRequest: { headers: {}, ip: '192.0.2.20' },
  };
  async function login() {
    const result = await shift.verifyShiftPin.run(request);
    const { uid, claims } = h.issued.at(-1);
    // Firebase creates the virtual Auth user when signInWithCustomToken completes.
    h.user(uid, undefined);
    const token = { ...claims, uid, sub: uid, auth_time: Math.floor(Date.now() / 1000), iat: Math.floor(Date.now() / 1000) };
    return { result, uid, token, check: () => shift.assertActiveWorkstationSession(uid, token) };
  }
  return { ...h, shift, today, pinId, deviceId, workstationToken, request, login };
}

const denied = (promise, codes = ['unauthenticated', 'permission-denied', 'unavailable']) =>
  assert.rejects(promise, error => codes.includes(error.code));

describe('T3 current privileged authority (real helper)', () => {
  it('accepts a current enabled administrator with MFA and updates activity', async () => {
    const h = privilegedFixture();
    const prior = h.get('privilegedSessions', h.sessionId).lastActivityAt.toMillis();
    assert.deepEqual(await h.check(), { sessionId: h.sessionId, role: 'admin' });
    assert.ok(h.get('privilegedSessions', h.sessionId).lastActivityAt.toMillis() > prior);
  });

  for (const role of ['student', 'manager', undefined]) {
    it(`rejects stored admin authority after current Auth role becomes ${role}`, async () => {
      const h = privilegedFixture();
      h.user('admin-caller', role);
      await denied(h.check());
    });
  }

  it('fails closed on Auth outage and missing accounts', async () => {
    for (const code of ['auth/internal-error', 'auth/user-not-found']) {
      const h = privilegedFixture();
      h.authErrors.set('admin-caller', Object.assign(new Error('Simulated Auth failure'), { code }));
      await denied(h.check(), [code === 'auth/user-not-found' ? 'unauthenticated' : 'unavailable']);
    }
  });

  it('rejects disabled accounts and sessions older than the Auth revocation boundary', async () => {
    for (const patch of [{ disabled: true }, { tokensValidAfterTime: new Date(Date.now() - 1000).toUTCString() }]) {
      const h = privilegedFixture();
      Object.assign(h.users.get('admin-caller'), patch);
      await denied(h.check());
    }
  });

  for (const [field, value] of [
    ['createdAt', undefined], ['createdAt', Timestamp.fromMillis(Date.now() + 60000)],
    ['expiresAt', undefined], ['expiresAt', { toMillis: () => NaN }],
    ['expiresAt', Timestamp.fromMillis(Date.now() + 86400000)],
    ['lastActivityAt', undefined], ['lastActivityAt', Timestamp.fromMillis(Date.now() + 60000)],
    ['lastActivityAt', Timestamp.fromMillis(Date.now() - 3600000)],
    ['mfaVerified', false], ['sessionId', 'psess_someone_else'],
  ]) {
    it(`rejects invalid privileged ${field}: ${String(value)}`, async () => {
      const h = privilegedFixture();
      h.get('privilegedSessions', h.sessionId)[field] = value;
      await denied(h.check());
    });
  }

  it('normalizes malformed timestamp representations to zero without throwing', () => {
    const { normalizeTimestampToMillis } = privilegedFixture().guard;
    for (const value of [new Date('invalid'), { toMillis: () => NaN }, { toMillis: () => Infinity },
      { toMillis: () => -1 }, { toMillis: () => '2000' }, { toMillis() { throw new Error('invalid'); } },
      { _seconds: Infinity }, { _seconds: 1700000000, _nanoseconds: NaN }]) {
      assert.equal(normalizeTimestampToMillis(value), 0);
    }
    const now = Date.now();
    assert.equal(normalizeTimestampToMillis(Timestamp.fromMillis(now)), now);
    assert.equal(normalizeTimestampToMillis(new Date(now).toISOString()), now);
  });

  it('accepts a session issued by the real MFA creation handler', async () => {
    const h = harness();
    h.user('admin-caller', 'admin');
    const mfa = h.load('mfa_totp.js');
    const secret = mfa.base32Encode(Buffer.alloc(20, 7));
    h.put('mfaEnrollments', 'admin-caller', { mfaEnabled: true, secretBase32: secret });
    const issued = await mfa.createPrivilegedSession.run({
      auth: h.staffAuth('admin-caller', 'admin'), app: { appId: 'local-test' },
      data: { totpCode: mfa.generateTotp(secret, Math.floor(Date.now() / 30000)) },
    });
    assert.equal(issued.success, true);
    assert.equal((await h.load('privileged_guard.js').assertPrivilegedSession('admin-caller', issued.sessionId, 'manage_staff_roles')).role, 'admin');
  });

  it('enforces real idle and absolute lifetime ceilings', async () => {
    for (const elapsed of [31 * 60000, 7 * 3600000]) {
      const h = privilegedFixture();
      const data = h.get('privilegedSessions', h.sessionId);
      const now = Date.now();
      data.createdAt = Timestamp.fromMillis(now - Math.max(2 * 3600000, elapsed));
      data.expiresAt = Timestamp.fromMillis(data.createdAt.toMillis() + 21600000);
      data.lastActivityAt = Timestamp.fromMillis(elapsed < 21600000 ? now - elapsed : data.expiresAt.toMillis() - 60000);
      await denied(h.check());
      assert.equal(h.get('privilegedSessions', h.sessionId).status, elapsed < 21600000 ? 'IDLE_TIMEOUT' : 'EXPIRED');
    }
  });

  it('rejects malformed revocation state while supporting Firebase accounts without a revocation epoch', async () => {
    const h = privilegedFixture();
    h.users.get('admin-caller').tokensValidAfterTime = 'invalid';
    await denied(h.check());
    delete h.users.get('admin-caller').tokensValidAfterTime;
    await h.check();
  });

  it('rechecks session revocation in the activity transaction', async () => {
    const h = privilegedFixture();
    const before = h.get('privilegedSessions', h.sessionId).lastActivityAt.toMillis();
    h.beforeTransaction(() => { h.get('privilegedSessions', h.sessionId).status = 'REVOKED'; });
    await denied(h.check());
    assert.equal(h.get('privilegedSessions', h.sessionId).lastActivityAt.toMillis(), before);
  });

  it('never revokes another user\'s session when an ineligible caller supplies its ID', async () => {
    for (const patch of [{ customClaims: { role: 'student' } }, { disabled: true }]) {
      const h = privilegedFixture();
      h.user('other-user', 'admin', patch);
      await denied(h.guard.assertPrivilegedSession('other-user', h.sessionId, 'manage_staff_roles'));
      assert.equal(h.get('privilegedSessions', h.sessionId).status, 'ACTIVE');
    }
  });
});

describe('T3 registered workstation/PIN authority (real handlers and helper)', () => {
  it('keeps an enrolled workstation login valid and caps its lifetime to the originating PIN', async () => {
    const h = workstationFixture();
    const signedIn = await h.login();
    assert.equal(signedIn.result.success, true);
    await signedIn.check();
    const session = h.get('workstationSessions', signedIn.uid);
    assert.ok(session.expiresAt.toMillis() <= h.get('shiftPins', h.pinId).expiresAt.toMillis());
    assert.equal(typeof signedIn.token.sessionGeneration, 'string');
  });

  it('requires registered hardware credentials even for arbitrary legacy device IDs', async () => {
    const h = workstationFixture();
    h.request.data.deviceId = 'arbitrary_personal_phone';
    delete h.request.data.workstationToken;
    await denied(h.shift.verifyShiftPin.run(h.request));
    assert.equal(h.issued.length, 0);
  });

  it('rechecks transaction-fresh PIN status, role, date and required expiry', async () => {
    for (const patch of [
      { status: 'REVOKED' }, { role: 'admin' }, { shiftDate: '2001-01-01' },
      { expiresAt: undefined }, { expiresAt: Timestamp.fromMillis(Date.now() - 1000) },
      { expiresAt: { toMillis: () => NaN } }, { shiftWindow: 'INVALID' },
      { createdAt: Timestamp.fromMillis(Date.now() + 60000) },
      { salt: 'ef'.repeat(16) }, { pinHash: 'ef'.repeat(32) },
      { lockedUntil: Timestamp.fromMillis(Date.now() + 60000) },
    ]) {
      const h = workstationFixture();
      h.beforeTransaction(() => Object.assign(h.get('shiftPins', h.pinId), patch));
      await denied(h.shift.verifyShiftPin.run(h.request));
      assert.equal(h.issued.length, 0);
      assert.equal([...h.docs.keys()].filter(key => key.startsWith('workstationSessions/')).length, 0);
    }
  });

  it('rejects missing/revoked originating PINs and revoked registered hardware', async () => {
    for (const change of [
      h => h.docs.delete(`shiftPins/${h.pinId}`),
      h => { h.get('shiftPins', h.pinId).status = 'REVOKED'; },
      h => { h.get('registeredWorkstations', h.deviceId).status = 'REVOKED'; },
    ]) {
      const h = workstationFixture();
      const signedIn = await h.login();
      change(h);
      await denied(signedIn.check());
    }
  });

  it('rejects role, device and per-login generation mismatches', async () => {
    for (const patch of [{ role: 'admin' }, { deviceId: 'TB_WS_KITCHEN_OTHER' }, { sessionGeneration: 'old-generation' },
      { sessionGeneration: undefined }, { shiftDate: '2001-01-01' }, { shiftWindow: 'MORNING' },
      { pinId: 'kitchen_2001-01-01_FULL_DAY' }, { isWorkstationSession: false }, { sub: 'someone-else' },
      { auth_time: undefined }, { auth_time: NaN }, { auth_time: Math.floor(Date.now() / 1000) + 600 },
      { iat: undefined }, { iat: Math.floor(Date.now() / 1000) + 600 }]) {
      const h = workstationFixture();
      const signedIn = await h.login();
      Object.assign(signedIn.token, patch);
      await denied(signedIn.check());
    }
  });

  it('rejects coercible/malformed login inputs before creating tokens', async () => {
    for (const patch of [
      { pin: 'abcdef' }, { pin: '12345a' }, { pin: ' 123456 ' }, { pin: 123456 },
      { role: ['kitchen'] }, { deviceId: undefined }, { deviceId: 12345 },
      { deviceId: ' padded_device ' }, { deviceId: 'path/to/device' }, { deviceId: 'x'.repeat(101) },
    ]) {
      const h = workstationFixture();
      Object.assign(h.request.data, patch);
      await denied(h.shift.verifyShiftPin.run(h.request), ['invalid-argument']);
      assert.equal(h.issued.length, 0);
    }
    for (const workstationToken of [undefined, 1234, {}, '', ' padded ', 'x'.repeat(201)]) {
      const h = workstationFixture();
      h.request.data.workstationToken = workstationToken;
      await denied(h.shift.verifyShiftPin.run(h.request));
      assert.equal(h.issued.length, 0);
    }
  });

  it('requires the live hardware secret and enrolled role', async () => {
    for (const change of [
      h => h.docs.delete(`registeredWorkstations/${h.deviceId}`),
      h => { h.get('registeredWorkstations', h.deviceId).status = 'REVOKED'; },
      h => { h.get('registeredWorkstations', h.deviceId).stationType = 'cashier'; },
      h => { h.request.data.workstationToken = 'wstok_wrong_secret'; },
    ]) {
      const h = workstationFixture();
      change(h);
      await denied(h.shift.verifyShiftPin.run(h.request));
      assert.equal(h.issued.length, 0);
    }
  });

  it('rechecks hardware revocation, identity, role and secret inside the PIN transaction', async () => {
    for (const patch of [{ status: 'REVOKED' }, { stationType: 'pickup' },
      { tokenHash: 'ef'.repeat(32) }, { workstationId: 'TB_WS_KITCHEN_DIFFERENT' }]) {
      const h = workstationFixture();
      h.beforeTransaction(() => Object.assign(h.get('registeredWorkstations', h.deviceId), patch));
      await denied(h.shift.verifyShiftPin.run(h.request));
      assert.equal(h.issued.length, 0);
      assert.equal([...h.docs.keys()].filter(key => key.startsWith('workstationSessions/')).length, 0);
    }
  });

  it('requires finite PIN issuance/expiry and valid device capacity before selecting a candidate', async () => {
    for (const patch of [
      { createdAt: undefined }, { createdAt: { toMillis: () => Infinity } },
      { expiresAt: undefined }, { expiresAt: { toMillis: () => NaN } },
      { expiresAt: Timestamp.fromMillis(Date.now() + 3 * 86400000) },
      { boundDevices: 'not-an-array' }, { maxDevices: 0 }, { maxDevices: '2' },
      { pinHash: 'malformed' }, { lockedUntil: { toMillis: () => NaN } },
    ]) {
      const h = workstationFixture();
      Object.assign(h.get('shiftPins', h.pinId), patch);
      await denied(h.shift.verifyShiftPin.run(h.request));
      assert.equal(h.issued.length, 0);
    }
  });

  it('enforces device capacity and allows the same registered terminal to log in again', async () => {
    const h = workstationFixture();
    h.get('shiftPins', h.pinId).boundDevices = ['TB_WS_KITCHEN_OTHER1', 'TB_WS_KITCHEN_OTHER2'];
    await denied(h.shift.verifyShiftPin.run(h.request));
    h.get('shiftPins', h.pinId).boundDevices = [h.deviceId, 'TB_WS_KITCHEN_OTHER1'];
    const first = await h.login();
    await first.check();
    const second = await h.login();
    await second.check();
    assert.deepEqual(h.get('shiftPins', h.pinId).boundDevices, [h.deviceId, 'TB_WS_KITCHEN_OTHER1']);
    assert.notEqual(first.token.sessionGeneration, second.token.sessionGeneration);
    await denied(first.check());
  });

  it('rejects missing/invalid session times, binding metadata and live PIN/device mismatches', async () => {
    for (const change of [
      (h, login) => { h.get('workstationSessions', login.uid).createdAt = undefined; },
      (h, login) => { h.get('workstationSessions', login.uid).createdAt = Timestamp.fromMillis(Date.now() + 60000); },
      (h, login) => { h.get('workstationSessions', login.uid).expiresAt = undefined; },
      (h, login) => { h.get('workstationSessions', login.uid).expiresAt = { toMillis: () => NaN }; },
      (h, login) => { h.get('workstationSessions', login.uid).expiresAt = Timestamp.fromMillis(Date.now() + 86400000); },
      (h, login) => { h.get('workstationSessions', login.uid).sessionId = 'another-user'; },
      (h, login) => { h.get('workstationSessions', login.uid).pinGeneration = undefined; },
      (h, login) => { h.get('workstationSessions', login.uid).deviceHash = 'forged'; },
      h => { h.get('shiftPins', h.pinId).role = 'pickup'; },
      h => { h.get('shiftPins', h.pinId).shiftDate = '2001-01-01'; },
      h => { h.get('shiftPins', h.pinId).boundDevices = []; },
      h => { h.get('shiftPins', h.pinId).expiresAt = undefined; },
      h => { h.get('registeredWorkstations', h.deviceId).stationType = 'cashier'; },
      h => { h.get('registeredWorkstations', h.deviceId).tokenHash = 'ef'.repeat(32); },
      h => h.docs.delete(`registeredWorkstations/${h.deviceId}`),
    ]) {
      const h = workstationFixture();
      const login = await h.login();
      change(h, login);
      await denied(login.check());
    }
  });

  it('fails closed for disabled, demoted, deleted or unavailable workstation Auth users', async () => {
    for (const patch of [{ disabled: true }, { customClaims: { role: 'customer' } },
      { tokensValidAfterTime: 'invalid' }, { tokensValidAfterTime: new Date(Date.now() + 60000).toUTCString() }]) {
      const h = workstationFixture();
      const login = await h.login();
      Object.assign(h.users.get(login.uid), patch);
      await denied(login.check());
    }
    for (const code of ['auth/user-not-found', 'auth/internal-error']) {
      const h = workstationFixture();
      const login = await h.login();
      h.authErrors.set(login.uid, Object.assign(new Error('Simulated Auth failure'), { code }));
      await denied(login.check(), [code === 'auth/user-not-found' ? 'unauthenticated' : 'unavailable']);
    }
  });

  it('uses original authentication time rather than a refreshed token issue time for revocation', async () => {
    const h = workstationFixture();
    const login = await h.login();
    login.token.auth_time = Math.floor(Date.now() / 1000) - 7200;
    h.users.get(login.uid).tokensValidAfterTime = new Date(Date.now() - 3600000).toUTCString();
    await denied(login.check());
  });

  it('allows initial custom-token account creation after issuance but rejects subsequent revocation', async () => {
    const h = workstationFixture();
    const login = await h.login();
    const now = Date.now();
    const session = h.get('workstationSessions', login.uid);
    session.createdAt = Timestamp.fromMillis(now - 15000);
    session.expiresAt = Timestamp.fromMillis(Math.min(session.expiresAt.toMillis(), now - 15000 + 8 * 3600000));
    // The terminal exchanged its custom token five seconds after issuance.
    const creationTime = new Date(now - 10000).toUTCString();
    Object.assign(h.users.get(login.uid), { metadata: { creationTime }, tokensValidAfterTime: creationTime });
    await login.check();
    // Re-exchanging the same custom token cannot escape a later revocation.
    h.users.get(login.uid).tokensValidAfterTime = new Date(now - 5000).toUTCString();
    await denied(login.check());
  });

  it('requires current human staff authority without requiring a workstation session', async () => {
    const h = workstationFixture();
    h.user('ordinary-admin', 'admin');
    const token = h.staffAuth('ordinary-admin', 'admin').token;
    await h.shift.assertActiveWorkstationSession('ordinary-admin', token);
    h.users.get('ordinary-admin').disabled = true;
    await denied(h.shift.assertActiveWorkstationSession('ordinary-admin', token));
    await denied(h.shift.assertActiveWorkstationSession('staff_legacy_session', { role: 'kitchen' }));
  });

  it('PIN regeneration cannot revalidate an old session, even when the session UID is reused', async () => {
    const h = workstationFixture();
    const old = await h.login();
    await old.check();
    const generated = await h.shift.generateShiftPin.run({
      auth: h.staffAuth('admin-caller', 'admin'), app: { appId: 'local-test' },
      data: { role: 'kitchen', shiftWindow: 'FULL_DAY', shiftDate: h.today, forceRegenerate: true },
    });
    assert.equal(generated.pinId, h.pinId);
    await denied(old.check());
    h.request.data.pin = generated.pin;
    const current = await h.login();
    assert.equal(current.uid, old.uid);
    await current.check();
    await denied(old.check());
  });

  it('honors administrative PIN revocation through the real handler', async () => {
    const h = workstationFixture();
    const login = await h.login();
    const result = await h.shift.revokeShiftPin.run({
      auth: h.staffAuth('admin-caller', 'admin'), app: { appId: 'local-test' },
      data: { pinId: h.pinId },
    });
    assert.equal(result.revokedSessionsCount, 1);
    assert.ok(h.revoked.includes(login.uid));
    await denied(login.check());
  });

  it('preserves the actual invite/enroll/generate/login flow without extra configuration', async () => {
    const h = harness();
    h.user('admin-caller', 'admin');
    const hardware = h.load('workstation_binding.js');
    const shift = h.load('shift_pins.js');
    const adminRequest = { auth: h.staffAuth('admin-caller', 'admin'), app: { appId: 'local-test' } };
    const invite = await hardware.createWorkstationInvite.run({ ...adminRequest, data: { stationType: 'cashier', stationName: 'Counter 1' } });
    const enrolled = await hardware.enrollWorkstation.run({ app: { appId: 'local-test' }, data: { inviteCode: invite.inviteCode } });
    const pin = await shift.generateShiftPin.run({ ...adminRequest, data: { role: 'cashier', shiftWindow: 'FULL_DAY' } });
    const result = await shift.verifyShiftPin.run({ app: { appId: 'local-test' }, rawRequest: { headers: {}, ip: '192.0.2.20' },
      data: { pin: pin.pin, role: 'cashier', deviceId: enrolled.workstationId, workstationToken: enrolled.workstationToken } });
    h.user(result.workstationUid, undefined);
    const token = { ...h.issued.at(-1).claims, auth_time: Math.floor(Date.now() / 1000), iat: Math.floor(Date.now() / 1000) };
    await shift.assertActiveWorkstationSession(result.workstationUid, token);
    assert.equal(h.get('workstationInvites', invite.inviteCode).status, 'CONSUMED');
    assert.deepEqual(result.boundDevices, [enrolled.workstationId]);
  });
});

describe('T3 role assignment requires current MFA authority (real handler)', () => {
  function request(h, data = {}, token = {}) {
    return {
      auth: { uid: 'admin-caller', token: { role: 'admin', auth_time: Math.floor(Date.now() / 1000), ...token } },
      app: { appId: 'local-test' },
      data: { targetUid: 'target-user', newRole: 'pickup', privilegedSessionId: h.sessionId, ...data },
    };
  }

  it('rejects an administrator role change without a privileged session', async () => {
    const h = privilegedFixture();
    h.user('target-user', 'kitchen');
    const assign = h.load('auth_roles.js').assignStaffRole;
    await denied(assign.run({ auth: { uid: 'admin-caller', token: { role: 'admin' } },
      app: { appId: 'local-test' }, data: { targetUid: 'target-user', newRole: 'pickup' } }));
    assert.equal(h.users.get('target-user').customClaims.role, 'kitchen');
  });

  it('revokes every active session on privileged-to-privileged role changes', async () => {
    const h = privilegedFixture();
    h.user('target-user', 'manager');
    h.user('staff_linked', undefined);
    h.put('privilegedSessions', 'psess_target', { userId: 'target-user', status: 'ACTIVE' });
    h.put('workstationSessions', 'staff_linked', { staffUid: 'target-user', status: 'ACTIVE' });
    h.put('workstationSessions', 'target-user', { staffUid: 'another-user', status: 'ACTIVE' });
    const result = await h.load('auth_roles.js').assignStaffRole.run({
      auth: { uid: 'admin-caller', token: { role: 'admin', auth_time: Math.floor(Date.now() / 1000) } }, app: { appId: 'local-test' },
      data: { targetUid: 'target-user', newRole: 'admin', privilegedSessionId: h.sessionId },
    });
    assert.equal(result.success, true);
    assert.equal(h.users.get('target-user').customClaims.role, 'admin');
    assert.equal(h.get('privilegedSessions', 'psess_target').status, 'REVOKED');
    assert.equal(h.get('workstationSessions', 'staff_linked').status, 'REVOKED');
    assert.equal(h.get('workstationSessions', 'target-user').status, 'REVOKED');
    assert.ok(h.revoked.includes('staff_linked'));
  });

  it('rejects stale administrator claims after current Auth demotion or disablement', async () => {
    for (const patch of [{ customClaims: { role: 'student' } }, { customClaims: { role: 'manager' } }, { disabled: true }]) {
      const h = privilegedFixture();
      h.user('target-user', 'kitchen');
      Object.assign(h.users.get('admin-caller'), patch);
      await denied(h.load('auth_roles.js').assignStaffRole.run(request(h)));
      assert.equal(h.users.get('target-user').customClaims.role, 'kitchen');
      assert.equal(h.revoked.length, 0);
    }
  });

  it('uses current administrative authority and preserves unrelated claims on an approved change', async () => {
    const h = privilegedFixture();
    h.user('target-user', 'kitchen', { customClaims: { role: 'kitchen', accountType: 'COLLEGE_STAFF', priorityLevel: 2 } });
    const result = await h.load('auth_roles.js').assignStaffRole.run(request(h, {}, { role: 'student' }));
    assert.equal(result.success, true);
    assert.equal(h.users.get('target-user').customClaims.role, 'pickup');
    assert.equal(h.users.get('target-user').customClaims.accountType, 'COLLEGE_STAFF');
    assert.equal(h.users.get('target-user').customClaims.priorityLevel, 2);
    assert.equal(h.get('staffUsers', 'target-user').role, 'pickup');
    assert.equal(h.get('authoritativeClaims', 'target-user').role, 'pickup');
    assert.ok(h.revoked.includes('target-user'));
  });

  it('cannot use a revoked sign-in to manage roles even with a later MFA session', async () => {
    const h = privilegedFixture();
    h.user('target-user', 'kitchen');
    h.users.get('admin-caller').tokensValidAfterTime = new Date(Date.now() - 120000).toUTCString();
    await denied(h.load('auth_roles.js').assignStaffRole.run(request(h, {}, { auth_time: Math.floor(Date.now() / 1000) - 240 })), ['unauthenticated']);
    assert.equal(h.users.get('target-user').customClaims.role, 'kitchen');
  });

  it('fails closed on both caller and target Auth outages', async () => {
    for (const uid of ['admin-caller', 'target-user']) {
      const h = privilegedFixture();
      h.user('target-user', 'kitchen');
      h.authErrors.set(uid, Object.assign(new Error('Simulated Auth outage'), { code: 'auth/internal-error' }));
      await denied(h.load('auth_roles.js').assignStaffRole.run(request(h)), ['unavailable']);
      assert.equal(h.users.get('target-user').customClaims.role, 'kitchen');
    }
  });

  it('uses current engineering authority for separation of duties', async () => {
    const h = privilegedFixture();
    h.user('target-user', 'kitchen');
    await denied(h.load('auth_roles.js').assignStaffRole.run(request(h, { newRole: 'developer' }, { role: 'developer' })));
    h.user('admin-caller', 'developer');
    h.get('privilegedSessions', h.sessionId).role = 'developer';
    const result = await h.load('auth_roles.js').assignStaffRole.run(request(h, { newRole: 'developer' }, { role: 'admin' }));
    assert.equal(result.success, true);
    assert.equal(h.users.get('target-user').customClaims.role, 'developer');
  });

  it('revokes linked sessions on both promotion and demotion and leaves inactive sessions inactive', async () => {
    for (const [existingRole, newRole] of [['kitchen', 'manager'], ['manager', 'pickup']]) {
      const h = privilegedFixture();
      h.user('target-user', existingRole);
      h.user('staff_linked', undefined);
      h.put('privilegedSessions', 'psess_target', { userId: 'target-user', status: 'ACTIVE' });
      h.put('privilegedSessions', 'psess_inactive', { userId: 'target-user', status: 'IDLE_TIMEOUT' });
      h.put('workstationSessions', 'staff_linked', { staffUid: 'target-user', status: 'ACTIVE' });
      assert.equal((await h.load('auth_roles.js').assignStaffRole.run(request(h, { newRole }))).success, true);
      assert.equal(h.get('privilegedSessions', 'psess_target').status, 'REVOKED');
      assert.equal(h.get('privilegedSessions', 'psess_inactive').status, 'IDLE_TIMEOUT');
      assert.equal(h.get('workstationSessions', 'staff_linked').status, 'REVOKED');
      assert.ok(h.revoked.includes('staff_linked'));
    }
  });

  it('keeps self-role and last-engineering-administrator protections intact', async () => {
    const h = privilegedFixture();
    await denied(h.load('auth_roles.js').assignStaffRole.run(request(h, { targetUid: 'admin-caller', newRole: 'manager' })));
    h.user('admin-caller', 'developer');
    h.get('privilegedSessions', h.sessionId).role = 'developer';
    h.user('target-user', 'developer');
    h.put('staffUsers', 'target-user', { role: 'developer' });
    await denied(h.load('auth_roles.js').assignStaffRole.run(request(h)), ['failed-precondition']);
    assert.equal(h.users.get('target-user').customClaims.role, 'developer');
  });

  it('requires strict role-assignment identities and role values', async () => {
    for (const data of [{ targetUid: {} }, { targetUid: ' nested ' }, { targetUid: 'nested/document' },
      { targetUid: 'x'.repeat(129) }, { newRole: ['admin'] }, { newRole: 'ADMIN' }]) {
      const h = privilegedFixture();
      await denied(h.load('auth_roles.js').assignStaffRole.run(request(h, data)), ['invalid-argument']);
      assert.equal(h.revoked.length, 0);
    }
  });
});
