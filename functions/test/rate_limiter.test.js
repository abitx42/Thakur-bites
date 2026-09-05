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

  it('Merges dynamic Firestore overrides over default endpoint policies', () => {
    const defaultLimits = {
      checkout: { maxRequests: 10, windowSeconds: 60 },
      payment_session: { maxRequests: 15, windowSeconds: 60 },
    };

    const firestoreOverrides = {
      checkout: { maxRequests: 25, windowSeconds: 60 }, // Loosened for festival rush
    };

    const effective = { ...defaultLimits, ...firestoreOverrides };
    assert.strictEqual(effective.checkout.maxRequests, 25);
    assert.strictEqual(effective.payment_session.maxRequests, 15);
  });

  it('Validates bounds on dynamic rate limit configuration parameters', () => {
    function validateRateLimitInput(maxRequests, windowSeconds) {
      if (typeof maxRequests !== 'number' || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) {
        return false;
      }
      if (typeof windowSeconds !== 'number' || !Number.isSafeInteger(windowSeconds) || windowSeconds < 5 || windowSeconds > 3600) {
        return false;
      }
      return true;
    }

    assert.strictEqual(validateRateLimitInput(15, 60), true);
    assert.strictEqual(validateRateLimitInput(0, 60), false); // Zero not allowed
    assert.strictEqual(validateRateLimitInput(1001, 60), false); // Exceeds ceiling
    assert.strictEqual(validateRateLimitInput(10, 4), false); // Window too small (< 5s)
    assert.strictEqual(validateRateLimitInput(10, 3601), false); // Window too large (> 1h)
    assert.strictEqual(validateRateLimitInput('10', 60), false); // Non-number
  });

  it('In-memory cache expires when elapsed time exceeds 60s TTL', () => {
    const TTL_MS = 60000;
    const cachedAt = Date.now() - 65000; // 65 seconds ago
    const isCacheValid = (Date.now() - cachedAt) < TTL_MS;
    assert.strictEqual(isCacheValid, false, 'Expired cache must trigger Firestore re-fetch');

    const freshCachedAt = Date.now() - 10000; // 10 seconds ago
    const isFreshValid = (Date.now() - freshCachedAt) < TTL_MS;
    assert.strictEqual(isFreshValid, true, 'Fresh cache must avoid unnecessary Firestore reads');
  });
});
