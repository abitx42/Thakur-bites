'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');

function clone(value) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

// Isolated module graph: every authorization helper/callable is the real compiled
// implementation. Only Auth/Firestore, rate-limit storage and telemetry are local.
function harness(t) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-17T06:00:00.000Z') });
  const docs = new Map();
  const users = new Map();
  const authErrors = new Map();
  const effects = { lookups: [], reads: [], writes: [], issued: [], claims: [], events: [] };
  let nextId = 0;
  const snapshot = ref => {
    const data = clone(docs.get(ref.path));
    return { id: ref.id, ref, exists: data !== undefined, data: () => clone(data) };
  };
  function write(ref, data, merge = false) {
    const value = merge ? { ...docs.get(ref.path), ...clone(data) } : clone(data);
    for (const [field, child] of Object.entries(value)) {
      if (child?.isEqual?.(FieldValue.delete())) delete value[field];
    }
    docs.set(ref.path, value);
    effects.writes.push(ref.path);
  }
  function collection(name, filters = []) {
    return {
      doc(id = `fixture-${++nextId}`) {
        assert.ok(typeof id === 'string' && id && !id.includes('/'));
        const ref = { id, path: `${name}/${id}` };
        ref.get = async () => { effects.reads.push(ref.path); return snapshot(ref); };
        ref.set = async (data, options) => write(ref, data, options?.merge);
        ref.update = async data => { assert.ok(docs.has(ref.path)); write(ref, data, true); };
        ref.collection = child => collection(`${ref.path}/${child}`);
        return ref;
      },
      where(field, operator, value) { return collection(name, [...filters, [field, operator, value]]); },
      orderBy() { return this; },
      limit() { return this; },
      async get() {
        effects.reads.push(name);
        const matches = [...docs.keys()].filter(key => key.startsWith(`${name}/`))
          .map(key => snapshot(collection(name).doc(key.slice(name.length + 1))))
          .filter(doc => filters.every(([field, operator, value]) => {
            assert.ok(['==', 'in'].includes(operator));
            return operator === 'in' ? value.includes(doc.data()[field]) : doc.data()[field] === value;
          }));
        return { docs: matches, empty: matches.length === 0, size: matches.length, forEach: callback => matches.forEach(callback) };
      },
    };
  }
  const db = {
    collection,
    async runTransaction(callback) {
      const writes = [];
      const result = await callback({
        async get(ref) {
          assert.equal(writes.length, 0, 'Firestore transactions read before writing');
          effects.reads.push(ref.path);
          return snapshot(ref);
        },
        set(ref, data, options) { writes.push(() => write(ref, data, options?.merge)); },
        update(ref, data) { writes.push(() => { assert.ok(docs.has(ref.path)); write(ref, data, true); }); },
        delete(ref) { writes.push(() => { docs.delete(ref.path); effects.writes.push(ref.path); }); },
      });
      for (const commit of writes) commit();
      return result;
    },
  };
  const auth = {
    async getUser(uid) {
      effects.lookups.push(uid);
      if (authErrors.has(uid)) throw authErrors.get(uid);
      if (!users.has(uid)) throw Object.assign(new Error('Missing fixture account'), { code: 'auth/user-not-found' });
      return clone(users.get(uid));
    },
    async setCustomUserClaims(uid, claims) {
      assert.ok(users.has(uid));
      users.get(uid).customClaims = clone(claims);
      effects.claims.push(uid);
    },
    async createCustomToken(uid, claims) {
      assert.equal(docs.get(`workstationSessions/${uid}`)?.sessionGeneration, claims.sessionGeneration);
      effects.issued.push({ uid, claims: clone(claims) });
      return 'fixture-workstation-token';
    },
    async revokeRefreshTokens() {},
  };
  const admin = { apps: [{}], firestore: Object.assign(() => db, { Timestamp, FieldValue }), auth: () => auth };
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
      if (specifier === './security_logger') return { logSecurityEvent: async event => { effects.events.push(event); } };
      if (specifier === './tv_projection') return { updatePublicLiveQueueProjection: async () => {} };
      if (specifier === './refunds') return { reserveAndExecuteRefund: async () => { throw new Error('Unexpected refund'); } };
      if (specifier.startsWith('.')) return load(realRequire.resolve(specifier));
      return realRequire(specifier);
    };
    loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
    return loaded.exports;
  }
  const h = {
    docs, users, authErrors, effects, load,
    put(name, id, data) { docs.set(`${name}/${id}`, clone(data)); },
    user(uid = 'operator', role = 'manager', patch = {}) {
      users.set(uid, { uid, disabled: false, customClaims: { role },
        tokensValidAfterTime: new Date(Date.now() - 3600000).toUTCString(), ...patch });
    },
    auth(uid = 'operator', role = 'manager', patch = {}) {
      return { uid, token: { uid, sub: uid, role, auth_time: Math.floor(Date.now() / 1000) - 120,
        iat: Math.floor(Date.now() / 1000), ...patch } };
    },
    request(data, role = 'manager', token = {}) {
      return { auth: h.auth('operator', role, token), app: { appId: 'staff-authority-regression' }, data };
    },
  };
  h.user();
  return h;
}

