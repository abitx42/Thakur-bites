const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const workstationId = 'TB_WS_KITCHEN_ABCDEF12';
const workstationToken = `wstok_${'a'.repeat(48)}`;
const uid = 'staff_kitchen_2026-10-17_fixture';
const claims = {
  role: 'kitchen', isWorkstationSession: true, deviceId: workstationId,
  shiftDate: '2026-10-17', shiftWindow: 'FULL_DAY', pinId: 'kitchen_2026-10-17_FULL_DAY',
  sessionGeneration: 'b'.repeat(32),
};
const response = { success: true, token: 'fixture-custom-token', role: 'kitchen', workstationUid: uid, boundDevices: [workstationId] };

// Load the actual exported authentication implementation; Firebase, browser
// storage and callable transport are the only substituted boundaries.
function harness(options = {}) {
  const calls = [];
  const customTokens = [];
  const anonymousSignIns = [];
  const states = [];
  const local = new Map([['tb_workstation_device_id', 'local-device-fixture']]);
  const session = new Map();
  let listener;
  let signOuts = 0;
  const user = {
    uid: options.uid || uid, isAnonymous: options.isAnonymous === true,
    async getIdTokenResult(refresh) {
      assert.equal(refresh, true);
      if (options.tokenError) throw options.tokenError;
      return { claims: options.claims || claims };
    },
  };
  const auth = { currentUser: options.initialUser || null };
  const firebase = {
    auth, functions: {},
    subscribeStaffAuth(callback) { listener = callback; return () => {}; },
    async staffLogin() { auth.currentUser = user; return { user, role: (options.claims || claims).role }; },
    async staffLogout() {
      signOuts++;
      auth.currentUser = null;
      listener({ user: null, role: null, isAuthenticated: false });
    },
  };
  const authSDK = {
    async signInWithCustomToken(_auth, token) {
      customTokens.push(token);
      if (options.signInError) throw options.signInError;
      auth.currentUser = user;
      // Firebase can notify observers before loginWithShiftPin finishes checking
      // its credential. Provisional identities may not become dashboard access.
      listener({ user, role: (options.claims || claims).role, isAuthenticated: true });
      return { user };
    },
    async signInAnonymously() { anonymousSignIns.push(true); auth.currentUser = user; return { user }; },
  };
  const functionsSDK = {
    httpsCallable(_functions, name) {
      return async payload => {
        calls.push({ name, payload });
        if (options.wait) await options.wait;
        if (options.callError) throw options.callError;
        return { data: Object.hasOwn(options, 'response') ? options.response : response };
      };
    },
  };
  const storage = map => ({
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key),
  });
  const file = path.resolve(__dirname, '../../js/auth.js');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name.startsWith('./firebase.js')) return firebase;
      if (name.includes('firebase-auth.js')) return authSDK;
      if (name.includes('firebase-functions.js')) return functionsSDK;
      if (name === './networkSentinel.js') return { getFriendlyErrorMessage: (error, fallback) => error?.message || fallback };
      throw new Error(`Unexpected authentication dependency: ${name}`);
    },
    localStorage: storage(local), sessionStorage: storage(session),
    navigator: { userAgent: 'authority-test-browser' }, window: { screen: { width: 1000, height: 800 } },
    console: { error() {}, warn() {} },
  }, { filename: file });
  module.exports.onStaffAuthStateChanged(state => states.push(state));
  if (options.enrolled !== false) module.exports.saveRegisteredWorkstation(workstationId, workstationToken, 'kitchen', 'Test kitchen');
  return {
    api: module.exports, auth, user, calls, customTokens, anonymousSignIns, local, session, states,
    get signOuts() { return signOuts; },
    emitAuth(user, role) { auth.currentUser = user; listener({ user, role, isAuthenticated: Boolean(user && role) }); },
  };
}

