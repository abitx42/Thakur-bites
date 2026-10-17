'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
// Reuse the project's locked local Firebase CLI dependency; no extra test dependency or network fetch.
const YAML = createRequire(require.resolve('firebase-tools/package.json'))('yaml');
const root = path.resolve(__dirname, '..');
const names = ['ci.yml', 'deploy_production.yml', 'deploy_staging.yml', 'build_apk.yml'];
const workflows = Object.fromEntries(names.map(name => [name,
  YAML.parse(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8'), { uniqueKeys: true }),
]));

for (const [name, workflow] of Object.entries(workflows)) {
  test(`${name} uses pinned, locked local tooling and valid bounded shell steps`, () => {
    assert.equal(workflow.permissions.contents, 'read');
    for (const job of Object.values(workflow.jobs)) {
      assert.equal(job['runs-on'], 'ubuntu-24.04');
      assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 60);
      assert.notEqual(job['continue-on-error'], true);
      const node = job.steps.find(step => step.uses?.startsWith('actions/setup-node@'));
      const flutter = job.steps.find(step => step.uses?.startsWith('subosito/flutter-action@'));
      const java = job.steps.find(step => step.uses?.startsWith('actions/setup-java@'));
      const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
      assert.equal(checkout.with['fetch-depth'], 0);
      assert.equal(node.with['node-version-file'], '.nvmrc');
      assert.match(node.with['cache-dependency-path'], /^package-lock\.json\nfunctions\/package-lock\.json\n?$/);
      assert.equal(flutter.with['flutter-version'], '${{ steps.pins.outputs.flutter }}');
      assert.equal(java.with['java-version'], '21');
      const pins = job.steps.find(step => step.id === 'pins');
      assert.match(pins.run, /\.flutter-version/);
      assert.match(pins.run, /npm --version/);
      assert.match(pins.run, /10\.9\.9/);
      const commands = job.steps.map(step => step.run || '').join('\n');
      assert.match(commands, /\bnpm ci\b/);
      assert.match(commands, /npm --prefix functions ci\b/);
      assert.match(commands, /flutter pub get --enforce-lockfile/);
      assert.doesNotMatch(commands, /npm (?:install|i) (?:-g|--global)|\bnpx\b|\|\|\s*(?:true|echo)|set \+e/);
      for (const step of job.steps) {
        assert.notEqual(step['continue-on-error'], true);
        if (!step.run) continue;
        const result = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
        assert.equal(result.status, 0, `${name}: ${step.name}: ${result.stderr}`);
      }
    }
  });
}

test('CI packages only the staged artifact and retains required security gate invocation', () => {
  const job = Object.values(workflows['ci.yml'].jobs)[0];
  const commands = job.steps.map(step => step.run || '').join('\n');
  assert.match(commands, /bash scripts\/run_all_security_checks\.sh/);
  assert.match(commands, /npm run build:web/);
  assert.match(commands, /scripts\/deploy_antideploy\.sh --package-only "\$RUNNER_TEMP\/thakur-bites-runtime\.tar\.gz"/);
  assert.doesNotMatch(commands, /firebase(?:-tools)? deploy|audit_deployment_reality|--dry-run/);
  const artifact = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(artifact.with.path, '${{ runner.temp }}/thakur-bites-runtime.tar.gz');
  assert.equal(artifact.with['if-no-files-found'], 'error');
});

function deployFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-workflow-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'node_modules/.bin'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'tmp'));
  fs.copyFileSync(path.join(root, 'firebase.json'), path.join(directory, 'firebase.json'));
  const log = path.join(directory, 'firebase.log');
  fs.writeFileSync(path.join(directory, 'node_modules/.bin/firebase'), `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credentials = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const configFile = args[args.indexOf('--config') + 1];
fs.appendFileSync(process.env.FAKE_FIREBASE_LOG, JSON.stringify({
  args, file, mode: fs.statSync(file).mode & 0o777,
  project: credentials.project_id, jsonStillExported: 'FIREBASE_SERVICE_ACCOUNT_JSON' in process.env,
  configFile, config: JSON.parse(fs.readFileSync(configFile, 'utf8')),
}) + '\\n');
process.exit(Number(process.env.FAKE_FIREBASE_EXIT || 0));
`, { mode: 0o755 });
  const credentials = {
    type: 'service_account', project_id: 'demo-thakur-deploy', client_email: 'fixture@demo-thakur-deploy.iam.gserviceaccount.com',
    private_key: ['-----BEGIN', 'PRIVATE KEY-----', '\nsynthetic-fixture-only\n'].join(' '),
  };
  return {
    directory, log, credentials,
    run(script, overrides = {}) {
      return spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
        cwd: directory, encoding: 'utf8', timeout: 10000,
        env: {
          PATH: process.env.PATH, HOME: path.join(directory, 'no-home-config'), LANG: 'C.UTF-8',
          RUNNER_TEMP: path.join(directory, 'tmp'), FAKE_FIREBASE_LOG: log,
          FIREBASE_PROJECT_ID: credentials.project_id, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials),
          FIREBASE_APP_HOSTING_SITE: 'demo-thakur-app', FIREBASE_STAFF_HOSTING_SITE: 'demo-thakur-staff', ...overrides,
        },
      });
    },
    assertClean() { assert.deepEqual(fs.readdirSync(path.join(directory, 'tmp')), []); },
  };
}

