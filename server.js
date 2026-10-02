const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.otf': 'font/otf',
  '.map': 'application/json',
};

const ROUTE_MAP = {
  '/': 'index.html',
  '/staff': 'staff.html',
  '/kitchen': 'staff.html',
  '/pickup': 'staff.html',
  '/cashier': 'staff.html',
  '/admin': 'admin.html',
  '/tv': 'tv.html',
  '/developer': 'developer.html',
  '/portal': 'portal.html',
  '/gateway': 'portal.html',
  '/copilot': 'copilot.html',
  '/ai': 'copilot.html',
  '/privacy': 'privacy.html',
  '/favicon.ico': 'favicon.ico',
};

function serveFile(res, filePath, statusCode = 200) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Internal Server Error');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(statusCode, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Strip trailing slash except for root
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // Check route map first
  if (ROUTE_MAP[pathname]) {
    const targetFile = path.join(ROOT_DIR, ROUTE_MAP[pathname]);
    return serveFile(res, targetFile);
  }

  // Prevent directory traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(ROOT_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      return serveFile(res, filePath);
    }

    // Check with .html extension
    const htmlPath = filePath + '.html';
    fs.stat(htmlPath, (htmlErr, htmlStats) => {
      if (!htmlErr && htmlStats.isFile()) {
        return serveFile(res, htmlPath);
      }

      // If missing and path looks like an asset (has extension), return 404
      if (path.extname(pathname)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      // Fallback to index.html for SPA routes
      const indexPath = path.join(ROOT_DIR, 'index.html');
      serveFile(res, indexPath);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Thakur Bites] Antideploy server running on http://0.0.0.0:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server');
  server.close(() => process.exit(0));
});
