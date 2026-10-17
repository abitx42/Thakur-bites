'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stageWeb } = require('../scripts/stage_web');
const { isPublicPath, SECURITY_HEADERS } = require('../web-public');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-stage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(name, content = 'PUBLIC') {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  for (const name of ['index.html', 'main.dart.js', 'flutter_bootstrap.js']) write(`thakur_bites/build/web/${name}`, `REBUILT ${name}`);
  write('index.html', 'STALE');
  write('staff.html');
  write('js/publicConfig.js', 'export const publicConfig = Object.freeze({appCheckSiteKey: "", functionsEmulator: null});');
  write('js/app.js');
  write('css/app.css');
  write('dist/site/old.js', 'PREVIOUS GOOD BUNDLE');
  return { root, write, read: name => fs.readFileSync(path.join(root, name), 'utf8'),
    exists: name => fs.existsSync(path.join(root, name)) };
}
test('staging uses rebuilt Flutter output and only public portal assets, never repository contents', t => {
  const f = fixture(t);
  for (const name of ['.env', 'functions/index.js', 'reports/private.json', 'js/private.env', 'js/app.js.map',
    'assets/.env', 'assets/service-account.json', 'assets/credentials.json', 'assets/secrets/config.json', 'js/node_modules/hidden.js']) f.write(name, 'PRIVATE');
  f.write('.well-known/security.txt', 'PUBLIC CONTACT');
  f.write('thakur_bites/build/web/assets/NOTICES', 'PUBLIC LICENSES');
  const result = stageWeb({ root: f.root, appCheckSiteKey: 'PUBLIC_TEST_SITE_KEY_123' });
  assert.equal(result, path.join(f.root, 'dist/site'));
  assert.equal(f.read('dist/site/index.html'), 'REBUILT index.html');
  assert.equal(f.read('dist/site/main.dart.js'), 'REBUILT main.dart.js');
  assert.equal(f.read('dist/site/staff.html'), 'PUBLIC');
  assert.equal(f.read('dist/site/.well-known/security.txt'), 'PUBLIC CONTACT');
  assert.equal(f.read('dist/site/assets/NOTICES'), 'PUBLIC LICENSES');
  assert.match(f.read('dist/site/js/publicConfig.js'), /PUBLIC_TEST_SITE_KEY_123/);
  assert.match(f.read('dist/site/js/publicConfig.js'), /"functionsEmulator":null/);
  assert.equal(f.exists('dist/site/old.js'), false);
  for (const name of ['.env', 'functions', 'reports', 'js/private.env', 'js/app.js.map', 'assets/.env',
    'assets/service-account.json', 'assets/credentials.json', 'assets/secrets/config.json', 'js/node_modules']) assert.equal(f.exists(`dist/site/${name}`), false, name);
  assert.equal(fs.readdirSync(path.join(f.root, 'dist')).filter(name => name.startsWith('.stage-')).length, 0);
});
test('rejected asset symlinks preserve the previous site and clean incomplete staging', t => {
  const f = fixture(t);
  f.write('.env', 'PRIVATE');
  fs.symlinkSync(path.join(f.root, '.env'), path.join(f.root, 'js/leak.js'));
  assert.throws(() => stageWeb({ root: f.root }), /Symlinks/);
  assert.equal(f.read('dist/site/old.js'), 'PREVIOUS GOOD BUNDLE');
  assert.equal(fs.readdirSync(path.join(f.root, 'dist')).filter(name => name.startsWith('.stage-')).length, 0);
});
test('required Flutter output cannot be satisfied by a symlink to stale or private content', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'thakur_bites/build/web/main.dart.js'));
  fs.symlinkSync(path.join(f.root, 'js/app.js'), path.join(f.root, 'thakur_bites/build/web/main.dart.js'));
  assert.throws(() => stageWeb({ root: f.root }), /regular rebuilt Flutter/);
  assert.equal(f.read('dist/site/old.js'), 'PREVIOUS GOOD BUNDLE');
});
test('explicit nested public filenames cannot escape through a symlinked parent', t => {
  const f = fixture(t);
  f.write('private/security.txt', 'PRIVATE CONTACT SOURCE');
  fs.symlinkSync(path.join(f.root, 'private'), path.join(f.root, '.well-known'));
  assert.throws(() => stageWeb({ root: f.root }), /Symlinks/);
  assert.equal(f.read('dist/site/old.js'), 'PREVIOUS GOOD BUNDLE');
});
test('symlinked output parents cannot delete or publish another directory', t => {
  const f = fixture(t);
  fs.renameSync(path.join(f.root, 'dist'), path.join(f.root, 'private-output'));
  fs.symlinkSync(path.join(f.root, 'private-output'), path.join(f.root, 'dist'));
  assert.throws(() => stageWeb({ root: f.root }), /Unsafe dist/);
  assert.equal(f.read('private-output/site/old.js'), 'PREVIOUS GOOD BUNDLE');
});
test('symlinked Flutter build parents are rejected before copying files', t => {
  const f = fixture(t);
  fs.renameSync(path.join(f.root, 'thakur_bites/build'), path.join(f.root, 'outside-build'));
  fs.symlinkSync(path.join(f.root, 'outside-build'), path.join(f.root, 'thakur_bites/build'));
  assert.throws(() => stageWeb({ root: f.root }), /Unsafe Flutter/);
  assert.equal(f.read('dist/site/old.js'), 'PREVIOUS GOOD BUNDLE');
});
test('direct staging rejects malformed public keys before replacing output', t => {
  const f = fixture(t);
  for (const key of [{}, null, 'short', 'invalid\nkey', 'x'.repeat(201)]) {
    assert.throws(() => stageWeb({ root: f.root, appCheckSiteKey: key }), /PUBLIC App Check/);
    assert.equal(f.read('dist/site/old.js'), 'PREVIOUS GOOD BUNDLE');
  }
});
test('public allowlist blocks nested dependency, traversal and control-character filenames', () => {
  for (const name of ['js/node_modules/library.js', 'assets/../private.json', 'js/a\nb.js', 'js/a\\b.js',
    'js/credentials.json', 'assets/private.js.map']) assert.equal(isPublicPath(name), false, name);
});
test('Firebase Hosting and Node share App Check-compatible security headers and use only staged output', () => {
  const firebase = require('../firebase.json');
  for (const site of firebase.hosting) {
    assert.equal(site.public, 'dist/site');
    const headers = Object.fromEntries(site.headers.find(entry => entry.source === '**').headers.map(entry => [entry.key, entry.value]));
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(headers[name], value, `${site.target}: ${name}`);
    assert.match(headers['Content-Security-Policy'], /https:\/\/www\.google\.com\/recaptcha\//);
  }
  assert.equal(fs.readFileSync(path.resolve(__dirname, '../firestore/firestore.rules'), 'utf8'),
    fs.readFileSync(path.resolve(__dirname, '../thakur_bites/firestore.rules'), 'utf8'));
});
