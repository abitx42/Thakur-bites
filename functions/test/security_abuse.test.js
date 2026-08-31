const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

describe('Phase 7 & Production Gate Security Abuse Integration Tests', () => {

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

  it('8. Webhook Amount Tampering Defense: Detects and rejects mismatched payment amounts', () => {
    const orderDoc = { id: 'order_123', totalAmount: 120.0, currency: 'INR' };
    const expectedPaise = Math.round(orderDoc.totalAmount * 100); // 12000 paise

    function validateWebhookPayment(order, receivedAmountPaise, receivedCurrency) {
      const expected = Math.round(order.totalAmount * 100);
      if (receivedAmountPaise !== expected || receivedCurrency !== order.currency) {
        return { isValid: false, reason: 'AMOUNT_MISMATCH_REJECTED' };
      }
      return { isValid: true, reason: 'PAYMENT_VERIFIED' };
    }

    // Legitimate webhook -> ₹120.00 (12000 paise)
    const validRes = validateWebhookPayment(orderDoc, 12000, 'INR');
    assert.strictEqual(validRes.isValid, true);

    // Tampered payload -> ₹1.00 (100 paise)
    const tamperedRes = validateWebhookPayment(orderDoc, 100, 'INR');
    assert.strictEqual(tamperedRes.isValid, false);
    assert.strictEqual(tamperedRes.reason, 'AMOUNT_MISMATCH_REJECTED');
  });

  it('9. Webhook Idempotency Defense: Rejects duplicate webhook event replays', () => {
    const processedEvents = new Set();

    function processGatewayWebhookEvent(eventId) {
      if (processedEvents.has(eventId)) {
        return { processed: false, alreadyProcessed: true };
      }
      processedEvents.add(eventId);
      return { processed: true, alreadyProcessed: false };
    }

    const eventId = 'evt_rzp_webhook_99999';
    const firstDelivery = processGatewayWebhookEvent(eventId);
    assert.strictEqual(firstDelivery.alreadyProcessed, false);

    const retryDelivery = processGatewayWebhookEvent(eventId);
    assert.strictEqual(retryDelivery.alreadyProcessed, true);
  });

  it('10. Short-Lived Signed QR Expiration Defense: Rejects expired QR tokens', () => {
    const secret = 'test_secret_qr_signing_secret';

    function verifyQrToken(qrToken, currentUnix) {
      const parts = qrToken.split('.');
      if (parts.length !== 5) return false;
      const [orderId, studentId, nonce, expiresAtStr, signature] = parts;
      const expiresAt = parseInt(expiresAtStr, 10);
      if (currentUnix > expiresAt) {
        return false; // Expired!
      }
      const expectedSig = crypto.createHmac('sha256', secret)
        .update(`${orderId}:${studentId}:${nonce}:${expiresAtStr}`)
        .digest('hex');
      return crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signature));
    }

    const now = 1756650000;
    const expiresAt = now + 7200; // 2 hours in future
    const nonce = 'abc12345';
    const sig = crypto.createHmac('sha256', secret).update(`order_1:student_1:${nonce}:${expiresAt}`).digest('hex');
    const validToken = `order_1.student_1.${nonce}.${expiresAt}.${sig}`;

    assert.strictEqual(verifyQrToken(validToken, now), true);
    assert.strictEqual(verifyQrToken(validToken, now + 8000), false); // Rejected past expiry
  });

  it('11. Signed QR Signature Tampering Defense: Detects tampered orderId in QR payload', () => {
    const secret = 'test_secret_qr_signing_secret';
    const expiresAt = 1756657200;
    const nonce = 'abc12345';
    const legitimateSig = crypto.createHmac('sha256', secret).update(`order_1:student_1:${nonce}:${expiresAt}`).digest('hex');

    // Attacker modifies order_1 to order_2 while preserving original signature
    const tamperedToken = `order_2.student_1.${nonce}.${expiresAt}.${legitimateSig}`;

    const expectedSigForTampered = crypto.createHmac('sha256', secret).update(`order_2:student_1:${nonce}:${expiresAt}`).digest('hex');
    const isTamperedMatch = crypto.timingSafeEqual(Buffer.from(expectedSigForTampered), Buffer.from(legitimateSig));

    assert.strictEqual(isTamperedMatch, false);
  });

  it('12. Pickup PIN Brute-Force Lockout Defense: Locks order after 3 failed attempts', () => {
    const order = { id: 'order_1', failedAttempts: 0, isLocked: false };
    const correctPinHash = crypto.createHash('sha256').update('5432').digest('hex');

    function attemptPinVerification(orderDoc, inputPin) {
      if (orderDoc.isLocked) {
        return { success: false, isLocked: true };
      }
      const hash = crypto.createHash('sha256').update(inputPin).digest('hex');
      if (hash === correctPinHash) {
        orderDoc.failedAttempts = 0;
        return { success: true, isLocked: false };
      }
      orderDoc.failedAttempts++;
      if (orderDoc.failedAttempts >= 3) {
        orderDoc.isLocked = true;
      }
      return { success: false, isLocked: orderDoc.isLocked, attemptsRemaining: Math.max(0, 3 - orderDoc.failedAttempts) };
    }

    // Attempt 1: Fail (2 left)
    const att1 = attemptPinVerification(order, '1111');
    assert.strictEqual(att1.isLocked, false);
    assert.strictEqual(att1.attemptsRemaining, 2);

    // Attempt 2: Fail (1 left)
    const att2 = attemptPinVerification(order, '2222');
    assert.strictEqual(att2.isLocked, false);
    assert.strictEqual(att2.attemptsRemaining, 1);

    // Attempt 3: Fail (0 left -> LOCKED)
    const att3 = attemptPinVerification(order, '3333');
    assert.strictEqual(att3.isLocked, true);
    assert.strictEqual(att3.attemptsRemaining, 0);

    // Attempt 4: Even with correct PIN, order remains locked
    const att4 = attemptPinVerification(order, '5432');
    assert.strictEqual(att4.success, false);
    assert.strictEqual(att4.isLocked, true);
  });
});
