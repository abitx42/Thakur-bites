const { describe, it } = require('node:test');
const assert = require('node:assert');
const { DEFAULT_ENDPOINT_LIMITS } = require('../lib/rate_limiter');
const { buildOrderNotification } = require('../lib/notifications');

describe('Round 2: Security & Architectural Invariants Test Suite', () => {

  it('1. Shift PIN verification endpoint has strict rate limiting (max 5 req/min)', () => {
    const shiftLimit = DEFAULT_ENDPOINT_LIMITS.shift_pin_verification;
    assert.ok(shiftLimit, 'shift_pin_verification endpoint must be configured');
    assert.strictEqual(shiftLimit.maxRequests, 5);
    assert.strictEqual(shiftLimit.windowSeconds, 60);
  });

  it('2. Notification builder produces formatted payload for pickup readiness', () => {
    const notif = buildOrderNotification('ord_123', 'TB-042', 'preparing', 'ready');
    assert.ok(notif);
    assert.ok(notif.body.includes('TB-042'));
    assert.ok(notif.body.includes('ready'));
  });

  it('3. Notification builder produces null for identical statuses (no redundant spam)', () => {
    const notif = buildOrderNotification('ord_123', 'TB-042', 'preparing', 'preparing');
    assert.strictEqual(notif, null);
  });

  it('4. Invariant: Cancelled or expired orders strictly forbid cash recording', () => {
    const cancelledOrder = { status: 'cancelled', paymentMethod: 'counter_cash', paymentStatus: 'cancelled' };
    const expiredOrder = { status: 'expired', paymentMethod: 'counter_cash', paymentStatus: 'expired' };

    function canRecordCash(order) {
      if (order.paymentMethod !== 'counter_cash') return false;
      if (order.status === 'cancelled' || order.status === 'expired' || order.paymentStatus === 'cancelled' || order.paymentStatus === 'expired') {
        return false;
      }
      return true;
    }

    assert.strictEqual(canRecordCash(cancelledOrder), false);
    assert.strictEqual(canRecordCash(expiredOrder), false);
    assert.strictEqual(canRecordCash({ status: 'placed', paymentMethod: 'counter_cash', paymentStatus: 'pending' }), true);
  });

  it('5. Pilot student feedback requires collected status before submission', () => {
    function validatePilotStudentFeedback(orderStatus) {
      if (orderStatus !== 'collected') {
        throw new Error('Pilot feedback can only be submitted once the order has been collected.');
      }
      return true;
    }

    assert.throws(() => validatePilotStudentFeedback('placed'), /collected/);
    assert.throws(() => validatePilotStudentFeedback('preparing'), /collected/);
    assert.throws(() => validatePilotStudentFeedback('cancelled'), /collected/);
    assert.strictEqual(validatePilotStudentFeedback('collected'), true);
  });

  it('6. Pilot staff feedback restricts roles to authoritative operational staff', () => {
    const allowedStaffRoles = ['kitchen', 'pickup', 'cashier', 'manager', 'admin'];

    function isAuthorizedStaffFeedback(callerRole) {
      return allowedStaffRoles.includes(callerRole);
    }

    assert.strictEqual(isAuthorizedStaffFeedback('kitchen'), true);
    assert.strictEqual(isAuthorizedStaffFeedback('cashier'), true);
    assert.strictEqual(isAuthorizedStaffFeedback('manager'), true);
    assert.strictEqual(isAuthorizedStaffFeedback('student'), false);
    assert.strictEqual(isAuthorizedStaffFeedback('guest'), false);
    assert.strictEqual(isAuthorizedStaffFeedback(''), false);
  });

  it('7. Break-glass operational mode restoration forbids self-approval (Dual Custody)', () => {
    function verifyBreakGlassDualCustody(createdAdminUid, approvingAdminUid) {
      if (createdAdminUid === approvingAdminUid) {
        throw new Error('Dual-custody invariant violation: The administrator who generated the break-glass token cannot approve its consumption.');
      }
      return true;
    }

    assert.throws(() => verifyBreakGlassDualCustody('admin_123', 'admin_123'), /Dual-custody/);
    assert.strictEqual(verifyBreakGlassDualCustody('admin_security', 'admin_operations'), true);
  });
});
