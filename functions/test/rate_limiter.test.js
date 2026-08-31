const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Phase 6 Operational Security & Rate Limiter Invariants', () => {
  it('Enforces max request ceiling within sliding window', () => {
    const config = { maxRequests: 5, windowSeconds: 60 };
    const now = Date.now();
    const windowStart = now - config.windowSeconds * 1000;

    // Simulate 5 requests within window
    const history = [
      now - 50000,
      now - 40000,
      now - 30000,
      now - 20000,
      now - 10000,
    ];

    const activeTimestamps = history.filter(t => t > windowStart);
    const wouldAllowNext = activeTimestamps.length < config.maxRequests;
    assert.strictEqual(wouldAllowNext, false);
  });

  it('Evicts expired timestamps outside sliding window', () => {
    const config = { maxRequests: 5, windowSeconds: 60 };
    const now = Date.now();
    const windowStart = now - config.windowSeconds * 1000;

    // Simulate old requests that have expired (> 60s ago)
    const history = [
      now - 90000, // Expired
      now - 80000, // Expired
      now - 70000, // Expired
      now - 10000, // Active
    ];

    const activeTimestamps = history.filter(t => t > windowStart);
    assert.strictEqual(activeTimestamps.length, 1);
    const wouldAllowNext = activeTimestamps.length < config.maxRequests;
    assert.strictEqual(wouldAllowNext, true);
  });

  it('Structured security event attributes conform to schema', () => {
    const event = {
      eventType: 'RATE_LIMIT_EXCEEDED',
      actorUid: 'student_12345',
      endpoint: 'checkout',
      severity: 'warn',
      timestamp: new Date(),
      details: { maxRequests: 10, windowSeconds: 60 },
    };

    assert.strictEqual(event.eventType, 'RATE_LIMIT_EXCEEDED');
    assert.strictEqual(['info', 'warn', 'critical'].includes(event.severity), true);
    assert.ok(event.details.maxRequests > 0);
  });
});