const denied = (promise, code = 'unauthenticated') => assert.rejects(promise, error => error.code === code);

describe('Current staff authority (real helper)', () => {
  for (const role of ['kitchen', 'pickup', 'cashier', 'manager', 'admin', 'developer', 'security_admin', 'system']) {
    it(`accepts the enabled current ${role} with matching signed identity and role`, async t => {
      const h = harness(t);
      h.user('operator', role);
      assert.equal(await h.load('staff_authority.js').assertCurrentStaffAuthority('operator', h.auth('operator', role).token), role);
      assert.deepEqual(h.effects.lookups, ['operator']);
    });
  }

  for (const [label, patch] of [
    ['disabled', { disabled: true }], ['missing enabled state', { disabled: undefined }],
    ['demoted', { customClaims: { role: 'student' } }], ['changed staff role', { customClaims: { role: 'admin' } }],
    ['removed role', { customClaims: {} }], ['wrong Auth UID', { uid: 'another-user' }],
    ['revoked', { tokensValidAfterTime: new Date('2026-10-17T05:59:00Z').toUTCString() }],
    ['malformed revocation epoch', { tokensValidAfterTime: 'invalid' }],
    ['null revocation epoch', { tokensValidAfterTime: null }],
    ['future revocation epoch', { tokensValidAfterTime: new Date('2026-10-18T00:00:00Z').toUTCString() }],
    ['workstation Auth marker', { customClaims: { role: 'manager', isWorkstationSession: true } }],
  ]) {
    it(`rejects ${label} current Auth state`, async t => {
      const h = harness(t);
      h.user('operator', 'manager', patch);
      await denied(h.load('staff_authority.js').assertCurrentStaffAuthority('operator', h.auth().token));
    });
  }

  for (const [label, patch] of [
    ['missing auth_time', { auth_time: undefined }], ['coerced auth_time', { auth_time: '1792216680' }],
    ['future auth_time', { auth_time: 2000000000 }], ['non-finite auth_time', { auth_time: NaN }],
    ['zero auth_time', { auth_time: 0 }], ['fractional auth_time', { auth_time: 1792216680.5 }],
    ['wrong UID claim', { uid: 'someone-else' }], ['wrong subject', { sub: 'someone-else' }],
    ['missing UID binding', { uid: undefined }], ['missing subject binding', { sub: undefined }],
    ['missing issued-at time', { iat: undefined }], ['issued before authentication', { iat: 1 }],
    ['future issued-at time', { iat: 2000000000 }], ['noncanonical role', { role: ' MANAGER ' }],
    ['array role', { role: ['manager'] }], ['customer role', { role: 'college_staff' }],
    ['workstation marker', { isWorkstationSession: true }],
  ]) {
    it(`rejects ${label} in signed staff claims`, async t => {
      const h = harness(t);
      await denied(h.load('staff_authority.js').assertCurrentStaffAuthority('operator', h.auth('operator', 'manager', patch).token));
      assert.equal(h.effects.writes.length, 0);
    });
  }

  it('uses original auth_time, not a refreshed iat, and accepts a valid sign-in at the revocation boundary', async t => {
    const h = harness(t);
    const epoch = Math.floor(Date.now() / 1000) - 60;
    h.user('operator', 'manager', { tokensValidAfterTime: new Date(epoch * 1000).toUTCString() });
    const check = patch => h.load('staff_authority.js').assertCurrentStaffAuthority('operator', h.auth('operator', 'manager', patch).token);
    await denied(check({ auth_time: epoch - 1 }));
    assert.equal(await check({ auth_time: epoch }), 'manager');
    delete h.users.get('operator').tokensValidAfterTime;
    assert.equal(await check({}), 'manager', 'Firebase may omit the optional revocation epoch');
  });

  it('fails closed for deleted accounts and Auth lookup failures without leaking internal errors', async t => {
    const h = harness(t);
    const check = () => h.load('staff_authority.js').assertCurrentStaffAuthority('operator', h.auth().token);
    h.users.delete('operator');
    await denied(check());
    h.authErrors.set('operator', Object.assign(new Error('private-auth-outage'), { code: 'auth/internal-error' }));
    await assert.rejects(check(), error => error.code === 'unavailable' && !error.message.includes('private-auth-outage'));
  });
});

