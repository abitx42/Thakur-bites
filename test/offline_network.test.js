'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const preload = path.resolve(__dirname, '../scripts/offline_network.cjs');
for (const [label, script] of [
  ['DNS callbacks', "require('node:dns').lookup('example.invalid', error => { if (error?.code !== 'ENETOFFLINE') process.exit(1); console.log('BLOCKED'); });"],
  ['DNS promises', "require('node:dns').promises.lookup('example.invalid').then(()=>process.exit(1), error=>{if(error.code!=='ENETOFFLINE')process.exit(1);console.log('BLOCKED');});"],
  ['direct external TCP', "const socket=require('node:net').connect(443,'203.0.113.1'); socket.on('connect',()=>process.exit(1)); socket.on('error',error=>{if(error.code!=='ENETOFFLINE')process.exit(1);console.log('BLOCKED');});"],
  ['HTTPS metadata access', "require('node:https').get('https://example.invalid',()=>process.exit(1)).on('error',error=>{if(error.code!=='ENETOFFLINE')process.exit(1);console.log('BLOCKED');});"],
]) {
  test(`offline test preload blocks ${label} before a remote connection`, () => {
    const result = spawnSync(process.execPath, ['--require', preload, '-e', script], { encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BLOCKED/);
  });
}
