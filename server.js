'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream');
const { isPublicPath, ROUTES, SECURITY_HEADERS } = require('./web-public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.otf': 'font/otf',
  '.frag': 'application/octet-stream', '.xml': 'application/xml; charset=utf-8',
};

function createServer({ root = __dirname } = {}) {
  const rootDir = path.resolve(root);
  return http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    const reply = (status, text) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : text);
    };
    req.resume();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return reply(405, 'Method Not Allowed');
    }
    let pathname;
    try {
      // Do not use an untrusted Host header as a URL base or normalize away traversal.
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return reply(400, 'Bad Request');
      pathname = decodeURIComponent(req.url.split('?')[0]);
      if (/[\x00-\x20\x7f\\]/.test(pathname) || pathname.length > 4096 ||
          pathname.split('/').some(segment => segment === '.' || segment === '..')) {
        return reply(400, 'Bad Request');
      }
    } catch (_) {
      return reply(400, 'Bad Request');
    }
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
    const route = ROUTES[pathname] || Object.entries(ROUTES).find(([name]) => name !== '/' && pathname.startsWith(`${name}/`))?.[1];
    let relative = route || pathname.slice(1);
    if (!isPublicPath(relative)) {
      // Unknown extensionless client routes may use the SPA; repository paths never do.
      const isClientRoute = !path.extname(relative) && !relative.includes('/') && /^[a-zA-Z0-9_-]+$/.test(relative) &&
        !['functions', 'scripts', 'test', 'firestore', 'docs', 'reports', 'node_modules', 'thakur_bites', 'assets', 'canvaskit', 'css', 'icons', 'js'].includes(relative);
      if (!isClientRoute) return reply(404, 'Not Found');
      relative = 'index.html';
    }
    try {
      // Reject all symlinks, including intermediate components inside public asset trees.
      let filename = rootDir;
      for (const segment of relative.split('/')) {
        filename = path.join(filename, segment);
        if ((await fs.promises.lstat(filename)).isSymbolicLink()) return reply(404, 'Not Found');
      }
      const handle = await fs.promises.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile()) {
        await handle.close();
        return reply(404, 'Not Found');
      }
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
      });
      if (req.method === 'HEAD') {
        await handle.close();
        res.end();
      } else {
        pipeline(handle.createReadStream(), res, () => {});
      }
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES'].includes(error.code)) return reply(404, 'Not Found');
      reply(500, 'Internal Server Error');
    }
  });
}

if (require.main === module) {
  const port = process.env.PORT === undefined ? 8080 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535.');
  const host = process.env.HOST || '127.0.0.1';
  const publicRoot = process.env.PUBLIC_DIR || path.join(__dirname, 'dist/site');
  if (!fs.existsSync(path.join(publicRoot, 'index.html'))) throw new Error('Web output is missing. Run npm run build:web before npm start.');
  const server = createServer({ root: publicRoot });
  server.listen(port, host, () => console.log(`[Thakur Bites] Serving public assets on port ${server.address().port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
}

module.exports = { createServer };
