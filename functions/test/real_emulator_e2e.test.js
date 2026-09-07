const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// Import actual compiled production modules from lib/
const { evaluateOperationalSLOs } = require('../lib/alert_thresholds');
const { validateEnvironmentCredentials, detectEnvironment } = require('../lib/env_config');
const { evaluateCampusSchedule, calculateSmartCanteenForecast } = require('../lib/smart_canteen');

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

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Phase 10: Smart Canteen Predictive Lunch Rush Intelligence
  // ──────────────────────────────────────────────────────────────────────────
  it('9. Smart Canteen: Campus schedule evaluator detects Primary Lunch Rush & applies 3.5x multiplier', () => {
    // 12:45 PM test date
    const lunchDate = new Date('2026-09-08T12:45:00');
    const { period, nextRecess } = evaluateCampusSchedule(lunchDate);

    assert.strictEqual(period, 'PEAK_LUNCH_RUSH');
    assert.ok(nextRecess.name.includes('Evening Snacks'));
    assert.strictEqual(nextRecess.historicalDemandMultiplier, 1.5);

    // 11:30 AM test date (prior to lunch rush)
    const midDayDate = new Date('2026-09-08T11:30:00');
    const midDayRes = evaluateCampusSchedule(midDayDate);
    assert.strictEqual(midDayRes.period, 'MID_DAY_LECTURES');
    assert.strictEqual(midDayRes.nextRecess.startTime, '12:30 PM');
    assert.strictEqual(midDayRes.nextRecess.historicalDemandMultiplier, 3.5);
  });

  it('10. Smart Canteen: Predictive stockout intelligence flags Masala Dosa deficit before recess bell', () => {
    const mockMenuItems = [
      { id: 'tb_dosa', name: 'Special Masala Dosa', category: 'South Indian', stockOnHand: 15, reservedStock: 3, type: 'instant' },
      { id: 'tb_vadapav', name: 'Mumbai Vada Pav', category: 'Snacks', stockOnHand: 50, reservedStock: 5, type: 'instant' },
    ];

    // Simulating orders with 20 Dosas and 10 Vada Pavs sold in the first 4 hours of operation
    const mockOrders = [
      { status: 'confirmed', items: [{ id: 'tb_dosa', quantity: 20 }, { id: 'tb_vadapav', quantity: 10 }] },
      { status: 'preparing', items: [{ id: 'tb_dosa', quantity: 5 }] },
    ];

    // 11:45 AM (45 mins before lunch rush)
    const testDate = new Date('2026-09-08T11:45:00');
    const forecast = calculateSmartCanteenForecast(mockMenuItems, mockOrders, testDate);

    assert.ok(forecast.currentCampusPeriod === 'MID_DAY_LECTURES');
    assert.ok(forecast.predictedKitchenLoad.activeQueueOrders === 2);
    
    // Check stockout prediction for Special Masala Dosa
    const dosaRisk = forecast.stockoutRiskPredictions.find(p => p.name === 'Special Masala Dosa');
    assert.ok(dosaRisk, 'Masala Dosa risk predicted');
    assert.strictEqual(dosaRisk.riskLevel, 'HIGH');
    assert.ok(dosaRisk.projectedDeficit > 0, 'Projected deficit flagged');
    assert.ok(dosaRisk.recommendation.includes('Prepare/restock'));

    // Verify proactive prep recommendations exist
    assert.ok(forecast.proactivePrepRecommendations.length > 0);
    assert.ok(forecast.proactivePrepRecommendations.some(r => r.title.includes('Masala Dosa')));
  });
});
