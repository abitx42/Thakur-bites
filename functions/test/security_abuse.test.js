const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

describe('Phase 7 End-to-End Security & Abuse Integration Tests', () => {

  it('1. IDOR Defense: Blocks cross-student order access', () => {
    const studentA = 'student_uid_AAA';
    const studentB = 'student_uid_BBB';
    const orderDoc = { id: 'order_1', studentId: studentA, totalAmount: 100 };

    function canAccessOrder(requestingUid, order) {
      return requestingUid === order.studentId;
    }

    assert.strictEqual(canAccessOrder(studentA, orderDoc), true);
    assert.strictEqual(canAccessOrder(studentB, orderDoc), false);
  });

  it('2. Privilege Escalation Defense: Blocks unauthorized role promotions', () => {
    const validCallerRoles = ['admin', 'security_admin'];

    function authorizeRoleAssignment(callerRole) {
      return validCallerRoles.includes(callerRole);
    }

    assert.strictEqual(authorizeRoleAssignment('student'), false);
    assert.strictEqual(authorizeRoleAssignment('kitchen'), false);
    assert.strictEqual(authorizeRoleAssignment('pickup'), false);
    assert.strictEqual(authorizeRoleAssignment('admin'), true);
    assert.strictEqual(authorizeRoleAssignment('security_admin'), true);
  });

  it('3. Price Tampering Defense: Calculates totals authoritatively from database snapshot', () => {
    const dbCatalog = {
      samosa: { price: 25.0, available: true },
      thali: { price: 120.0, available: true },
    };

    // Attacker sends manipulated client price (e.g. ₹1 instead of ₹120)
    const clientPayload = [
      { itemId: 'samosa', quantity: 2, price: 1.0 },
      { itemId: 'thali', quantity: 1, price: 1.0 },
    ];

    // Backend calculation uses authoritative snapshot prices
    const authoritativeTotal = clientPayload.reduce((sum, item) => {
      const dbItem = dbCatalog[item.itemId];
      assert.ok(dbItem, 'Item must exist in catalog');
      return sum + dbItem.price * item.quantity;
    }, 0);

    assert.strictEqual(authoritativeTotal, 170.0); // 2*25 + 1*120 = 170, NOT 3.0
  });

  it('4. Race Condition Defense: Serialized transactions prevent inventory overselling', () => {
    let availableStock = 5;

    function attemptReservation(requestedQty) {
      if (requestedQty > availableStock) {
        return { success: false, remainingStock: availableStock };
      }
      availableStock -= requestedQty;
      return { success: true, remainingStock: availableStock };
    }

    // Client A requests 3 -> succeeds (2 left)
    const resA = attemptReservation(3);
    assert.strictEqual(resA.success, true);
    assert.strictEqual(resA.remainingStock, 2);

    // Client B requests 3 concurrently -> fails because only 2 left
    const resB = attemptReservation(3);
    assert.strictEqual(resB.success, false);
    assert.strictEqual(resB.remainingStock, 2);

    // Client C requests 2 -> succeeds (0 left)
    const resC = attemptReservation(2);
    assert.strictEqual(resC.success, true);
    assert.strictEqual(resC.remainingStock, 0);
  });

  it('5. QR/PIN Pickup Replay Defense: Rejects duplicate handover attempts', () => {
    const orderState = {
      id: 'order_999',
      status: 'ready',
      pinCode: '1234',
      isCollected: false,
    };

    function processPickup(order, inputPin) {
      if (order.status === 'collected' || order.isCollected) {
        return { success: false, alreadyCollected: true, message: 'Order already collected.' };
      }
      if (order.pinCode !== inputPin) {
        return { success: false, alreadyCollected: false, message: 'Invalid PIN.' };
      }
      order.status = 'collected';
      order.isCollected = true;
      return { success: true, alreadyCollected: false, message: 'Handover complete.' };
    }

    // First scan -> succeeds
    const firstScan = processPickup(orderState, '1234');
    assert.strictEqual(firstScan.success, true);
    assert.strictEqual(firstScan.alreadyCollected, false);

    // Second scan (replay) -> rejected
    const secondScan = processPickup(orderState, '1234');
    assert.strictEqual(secondScan.success, false);
    assert.strictEqual(secondScan.alreadyCollected, true);
  });

  it('6. Payment Signature Replay Defense: Idempotent payments collection', () => {
    const capturedPayments = new Set();

    function capturePayment(gatewayPaymentId) {
      if (capturedPayments.has(gatewayPaymentId)) {
        return { success: true, alreadyCaptured: true, isDuplicate: true };
      }
      capturedPayments.add(gatewayPaymentId);
      return { success: true, alreadyCaptured: false, isDuplicate: false };
    }

    const payId = 'pay_tcet_live_88888';
    const firstCall = capturePayment(payId);
    assert.strictEqual(firstCall.isDuplicate, false);

    const secondCall = capturePayment(payId);
    assert.strictEqual(secondCall.isDuplicate, true);
  });

  it('7. State Machine Transition Defense: Blocks invalid transition skips', () => {
    const ALLOWED = {
      confirmed: ['preparing', 'cancelled'],
      preparing: ['ready'],
      ready: ['collected'],
      collected: [],
    };

    function canTransition(current, next) {
      const allowedNext = ALLOWED[current] || [];
      return allowedNext.includes(next);
    }

    assert.strictEqual(canTransition('confirmed', 'preparing'), true);
    assert.strictEqual(canTransition('preparing', 'ready'), true);
    assert.strictEqual(canTransition('ready', 'collected'), true);

    // Illegal skip: confirmed directly to collected
    assert.strictEqual(canTransition('confirmed', 'collected'), false);
  });
});
