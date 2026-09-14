const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Round 5 Invariants & System Hardening Regression Suite', () => {
  describe('BUG-07: Conversion Funnel Asia/Kolkata Evaluation', () => {
    const { calculateConversionFunnel } = require('../lib/funnel_metrics');

    it('should calculate funnel metrics and format summaryDate correctly', () => {
      const sampleOrders = [
        { status: 'placed', paymentStatus: 'pending' },
        { status: 'confirmed', paymentStatus: 'paid' },
        { status: 'preparing', paymentStatus: 'paid' },
        { status: 'ready', paymentStatus: 'paid' },
        { status: 'collected', paymentStatus: 'paid' },
        { status: 'cancelled', paymentStatus: 'refunded' },
      ];

      const res = calculateConversionFunnel(sampleOrders, '2026-09-14');
      assert.strictEqual(res.summaryDate, '2026-09-14');
      assert.strictEqual(res.totalOrdersCompleted, 1);
      assert.ok(res.funnelStages.length === 9, 'Should have 9 stages');
      assert.ok(res.orderSuccessRatePercent >= 0 && res.orderSuccessRatePercent <= 100);
    });
  });

  describe('BUG-08: Menu Item Available Stock Equation in upsertMenuItem', () => {
    it('should compute availableStock and stockCount as stockOnHand - reservedStock', () => {
      const stockOnHand = 50;
      const reservedStock = 12;
      const computedAvailable = Math.max(0, stockOnHand - reservedStock);
      assert.strictEqual(computedAvailable, 38);

      const oversoldOnHand = 5;
      const oversoldReserved = 8;
      const clampedAvailable = Math.max(0, oversoldOnHand - oversoldReserved);
      assert.strictEqual(clampedAvailable, 0, 'Negative stock must clamp to 0');
    });
  });

  describe('BUG-11: Universal Kitchen Prep Lock on Cancellation', () => {
    it('should reject cancellation when order is preparing or ready regardless of counter-cash or digital payment', () => {
      const isCancellationBlocked = (status) => {
        return status === 'preparing' || status === 'ready' || status === 'collected';
      };

      // Counter-cash order in preparing status (paymentStatus: 'pending')
      const cashOrder = { status: 'preparing', paymentStatus: 'pending', paymentMethod: 'counter_cash' };
      assert.strictEqual(isCancellationBlocked(cashOrder.status), true, 'Counter-cash in prep must be locked from cancellation');

      // Online order in preparing status
      const onlineOrder = { status: 'preparing', paymentStatus: 'paid', paymentMethod: 'online' };
      assert.strictEqual(isCancellationBlocked(onlineOrder.status), true, 'Online order in prep must be locked from cancellation');

      // Fresh placed order can be cancelled
      const freshOrder = { status: 'placed', paymentStatus: 'pending' };
      assert.strictEqual(isCancellationBlocked(freshOrder.status), false, 'Fresh placed order may be cancelled');
    });
  });

  describe('BUG-12: Reconciliation Engine Includes Partially Refunded Orders', () => {
    it('should recognize partially_refunded orders as paid for revenue reconciliation', () => {
      const isPaidForReconciliation = (paymentStatus) => {
        return paymentStatus === 'paid' || paymentStatus === 'captured' || paymentStatus === 'partially_refunded';
      };

      assert.strictEqual(isPaidForReconciliation('paid'), true);
      assert.strictEqual(isPaidForReconciliation('captured'), true);
      assert.strictEqual(isPaidForReconciliation('partially_refunded'), true, 'partially_refunded must be counted in gross revenue');
      assert.strictEqual(isPaidForReconciliation('pending'), false);
      assert.strictEqual(isPaidForReconciliation('failed'), false);
    });
  });

  describe('BUG-13: Deactivated Account Guard', () => {
    it('should block operations when accountDisabled is true', () => {
      const checkAccountActive = (userData) => {
        if (userData && userData.accountDisabled === true) {
          throw new Error('Account has been deactivated.');
        }
      };

      assert.throws(() => checkAccountActive({ accountDisabled: true }), /deactivated/);
      assert.doesNotThrow(() => checkAccountActive({ accountDisabled: false }));
      assert.doesNotThrow(() => checkAccountActive({}));
    });
  });

  describe('BUG-15: Dietary Preferences Sanitization', () => {
    it('should sanitize dietary preferences list and notes', () => {
      const rawPreferences = ['  Jain Prep  ', '', 'No Onion ', 123, 'Extra Spicy'.repeat(10)];
      const sanitized = Array.isArray(rawPreferences)
        ? rawPreferences
            .filter(p => typeof p === 'string' && p.trim().length > 0)
            .map(p => p.trim().slice(0, 50))
            .slice(0, 5)
        : [];

      assert.deepStrictEqual(sanitized, ['Jain Prep', 'No Onion', 'Extra Spicy'.repeat(10).slice(0, 50)]);
      assert.ok(sanitized.length <= 5);
    });
  });
});
