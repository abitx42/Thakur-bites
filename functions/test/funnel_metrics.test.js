const { describe, it } = require('node:test');
const assert = require('node:assert');

const { calculateConversionFunnel } = require('../lib/funnel_metrics');

describe('Phase 11 Pillar 3: Order Conversion Funnel & Success Rate Metrics', () => {

  it('1. Funnel Calculation: Accurately maps 9-stage funnel and computes Order Success Rate', () => {
    const mockOrders = [
      { status: 'collected', paymentStatus: 'paid' },
      { status: 'collected', paymentStatus: 'paid' },
      { status: 'collected', paymentStatus: 'paid' },
      { status: 'ready', paymentStatus: 'paid' },
      { status: 'preparing', paymentStatus: 'paid' },
      { status: 'cancelled', paymentStatus: 'paid' }, // cancelled post-pay
      { status: 'payment_pending', paymentStatus: 'initiated' }, // payment dropped
    ];

    const funnelRes = calculateConversionFunnel(mockOrders);

    assert.ok(funnelRes.funnelStages.length === 9, 'All 9 stages calculated');
    assert.strictEqual(funnelRes.totalCheckoutsAttempted, 7);
    assert.strictEqual(funnelRes.totalOrdersCompleted, 3); // 3 collected

    // Order Success Rate = (3 / 7) * 100 = 42.9%
    assert.strictEqual(funnelRes.orderSuccessRatePercent, 42.9);

    // Stages check
    const checkoutStage = funnelRes.funnelStages.find(s => s.stageName === 'Checkout Started');
    const pickedUpStage = funnelRes.funnelStages.find(s => s.stageName === 'Food Picked Up');
    assert.strictEqual(checkoutStage.count, 7);
    assert.strictEqual(pickedUpStage.count, 3);
  });

  it('2. Bottleneck Detection: Flags payment abandonment when payment drops occur', () => {
    // 10 checkouts, but only 2 succeed in paying
    const droppedOrders = [
      { status: 'collected', paymentStatus: 'paid' },
      { status: 'collected', paymentStatus: 'paid' },
      { status: 'payment_pending', paymentStatus: 'initiated' },
      { status: 'payment_pending', paymentStatus: 'initiated' },
      { status: 'payment_pending', paymentStatus: 'initiated' },
      { status: 'payment_pending', paymentStatus: 'initiated' },
      { status: 'payment_pending', paymentStatus: 'initiated' },
      { status: 'payment_pending', paymentStatus: 'initiated' },
      { status: 'payment_pending', paymentStatus: 'initiated' },
      { status: 'payment_pending', paymentStatus: 'initiated' },
    ];

    const res = calculateConversionFunnel(droppedOrders);
    assert.strictEqual(res.primaryDropoffBottleneck.stage, 'Payment Successful');
    assert.ok(res.primaryDropoffBottleneck.dropoffCount >= 8);
    assert.ok(res.primaryDropoffBottleneck.actionableRecommendation.includes('UPI intent'));
  });
});
