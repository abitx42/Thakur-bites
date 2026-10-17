'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const token = 'fixture-token-do-not-log';
const publicKey = 'fixture-public-app-check-key';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-deploy-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ['scripts', 'bin', 'tmp', 'dist/site/js', 'dist/site/.well-known', 'node_modules', 'functions']) {
    fs.mkdirSync(path.join(directory, name), { recursive: true });
  }
  for (const name of ['scripts/deploy_antideploy.sh', 'server.js', 'web-public.js', '.nvmrc']) {
    fs.copyFileSync(path.join(root, name), path.join(directory, name));
  }
  const packageManager = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).packageManager;
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ packageManager, scripts: { private: 'not-deployable' } }));
  for (const name of ['index.html', 'main.dart.js', 'flutter_bootstrap.js', 'js/staff.js', '.well-known/security.txt']) {
    fs.writeFileSync(path.join(directory, 'dist/site', name), `PUBLIC ${name}\n`);
  }
  for (const name of ['.env', '.antideploy.json', 'node_modules/private.json', 'functions/private.json', 'private.json']) {
    fs.writeFileSync(path.join(directory, name), 'PRIVATE-CANARY-DO-NOT-PACKAGE');
  }
  // An inaccessible/nonexistent synthetic HOME proves package-only does not need workstation login state.
  const env = {
    PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env.PATH}`,
    HOME: path.join(directory, 'no-home-config'), TMPDIR: path.join(directory, 'tmp'), LANG: 'C.UTF-8',
    FAKE_NPM_LOG: path.join(directory, 'npm.log'), FAKE_CURL_LOG: path.join(directory, 'curl.log'),
  };
  fs.writeFileSync(path.join(directory, 'bin/npm'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({
  args: process.argv.slice(2), cwd: process.cwd(), tokenPresent: 'ANTIDEPLOY_TOKEN' in process.env,
  publicKey: process.env.FIREBASE_APP_CHECK_WEB_KEY,
}) + '\\n');
if (process.env.FAKE_BUILD_SLEEP === 'yes') setInterval(() => {}, 1000);
else process.exit(Number(process.env.FAKE_BUILD_EXIT || 0));
`, { mode: 0o755 });
  fs.writeFileSync(path.join(directory, 'bin/curl'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const previous = fs.existsSync(process.env.FAKE_CURL_LOG) ? fs.readFileSync(process.env.FAKE_CURL_LOG, 'utf8').trim().split('\\n') : [];
const call = previous.length + 1;
const headerFile = args[args.indexOf('--header') + 1].slice(1);
const header = fs.readFileSync(headerFile, 'utf8');
fs.appendFileSync(process.env.FAKE_CURL_LOG, JSON.stringify({
  args, call, headerFile, headerMode: fs.statSync(headerFile).mode & 0o777,
  correctHeader: header === 'Authorization: Bearer ${token}\\n', tokenPresent: 'ANTIDEPLOY_TOKEN' in process.env,
}) + '\\n');
const scenario = process.env.FAKE_CURL_SCENARIO || 'success';
if (scenario === 'curl-error' || (scenario === 'poll-curl-error' && call > 1)) {
  process.stderr.write('Untrusted upstream error reflecting ${token}');
  process.exit(28);
}
let body = call === 1 ? JSON.stringify({ taskId: 'task-123' }) : JSON.stringify({ status: 'succeeded' });
let http = '200';
if (scenario === 'upload-http' && call === 1) { http = '401'; body = '${token}'; }
if (scenario === 'upload-malformed' && call === 1) body = '${token} is not JSON';
if (scenario === 'upload-no-task' && call === 1) body = JSON.stringify({ reflectedToken: '${token}' });
if (scenario === 'upload-unsafe-task' && call === 1) body = JSON.stringify({ taskId: '../injected' });
if (scenario === 'poll-http' && call > 1) { http = '503'; body = '${token}'; }
if (scenario === 'poll-malformed' && call > 1) body = '${token} is not JSON';
if (scenario === 'poll-unknown' && call > 1) body = JSON.stringify({ status: '${token}' });
if (scenario === 'poll-failed' && call > 1) body = JSON.stringify({ status: 'failed', details: '${token}' });
if (scenario === 'poll-cancelled' && call > 1) body = JSON.stringify({ status: 'cancelled' });
if (scenario === 'pending-success' && call === 2) body = JSON.stringify({ status: 'building' });
if (scenario === 'pending-forever' && call > 1) body = JSON.stringify({ status: 'running' });
fs.writeFileSync(args[args.indexOf('--output') + 1], body);
process.stdout.write(http);
`, { mode: 0o755 });
  const readLog = name => {
    const file = path.join(directory, `${name}.log`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  };
  return {
    directory, env, readLog,
    run(args, overrides = {}, trace = false) {
      return spawnSync('bash', [...(trace ? ['-x'] : []), path.join(directory, 'scripts/deploy_antideploy.sh'), ...args], {
        cwd: os.tmpdir(), env: { ...env, ...overrides }, encoding: 'utf8', timeout: 12000,
      });
    },
    deployEnv(overrides = {}) {
      return {
        ANTIDEPLOY_APPLICATION_ID: 'fixture-app-123', ANTIDEPLOY_TOKEN: token,
        FIREBASE_APP_CHECK_WEB_KEY: publicKey, ANTIDEPLOY_POLL_INTERVAL_SECONDS: '1', ...overrides,
      };
    },
    assertClean() { assert.deepEqual(fs.readdirSync(path.join(directory, 'tmp')), []); },
  };
}

function successful(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('package-only is credential-free, allowlisted, dependency-free and byte-reproducible', t => {
  const f = fixture(t);
  const archive = path.join(f.directory, 'runtime one.tar.gz');
  const other = path.join(f.directory, 'runtime two.tar.gz');
  const first = f.run(['--package-only', archive], { TAR_OPTIONS: '--exclude=server.js', GZIP: '-9' });
  successful(first);
  assert.match(first.stdout, /No build or deployment was performed/);
  const listed = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  successful(listed);
  const entries = listed.stdout.trim().split('\n').filter(name => !name.endsWith('/')).map(name => name.replace(/^\.\//, '')).sort();
  assert.deepEqual(entries, [
    '.nvmrc', 'dist/site/.well-known/security.txt', 'dist/site/flutter_bootstrap.js', 'dist/site/index.html',
    'dist/site/js/staff.js', 'dist/site/main.dart.js', 'package-lock.json', 'package.json', 'server.js', 'web-public.js',
  ].sort());
  const extracted = path.join(f.directory, 'extracted');
  fs.mkdirSync(extracted);
  successful(spawnSync('tar', ['--same-permissions', '-xzf', archive, '-C', extracted], { encoding: 'utf8' }));
  const manifest = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(extracted, 'package-lock.json'), 'utf8'));
  assert.equal(manifest.engines.node, fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim());
  assert.equal(manifest.packageManager, 'npm@10.9.9');
  assert.equal(manifest.scripts.start, 'HOST=0.0.0.0 node server.js');
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(Object.keys(lock.packages), ['']);
  assert.equal(typeof require(path.join(extracted, 'server.js')).createServer, 'function');
  assert.equal(fs.statSync(path.join(extracted, 'dist/site/index.html')).mtimeMs, 0);
  for (const name of entries) {
    assert.ok(!fs.readFileSync(path.join(extracted, name), 'utf8').includes('PRIVATE-CANARY-DO-NOT-PACKAGE'));
    assert.equal(fs.statSync(path.join(extracted, name)).mode & 0o777, 0o644);
  }
  fs.utimesSync(path.join(f.directory, 'dist/site/index.html'), 123456789, 987654321);
  fs.chmodSync(path.join(f.directory, 'dist/site/index.html'), 0o600);
  successful(f.run(['--dry-run', other]));
  assert.deepEqual(fs.readFileSync(archive), fs.readFileSync(other));
  assert.deepEqual(f.readLog('npm'), []);
  assert.deepEqual(f.readLog('curl'), []);
  f.assertClean();
});

for (const unsafe of ['.env', 'js/app.js.map', 'assets/service-account.json', 'assets/node_modules/hidden.js', 'private/data.json']) {
  test(`package-only rejects unsafe staged path ${unsafe}`, t => {
    const f = fixture(t);
    const file = path.join(f.directory, 'dist/site', unsafe);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'PRIVATE');
    const archive = path.join(f.directory, 'runtime.tar.gz');
    const result = f.run(['--package-only', archive]);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(archive), false);
    assert.deepEqual(f.readLog('curl'), []);
    f.assertClean();
  });
}

for (const relative of ['dist/site/js/leak.js', 'dist/site', 'dist', 'server.js', 'web-public.js']) {
  test(`package-only rejects symlink input ${relative}`, t => {
    const f = fixture(t);
    const source = path.join(f.directory, relative);
    const target = path.join(f.directory, 'symlink-target');
    if (fs.existsSync(source)) fs.renameSync(source, target);
    else fs.writeFileSync(target, 'PRIVATE');
    fs.symlinkSync(target, source);
    assert.notEqual(f.run(['--package-only', path.join(f.directory, 'runtime.tar.gz')]).status, 0);
    assert.deepEqual(f.readLog('curl'), []);
    f.assertClean();
  });
}

test('package-only requires built output and refuses to overwrite existing files or output symlinks', t => {
  const f = fixture(t);
  const archive = path.join(f.directory, 'runtime.tar.gz');
  fs.writeFileSync(archive, 'KEEP');
  assert.notEqual(f.run(['--package-only', archive]).status, 0);
  assert.equal(fs.readFileSync(archive, 'utf8'), 'KEEP');
  const link = path.join(f.directory, 'link.tar.gz');
  fs.symlinkSync(archive, link);
  assert.notEqual(f.run(['--dry-run', link]).status, 0);
  fs.rmSync(archive);
  fs.rmSync(path.join(f.directory, 'dist/site/main.dart.js'));
  assert.notEqual(f.run(['--package-only', archive]).status, 0);
  assert.equal(fs.existsSync(archive), false);
  f.assertClean();
});

test('package-only rejects a public-looking hardlink to a private repository file', t => {
  const f = fixture(t);
  fs.linkSync(path.join(f.directory, '.env'), path.join(f.directory, 'dist/site/js/leak.js'));
  const archive = path.join(f.directory, 'runtime.tar.gz');
  const result = f.run(['--package-only', archive]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Hardlinked files are not deployable/);
  assert.equal(fs.existsSync(archive), false);
  assert.deepEqual(f.readLog('curl'), []);
  f.assertClean();
});

test('deploy validates required inputs and bounds before building or uploading', t => {
  const f = fixture(t);
  const invalid = [
    { ANTIDEPLOY_APPLICATION_ID: '' }, { ANTIDEPLOY_APPLICATION_ID: 'id&injected=1' },
    { ANTIDEPLOY_TOKEN: '' }, { ANTIDEPLOY_TOKEN: 'bad\nHeader: injected' }, { FIREBASE_APP_CHECK_WEB_KEY: '' },
    { FIREBASE_APP_CHECK_WEB_KEY: 'bad key' }, { ANTIDEPLOY_DEPLOY_TIMEOUT_SECONDS: '0' },
    { ANTIDEPLOY_POLL_INTERVAL_SECONDS: '1;exit 0' }, { ANTIDEPLOY_REQUEST_TIMEOUT_SECONDS: '301' },
    { SOURCE_DATE_EPOCH: '-1' },
  ];
  assert.notEqual(f.run([]).status, 0);
  for (const overrides of invalid) {
    assert.notEqual(f.run(['--deploy'], f.deployEnv(overrides)).status, 0, JSON.stringify(overrides));
  }
  assert.deepEqual(f.readLog('npm'), []);
  assert.deepEqual(f.readLog('curl'), []);
  f.assertClean();
});

test('deploy builds once, uploads once, polls success and does not leak credentials under inherited tracing', t => {
  const f = fixture(t);
  const result = f.run(['--deploy'], f.deployEnv({ FAKE_CURL_SCENARIO: 'pending-success' }), true);
  successful(result);
  assert.match(result.stdout, /reports deployment succeeded \(task task-123\)/);
  assert.ok(!(result.stdout + result.stderr).includes(token));
  assert.deepEqual(f.readLog('npm'), [{ args: ['run', 'build:web'], cwd: f.directory, tokenPresent: false, publicKey }]);
  const calls = f.readLog('curl');
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(call => call.args.includes('POST')).length, 1);
  for (const call of calls) {
    assert.equal(call.args[0], '-q');
    assert.equal(call.headerMode, 0o600);
    assert.equal(call.correctHeader, true);
    assert.equal(call.tokenPresent, false);
    assert.ok(!JSON.stringify(call.args).includes(token));
    assert.ok(!call.args.includes('--location'));
    assert.ok(call.args.includes('--max-time'));
    assert.ok(call.args.includes('--connect-timeout'));
    assert.equal(fs.existsSync(call.headerFile), false);
  }
  f.assertClean();
});

for (const [scenario, expected, count] of [
  ['upload-http', /Upload returned HTTP 401/, 1],
  ['upload-malformed', /Upload did not return valid JSON/, 1],
  ['upload-no-task', /Upload did not return a valid taskId/, 1],
  ['upload-unsafe-task', /Upload did not return a valid taskId/, 1],
  ['curl-error', /Upload request failed \(curl exit 28\)/, 1],
  ['poll-http', /Poll returned HTTP 503/, 2],
  ['poll-malformed', /Poll did not return valid JSON/, 2],
  ['poll-unknown', /missing or unrecognized status/, 2],
  ['poll-failed', /reports deployment failed/, 2],
  ['poll-cancelled', /reports deployment cancelled/, 2],
  ['poll-curl-error', /Poll request failed \(curl exit 28\)/, 2],
]) {
  test(`deploy reports ${scenario} honestly without retrying or logging upstream secrets`, t => {
    const f = fixture(t);
    const result = f.run([], f.deployEnv({ FAKE_CURL_SCENARIO: scenario }));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.ok(!(result.stdout + result.stderr).includes(token));
    assert.ok(!result.stdout.includes('deployment succeeded'));
    assert.equal(f.readLog('curl').length, count);
    f.assertClean();
  });
}

test('polling has a total deadline and clamps each request to the remaining time', t => {
  const f = fixture(t);
  const start = Date.now();
  const result = f.run([], f.deployEnv({
    FAKE_CURL_SCENARIO: 'pending-forever', ANTIDEPLOY_DEPLOY_TIMEOUT_SECONDS: '1',
    ANTIDEPLOY_REQUEST_TIMEOUT_SECONDS: '2',
  }));
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /[Tt]imed out|deadline exceeded/);
  assert.ok(Date.now() - start < 5000, 'Polling should terminate locally, not wait indefinitely.');
  const calls = f.readLog('curl');
  assert.equal(calls.filter(call => call.args.includes('POST')).length, 1);
  for (const call of calls) assert.equal(call.args[call.args.indexOf('--max-time') + 1], '1');
  f.assertClean();
});

for (const [overrides, expectedStatus] of [
  [{ FAKE_BUILD_EXIT: '42' }, 42],
  [{ FAKE_BUILD_SLEEP: 'yes', ANTIDEPLOY_BUILD_TIMEOUT_SECONDS: '1' }, 124],
]) {
  test(`build failure/timeout exit ${expectedStatus} is preserved and prevents upload`, t => {
    const f = fixture(t);
    const result = f.run([], f.deployEnv(overrides));
    assert.ifError(result.error);
    assert.equal(result.status, expectedStatus);
    assert.match(result.stderr, new RegExp(`Web build failed \\(exit ${expectedStatus}\\); nothing was uploaded`));
    assert.deepEqual(f.readLog('curl'), []);
    f.assertClean();
  });
}
