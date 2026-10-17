'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');

function clone(value) {
  if (!value || typeof value !== 'object' || value instanceof Timestamp) return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function harness() {
  const docs = new Map();
  const versions = new Map();
  const users = new Map([['admin-caller', {
    uid: 'admin-caller', disabled: false, customClaims: { role: 'admin' },
    tokensValidAfterTime: new Date(Date.now() - 86400000).toUTCString(),
  }]]);
  let sessionCount = 0;
  const snapshot = ref => ({ id: ref.id, ref, exists: docs.has(ref.path), data: () => clone(docs.get(ref.path)) });
  const ref = (collection, id) => ({
    id, path: `${collection}/${id}`,
    async get() { return snapshot(this); },
    async set(data, options) {
      docs.set(this.path, options?.merge ? { ...docs.get(this.path), ...clone(data) } : clone(data));
      versions.set(this.path, (versions.get(this.path) || 0) + 1);
    },
    async update(data) {
      assert.ok(docs.has(this.path));
      docs.set(this.path, { ...docs.get(this.path), ...clone(data) });
      versions.set(this.path, (versions.get(this.path) || 0) + 1);
    },
  });
  const collection = name => ({ doc(id) { return ref(name, id); } });
  const db = {
    collection,
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const readVersions = new Map();
        const writes = [];
        const transaction = {
          async get(document) {
            assert.equal(writes.length, 0, 'MFA transaction must read before writing');
            readVersions.set(document.path, versions.get(document.path) || 0);
            await new Promise(resolve => setImmediate(resolve));
            return snapshot(document);
          },
          set(document, data, options) { writes.push({ type: 'set', document, data, options }); },
          update(document, data) { writes.push({ type: 'update', document, data }); },
          create(document, data) { writes.push({ type: 'create', document, data }); },
        };
        const result = await callback(transaction);
        const conflicted = [...readVersions].some(([path, version]) => (versions.get(path) || 0) !== version);
        if (conflicted) continue;
        for (const write of writes) {
          if (write.type === 'create') assert.equal(docs.has(write.document.path), false);
          if (write.type === 'update') await write.document.update(write.data);
          else await write.document.set(write.data, write.options);
        }
        return result;
      }
      throw new Error('transaction retry limit exceeded');
    },
  };
  const auth = {
    async getUser(uid) {
      if (!users.has(uid)) throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
      return clone(users.get(uid));
    },
  };
  const admin = { apps: [{}], firestore: Object.assign(() => db, { Timestamp, FieldValue }), auth: () => auth, initializeApp() {} };
  const target = require.resolve('../lib/mfa_totp');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === target) {
      if (request === 'firebase-admin') return admin;
      if (request === 'firebase-admin/firestore') return { Timestamp, FieldValue };
      const mocks = {
        './app_check': { enforceAppCheck() {} },
        './rate_limiter': { async enforceRateLimit() {} },
        './security_logger': { async logSecurityEvent() {} },
        './honeypot_defense': { async assertNoHoneytokens() {} },
        './staff_authority': { async assertCurrentStaffAuthority() { return 'admin'; } },
      };
      if (Object.hasOwn(mocks, request)) return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let mfa;
  try { delete require.cache[target]; mfa = require(target); }
  finally { Module._load = originalLoad; delete require.cache[target]; }
  const token = { uid: 'admin-caller', sub: 'admin-caller', role: 'admin', auth_time: Math.floor(Date.now() / 1000), iat: Math.floor(Date.now() / 1000) };
  return { docs, mfa, token, put(name, id, data) { docs.set(`${name}/${id}`, clone(data)); versions.set(`${name}/${id}`, 0); }, nextSessionId: () => `psess_${++sessionCount}` };
}

test('concurrent identical TOTP requests consume one step and issue one privileged session', async () => {
  const h = harness();
  const secret = h.mfa.base32Encode(Buffer.alloc(20, 7));
  h.put('mfaEnrollments', 'admin-caller', { mfaEnabled: true, secretBase32: secret, recoveryCodeHashes: [] });
  const code = h.mfa.generateTotp(secret, Math.floor(Date.now() / 30000));
  const request = () => h.mfa.createPrivilegedSession.run({ auth: { uid: 'admin-caller', token: h.token }, app: { appId: 'mfa-replay-test' }, data: { totpCode: code } });
  const results = await Promise.allSettled([request(), request()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal([...h.docs.keys()].filter(key => key.startsWith('privilegedSessions/')).length, 1);
});

test('concurrent identical recovery-code requests consume one code and issue one privileged session', async () => {
  const h = harness();
  const secret = h.mfa.base32Encode(Buffer.alloc(20, 8));
  const recoveryCode = 'RECOVERY-ONE';
  const hash = require('node:crypto').createHash('sha256').update(recoveryCode).digest('hex');
  h.put('mfaEnrollments', 'admin-caller', { mfaEnabled: true, secretBase32: secret, recoveryCodeHashes: [hash] });
  const request = () => h.mfa.createPrivilegedSession.run({ auth: { uid: 'admin-caller', token: h.token }, app: { appId: 'mfa-replay-test' }, data: { recoveryCode } });
  const results = await Promise.allSettled([request(), request()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.deepEqual(h.docs.get('mfaEnrollments/admin-caller').recoveryCodeHashes, []);
  assert.equal([...h.docs.keys()].filter(key => key.startsWith('privilegedSessions/')).length, 1);
});
