const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { HttpsError } = require('firebase-functions/v2/https');

// Run the compiled runtime code with a synthetic, isolated process.env. Tests
// never read ambient/private environment values or mutate the process env.
function runtime(env = {}) {
  const cache = new Map();
  const process = { env: { ...env } };
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const module = { exports: {} };
    cache.set(name, module);
    const filename = path.resolve(__dirname, '../lib', `${name}.js`);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, process,
      require(specifier) {
        if (specifier === 'firebase-functions/v2/https') return { HttpsError };
        assert.match(specifier, /^\.\/(env_config|app_check|secrets)$/);
        return load(specifier.slice(2));
      },
      console: { warn() {}, error() {} },
    }, { filename });
    return module.exports;
  }
  return { env: process.env, config: load('env_config'), secrets: load('secrets'), appCheck: load('app_check') };
}

describe('T3 environment classification executes the real runtime', () => {
  it('uses GCLOUD_PROJECT before Firebase JSON, including when that JSON is malformed', () => {
    for (const FIREBASE_CONFIG of [undefined, '{broken', '{"projectId":"other-project"}']) {
      const h = runtime({ GCLOUD_PROJECT: '  authoritative-project  ', FIREBASE_CONFIG, PROJECT_ID: 'fallback-project' });
      assert.equal(h.config.getProjectId(), 'authoritative-project');
    }
  });

  it('resolves supported project-ID sources in deterministic priority order', () => {
    for (const [env, project] of [
      [{ GOOGLE_CLOUD_PROJECT: 'gcp-project', FIREBASE_CONFIG: '{"projectId":"firebase-project"}' }, 'gcp-project'],
      [{ FIREBASE_CONFIG: '{"projectId":"firebase-project"}', PROJECT_ID: 'fallback-project' }, 'firebase-project'],
      [{ FIREBASE_CONFIG: '{}', PROJECT_ID: 'fallback-project' }, 'fallback-project'],
      [{ PROJECT_ID: 'fallback-project' }, 'fallback-project'],
      [{}, ''],
    ]) assert.equal(runtime(env).config.getProjectId(), project);
  });

  it('reports malformed selected Firebase JSON as a deterministic configuration error', () => {
    for (const FIREBASE_CONFIG of ['{broken', 'null', '[]', '"text"', '{"projectId":123}']) {
      assert.throws(() => runtime({ FIREBASE_CONFIG }).config.getProjectId(), /FIREBASE_CONFIG.*configuration/i);
    }
  });

  it('cannot downgrade a deployed K_SERVICE by NODE_ENV or emulator/simulation flags', () => {
    for (const NODE_ENV of ['development', 'test', 'staging', undefined]) {
      const h = runtime({ NODE_ENV, K_SERVICE: 'deployed-service', GCLOUD_PROJECT: 'campus-staging',
        FUNCTIONS_EMULATOR: 'true', SIMULATE_PAYMENTS: 'true' });
      assert.equal(h.config.detectEnvironment(), 'production');
      assert.equal(h.config.isSimulationAllowed(), false);
    }
  });

  it('preserves canonical production project safeguards even in test/emulator mode', () => {
    for (const projectId of ['adi-thakur-bite', 'thakurbites-live', 'campus-prod-project']) {
      for (const source of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'PROJECT_ID']) {
        const h = runtime({ NODE_ENV: 'test', FUNCTIONS_EMULATOR: 'true', [source]: projectId });
        assert.equal(h.config.detectEnvironment(), 'production');
        assert.equal(h.config.isSimulationAllowed(), false);
      }
    }
  });

  it('does not let conflicting project IDs hide a known production project', () => {
    const h = runtime({ NODE_ENV: 'test', GCLOUD_PROJECT: 'demo-campus', PROJECT_ID: 'adi-thakur-bite',
      FIREBASE_CONFIG: '{"projectId":"thakurbites-live"}' });
    assert.equal(h.config.getProjectId(), 'demo-campus');
    assert.equal(h.config.detectEnvironment(), 'production');
  });

  it('only enables a present simulation flag for the explicit string true', () => {
    for (const SIMULATE_PAYMENTS of ['false', '0', '1', '', 'yes', 'TRUE']) {
      const h = runtime({ NODE_ENV: 'development', SIMULATE_PAYMENTS });
      assert.equal(h.config.isSimulationAllowed(), false);
    }
    assert.equal(runtime({ NODE_ENV: 'development', SIMULATE_PAYMENTS: 'true' }).config.isSimulationAllowed(), true);
    assert.equal(runtime({ NODE_ENV: 'test' }).config.isSimulationAllowed(), true);
    assert.equal(runtime({ NODE_ENV: 'test', SIMULATE_PAYMENTS: 'false' }).config.isSimulationAllowed(), false);
  });
});

