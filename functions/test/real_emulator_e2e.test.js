const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// Import actual compiled production modules from lib/
const { evaluateOperationalSLOs } = require('../lib/alert_thresholds');
const { validateEnvironmentCredentials, detectEnvironment } = require('../lib/env_config');

/**
 * Phase 9 — Real Production Function & Emulator Integration Test Suite
 * Directly executes actual compiled Cloud Function logic and validates
 * operational SLO evaluation, environment segregation, and production invariants.
 */
describe('Phase 9: Real Cloud Function & Emulator Integration Suite', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Authoritative Operational SLO Engine
  // ──────────────────────────────────────────────────────────────────────────
  it('1. Operational SLOs: Healthy evaluation when metrics are nominal', () => {
    const nominalMetrics = {
      checkoutAttempts: 100,
      checkoutSuccesses: 99,
      paymentReconciliationDelaySeconds: 45,
      stockContentionEvents: 1,
      unbalancedLedgersDetected: 0,
      webhookSignatureAttacks: 0,
      negativeStockDetected: 0,
      unauthorizedAdminEscalations: 0,
      breakGlassTokensUsed: 0,
      averageQueueWaitMinutes: 8,
    };

    const evalResult = evaluateOperationalSLOs(nominalMetrics);
    assert.strictEqual(evalResult.level, 'HEALTHY');
    assert.strictEqual(evalResult.recommendedAction, 'NONE');
    assert.ok(evalResult.metricsSnapshot.checkoutSuccessRate >= 0.98);
  });

  it('2. Operational SLOs: Warning mode triggered on slow payment reconciliation (>120s)', () => {
    const warningMetrics = {
      checkoutAttempts: 100,
      checkoutSuccesses: 99,
      paymentReconciliationDelaySeconds: 140, // SLO threshold breached
      stockContentionEvents: 0,
      unbalancedLedgersDetected: 0,
      webhookSignatureAttacks: 0,
      negativeStockDetected: 0,
      unauthorizedAdminEscalations: 0,
      breakGlassTokensUsed: 0,
      averageQueueWaitMinutes: 5,
    };

    const evalResult = evaluateOperationalSLOs(warningMetrics);
    assert.strictEqual(evalResult.level, 'WARNING');
    assert.strictEqual(evalResult.recommendedAction, 'NOTIFY_MANAGER');
    assert.ok(evalResult.reasons.some(r => r.includes('PAYMENT SLOWDOWN')));
  });

  it('3. Operational SLOs: Critical mode triggered on forged webhook attack', () => {
    const criticalMetrics = {
      checkoutAttempts: 50,
      checkoutSuccesses: 49,
      paymentReconciliationDelaySeconds: 30,
      stockContentionEvents: 0,
      unbalancedLedgersDetected: 0,
      webhookSignatureAttacks: 1, // Signature attack intercepted
      negativeStockDetected: 0,
      unauthorizedAdminEscalations: 0,
      breakGlassTokensUsed: 0,
      averageQueueWaitMinutes: 6,
    };

    const evalResult = evaluateOperationalSLOs(criticalMetrics);
    assert.strictEqual(evalResult.level, 'CRITICAL');
    assert.strictEqual(evalResult.recommendedAction, 'SWITCH_TO_DEGRADED');
    assert.ok(evalResult.reasons.some(r => r.includes('GATEWAY TAMPER')));
  });

  it('4. Operational SLOs: Emergency freeze triggered on unbalanced double-entry ledger', () => {
    const emergencyMetrics = {
      checkoutAttempts: 10,
      checkoutSuccesses: 10,
      paymentReconciliationDelaySeconds: 20,
      stockContentionEvents: 0,
      unbalancedLedgersDetected: 1, // Accounting violation detected
      webhookSignatureAttacks: 0,
      negativeStockDetected: 0,
      unauthorizedAdminEscalations: 0,
      breakGlassTokensUsed: 0,
      averageQueueWaitMinutes: 5,
    };

    const evalResult = evaluateOperationalSLOs(emergencyMetrics);
    assert.strictEqual(evalResult.level, 'EMERGENCY');
    assert.strictEqual(evalResult.recommendedAction, 'SWITCH_TO_FINANCIAL_FROZEN');
    assert.ok(evalResult.reasons.some(r => r.includes('CRITICAL INTEGRITY BREACH')));
  });

  it('5. Environment Credential Segregation: Validates test credentials in test environment', () => {
    const env = detectEnvironment();
    assert.ok(env === 'test' || env === 'development', `Current test env is: ${env}`);

    const testValid = validateEnvironmentCredentials({
      razorpayKeyId: 'rzp_test_mock_123',
      allowSimulation: true,
    });
    assert.strictEqual(testValid.valid, true);

    // Live credential rejection
    assert.throws(
      () => validateEnvironmentCredentials({ razorpayKeyId: 'rzp_live_real_prod_key' }),
      /Live Razorpay credentials/
    );
  });

  it('6. Operational SLOs: Kitchen congestion warning triggered when wait time exceeds 20 minutes', () => {
    const congestionMetrics = {
      checkoutAttempts: 50,
      checkoutSuccesses: 50,
      paymentReconciliationDelaySeconds: 25,
      stockContentionEvents: 2,
      unbalancedLedgersDetected: 0,
      webhookSignatureAttacks: 0,
      negativeStockDetected: 0,
      unauthorizedAdminEscalations: 0,
      breakGlassTokensUsed: 0,
      averageQueueWaitMinutes: 24, // SLO breach: > 20 mins
    };

    const evalResult = evaluateOperationalSLOs(congestionMetrics);
    assert.strictEqual(evalResult.level, 'WARNING');
    assert.strictEqual(evalResult.recommendedAction, 'NOTIFY_MANAGER');
    assert.ok(evalResult.reasons.some(r => r.includes('KITCHEN CONGESTION')));
  });

  it('7. Operational SLOs: Critical alert triggered when checkout success rate drops below 90%', () => {
    const dropMetrics = {
      checkoutAttempts: 20,
      checkoutSuccesses: 17, // 85% success rate < 90%
      paymentReconciliationDelaySeconds: 40,
      stockContentionEvents: 5,
      unbalancedLedgersDetected: 0,
      webhookSignatureAttacks: 0,
      negativeStockDetected: 0,
      unauthorizedAdminEscalations: 0,
      breakGlassTokensUsed: 0,
      averageQueueWaitMinutes: 12,
    };

    const evalResult = evaluateOperationalSLOs(dropMetrics);
    assert.strictEqual(evalResult.level, 'CRITICAL');
    assert.strictEqual(evalResult.recommendedAction, 'SWITCH_TO_DEGRADED');
    assert.ok(evalResult.reasons.some(r => r.includes('CHECKOUT COLLAPSE')));
  });

  it('8. Operational SLOs: Forensic emergency triggered when emergency break-glass token is consumed', () => {
    const breakGlassMetrics = {
      checkoutAttempts: 10,
      checkoutSuccesses: 10,
      paymentReconciliationDelaySeconds: 15,
      stockContentionEvents: 0,
      unbalancedLedgersDetected: 0,
      webhookSignatureAttacks: 0,
      negativeStockDetected: 0,
      unauthorizedAdminEscalations: 0,
      breakGlassTokensUsed: 1, // Consumed break-glass token
      averageQueueWaitMinutes: 4,
    };

    const evalResult = evaluateOperationalSLOs(breakGlassMetrics);
    assert.strictEqual(evalResult.level, 'EMERGENCY');
    assert.strictEqual(evalResult.recommendedAction, 'SWITCH_TO_FINANCIAL_FROZEN');
    assert.ok(evalResult.reasons.some(r => r.includes('FORENSIC ESCALATION')));
  });
});
