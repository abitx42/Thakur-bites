'use strict';

// One allowlist for local HTTP serving and deployment staging. Never publish the repository root.
const PUBLIC_FILES = new Set([
  'index.html', 'staff.html', 'admin.html', 'developer.html', 'portal.html', 'copilot.html',
  'privacy.html', 'tv.html', 'favicon.ico', 'favicon.png', 'manifest.json', 'robots.txt',
  'security.txt', '.well-known/security.txt', 'sitemap.xml', 'version.json',
  'main.dart.js', 'main.dart.wasm', 'main.dart.mjs', 'main.dart.js_1.part.js',
  'flutter.js', 'flutter_bootstrap.js', 'flutter_service_worker.js', 'sw.js',
]);
const PUBLIC_TREES = new Set(['assets', 'canvaskit', 'css', 'icons', 'js', 'web_tv']);
const PUBLIC_EXTENSIONS = new Set([
  '.html', '.css', '.js', '.mjs', '.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.webp', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav', '.wasm', '.bin', '.frag',
]);
function isPublicPath(relative) {
  if (PUBLIC_FILES.has(relative)) return true;
  const parts = relative.split('/');
  if (parts.some(part => !part || part.startsWith('.') || part === 'node_modules' || /[\\\u0000-\u001f\u007f]/.test(part))) return false;
  if (!PUBLIC_TREES.has(parts[0])) return false;
  if (relative === 'assets/NOTICES') return true;
  // Configuration credentials, sourcemaps, backups and arbitrary source are not public assets.
  if (parts.some(part => /(?:^|[._-])(?:secrets?|credentials?|service.?accounts?|backups?)(?:[._-]|$)/i.test(part))) return false;
  return PUBLIC_EXTENSIONS.has(require('node:path').extname(relative).toLowerCase());
}
const ROUTES = Object.freeze({
  '/': 'index.html', '/staff': 'staff.html', '/kitchen': 'staff.html', '/pickup': 'staff.html',
  '/cashier': 'staff.html', '/admin': 'admin.html', '/developer': 'developer.html', '/tv': 'tv.html',
  '/portal': 'portal.html', '/gateway': 'portal.html', '/copilot': 'copilot.html', '/ai': 'copilot.html',
  '/privacy': 'privacy.html', '/web_tv': 'web_tv/index.html',
  '/styles.css': 'web_tv/styles.css', '/tv.js': 'web_tv/tv.js',
});

const CSP = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://www.gstatic.com https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/ https://*.firebaseapp.com https://accounts.google.com https://apis.google.com https://*.razorpay.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' data: blob: https://*.googleapis.com https://*.cloudfunctions.net https://*.firebaseio.com https://*.firebaseapp.com https://www.gstatic.com https://fonts.gstatic.com https://fonts.googleapis.com https://accounts.google.com https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/ https://*.razorpay.com https://cloudflareinsights.com https://*.cloudflareinsights.com wss://*.firebaseio.com wss://*.googleapis.com",
  "worker-src 'self' blob:",
  "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com https://*.razorpay.com https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/",
].join('; ') + ';';
const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': CSP,
});
module.exports = { PUBLIC_FILES, PUBLIC_TREES, isPublicPath, ROUTES, SECURITY_HEADERS };
