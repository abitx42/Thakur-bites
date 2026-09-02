const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isSimulationAllowed, assertNotProduction, detectEnvironment } = require('../lib/env_config');

describe('Phase 4: Environment Isolation & Security Configuration Tests', () => {

  it('211. Production Simulation Invariant: Payment simulation is strictly prohibited in production', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSim = process.env.SIMULATE_PAYMENTS;

    try {
      process.env.NODE_ENV = 'production';
      process.env.SIMULATE_PAYMENTS = 'true';

      assert.strictEqual(detectEnvironment(), 'production');
      assert.strictEqual(isSimulationAllowed(), false);
      assert.throws(
        () => assertNotProduction('simulatePaymentSuccess'),
        /SECURITY VIOLATION.*forbidden in production/
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalSim !== undefined) {
        process.env.SIMULATE_PAYMENTS = originalSim;
      } else {
        delete process.env.SIMULATE_PAYMENTS;
      }
    }
  });

  it('212. Non-Production Environment Simulation Invariant: Allowed strictly in test/dev', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSim = process.env.SIMULATE_PAYMENTS;

    try {
      process.env.NODE_ENV = 'test';
      assert.strictEqual(isSimulationAllowed(), true);
      assert.doesNotThrow(() => assertNotProduction('testOperation'));
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalSim !== undefined) {
        process.env.SIMULATE_PAYMENTS = originalSim;
      } else {
        delete process.env.SIMULATE_PAYMENTS;
      }
    }
  });

  it('213. Production Project ID Safety Invariant: Detects prod in project ID', () => {
    const originalProject = process.env.PROJECT_ID;
    const originalEnv = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = 'development';
      process.env.PROJECT_ID = 'thakurbites-prod-live';

      assert.strictEqual(detectEnvironment(), 'production');
      assert.strictEqual(isSimulationAllowed(), false);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalProject !== undefined) {
        process.env.PROJECT_ID = originalProject;
      } else {
        delete process.env.PROJECT_ID;
      }
    }
  });

});
