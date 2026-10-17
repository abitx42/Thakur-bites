'use strict';
// Test-only preload: external DNS and TCP are forbidden, even if a developer
// has cloud credentials. Loopback stays available for HTTP fixtures. This is
// a reproducibility guard, not a sandbox for executing hostile test code.
const net = require('node:net');
const dns = require('node:dns');
const allowed = hostname => ['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1'].includes(String(hostname).toLowerCase());
const unavailable = () => Object.assign(new Error('External networking is disabled in the offline test suite.'), { code: 'ENETOFFLINE' });
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let options = Array.isArray(args[0]) ? args[0][0] : args[0];
  let hostname;
  if (options && typeof options === 'object') {
    if (options.path) { queueMicrotask(() => this.destroy(unavailable())); return this; }
    hostname = options.host || options.hostname || 'localhost';
  } else if (typeof options === 'number') hostname = typeof args[1] === 'string' ? args[1] : 'localhost';
  else hostname = ''; // Unix sockets and unrecognized transports are not test fixtures.
  if (!allowed(hostname)) { queueMicrotask(() => this.destroy(unavailable())); return this; }
  return originalConnect.apply(this, args);
};
const originalLookup = dns.lookup;
dns.lookup = function (hostname, ...args) {
  if (allowed(hostname)) return originalLookup.call(this, hostname, ...args);
  const callback = args.at(-1);
  if (typeof callback !== 'function') throw unavailable();
  queueMicrotask(() => callback(unavailable()));
};
const originalPromiseLookup = dns.promises.lookup;
dns.promises.lookup = async function (hostname, ...args) {
  if (!allowed(hostname)) throw unavailable();
  return originalPromiseLookup.call(this, hostname, ...args);
};