describe('Kill switch current staff authorization (real callable)', () => {
  for (const email of ['admin.person@gmail.com', 'adi@tcetmumbai.in', 'person@tcetmumbai.in', 'person@thakureducation.org', 'person@gmail.com']) {
    it(`never elevates the email ${email} without signed current staff authority`, async t => {
      const h = harness(t);
      h.user('operator', undefined, { customClaims: {}, email, emailVerified: true });
      const request = h.request({ mode: 'DEGRADED' }, undefined, { role: undefined, email, email_verified: true });
      await denied(h.load('kill_switch.js').setSystemOperationalMode.run(request));
      assert.equal(h.effects.writes.length, 0);
    });
  }

  it('never elevates a client profile, staffUsers document or fake workstation marker', async t => {
    const h = harness(t);
    h.put('users', 'operator', { role: 'admin', accountType: 'COLLEGE_STAFF', isVerified: true });
    h.put('staffUsers', 'operator', { role: 'admin', status: 'ACTIVE' });
    h.user('operator', 'student');
    const handler = h.load('kill_switch.js').setSystemOperationalMode;
    await denied(handler.run(h.request({ mode: 'EMERGENCY_HALT' }, undefined, { role: undefined })));
    await denied(handler.run(h.request({ mode: 'EMERGENCY_HALT' }, 'admin', { isWorkstationSession: true })));
    await denied(handler.run(h.request({ mode: 'EMERGENCY_HALT' }, undefined, { role: undefined, isWorkstationSession: true })));
    assert.equal(h.effects.writes.length, 0);
    assert.equal(h.effects.reads.length, 0, 'Unverified authority must be rejected before privileged config/profile reads');
  });

  it('retains valid manager transitions and the admin-only halt/restore separation of duties', async t => {
    const h = harness(t);
    const handler = h.load('kill_switch.js').setSystemOperationalMode;
    const call = mode => handler.run(h.request({ mode, reason: 'Operations update' }));
    assert.equal((await call('DEGRADED')).mode, 'DEGRADED');
    assert.equal(h.docs.get('publicSystemStatus/global').orderingAvailable, false);
    assert.equal((await call('NORMAL')).mode, 'NORMAL');
    assert.equal((await call('FINANCIAL_FROZEN')).mode, 'FINANCIAL_FROZEN');
    await denied(call('NORMAL'), 'permission-denied');
    await denied(call('EMERGENCY_HALT'), 'permission-denied');
    h.user('operator', 'admin');
    assert.equal((await handler.run(h.request({ mode: 'EMERGENCY_HALT' }, 'admin'))).success, true);
    h.user('operator', 'manager');
    await denied(call('NORMAL'), 'permission-denied');
    h.user('operator', 'admin');
    assert.equal((await handler.run(h.request({ mode: 'NORMAL' }, 'admin'))).success, true);
    assert.equal(h.docs.get('systemConfig/global').updatedBy, 'operator');
    assert.equal(h.docs.get('publicSystemStatus/global').orderingAvailable, true);
  });
});