for (const [name, environment] of [['deploy_production.yml', 'production'], ['deploy_staging.yml', 'staging']]) {
  const workflow = workflows[name];
  const job = Object.values(workflow.jobs)[0];
  const build = job.steps.find(step => step.run?.includes('npm run build:web'));
  const deploy = job.steps.find(step => step.run?.includes('./node_modules/.bin/firebase deploy'));

  test(`${environment} preserves approval scope, real gates, keyed web build and actual local-CLI deployment`, () => {
    assert.equal(job.environment, environment);
    assert.equal(workflow.concurrency['cancel-in-progress'], false);
    assert.ok(job.steps.some(step => step.run === 'bash scripts/run_all_security_checks.sh'));
    assert.equal(build.env.FIREBASE_APP_CHECK_WEB_KEY, '${{ vars.FIREBASE_APP_CHECK_WEB_KEY }}');
    assert.match(build.run, /FIREBASE_APP_CHECK_WEB_KEY:\?/);
    assert.match(build.run, /npm run build:web/);
    assert.ok(deploy);
    assert.equal(deploy.env.FIREBASE_PROJECT_ID, '${{ vars.FIREBASE_PROJECT_ID }}');
    assert.equal(deploy.env.FIREBASE_APP_HOSTING_SITE, '${{ vars.FIREBASE_APP_HOSTING_SITE }}');
    assert.equal(deploy.env.FIREBASE_STAFF_HOSTING_SITE, '${{ vars.FIREBASE_STAFF_HOSTING_SITE }}');
    assert.equal(deploy.env.FIREBASE_SERVICE_ACCOUNT_JSON, '${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON }}');
    assert.match(deploy.run, /timeout --signal=TERM --kill-after=30s 15m/);
    assert.match(deploy.run, /--only firestore,hosting --project "\$FIREBASE_PROJECT_ID" --non-interactive/);
    assert.doesNotMatch(deploy.run, /--dry-run|rzp_(?:test|live)_|\$HOME|firebase login/);
    assert.ok(job.steps.indexOf(build) < job.steps.indexOf(deploy));
    const firebase = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
    for (const site of firebase.hosting) assert.equal(site.public, 'dist/site');
  });

  for (const exit of [0, 7]) {
    test(`${environment} deploy shell propagates CLI exit ${exit} and cleans temporary credentials`, t => {
      const f = deployFixture(t);
      const result = f.run(deploy.run, { FAKE_FIREBASE_EXIT: String(exit) });
      assert.ifError(result.error);
      assert.equal(result.status, exit, result.stderr);
      const calls = fs.readFileSync(f.log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args, ['deploy', '--config', calls[0].configFile, '--only', 'firestore,hosting', '--project', 'demo-thakur-deploy', '--non-interactive']);
      assert.equal(calls[0].mode, 0o600);
      assert.equal(calls[0].jsonStillExported, false);
      assert.equal(fs.existsSync(calls[0].file), false);
      assert.equal(fs.existsSync(calls[0].configFile), false);
      assert.equal(calls[0].config.functions, undefined);
      assert.deepEqual(calls[0].config.hosting.map(site => site.site), ['demo-thakur-app', 'demo-thakur-staff']);
      for (const site of calls[0].config.hosting) {
        assert.equal(site.public, path.join(f.directory, 'dist/site'));
        assert.equal(site.target, undefined);
      }
      assert.equal(calls[0].config.firestore.rules, path.join(f.directory, 'firestore/firestore.rules'));
      assert.ok(!(result.stdout + result.stderr).includes('synthetic-fixture-only'));
      f.assertClean();
    });
  }

  for (const [label, overrides] of [
    ['missing project', { FIREBASE_PROJECT_ID: '' }],
    ['invalid project', { FIREBASE_PROJECT_ID: '--injected' }],
    ['missing secret', { FIREBASE_SERVICE_ACCOUNT_JSON: '' }],
    ['missing app site', { FIREBASE_APP_HOSTING_SITE: '' }],
    ['missing staff site', { FIREBASE_STAFF_HOSTING_SITE: '' }],
    ['invalid site', { FIREBASE_APP_HOSTING_SITE: '../other-site' }],
    ['duplicate sites', { FIREBASE_APP_HOSTING_SITE: 'demo-thakur-staff' }],
    ['invalid JSON', { FIREBASE_SERVICE_ACCOUNT_JSON: 'synthetic-fixture-only invalid JSON' }],
    ['wrong project', { FIREBASE_PROJECT_ID: 'other-demo-project' }],
  ]) {
    test(`${environment} rejects ${label} before invoking Firebase`, t => {
      const f = deployFixture(t);
      const result = f.run(deploy.run, overrides);
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(f.log), false);
      assert.ok(!(result.stdout + result.stderr).includes('synthetic-fixture-only'));
      f.assertClean();
    });
  }

  test(`${environment} web build rejects an unset App Check site key before invoking npm`, t => {
    const f = deployFixture(t);
    const result = f.run(build.run, { FIREBASE_APP_CHECK_WEB_KEY: '' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FIREBASE_APP_CHECK_WEB_KEY/);
  });
}