describe('T1 actual workstation authentication caller regressions', () => {
  it('rejects unregistered hardware and station-role mismatches without contacting verification', async () => {
    for (const options of [{ enrolled: false }, {}]) {
      const h = harness(options);
      const result = await h.api.staffAuth.loginWithShiftPin('123456', options.enrolled === false ? 'kitchen' : 'pickup');
      assert.equal(result.success, false);
      assert.match(result.error, /enroll|station/i);
      assert.equal(h.calls.length, 0);
      assert.equal(h.anonymousSignIns.length, 0);
      assert.equal(h.api.staffAuth.isAuthenticated(), false);
    }
  });

  it('rejects administrative roles and nondigit PINs before dispatch', async () => {
    for (const [pin, role] of [['123456', 'admin'], ['abcdef', 'kitchen'], ['12345', 'kitchen'], ['1234567', 'kitchen']]) {
      const h = harness();
      assert.equal((await h.api.staffAuth.loginWithShiftPin(pin, role)).success, false);
      assert.equal(h.calls.length, 0);
    }
  });

  for (const code of ['functions/not-found', 'not-found', 'functions/unavailable', 'functions/permission-denied']) {
    it(`${code} cannot become anonymous staff authorization`, async () => {
      const error = Object.assign(new Error('verification unavailable'), { code });
      const h = harness({ callError: error });
      const result = await h.api.staffAuth.loginWithShiftPin('123456', 'kitchen');
      assert.equal(result.success, false);
      assert.equal(result.code, code);
      assert.equal(h.calls.length, 1);
      assert.equal(h.customTokens.length, 0);
      assert.equal(h.anonymousSignIns.length, 0);
      assert.equal(h.session.has('tb_session_role'), false);
      assert.equal(h.api.staffAuth.isAuthenticated(), false);
      assert.ok(h.states.every(state => !state.isAuthenticated));
    });
  }

  it('requires a complete successful server response before using a custom token', async () => {
    for (const data of [null, {}, { ...response, success: false }, { ...response, role: undefined },
      { ...response, role: 'admin' }, { ...response, token: '' }, { ...response, workstationUid: null },
      { ...response, boundDevices: [] }]) {
      const h = harness({ response: data });
      assert.equal((await h.api.staffAuth.loginWithShiftPin('123456', 'kitchen')).success, false);
      assert.equal(h.customTokens.length, 0);
      assert.equal(h.api.staffAuth.isAuthenticated(), false);
    }
  });

  it('accepts only the refreshed, nonanonymous, device-bound station identity', async () => {
    const h = harness();
    const result = await h.api.staffAuth.loginWithShiftPin('123456', 'kitchen');
    assert.equal(result.success, true);
    assert.equal(result.role, 'kitchen');
    assert.equal(h.calls[0].name, 'verifyShiftPin');
    assert.equal(h.calls[0].payload.deviceId, workstationId);
    assert.equal(h.calls[0].payload.workstationToken, workstationToken);
    assert.equal(h.api.staffAuth.getDeviceId(), workstationId);
    assert.equal(h.api.staffAuth.isAuthenticated(), true);
    assert.equal(h.states.filter(state => state.isAuthenticated).length, 1);
    assert.equal(h.session.has('tb_session_role'), false);
  });

  it('rejects mismatched identities/claims and never publishes a provisional staff state', async () => {
    for (const options of [
      { uid: 'another-user' }, { isAnonymous: true },
      { claims: { ...claims, role: 'admin' } }, { claims: { ...claims, role: 'pickup' } },
      { claims: { ...claims, deviceId: 'another-workstation' } },
      { claims: { ...claims, isWorkstationSession: false } },
      { claims: { ...claims, sessionGeneration: undefined } },
      { claims: { ...claims, pinId: 'unrelated-pin' } },
    ]) {
      const h = harness(options);
      assert.equal((await h.api.staffAuth.loginWithShiftPin('123456', 'kitchen')).success, false);
      assert.equal(h.api.staffAuth.isAuthenticated(), false);
      assert.ok(h.states.every(state => !state.isAuthenticated));
      assert.equal(h.signOuts, 1);
    }
  });

  it('fails closed when the signed-in custom token cannot refresh', async () => {
    const error = new Error('token refresh failed');
    const h = harness({ tokenError: error });
    assert.equal((await h.api.staffAuth.loginWithShiftPin('123456', 'kitchen')).success, false);
    assert.equal(h.api.staffAuth.getRole(), null);
    assert.equal(h.auth.currentUser, null);
    assert.ok(h.states.every(state => !state.isAuthenticated));
  });

  it('does not authenticate an old local state after Firebase changes account', () => {
    const h = harness();
    h.emitAuth(h.user, 'kitchen');
    h.auth.currentUser = { uid: 'different-account' };
    assert.equal(h.api.staffAuth.isAuthenticated(), false);
  });

  it('restored and locally unlinked workstation identities still require enrolled hardware', () => {
    const h = harness({ enrolled: false });
    h.emitAuth(h.user, 'kitchen');
    assert.equal(h.api.staffAuth.isAuthenticated(), false);
    h.api.saveRegisteredWorkstation(workstationId, workstationToken, 'kitchen', 'Kitchen');
    h.emitAuth(h.user, 'kitchen');
    assert.equal(h.api.staffAuth.isAuthenticated(), true);
    h.api.clearRegisteredWorkstation();
    assert.equal(h.api.staffAuth.isAuthenticated(), false);
  });

  it('clears role authority and preserves refresh errors instead of returning a stale role', async () => {
    for (const options of [{ tokenError: new Error('refresh unavailable') }, { claims: { role: 'student' } }]) {
      const h = harness({ ...options, uid: 'regular-admin-user' });
      h.emitAuth(h.user, 'admin');
      await assert.rejects(h.api.staffAuth.refreshTokenClaims(), options.tokenError ? error => error === options.tokenError : /authorization/i);
      assert.equal(h.api.staffAuth.getRole(), null);
      assert.equal(h.api.staffAuth.isAuthenticated(), false);
      assert.equal(h.states.at(-1).isAuthenticated, false);
    }
  });

  it('refreshes legitimate canonical staff roles and refuses a missing Firebase identity', async () => {
    const h = harness({ uid: 'regular-manager-user', claims: { role: 'manager' } });
    h.emitAuth(h.user, 'manager');
    assert.equal(await h.api.staffAuth.refreshTokenClaims(), 'manager');
    assert.equal(h.api.staffAuth.isAuthenticated(), true);
    h.auth.currentUser = null;
    await assert.rejects(h.api.staffAuth.refreshTokenClaims(), /authentication/i);
    assert.equal(h.api.staffAuth.getRole(), null);
  });

  it('logout invalidates an in-flight shift login before any later custom-token sign-in', async () => {
    let finish;
    const wait = new Promise(resolve => { finish = resolve; });
    const h = harness({ wait });
    const pending = h.api.staffAuth.loginWithShiftPin('123456', 'kitchen');
    await h.api.staffAuth.logout();
    finish();
    assert.equal((await pending).success, false);
    assert.equal(h.customTokens.length, 0);
    assert.equal(h.api.staffAuth.isAuthenticated(), false);
  });

  it('does not cache incomplete enrollment responses or infer their role from a request', async () => {
    for (const data of [{ success: true }, { success: true, workstationId, workstationToken },
      { success: true, workstationId, workstationToken, stationType: 'admin' }]) {
      const h = harness({ enrolled: false, response: data });
      assert.equal((await h.api.enrollWorkstationClient('WS-FIXTURE', 'Kitchen', 'kitchen')).success, false);
      assert.equal(h.api.getRegisteredWorkstation(), null);
    }
  });

  it('stores the station identity returned by successful server enrollment', async () => {
    const h = harness({ enrolled: false, response: {
      success: true, workstationId: 'TB_WS_CASHIER_ABCDEF12', workstationToken,
      stationType: 'cashier', stationName: 'Cashier counter',
    } });
    assert.equal((await h.api.enrollWorkstationClient('WS-FIXTURE', 'Terminal', 'kitchen')).success, true);
    assert.equal(h.api.getRegisteredWorkstation().role, 'cashier');
    assert.equal(h.api.getRegisteredWorkstation().id, 'TB_WS_CASHIER_ABCDEF12');
  });

  it('privileged sessions are account-bound and malformed/expired local sessions are rejected', () => {
    const admin = { uid: 'admin-account' };
    const h = harness({ initialUser: admin });
    h.api.savePrivilegedSession({ success: true, sessionId: 'psess_fixture', role: 'admin', expiresAt: new Date(Date.now() + 60000).toISOString() });
    assert.equal(h.api.getPrivilegedSession().userId, admin.uid);
    h.auth.currentUser = { uid: 'different-admin' };
    assert.equal(h.api.getPrivilegedSession(), null);
    for (const expiresAt of ['not-a-date', new Date(Date.now() - 60000).toISOString()]) {
      h.api.savePrivilegedSession({ sessionId: 'psess_fixture', role: 'admin', expiresAt });
      assert.equal(h.api.getPrivilegedSession(), null);
    }
  });
});
