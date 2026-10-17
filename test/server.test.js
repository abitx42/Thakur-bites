'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('../server');

let server, fixture, port;
before(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'tb-http-'));
  for (const name of ['js', 'assets', 'web_tv', 'functions', 'reports', '.git', '.well-known']) await fs.mkdir(path.join(fixture, name));
  for (const name of ['index.html', 'staff.html', 'admin.html', 'tv.html', 'privacy.html', 'web_tv/index.html']) await fs.writeFile(path.join(fixture, name), `PUBLIC ${name}`);
  for (const name of ['.env', 'server.js', 'package.json', 'functions/secret.json', 'reports/private.json', '.git/config', 'assets/.env', 'js/app.js.map']) await fs.writeFile(path.join(fixture, name), 'PRIVATE');
  await fs.writeFile(path.join(fixture, 'js/app.js'), 'PUBLIC SCRIPT');
  await fs.writeFile(path.join(fixture, '.well-known/security.txt'), 'PUBLIC CONTACT');
  await fs.symlink(path.join(fixture, '.env'), path.join(fixture, 'js/leak.js'));
  await fs.symlink(path.join(fixture, 'functions'), path.join(fixture, 'assets/private'));
  server = createServer({ root: fixture });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (fixture) await fs.rm(fixture, { recursive: true, force: true });
});
function request(target, method = 'GET', headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, method, headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
for (const route of ['/', '/staff', '/staff/queue', '/web_tv', '/web_tv/', '/js/app.js', '/.well-known/security.txt']) {
  test(`serves intended public route ${route}`, async () => {
    const result = await request(route);
    assert.equal(result.status, 200);
    assert.match(result.body, /^PUBLIC/);
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
    assert.equal(result.headers['x-frame-options'], 'DENY');
    assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
  });
}
for (const target of ['/.env', '/.git/config', '/server.js', '/server_no_cache.py', '/web-public.js', '/package.json', '/functions/secret.json', '/reports/private.json', '/docs/private.md', '/node_modules', '/thakur_bites', '/assets/.env', '/js/app.js.map', '/js/leak.js', '/assets/private/secret.json']) {
  test(`does not expose private path ${target}`, async () => {
    const result = await request(target);
    assert.equal(result.status, 404);
    assert.ok(!result.body.includes('PRIVATE'));
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
  });
}
for (const target of ['/%', '/%zz', '/%ff', '/%00', '/js/%2e%2e/.env', '/a/../.env', '/a%5c..%5c.env', '//evil.example/path', 'http://evil.example/']) {
  test(`rejects malformed target without crashing ${target}`, async () => {
    assert.equal((await request(target)).status, 400);
    assert.equal((await request('/')).status, 200);
  });
}
test('HEAD returns headers and no body; writes are rejected', async () => {
  const get = await request('/');
  const head = await request('/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], get.headers['content-length']);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const result = await request('/', method);
    assert.equal(result.status, 405);
    assert.equal(result.headers.allow, 'GET, HEAD');
  }
});
test('invalid Host cannot crash parsing and missing assets remain 404', async () => {
  assert.equal((await request('/', 'GET', { Host: '[' })).status, 200);
  assert.equal((await request('/js/missing.js')).status, 404);
  assert.equal((await request('/assets')).status, 404);
});