describe('Ordinary staff and customers at the shared workstation guard (real helper/callables)', () => {
  it('revalidates ordinary staff without requiring a workstation session', async t => {
    const h = harness(t);
    const shift = h.load('shift_pins.js');
    await shift.assertActiveWorkstationSession('operator', h.auth().token);
    h.users.get('operator').disabled = true;
    await denied(shift.assertActiveWorkstationSession('operator', h.auth().token));
    assert.equal(h.docs.size, 0);
    assert.deepEqual(h.effects.lookups, ['operator', 'operator']);
  });

  it('checks normalized staff-like claims too, instead of bypassing current authority', async t => {
    const h = harness(t);
    await denied(h.load('shift_pins.js').assertActiveWorkstationSession('operator', h.auth('operator', ' MANAGER ').token));
  });

  it('preserves customer self-cancellation but grants no staff cancellation or administrative capability', async t => {
    const h = harness(t);
    const shift = h.load('shift_pins.js');
    for (const role of ['student', 'customer', 'teacher', 'college_staff', 'visitor', 'guest', undefined]) {
      await shift.assertActiveWorkstationSession('customer-user', { role });
    }
    assert.equal(h.effects.lookups.length, 0, 'Customer calls do not require a permanent operational staff role');
    h.put('orders', 'customer-order', { studentId: 'customer-user', status: 'payment_pending', paymentStatus: 'pending', items: [] });
    const handler = h.load('order_state.js').cancelOrder;
    const request = { app: { appId: 'local-test' }, auth: h.auth('customer-user', 'student'),
      data: { orderId: 'customer-order', reason: 'Plans changed' } };
    const outsider = { ...request, auth: h.auth('another-customer', 'student') };
    await denied(handler.run(outsider), 'permission-denied');
    assert.equal(h.effects.writes.length, 0);
    assert.equal((await handler.run(request)).status, 'cancelled');
    assert.equal(h.docs.get('orders/customer-order').cancelledBy, 'customer-user');
    await denied(h.load('kill_switch.js').setSystemOperationalMode.run(h.request({ mode: 'DEGRADED' }, 'student')));
  });

  it('retains complete validation for issued workstations with no permanent Auth role', async t => {
    const h = harness(t);
    const hardware = h.load('workstation_binding.js');
    const shift = h.load('shift_pins.js');
    const invite = await hardware.createWorkstationInvite.run(h.request({ stationType: 'kitchen', stationName: 'Kitchen' }));
    const enrolled = await hardware.enrollWorkstation.run({ app: { appId: 'local-test' }, data: { inviteCode: invite.inviteCode } });
    const generated = await shift.generateShiftPin.run(h.request({ role: 'kitchen', shiftWindow: 'FULL_DAY' }));
    const login = await shift.verifyShiftPin.run({ app: { appId: 'local-test' }, rawRequest: { headers: {}, ip: '192.0.2.40' },
      data: { pin: generated.pin, role: 'kitchen', deviceId: enrolled.workstationId, workstationToken: enrolled.workstationToken } });
    const issued = h.effects.issued.at(-1);
    h.user(login.workstationUid, undefined, { customClaims: {} });
    const token = { ...h.auth(login.workstationUid, 'kitchen', { auth_time: Math.floor(Date.now() / 1000) }).token, ...issued.claims };
    await shift.assertActiveWorkstationSession(login.workstationUid, token);
    assert.deepEqual(await h.load('operational_views.js').getKitchenOrders.run({ app: { appId: 'local-test' },
      auth: { uid: login.workstationUid, token } }), []);
    await denied(h.load('kill_switch.js').setSystemOperationalMode.run({ ...h.request({ mode: 'DEGRADED' }),
      auth: { uid: login.workstationUid, token } }));
    h.docs.get(`registeredWorkstations/${enrolled.workstationId}`).status = 'REVOKED';
    await denied(shift.assertActiveWorkstationSession(login.workstationUid, token));
  });

  it('a real operational callable rejects ordinary staff demotion and revocation before reading orders', async t => {
    const h = harness(t);
    const handler = h.load('operational_views.js').getKitchenOrders;
    h.user('operator', 'kitchen');
    assert.deepEqual(await handler.run(h.request(undefined, 'kitchen')), []);
    for (const patch of [
      { customClaims: { role: 'student' } },
      { tokensValidAfterTime: new Date(Date.now() - 60000).toUTCString() },
    ]) {
      h.user('operator', 'kitchen', patch);
      h.effects.reads.length = 0;
      await denied(handler.run(h.request(undefined, 'kitchen')));
      assert.equal(h.effects.reads.length, 0);
    }
  });
});

const protectedCalls = [
  ['shift PIN generation', 'shift_pins.js', 'generateShiftPin', 'manager', { role: 'pickup', shiftWindow: 'FULL_DAY' }],
  ['shift PIN revocation', 'shift_pins.js', 'revokeShiftPin', 'manager', { pinId: 'pickup_2026-10-17_FULL_DAY' }],
  ['shift PIN listing', 'shift_pins.js', 'listActiveShiftPins', 'manager', {}],
  ['kill-switch mutation', 'kill_switch.js', 'setSystemOperationalMode', 'manager', { mode: 'DEGRADED' }],
  ['verification review', 'verification.js', 'reviewVerificationApplication', 'manager', { applicationId: 'FAC-TEST', decision: 'APPROVED' }],
  ['version policy update', 'version_policy.js', 'updateAppVersionPolicy', 'admin', { latestVersion: '2.0.0', minimumSupportedVersion: '1.0.0' }],
  ['owner feature flags', 'owner_console.js', 'updateOwnerFeatureFlags', 'manager', { onlineOrderingEnabled: false }],
  ['workstation invite creation', 'workstation_binding.js', 'createWorkstationInvite', 'manager', { stationType: 'kitchen' }],
  ['workstation revocation', 'workstation_binding.js', 'revokeWorkstation', 'manager', { workstationId: 'WS-TEST' }],
  ['workstation directory', 'workstation_binding.js', 'listRegisteredWorkstations', 'manager', {}],
];