describe('T3 dedicated secret resolution executes the real getter', () => {
  for (const NODE_ENV of ['production', 'development', 'staging', undefined]) {
    it(`has no runtime default QR, payment key or HMAC secrets in ${NODE_ENV}`, () => {
      const h = runtime({ NODE_ENV });
      for (const name of ['QR_SIGNING_SECRET', 'PAYMENT_GATEWAY_KEY_ID', 'PAYMENT_GATEWAY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
        assert.throws(() => h.secrets.getRequiredSecret(name), /Required secret.*not set/);
      }
    });
  }

  it('requires dedicated canonical variables and never aliases webhook/API signing secrets', () => {
    const h = runtime({ NODE_ENV: 'development', PAYMENT_GATEWAY_SECRET: 'explicit-api-secret',
      RAZORPAY_KEY_ID: 'explicit-legacy-key', RAZORPAY_KEY_SECRET: 'explicit-legacy-secret' });
    assert.equal(h.secrets.getRequiredSecret('PAYMENT_GATEWAY_SECRET'), 'explicit-api-secret');
    assert.throws(() => h.secrets.getRequiredSecret('RAZORPAY_WEBHOOK_SECRET'), /Required secret.*not set/);
    assert.throws(() => h.secrets.getRequiredSecret('PAYMENT_GATEWAY_KEY_ID'), /Required secret.*not set/);
    h.env.RAZORPAY_WEBHOOK_SECRET = 'dedicated-webhook-secret';
    assert.equal(h.secrets.getRequiredSecret('RAZORPAY_WEBHOOK_SECRET'), 'dedicated-webhook-secret');
  });

  it('allows deterministic fallback only in an explicit test or true, nonproduction emulator', () => {
    for (const env of [{ NODE_ENV: 'test' }, { NODE_ENV: 'development', FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'demo-campus' }]) {
      const h = runtime(env);
      const first = h.secrets.getRequiredSecret('QR_SIGNING_SECRET');
      assert.equal(first, h.secrets.getRequiredSecret('QR_SIGNING_SECRET'));
      assert.match(first, /^dev_mock_/);
      assert.notEqual(first, h.secrets.getRequiredSecret('RAZORPAY_WEBHOOK_SECRET'));
    }
    assert.throws(() => runtime({ FUNCTIONS_EMULATOR: 'false' }).secrets.getRequiredSecret('QR_SIGNING_SECRET'), /not set/);
  });

  it('never permits test fallbacks in the presence of production signals', () => {
    for (const signal of [{ NODE_ENV: 'production' }, { K_SERVICE: 'cloud-service' }, { GCLOUD_PROJECT: 'adi-thakur-bite' },
      { PROJECT_ID: 'campus-prod' }, { FIREBASE_CONFIG: '{"projectId":"thakurbites-live"}' }]) {
      const h = runtime({ NODE_ENV: 'test', FUNCTIONS_EMULATOR: 'true', ...signal });
      assert.throws(() => h.secrets.getRequiredSecret('QR_SIGNING_SECRET'), /Required secret.*not set/);
    }
  });

  it('rejects development/mock/example placeholders and the exposed campus QR default in production', () => {
    for (const value of ['dev_mock_qr_12345678901234567890123456789012', 'test_secret_payment',
      'sandbox-webhook', 'replace_me_with_secret', 'your-secret-here', 'example-secret', 'changeme',
      'tcet_campus_qr_hmac_2026', 'rzp_test_known_public_key']) {
      const h = runtime({ NODE_ENV: 'production', QR_SIGNING_SECRET: value });
      assert.throws(() => h.secrets.getRequiredSecret('QR_SIGNING_SECRET'), /SECURITY VIOLATION|configuration/i);
    }
  });

  it('returns only explicit dedicated production values and does not disclose rejected values in errors', () => {
    const h = runtime({ NODE_ENV: 'production', QR_SIGNING_SECRET: '  7843be390d15a96c6a8b4e49dc698ec78e68be2d407a93a643036693aef36c0b  ',
      PAYMENT_GATEWAY_KEY_ID: 'rzp_live_opaque', PAYMENT_GATEWAY_SECRET: '8a16d7c68db5931c62f9',
      RAZORPAY_WEBHOOK_SECRET: '726e1a068e6ed7a66c00' });
    assert.equal(h.secrets.getRequiredSecret('QR_SIGNING_SECRET'), h.env.QR_SIGNING_SECRET.trim());
    assert.equal(h.secrets.getRequiredSecret('PAYMENT_GATEWAY_KEY_ID'), h.env.PAYMENT_GATEWAY_KEY_ID);
    assert.notEqual(h.secrets.getRequiredSecret('RAZORPAY_WEBHOOK_SECRET'), h.secrets.getRequiredSecret('PAYMENT_GATEWAY_SECRET'));
    h.env.QR_SIGNING_SECRET = 'dev_mock_sensitive_value_should_not_appear_in_error';
    assert.throws(() => h.secrets.getRequiredSecret('QR_SIGNING_SECRET'), error => {
      assert.ok(!error.message.includes(h.env.QR_SIGNING_SECRET));
      return true;
    });
  });
});

describe('T3 production App Check attestation executes the real guard', () => {
  it('requires attestation for every role, institutional/admin-looking email and workstation flag', () => {
    const h = runtime({ NODE_ENV: 'production' });
    for (const role of ['student', 'kitchen', 'pickup', 'cashier', 'manager', 'admin', 'developer', 'security_admin', 'system']) {
      for (const email of ['employee@tcetmumbai.in', 'employee@thakureducation.org', 'notadmin@example.test']) {
        assert.throws(() => h.appCheck.enforceAppCheck({ auth: { uid: 'local-user', token: { role, email, isWorkstationSession: true } } }),
          error => error.code === 'unauthenticated');
      }
    }
    assert.throws(() => h.appCheck.enforceAppCheck({ data: { app: { appId: 'body-is-not-attestation' } } }), /App Check/);
  });

  it('does not let deployed/canonical production bypass attestation with emulator or disable flags', () => {
    for (const signal of [{ K_SERVICE: 'deployed' }, { GCLOUD_PROJECT: 'adi-thakur-bite' }, { PROJECT_ID: 'campus-prod' }]) {
      const h = runtime({ NODE_ENV: 'test', ENFORCE_APP_CHECK: 'false', FUNCTIONS_EMULATOR: 'true', ...signal });
      assert.throws(() => h.appCheck.enforceAppCheck({}), /App Check verification failed/);
      assert.doesNotThrow(() => h.appCheck.enforceAppCheck({ app: { appId: 'verified-local-fixture' } }));
    }
  });

  it('requires an actual verified app context rather than arbitrary truthy/missing app values', () => {
    const h = runtime({ NODE_ENV: 'production' });
    for (const app of [undefined, null, false, true, 'forged', {}, { appId: '' }]) {
      assert.throws(() => h.appCheck.enforceAppCheck({ app }), /App Check verification failed/);
    }
    assert.doesNotThrow(() => h.appCheck.enforceAppCheck({ app: { appId: 'verified-local-fixture' } }));
  });

  it('supports explicit attestation enforcement in development and isolated true-emulator tests', () => {
    const local = runtime({ FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'demo-campus', NODE_ENV: 'development' });
    assert.doesNotThrow(() => local.appCheck.enforceAppCheck({}));
    local.env.ENFORCE_APP_CHECK = 'true';
    assert.throws(() => local.appCheck.enforceAppCheck({}), /App Check verification failed/);
    assert.doesNotThrow(() => local.appCheck.enforceAppCheck({ app: { appId: 'verified-local-fixture' } }));
  });
});

const firebaseFilename = path.resolve(__dirname, '../../js/firebase.js');
const firebaseCode = ts.transpileModule(fs.readFileSync(firebaseFilename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function browser({ hostname = 'staff.example.test', config = {}, failAppCheck = false } = {}) {
  const events = [];
  const window = { location: { hostname, origin: `http://${hostname}:3000` } };
  const functions = new Proxy({}, {
    set(_target, key) { assert.notEqual(key, 'emulatorOrigin', 'Use the supported SDK function, never mutate emulatorOrigin'); return true; },
  });
  const sdk = {
    initializeApp: value => { events.push(['app', value]); return {}; }, getApps: () => [], getApp: () => ({}),
    getFirestore: () => { events.push(['firestore']); return {}; },
    getAuth: () => { events.push(['auth']); return {}; },
    getFunctions: () => { events.push(['functions']); return functions; }, getStorage: () => ({}),
    ReCaptchaV3Provider: class { constructor(siteKey) { this.siteKey = siteKey; } },
    initializeAppCheck(app, options) {
      events.push(['app-check', app, options]);
      if (failAppCheck) throw new Error('App Check initialization rejected');
      return { initialized: true };
    },
    connectFunctionsEmulator(service, host, port) { events.push(['emulator', service, host, port]); },
  };
  const module = { exports: {} };
  const publicConfig = { appCheckSiteKey: 'synthetic-public-site-key-for-runtime-tests', functionsEmulator: null, ...config };
  const run = () => vm.runInNewContext(firebaseCode, {
    module, exports: module.exports, window,
    console: { warn() {}, error() {}, log() {} },
    require(name) {
      if (name === './publicConfig.js') return { publicConfig };
      assert.match(name, /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.0\/firebase-/);
      return sdk;
    },
  }, { filename: firebaseFilename });
  return { run, exports: module.exports, events, window, functions };
}

describe('T3 browser App Check and explicit local Functions routing execute the real bootstrap', () => {
  it('initializes reCAPTCHA App Check before any Firebase client service with token auto-refresh', () => {
    const h = browser();
    h.run();
    const event = h.events.find(item => item[0] === 'app-check');
    assert.ok(event);
    assert.equal(event[2].provider.siteKey, 'synthetic-public-site-key-for-runtime-tests');
    assert.equal(event[2].isTokenAutoRefreshEnabled, true);
    assert.ok(h.events.indexOf(event) < h.events.findIndex(item => item[0] === 'auth'));
    assert.ok(h.events.indexOf(event) < h.events.findIndex(item => item[0] === 'functions'));
    assert.equal(h.window.FIREBASE_APPCHECK_DEBUG_TOKEN, undefined);
    assert.equal(h.events.filter(item => item[0] === 'emulator').length, 0);
  });

  it('treats a missing public site key as an explicit deployment configuration blocker', () => {
    for (const appCheckSiteKey of ['', '  ', null, undefined, 123]) {
      const h = browser({ config: { appCheckSiteKey } });
      assert.throws(h.run, /APP_CHECK_PUBLIC_SITE_KEY_REQUIRED/);
      assert.equal(h.events.filter(item => item[0] === 'emulator').length, 0);
    }
  });

  it('propagates SDK initialization failures without enabling an insecure fallback', () => {
    const h = browser({ failAppCheck: true });
    assert.throws(h.run, /App Check initialization rejected/);
    assert.equal(h.events.filter(item => item[0] === 'functions').length, 0);
    assert.equal(h.window.FIREBASE_APPCHECK_DEBUG_TOKEN, undefined);
  });

  it('localhost static hosting keeps the normal cloud Functions SDK destination by default', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'staff.example.test']) {
      const h = browser({ hostname });
      h.run();
      assert.equal(h.events.filter(item => item[0] === 'emulator').length, 0);
    }
  });

  it('connects only an explicitly configured loopback emulator using the supported SDK', () => {
    const h = browser({ hostname: 'localhost', config: { functionsEmulator: { host: '127.0.0.1', port: 5001 } } });
    h.run();
    const connections = h.events.filter(item => item[0] === 'emulator');
    assert.equal(connections.length, 1);
    assert.equal(connections[0][1], h.functions);
    assert.equal(connections[0][2], '127.0.0.1');
    assert.equal(connections[0][3], 5001);
  });

  it('allows a keyless bootstrap only for explicit local emulator routing without weakening server enforcement', () => {
    const h = browser({ hostname: '127.0.0.1', config: { appCheckSiteKey: '', functionsEmulator: { host: '127.0.0.1', port: 5001 } } });
    h.run();
    assert.equal(h.events.filter(item => item[0] === 'app-check').length, 0);
    assert.equal(h.events.filter(item => item[0] === 'emulator').length, 1);
    assert.equal(h.window.FIREBASE_APPCHECK_DEBUG_TOKEN, undefined);
    const deployed = runtime({ NODE_ENV: 'test', FUNCTIONS_EMULATOR: 'true', K_SERVICE: 'deployed' });
    assert.throws(() => deployed.appCheck.enforceAppCheck({}), /App Check verification failed/);
  });

  it('rejects remote, malformed or accidental emulator destinations and nonlocal browser opt-ins', () => {
    for (const [hostname, functionsEmulator] of [
      ['localhost', { host: 'attacker.example.test', port: 5001 }],
      ['localhost', { host: '127.0.0.1', port: '5001' }],
      ['localhost', { host: '127.0.0.1', port: 0 }],
      ['localhost', { host: '127.0.0.1', port: 65536 }],
      ['localhost', true], ['localhost', {}],
      ['staff.example.test', { host: '127.0.0.1', port: 5001 }],
    ]) {
      const h = browser({ hostname, config: { functionsEmulator } });
      assert.throws(h.run, /FUNCTIONS_EMULATOR_CONFIGURATION_INVALID/);
      assert.equal(h.events.filter(item => item[0] === 'emulator').length, 0);
    }
  });
});
