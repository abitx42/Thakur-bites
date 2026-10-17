'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('profile provisioning does not trust a stale privileged role for provider exceptions', async () => {
  const uid = 'admin-user';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const auth = {
    async getUser(requestedUid) {
      assert.equal(requestedUid, uid);
      return {
        uid,
        disabled: false,
        customClaims: { role: 'student' },
        tokensValidAfterTime: new Date(Date.now() - 86400000).toUTCString(),
      };
    },
  };
  const admin = {
    apps: [{}],
    firestore: () => ({
      collection() {
        throw new Error('Firestore must not be reached before current authority is checked');
      },
    }),
    auth: () => auth,
  };
  const target = require.resolve('../lib/user_provisioning');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'firebase-admin') return admin;
    if (request === 'firebase-admin/firestore') return {};
    if (parent?.filename === target) {
      const mocks = {
        './app_check': { enforceAppCheck() {} },
        './rate_limiter': { async enforceRateLimit() {} },
        './security_logger': { async logSecurityEvent() {} },
        './claims_manager': { async syncUserCustomClaims() {} },
        './version_policy': { async enforceAppVersionPolicy() {} },
        './honeypot_defense': { async assertNoHoneytokens() {} },
      };
      if (Object.hasOwn(mocks, request)) return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let provisionUserProfile;
  try {
    delete require.cache[target];
    provisionUserProfile = require(target).provisionUserProfile;
  } finally {
    Module._load = originalLoad;
    delete require.cache[target];
  }

  const stalePrivilegedRequest = {
    app: { appId: 'authority-regression' },
    auth: {
      uid,
      token: {
        uid,
        sub: uid,
        role: 'admin',
        auth_time: nowSeconds - 120,
        iat: nowSeconds - 60,
        email: 'admin@example.com',
        email_verified: true,
        firebase: { sign_in_provider: 'password' },
      },
    },
    data: {},
  };

  await assert.rejects(
    provisionUserProfile.run(stalePrivilegedRequest),
    error => error.code === 'unauthenticated' && /authority/i.test(error.message),
  );
});
