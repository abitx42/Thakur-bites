'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const environment = { ...process.env, NODE_OPTIONS: `--require=${JSON.stringify(path.join(__dirname, 'offline_network.cjs'))}` };
fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
const home = fs.mkdtempSync(path.join(root, '.cache/offline-home-'));
environment.HOME = home;
environment.CLOUDSDK_CONFIG = path.join(home, 'gcloud');
// No credential paths or deployment selection are needed by deterministic tests.
for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_CONFIG', 'PROJECT_ID',
  'QR_SIGNING_SECRET', 'PAYMENT_GATEWAY_KEY_ID', 'PAYMENT_GATEWAY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'ANTIDEPLOY_TOKEN']) delete environment[name];
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: environment });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
const tests = fs.readdirSync(path.join(root, 'test')).filter(name => name.endsWith('.test.js')).sort().map(name => path.join('test', name));
try {
  process.exitCode = run(process.execPath, ['--test', '--test-reporter=spec', ...tests]);
  if (process.exitCode === 0) process.exitCode = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--prefix', 'functions', 'test']);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
