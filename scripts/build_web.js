'use strict';
const { runFlutter } = require('./flutter_tool');
const { stageWeb } = require('./stage_web');
const key = (process.env.FIREBASE_APP_CHECK_WEB_KEY || '').trim();
if (key && !/^[A-Za-z0-9_-]{10,200}$/.test(key)) throw new Error('Invalid PUBLIC App Check site key format.');
if (!key) console.warn('App Check public site key is unset: build is for inspection, not authenticated production use.');
// Avoid an unused second Wasm compiler and O4 peak memory on small Linux runners.
runFlutter(['build', 'web', '--release', '--no-pub', '--no-wasm-dry-run', '--optimization-level=2',
  `--dart-define=FIREBASE_APP_CHECK_WEB_KEY=${key}`]);
stageWeb({ appCheckSiteKey: key });
