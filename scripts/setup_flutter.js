'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = fs.readFileSync(path.join(root, '.flutter-version'), 'utf8').trim();
const revision = 'd3b14c876900e553bc736ca19295fc09e3853e8e';
if (version !== '3.47.2') throw new Error('Update and verify the Flutter revision when changing .flutter-version.');
const sdk = path.join(root, '.tools/flutter');
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit',
    env: { ...process.env, PUB_CACHE: process.env.PUB_CACHE || path.join(root, '.cache/pub') }, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(executable)} ${args[0]} failed (exit ${result.status || result.signal}).`);
  return result;
}
if (!process.env.FLUTTER_BIN && !fs.existsSync(sdk)) {
  fs.mkdirSync(path.dirname(sdk), { recursive: true });
  run('git', ['clone', '--depth', '1', '--branch', version, 'https://github.com/flutter/flutter.git', sdk]);
}
const flutter = process.env.FLUTTER_BIN || path.join(sdk, 'bin/flutter');
run(flutter, ['--disable-analytics']);
const details = JSON.parse(run(flutter, ['--version', '--machine'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).stdout);
if (details.frameworkVersion !== version || details.frameworkRevision !== revision) throw new Error('Flutter version/revision differs from the project pin.');
run(flutter, ['precache', '--web', '--linux']);
run(flutter, ['pub', 'get', '--enforce-lockfile'], { cwd: path.join(root, 'thakur_bites') });
