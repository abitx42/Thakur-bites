'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const flutter = process.env.FLUTTER_BIN || (fs.existsSync(path.join(root, '.tools/flutter/bin/flutter'))
  ? path.join(root, '.tools/flutter/bin/flutter') : 'flutter');
function runFlutter(args) {
  const result = spawnSync(flutter, args, { cwd: path.join(root, 'thakur_bites'), stdio: 'inherit',
    env: { ...process.env, PUB_CACHE: process.env.PUB_CACHE || path.join(root, '.cache/pub') } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Flutter ${args[0]} failed (exit ${result.status ?? result.signal}).`);
}
module.exports = { runFlutter };
