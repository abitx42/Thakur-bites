const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual browser module. Only Firebase's CDN imports and browser
// globals are stubbed; none of the service's authorization/action code is copied.
const servicePath = path.resolve(__dirname, '../../js/firebase.js');
const serviceCode = ts.transpileModule(fs.readFileSync(servicePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function loadService(options = {}) {
  const calls = [];
  const reads = [];
  const writes = [];
  const batches = [];
  const snapshots = [];
  const timers = [];
  const storage = new Map([['tb_session_role', 'admin']]);
  const user = options.user || {
    uid: 'staff-user',
    email: options.email || 'employee@tcetmumbai.in',
    async getIdTokenResult(refresh) {
      assert.equal(refresh, true, 'roles must come from a refreshed token');
      if (options.tokenError) throw options.tokenError;
      return { claims: options.claims || {} };
    },
  };
  const auth = { currentUser: user };
  let authListener;
  const document = (_db, ...parts) => ({ path: parts.join('/'), id: parts.at(-1) });
  const readDocument = async (reference, source) => {
    reads.push({ path: reference.path, source });
    if (options.readError) throw options.readError;
    const data = reference.path.startsWith('staffUsers/')
      ? options.staffRecord
      : options.userRecord;
    return { exists: () => data != null, data: () => data };
  };
  const sdk = {
    initializeApp: () => ({}), getApps: () => [], getApp: () => ({}),
    initializeAppCheck: () => ({}), ReCaptchaV3Provider: class { constructor(siteKey) { this.siteKey = siteKey; } },
    getFirestore: () => ({}), getAuth: () => auth, getFunctions: () => ({}), getStorage: () => ({}),
    collection: document, doc: document,
    getDoc: reference => readDocument(reference, 'default'),
    getDocFromServer: reference => readDocument(reference, 'server'),
    getDocs: async reference => {
      reads.push({ path: reference.path, source: 'query' });
      if (options.queryError) throw options.queryError;
      return { docs: [] };
    },
    updateDoc: async (...args) => { writes.push({ operation: 'update', args }); },
    setDoc: async (...args) => { writes.push({ operation: 'set', args }); },
    deleteDoc: async (...args) => { writes.push({ operation: 'delete', args }); },
    writeBatch: () => {
      const batch = { operations: [], commits: 0 };
      batches.push(batch);
      return {
        set(reference, data, config) { batch.operations.push({ reference, data, config }); },
        async commit() {
          batch.commits++;
          if (options.batchError) throw options.batchError;
          writes.push(...batch.operations.map(operation => ({ operation: 'batch-set', ...operation })));
        },
      };
    },
    onSnapshot: (reference, next, error) => {
      snapshots.push({ reference, next, error });
      return () => {};
    },
    query: reference => reference, orderBy: () => ({}), where: () => ({}), limit: () => ({}),
    Timestamp: { now: () => ({ timestamp: true }) },
    serverTimestamp: () => ({ serverTimestamp: true }), increment: value => ({ increment: value }),
    signInWithEmailAndPassword: async (_auth, email) => {
      calls.push({ login: email });
      return { user };
    },
    signInAnonymously: async () => ({ user }),
    signOut: async () => { auth.currentUser = null; },
    onAuthStateChanged: (_auth, callback) => {
      authListener = callback;
      return () => { authListener = undefined; };
    },
    httpsCallable: (_functions, name) => async payload => {
      calls.push({ name, payload });
      if (options.callError) throw options.callError;
      if (options.callHandler) return { data: await options.callHandler(name, payload) };
      return { data: Object.hasOwn(options, 'response') ? options.response : { success: true } };
    },
    connectFunctionsEmulator: () => {}, ref: () => ({}),
    uploadBytes: async () => ({}), getDownloadURL: async () => '',
  };
  const module = { exports: {} };
  vm.runInNewContext(serviceCode, {
    module, exports: module.exports,
    require(name) {
      if (name === './publicConfig.js') return { publicConfig: { appCheckSiteKey: 'public-test-site-key', functionsEmulator: null } };
      assert.match(name, /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.0\/firebase-/);
      return sdk;
    },
    window: { location: { hostname: 'dashboard.example.test', origin: 'https://dashboard.example.test' } },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    localStorage: { removeItem: () => {} },
    console: { warn: () => {}, error: () => {}, log: () => {} },
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
  }, { filename: servicePath });
  return {
    service: module.exports, calls, reads, writes, batches, snapshots, user, auth,
    emitAuth: value => authListener(value),
    async flushTimers() { while (timers.length) await timers.shift()(); },
  };
}

function loadInventoryHandler() {
  const writes = [];
  const item = { stockOnHand: 5, stockCount: 3, reservedStock: 2 };
  const db = {
    collection: name => ({ doc: (id = 'test-ledger') => ({ path: `${name}/${id}`, id }) }),
    async runTransaction(callback) {
      const pending = [];
      const result = await callback({
        async get(reference) {
          assert.equal(reference.path, 'menuItems/item-1');
          return { exists: true, data: () => ({ ...item }) };
        },
        update(reference, data) { pending.push({ reference, data }); },
        set(reference, data) { pending.push({ reference, data }); },
      });
      writes.push(...pending);
      return result;
    },
  };
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const dependencies = {
    'firebase-admin/firestore': { Timestamp: { now: () => ({ toMillis: () => 123 }) } },
    'firebase-functions/v2/https': { onCall: handler => handler, HttpsError },
    'firebase-admin': { firestore: () => db },
    './security_logger': { logSecurityEvent: async () => {} },
    './rate_limiter': { enforceRateLimit: async () => {} },
    './app_check': { enforceAppCheck: () => {} },
    './shift_pins': { assertActiveWorkstationSession: async () => {} },
    './authorization_policy': { hasCapability: () => true, isOperationalStaffRole: () => true },
    './honeypot_defense': { assertNoHoneytokens: async () => {} },
  };
  const filename = path.resolve(__dirname, '../src/inventory.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected inventory dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return { handler: module.exports.adjustInventoryStock, writes };
}

const actions = [
  ['updateOrderStatusInDb', ['order-1', 'collected'], 'updateOrderStatus'],
  ['toggleItemAvailability', ['item-1', false], 'toggleMenuItemAvailability'],
  ['updateItemStockCount', ['item-1', 12], 'adjustInventoryStock'],
  ['updateItemDetails', ['item-1', { price: 90 }], 'updateMenuItemDetails'],
  ['saveMenuItem', [{ id: 'item-1', name: 'Meal', price: 90 }], 'upsertMenuItem'],
  ['archiveMenuItem', ['item-1', 'No longer sold'], 'archiveMenuItem'],
  ['deleteMenuItem', ['item-1'], 'deleteMenuItemAdmin'],
  ['unlockOrder', ['order-1', 'Physical ID checked'], 'unlockOrderPickupVerification'],
  ['recordCashPayment', ['order-1'], 'recordCashPayment'],
  ['cancelStaffOrder', ['order-1', 'Customer requested cancellation'], 'cancelOrder'],
  ['processStaffRefund', [{ orderId: 'order-1', reason: 'Duplicate charge', amountPaise: 9000 }], 'processOrderRefund'],
];

describe('Web staff service authority regressions (real module, stubbed SDK)', () => {
  for (const email of [
    'student@tcetmumbai.in', 'teacher@thakureducation.org',
    'moreaboutastram@gmail.com', 'adi@tcetmumbai.in',
    '1032251174@tcetmumbai.in', 'adityadjsb@gmail.com',
  ]) {
    it(`does not infer staff authority from ${email}`, async () => {
      const harness = loadService({ email });
      await assert.rejects(harness.service.staffLogin(email, 'test-only-password'), /Unauthorized/);
      assert.ok(harness.reads.every(read => read.path.startsWith('staffUsers/')));
    });
  }

  it('does not treat a user profile role or accountType as canteen staff authority', async () => {
    for (const userRecord of [{ role: 'admin' }, { accountType: 'COLLEGE_STAFF' }, { accountType: 'staff' }]) {
      const harness = loadService({ email: 'customer@example.test', userRecord });
      await assert.rejects(harness.service.staffLogin(harness.user.email, 'test-only-password'), /Unauthorized/);
      assert.ok(harness.reads.every(read => read.path.startsWith('staffUsers/')));
    }
  });

  it('accepts canonical refreshed roles and server-owned staff records only', async () => {
    for (const role of ['kitchen', 'pickup', 'cashier', 'manager', 'admin', 'developer', 'security_admin', 'system']) {
      const claimed = loadService({ claims: { role } });
      assert.equal((await claimed.service.staffLogin('staff@example.test', 'test-only-password')).role, role);
      assert.equal(claimed.reads.length, 0);
      const recorded = loadService({ staffRecord: { role } });
      assert.equal((await recorded.service.staffLogin('staff@example.test', 'test-only-password')).role, role);
      assert.equal(recorded.reads.length, 1);
      assert.equal(recorded.reads[0].source, 'server', 'do not authorize from a Firestore cache');
    }
  });

  it('does not override explicit customer/invalid claims with a staff record or cached role', async () => {
    for (const role of ['student', 'customer', 'teacher', 'college_staff', 'staff', 'kitchen_staff', 'ADMIN', null]) {
      const harness = loadService({ claims: { role }, staffRecord: { role: 'admin' } });
      await assert.rejects(harness.service.staffLogin('staff@example.test', 'test-only-password'), /Unauthorized/);
      assert.equal(harness.reads.length, 0, 'a present role claim takes precedence over a fallback record');
    }
  });

  it('propagates token/role-fetch failures instead of inferring authority', async () => {
    for (const failure of ['tokenError', 'readError']) {
      const error = new Error(`${failure}: unavailable`);
      const harness = loadService({ [failure]: error, email: 'adi@tcetmumbai.in' });
      await assert.rejects(harness.service.staffLogin(harness.user.email, 'test-only-password'), candidate => candidate === error);
    }
  });

  it('auth subscriptions ignore forged cached roles, email hints, and customer claims', async () => {
    for (const claims of [{}, { role: 'student' }, { isWorkstationSession: true }]) {
      const harness = loadService({ claims });
      const states = [];
      harness.service.subscribeStaffAuth(state => states.push(state));
      await harness.emitAuth(harness.user);
      assert.equal(states.length, 1);
      assert.equal(states[0].isAuthenticated, false);
      assert.equal(states[0].role, null);
      assert.equal(states[0].user, null);
    }
  });

  it('auth subscriptions fail closed and report a failed role lookup', async () => {
    const error = new Error('role service unavailable');
    const harness = loadService({ tokenError: error });
    const states = [];
    const failures = [];
    harness.service.subscribeStaffAuth(state => states.push(state), failure => failures.push(failure));
    await harness.emitAuth(harness.user);
    assert.equal(states[0].isAuthenticated, false);
    assert.equal(failures[0], error);
  });

  it('auth subscriptions discard a role lookup completed after sign-out', async () => {
    let resolveToken;
    const user = {
      uid: 'slow-staff', email: 'staff@example.test',
      getIdTokenResult: () => new Promise(resolve => { resolveToken = resolve; }),
    };
    const harness = loadService({ user });
    const states = [];
    harness.service.subscribeStaffAuth(state => states.push(state));
    const pending = harness.emitAuth(user);
    harness.auth.currentUser = null;
    await harness.emitAuth(null);
    resolveToken({ claims: { role: 'admin' } });
    await pending;
    assert.equal(states.length, 1);
    assert.equal(states[0].isAuthenticated, false);
  });

  for (const [exportName, args, callable] of actions) {
    it(`${exportName} preserves callable failures and never writes directly`, async () => {
      for (const code of ['permission-denied', 'unauthenticated', 'failed-precondition', 'unavailable']) {
        const error = Object.assign(new Error(`blocked ${callable}`), { code: `functions/${code}` });
        const harness = loadService({ callError: error });
        await assert.rejects(harness.service[exportName](...args), candidate => candidate === error);
        await harness.flushTimers();
        assert.equal(harness.calls.length, 1, 'do not retry a rejected command');
        assert.equal(harness.calls[0].name, callable);
        assert.equal(harness.writes.length, 0, 'a rejected callable must not trigger a direct mutation');
        assert.equal(harness.reads.length, 0, 'do not fall back to raw Firestore');
      }
    });
  }

  it('command wrappers return backend receipts without direct writes', async () => {
    for (const [exportName, args, callable] of actions) {
      const response = { success: true, orderId: 'order-1', itemId: 'item-1', receipt: callable };
      const harness = loadService({ response });
      assert.equal(await harness.service[exportName](...args), response, exportName);
      await harness.flushTimers();
      assert.equal(harness.calls[0].name, callable);
      assert.equal(harness.writes.length, 0);
      assert.equal(harness.reads.length, 0);
    }
  });

  it('does not treat an unsuccessful or malformed command response as success', async () => {
    for (const [exportName, args] of actions) {
      for (const response of [undefined, null, {}, { success: false }]) {
        const harness = loadService({ response });
        await assert.rejects(harness.service[exportName](...args), /success|confirm/i, exportName);
        assert.equal(harness.writes.length, 0);
      }
    }
  });

  it('sets absolute stock through the actual inventory handler without falling back to a delta', async () => {
    const inventory = loadInventoryHandler();
    const harness = loadService({
      callHandler(name, payload) {
        assert.equal(name, 'adjustInventoryStock');
        return inventory.handler({
          auth: { uid: 'staff-user', token: { role: 'manager' } }, data: payload,
          rawRequest: { ip: '127.0.0.1', headers: {} },
        });
      },
    });
    const result = await harness.service.updateItemStockCount('item-1', 12);
    const payload = harness.calls[0].payload;
    assert.equal(payload.itemId, 'item-1');
    assert.equal(payload.newStock, 12);
    assert.equal(typeof payload.reason, 'string');
    assert.equal(Object.hasOwn(payload, 'deltaUnits'), false, 'do not silently restock one unit if an absolute update is rejected');
    assert.equal(result.newStockOnHand, 12, 'newStockOnHand is the server response, not its request parameter');
    assert.equal(result.reservedStock, 2);
    assert.equal(inventory.writes[0].data.stockOnHand, 12);
    assert.equal(inventory.writes[0].data.availableStock, 10);
    assert.equal(inventory.writes[1].data.deltaUnits, 7);
    assert.equal(harness.writes.length, 0);
    const committedWrites = inventory.writes.length;
    await assert.rejects(harness.service.updateItemStockCount('item-1', 1), error => error.code === 'failed-precondition');
    assert.equal(inventory.writes.length, committedWrites, 'the actual reserved-stock guard must remain authoritative');
    assert.equal(harness.writes.length, 0);
  });

  it('rejects invalid stock counts instead of coercing them into destructive zero-stock updates', async () => {
    for (const count of [NaN, Infinity, -1, 1.5, 'not-a-count', null, Number.MAX_SAFE_INTEGER + 1]) {
      const harness = loadService();
      await assert.rejects(harness.service.updateItemStockCount('item-1', count), /stock|integer/i);
      assert.equal(harness.calls.length, 0);
      assert.equal(harness.writes.length, 0);
    }
  });

  it('does not turn an invalid partial refund amount into a full refund request', async () => {
    for (const amountPaise of [NaN, Infinity, -1, 0, 1.5, '9000', null]) {
      const harness = loadService();
      await assert.rejects(harness.service.processStaffRefund({ orderId: 'order-1', reason: 'Partial refund', amountPaise }), /amount|integer/i);
      assert.equal(harness.calls.length, 0);
      assert.equal(harness.writes.length, 0);
    }
  });

  for (const [exportName, callable] of [
    ['fetchKitchenOrders', 'getKitchenOrders'],
    ['fetchPickupOrders', 'getPickupOrders'],
    ['fetchCashierOrders', 'getCashierOrders'],
  ]) {
    it(`${exportName} preserves rejected/malformed fetches and valid server results`, async () => {
      const error = Object.assign(new Error('not authorized'), { code: 'functions/permission-denied' });
      const rejected = loadService({ callError: error, queryError: new Error('Firestore denied') });
      await assert.rejects(rejected.service[exportName](), candidate => candidate === error);
      assert.equal(rejected.reads.length, 0, 'least-privilege views may not become raw order queries');
      for (const response of [undefined, null, {}, { orders: [] }, '']) {
        const malformed = loadService({ response });
        await assert.rejects(malformed.service[exportName](), /response|array/i);
      }
      const response = [{ orderId: 'order-1', tokenNumber: 'TB-123' }];
      const valid = loadService({ response });
      assert.equal(await valid.service[exportName](), response);
      assert.equal(valid.calls[0].name, callable);
      const empty = loadService({ response: [] });
      assert.equal((await empty.service[exportName]()).length, 0, 'an actual empty server result remains valid');
    });
  }

  it('order subscriptions and legacy queue refresh calls never publish a client projection', async () => {
    const harness = loadService();
    let orders;
    harness.service.subscribeOrders(value => { orders = value; });
    harness.snapshots[0].next({ docs: [{ id: 'order-1', data: () => ({ tokenNumber: 'TB-123', status: 'ready' }) }] });
    await harness.service.syncPublicLiveQueue([{ tokenNumber: 'TB-999', status: 'ready' }]);
    await harness.flushTimers();
    assert.equal(orders.length, 1);
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.reads.length, 0);
  });

  it('menu subscriptions do not repair stock with unauthorized client writes', async () => {
    const harness = loadService();
    let items;
    harness.service.subscribeMenuItems(value => { items = value; });
    harness.snapshots[0].next({ docs: [{
      id: 'item-1', ref: { path: 'menuItems/item-1' },
      data: () => ({ name: 'Meal', type: 'instant', stockCount: -5, stockOnHand: -5 }),
    }] });
    assert.equal(items[0].stockCount, 0);
    assert.equal(harness.writes.length, 0, 'reading corrupt stock must not become a write');
  });

  it('an availability toggle does not overwrite the physical stock shown by the service', () => {
    const harness = loadService();
    let items;
    harness.service.subscribeMenuItems(value => { items = value; });
    harness.snapshots[0].next({ docs: [{
      id: 'item-1', data: () => ({ type: 'instant', stockOnHand: 12, reservedStock: 2, available: false }),
    }] });
    assert.equal(items[0].stockOnHand, 12);
    assert.equal(items[0].reservedStock, 2);
    assert.equal(items[0].stockCount, 0);
    assert.equal(items[0].available, false);
    assert.equal(harness.writes.length, 0);
  });

  it('daily-board read errors are not reported as a successful missing board', () => {
    const harness = loadService();
    const values = [];
    const failures = [];
    const error = new Error('permission denied');
    harness.service.subscribeDailyBoard(value => values.push(value), failure => failures.push(failure));
    harness.snapshots[0].error(error);
    assert.equal(values.length, 0);
    assert.equal(failures[0], error);
    harness.snapshots[0].next({ exists: () => false });
    assert.equal(values.length, 1);
    assert.equal(values[0], null, 'a genuinely missing board may still be represented as null');
  });

  it('daily-board saves atomically preserve the canonical and legacy board contracts', async () => {
    const harness = loadService();
    await harness.service.saveDailyBoard({ sabji1: 'Paneer', rotiAvailable: false });
    assert.equal(harness.batches.length, 1);
    assert.equal(harness.batches[0].commits, 1);
    assert.deepEqual(harness.batches[0].operations.map(operation => operation.reference.path), [
      'canteenConfig/dailyMenuBoard', 'dailyBoard/today',
    ]);
    for (const operation of harness.batches[0].operations) {
      assert.equal(operation.data.sabji1, 'Paneer');
      assert.equal(operation.data.rotiAvailable, false);
      assert.equal(operation.data.updatedBy, harness.user.uid);
      assert.equal(operation.data.updatedAt.serverTimestamp, true);
      assert.equal(operation.config.merge, true);
    }
  });

  it('daily-board save failures propagate without swallowing a legacy mirror error', async () => {
    const error = new Error('board write denied');
    const harness = loadService({ batchError: error });
    await assert.rejects(harness.service.saveDailyBoard({ rotiAvailable: false }), candidate => candidate === error);
    assert.equal(harness.batches[0].commits, 1);
    assert.equal(harness.writes.length, 0);
  });
});
