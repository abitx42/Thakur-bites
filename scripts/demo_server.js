const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

const PORT = parseInt(process.env.PORT || '8080', 10);
const WEB_DIR = process.env.WEB_DIR || path.join(__dirname, '../thakur_bites/build/web');
const FUNCTIONS_PORT = parseInt(process.env.FUNCTIONS_PORT || '5001', 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  // ─── 1. CORS Preflight & Headers ──────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-Requested-With, x-firebase-appcheck, firebase-instance-id-token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname || '/';

  // ─── 2. Reverse Proxy for Cloud Functions (/adi-thakur-bite/*) ────────────
  if (pathname.startsWith('/adi-thakur-bite/')) {
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: FUNCTIONS_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${FUNCTIONS_PORT}`,
      }
    }, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', err => {
      console.error('[Proxy Error]', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Cloud Functions Emulator unavailable on 5001', status: 'UNAVAILABLE' } }));
    });

    req.pipe(proxyReq);
    return;
  }

  // ─── 3. Static Files with Multi-Portal & SPA Routing ──────────────────────
  let targetPath;
  if (pathname === '/admin' || pathname === '/admin/') {
    targetPath = path.join(WEB_DIR, 'admin.html');
  } else if (pathname === '/staff' || pathname === '/staff/') {
    targetPath = path.join(WEB_DIR, 'staff.html');
  } else if (pathname === '/developer' || pathname === '/developer/') {
    targetPath = path.join(WEB_DIR, 'developer.html');
  } else if (pathname === '/tv' || pathname === '/tv/') {
    targetPath = path.join(WEB_DIR, 'tv.html');
  } else if (pathname === '/portal' || pathname === '/portal/') {
    targetPath = path.join(WEB_DIR, 'portal.html');
  } else {
    // Normal file lookup
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const candidate = path.join(WEB_DIR, safePath);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      targetPath = candidate;
    } else if (fs.existsSync(path.join(candidate, 'index.html'))) {
      targetPath = path.join(candidate, 'index.html');
    } else {
      // SPA Fallback: customer app index.html
      targetPath = path.join(WEB_DIR, 'index.html');
    }
  }

  if (!fs.existsSync(targetPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(targetPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const compressible = ['.js', '.mjs', '.html', '.css', '.json', '.wasm'].includes(ext);
  const acceptEncoding = req.headers['accept-encoding'] || '';

  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Access-Control-Allow-Origin': '*',
  };

  if (compressible && acceptEncoding.includes('gzip')) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    fs.createReadStream(targetPath).pipe(zlib.createGzip()).pipe(res);
  } else {
    res.writeHead(200, headers);
    fs.createReadStream(targetPath).pipe(res);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Multi-Portal & Reverse Proxy Server running at http://0.0.0.0:${PORT}`);
  console.log(`   Serving static web from: ${WEB_DIR}`);
  console.log(`   Proxying /adi-thakur-bite/* -> http://127.0.0.1:${FUNCTIONS_PORT}`);
});
