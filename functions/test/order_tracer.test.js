const { describe, it } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'tcet-pilot-test' });
}

const { recordOrderLifecycleTrace } = require('../lib/order_tracer');

describe('Phase 11 Pillar 1: Order Lifecycle Tracer & Correlation Forensic Diagnostic', () => {

  it('1. Trace Emission: Generates unique TRC- UUID with unified correlationId', async () => {
    const trace = await recordOrderLifecycleTrace({
      orderId: 'ord_trace_101',
      correlationId: 'REQ-STUDENT-ABC123',
      stage: 'PAYMENT_INITIATED',
      actorId: 'student_42',
      details: { amountPaise: 8500, gateway: 'razorpay' },
    });

    assert.ok(trace.traceId.startsWith('TRC-'), 'Trace ID starts with TRC-');
    assert.strictEqual(trace.orderId, 'ord_trace_101');
    assert.strictEqual(trace.correlationId, 'REQ-STUDENT-ABC123');
    assert.strictEqual(trace.stage, 'PAYMENT_INITIATED');
    assert.strictEqual(trace.actorId, 'student_42');
    assert.strictEqual(trace.details.amountPaise, 8500);
  });

  it('2. Forensic Diagnosis Logic: Diagnoses orphaned payment on cancelled order', () => {
    function diagnoseOrder(orderData) {
      const isPaid = orderData.paymentStatus === 'paid' || orderData.paymentStatus === 'captured';
      const isCollected = orderData.status === 'collected';
      const isCancelled = orderData.status === 'cancelled';
      const isOrphaned = isPaid && isCancelled;

      let summary = 'Order completed normally.';
      if (isOrphaned) {
        summary = 'ORPHANED PAYMENT: Student funds captured after cancellation. Auto-refund queued.';
      } else if (!isPaid && !isCancelled) {
        summary = 'PAYMENT PENDING: Waiting for student gateway completion or webhook verification.';
      } else if (isPaid && !isCollected) {
        summary = `IN PROGRESS: Food is ${orderData.status}. Token #${orderData.tokenNumber || '—'}.`;
      }

      return { isFullySettled: isPaid, isFoodCollected: isCollected, isOrphaned, hasDiscrepancy: isOrphaned, summary };
    }

    // Normal confirmed order
    const normal = diagnoseOrder({ paymentStatus: 'paid', status: 'ready', tokenNumber: 'TB-102' });
    assert.strictEqual(normal.isOrphaned, false);
    assert.strictEqual(normal.hasDiscrepancy, false);
    assert.ok(normal.summary.includes('TB-102'));

    // Orphaned capture
    const orphan = diagnoseOrder({ paymentStatus: 'paid', status: 'cancelled' });
    assert.strictEqual(orphan.isOrphaned, true);
    assert.strictEqual(orphan.hasDiscrepancy, true);
    assert.ok(orphan.summary.includes('ORPHANED PAYMENT'));

    // Payment pending
    const pending = diagnoseOrder({ paymentStatus: 'initiated', status: 'payment_pending' });
    assert.strictEqual(pending.isFullySettled, false);
    assert.ok(pending.summary.includes('PAYMENT PENDING'));
  });
});
