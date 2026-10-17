'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cache = process.env.FIREBASE_EMULATORS_PATH || path.join(root, '.cache/firebase/emulators');
fs.mkdirSync(cache, { recursive: true });
const cli = require.resolve('firebase-tools/lib/bin/firebase.js');
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit',
    env: { ...process.env, FIREBASE_EMULATORS_PATH: cache, FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (process.argv[2] === '--download') {
  run(['setup:emulators:firestore']);
  run(['setup:emulators:storage']);
} else if (process.argv.length === 2) {
  run(['emulators:exec', '--only', 'firestore,storage', '--project', 'demo-thakur-bites', '--config', 'firebase.json',
    'npm --prefix functions run test:rules:local']);
} else {
  console.error('Usage: node scripts/emulator_tests.js [--download]');
  process.exit(2);
}
