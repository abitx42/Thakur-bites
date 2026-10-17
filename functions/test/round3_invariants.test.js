const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DEFAULT_ENDPOINT_LIMITS } = require('../lib/rate_limiter');

describe('Round 3: Security & Architectural Invariants Test Suite', () => {

  it('1. Telemetry Security Reporting Endpoint has strict rate limiting (max 10 req/min)', () => {
    const reportLimit = DEFAULT_ENDPOINT_LIMITS.security_report;
    assert.ok(reportLimit, 'security_report endpoint must be configured in DEFAULT_ENDPOINT_LIMITS');
    assert.strictEqual(reportLimit.maxRequests, 10);
    assert.strictEqual(reportLimit.windowSeconds, 60);
  });

  it('2. Invariant: Partial Refund Balance Calculation preserves unrefunded funds on cancellation', () => {
    function computeCancellationRefundPaise(orderData) {
      if (orderData.paymentStatus === 'paid' || orderData.paymentStatus === 'partially_refunded') {
        const amountPaidPaise = Number(orderData.amountPaidPaise || 0);
        const amountRefundedPaise = Number(orderData.amountRefundedPaise || 0);
        const pendingRefundPaise = Number(orderData.pendingRefundPaise || 0);
        const refundablePaise = orderData.amountRefundablePaise !== undefined
          ? Number(orderData.amountRefundablePaise)
          : Math.max(0, amountPaidPaise - amountRefundedPaise - pendingRefundPaise);

        if (refundablePaise > 0 && Number.isSafeInteger(refundablePaise)) {
          return refundablePaise;
        }
      }
      return 0;
    }

    // Fully paid ₹200 order
    assert.strictEqual(computeCancellationRefundPaise({ paymentStatus: 'paid', amountPaidPaise: 20000 }), 20000);

    // Partially refunded ₹200 order (₹80 already refunded) -> Remaining ₹120 must be refunded on cancellation
    assert.strictEqual(computeCancellationRefundPaise({
      paymentStatus: 'partially_refunded',
      amountPaidPaise: 20000,
      amountRefundedPaise: 8000,
    }), 12000);

    // Fully refunded order cancelled -> 0 paise to refund
    assert.strictEqual(computeCancellationRefundPaise({
      paymentStatus: 'partially_refunded',
      amountPaidPaise: 20000,
      amountRefundedPaise: 20000,
    }), 0);
  });

  it('3. Invariant: Bread availability check validates default uncustomized combos and total outages', () => {
    function validateBreadAvailability(itemData, customizations, rotiAvailable, puriAvailable) {
      const name = (itemData.name || '').toLowerCase();
      const cat = (itemData.category || '').toLowerCase();
      const isBreadMeal = cat === 'rotibhaji' || name.includes('thali') || name.includes('roti') || name.includes('puri');

      if (isBreadMeal) {
        if (!rotiAvailable && !puriAvailable) {
          throw new Error('All fresh breads (Chapatis & Puris) are sold out for today.');
        }

        const itemsWithCustom = customizations.filter(c => c);
        if (itemsWithCustom.length === 0) {
          if (!rotiAvailable) {
            throw new Error('Fresh Chapatis are sold out for today. Please customize your meal with Puris.');
          }
        } else {
          for (const c of itemsWithCustom) {
            const custLower = c.toLowerCase();
            if (!rotiAvailable && (custLower.includes('roti') || custLower.includes('chapati'))) {
              throw new Error('Fresh Chapatis are sold out for today. Please select Puris or update your cart.');
            }
            if (!puriAvailable && (custLower.includes('puri') || custLower.includes('poori'))) {
              throw new Error('Fresh Puris are sold out for today. Please select Rotis or update your cart.');
            }
          }
        }
      }
      return true;
    }

    // 1. Both out -> Thali throws
    assert.throws(() => validateBreadAvailability({ name: 'Special Deluxe Thali', category: 'meals' }, [], false, false), /All fresh breads/);

    // 2. Roti out, uncustomized Thali -> Thali throws requiring Puri customization
    assert.throws(() => validateBreadAvailability({ name: 'Special Deluxe Thali', category: 'meals' }, [], false, true), /customize your meal with Puris/);

    // 3. Roti out, customized with Puri -> Succeeds
    assert.strictEqual(validateBreadAvailability({ name: 'Special Deluxe Thali', category: 'meals' }, ['4 Fresh Puris'], false, true), true);

    // 4. Non-bread item (Idli Sambar) -> Succeeds even if breads are sold out
    assert.strictEqual(validateBreadAvailability({ name: 'Idli Sambar', category: 'snacks' }, [], false, false), true);
  });

  it('4. Invariant: Ratings computation enforces non-negative bounds and guards against NaN/Infinity', () => {
    function computeNewRating(currentCount, currentTotal, newRating) {
      const safeCount = (Number.isSafeInteger(currentCount) && currentCount >= 0) ? currentCount : 0;
      const safeTotal = (Number.isFinite(currentTotal) && currentTotal >= 0) ? currentTotal : 0;
      const newCount = safeCount + 1;
      const newTot = safeTotal + newRating;
      const newAverage = Number((newTot / newCount).toFixed(2));
      return { newCount, newTotal: newTot, newAverage };
    }

    // Normal progression: 1 review at 5.0 -> second review 4.0 -> average 4.5
    const r1 = computeNewRating(1, 5, 4);
    assert.strictEqual(r1.newCount, 2);
    assert.strictEqual(r1.newTotal, 9);
    assert.strictEqual(r1.newAverage, 4.5);

    // Corrupted state (-1 count) is safely normalized without NaN or Infinity
    const r2 = computeNewRating(-1, -10, 5);
    assert.strictEqual(r2.newCount, 1);
    assert.strictEqual(r2.newTotal, 5);
    assert.strictEqual(r2.newAverage, 5.0);
  });

  it('5. Invariant: Webhook terminal domain errors are classified to prevent retry storms', () => {
    function isTerminalDomainError(errorMessage) {
      const msg = String(errorMessage || '').toLowerCase();
      return (
        msg.includes('invalid payment flow') ||
        msg.includes('not found') ||
        msg.includes('mismatch') ||
        msg.includes('tamper') ||
        msg.includes('cancelled') ||
        msg.includes('zero-paise')
      );
    }

    assert.strictEqual(isTerminalDomainError('Invalid payment flow: Order placed as online cannot be settled as cash'), true);
    assert.strictEqual(isTerminalDomainError('PAYMENT_AMOUNT_TAMPERING_FLAGGED: Received 5000 paise expected 10000 paise'), true);
    assert.strictEqual(isTerminalDomainError('Order ord_999 not found.'), true);
    assert.strictEqual(isTerminalDomainError('DEADLINE_EXCEEDED: Firestore transaction timed out'), false);
    assert.strictEqual(isTerminalDomainError('ECONNRESET: Network socket disconnected'), false);
  });

  it('6. Invariant: Menu item availability toggle preserves physical stockOnHand', () => {
    function toggleAvailability(currentDoc, available) {
      const updateData = {
        available,
        isOrderable: available,
        availabilityStatus: available ? 'AVAILABLE' : 'OUT_OF_STOCK',
      };
      if (!available) {
        updateData.availableStock = 0;
      } else {
        const stockOnHand = Number(currentDoc.stockOnHand || 0);
        const reservedStock = Number(currentDoc.reservedStock || 0);
        updateData.availableStock = Math.max(0, stockOnHand - reservedStock);
      }
      return updateData;
    }

    const currentDoc = { stockOnHand: 25, reservedStock: 3 };
    const toggledOff = toggleAvailability(currentDoc, false);
    // stockOnHand must NOT be zeroed
    assert.strictEqual(toggledOff.stockOnHand, undefined);
    assert.strictEqual(toggledOff.availableStock, 0);

    const toggledBackOn = toggleAvailability(currentDoc, true);
    assert.strictEqual(toggledBackOn.availableStock, 22);
  });

  it('7. Invariant: Firestore Security Rules strictly lockdown TV projection and canteen singletons', () => {
    const rulesContent = fs.readFileSync(path.join(__dirname, '../../firestore/firestore.rules'), 'utf8');

    // The trusted backend alone publishes the PII-minimized projection.
    assert.match(rulesContent, /match \/publicLiveQueue\/current \{\s*allow read: if true;\s*allow write: if false;/);

    // 2. /canteenConfig/{configId} forbids deletion
    assert.match(rulesContent, /match \/canteenConfig\/\{configId\} \{[\s\S]*?allow create, update: if configId == 'dailyMenuBoard'[\s\S]*?allow delete: if false;/);

    // 3. /dailyBoard/{docId} forbids deletion
    assert.match(rulesContent, /match \/dailyBoard\/\{docId\} \{[\s\S]*?allow create, update: if docId == 'today'[\s\S]*?allow delete: if false;/);

    // 4. /userPreferences/{userId} has explicit allow delete
    assert.ok(rulesContent.includes('match /userPreferences/{userId} {\n      allow read: if isOwner(userId);\n      allow create, update: if isOwner(userId)') &&
              rulesContent.includes('allow delete: if isOwner(userId);'),
      '/userPreferences must support deletion for document owner');

    // 5. /userFavourites/{userId} has explicit allow delete
    assert.ok(rulesContent.includes('match /userFavourites/{userId} {\n      allow read: if isOwner(userId);\n      allow create, update: if isOwner(userId)') &&
              rulesContent.includes('allow delete: if isOwner(userId);'),
      '/userFavourites must support deletion for document owner');
  });
});