describe('Administrative current-authority boundaries (real callables)', () => {
  for (const [label, filename, name, role, data] of protectedCalls) {
    it(`${label} rejects disabled, demoted, revoked, missing and unavailable current authority before privileged work`, async t => {
      const h = harness(t);
      const handler = h.load(filename)[name];
      const request = h.request(data, role);
      for (const patch of [
        { disabled: true }, { customClaims: { role: 'student' } },
        { tokensValidAfterTime: new Date(Date.now() - 60000).toUTCString() },
      ]) {
        h.user('operator', role, patch);
        await denied(handler.run(request));
      }
      h.users.delete('operator');
      await denied(handler.run(request));
      h.authErrors.set('operator', Object.assign(new Error('private-auth-outage'), { code: 'auth/internal-error' }));
      await denied(handler.run(request), 'unavailable');
      assert.equal(h.effects.writes.length, 0);
      assert.equal(h.effects.reads.length, 0);
      assert.equal(h.effects.claims.length, 0);
      assert.equal(h.effects.issued.length, 0);
    });
  }

  it('valid current managers can generate/list/revoke a PIN and update campus flags', async t => {
    const h = harness(t);
    const shift = h.load('shift_pins.js');
    const generated = await shift.generateShiftPin.run(h.request({ role: 'pickup', shiftWindow: 'FULL_DAY' }));
    const listed = await shift.listActiveShiftPins.run(h.request({}));
    assert.equal(listed.pins[0].pinId, generated.pinId);
    assert.equal((await shift.revokeShiftPin.run(h.request({ pinId: generated.pinId }))).status, 'REVOKED');
    assert.equal(h.docs.get(`shiftPins/${generated.pinId}`).status, 'REVOKED');
    assert.equal((await h.load('owner_console.js').updateOwnerFeatureFlags.run(h.request({ onlineOrderingEnabled: false }))).success, true);
    assert.equal(h.docs.get('featureFlags/global').onlineOrderingEnabled, false);
    assert.ok(h.effects.lookups.length >= 4);
  });

  it('review retains four-eyes protection and approvals change account type without granting operational staff roles', async t => {
    const h = harness(t);
    const handler = h.load('verification.js').reviewVerificationApplication;
    const application = { userId: 'operator', applicationType: 'TEACHER', status: 'SUBMITTED',
      employeeId: 'EMP-1', department: 'Physics', designation: 'Teacher' };
    h.put('verificationApplications', 'FAC-TEST', application);
    await denied(handler.run(h.request({ applicationId: 'FAC-TEST', decision: 'APPROVED' })), 'permission-denied');
    assert.equal(h.effects.writes.length, 0);
    h.user('applicant', 'student');
    h.put('users', 'applicant', { verificationStatus: 'UNDER_REVIEW' });
    h.put('verificationApplications', 'FAC-TEST', { ...application, userId: 'applicant' });
    assert.equal((await handler.run(h.request({ applicationId: 'FAC-TEST', decision: 'APPROVED' }))).claimsSynced, true);
    assert.equal(h.users.get('applicant').customClaims.role, 'student');
    assert.equal(h.users.get('applicant').customClaims.accountType, 'TEACHER');
    assert.equal(h.docs.get('verificationApplications/FAC-TEST').reviewerId, 'operator');
  });

  it('version updates preserve capability restrictions while allowing a current engineering administrator', async t => {
    const h = harness(t);
    const handler = h.load('version_policy.js').updateAppVersionPolicy;
    const data = { latestVersion: '2.0.0', minimumSupportedVersion: '1.0.0' };
    await denied(handler.run(h.request(data)), 'permission-denied');
    assert.equal(h.effects.writes.length, 0);
    h.user('operator', 'developer');
    assert.equal((await handler.run(h.request(data, 'developer'))).success, true);
    assert.equal(h.docs.get('appConfig/versions').updatedBy, 'operator');
  });
});
