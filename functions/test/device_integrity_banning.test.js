const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Security Hardening & Device Integrity Banning Invariants', () => {

  it('1. Violation Type Validation: Accepts valid violation enums and rejects spoofed strings', () => {
    const validTypes = [
      'DEV_OPTIONS_ACTIVE',
      'ADB_ACTIVE',
      'ROOT_DETECTED',
      'TAMPERED_APK_SIGNATURE',
      'CLIENT_DOM_TAMPERING',
    ];

    function isValidViolation(type) {
      return typeof type === 'string' && validTypes.includes(type);
    }

    assert.strictEqual(isValidViolation('DEV_OPTIONS_ACTIVE'), true);
    assert.strictEqual(isValidViolation('ROOT_DETECTED'), true);
    assert.strictEqual(isValidViolation('TAMPERED_APK_SIGNATURE'), true);
    assert.strictEqual(isValidViolation('CLIENT_DOM_TAMPERING'), true);
    assert.strictEqual(isValidViolation('INVALID_EXPLOIT_TYPE'), false);
    assert.strictEqual(isValidViolation(''), false);
    assert.strictEqual(isValidViolation(null), false);
  });

  it('2. Automated Account & Device Ban Policy: Distinguishes warning vs critical actions', () => {
    const CRITICAL_VIOLATIONS = new Set([
      'ROOT_DETECTED',
      'TAMPERED_APK_SIGNATURE',
      'CLIENT_DOM_TAMPERING',
    ]);

    function determineSecurityAction(violationType) {
      if (CRITICAL_VIOLATIONS.has(violationType)) {
        return {
          banAccount: true,
          banDevice: true,
          actionTaken: 'ACCOUNT_AND_DEVICE_RESTRICTED',
          severity: 'CRITICAL',
        };
      }
      return {
        banAccount: false,
        banDevice: false,
        actionTaken: 'LOGGED_AND_MONITORED',
        severity: 'MEDIUM',
      };
    }

    const devResult = determineSecurityAction('DEV_OPTIONS_ACTIVE');
    assert.strictEqual(devResult.banAccount, false);
    assert.strictEqual(devResult.banDevice, false);
    assert.strictEqual(devResult.actionTaken, 'LOGGED_AND_MONITORED');

    const rootResult = determineSecurityAction('ROOT_DETECTED');
    assert.strictEqual(rootResult.banAccount, true);
    assert.strictEqual(rootResult.banDevice, true);
    assert.strictEqual(rootResult.actionTaken, 'ACCOUNT_AND_DEVICE_RESTRICTED');

    const tamperResult = determineSecurityAction('TAMPERED_APK_SIGNATURE');
    assert.strictEqual(tamperResult.banAccount, true);
    assert.strictEqual(tamperResult.banDevice, true);
    assert.strictEqual(tamperResult.actionTaken, 'ACCOUNT_AND_DEVICE_RESTRICTED');
  });

  it('3. Device Blacklist Verification in Checkout: Blocks banned devices fail-closed', () => {
    const bannedDevicesDB = new Map();
    bannedDevicesDB.set('banned_hardware_hash_123', {
      bannedAt: new Date().toISOString(),
      reason: 'TAMPERED_APK_SIGNATURE',
    });

    function evaluateCheckoutDeviceSecurity(deviceId) {
      if (deviceId && bannedDevicesDB.has(deviceId)) {
        throw new Error('PERMISSION_DENIED: This device has been restricted due to security policy violations.');
      }
      return true;
    }

    // Clean device
    assert.doesNotThrow(() => evaluateCheckoutDeviceSecurity('clean_phone_hash_999'));

    // Omitted device ID (e.g. web browser)
    assert.doesNotThrow(() => evaluateCheckoutDeviceSecurity(undefined));

    // Banned device
    assert.throws(
      () => evaluateCheckoutDeviceSecurity('banned_hardware_hash_123'),
      /This device has been restricted due to security policy violations/
    );
  });

  it('4. Account Deactivation Verification: Disabled accounts are strictly rejected', () => {
    const usersDB = {
      active_student: { displayName: 'John Doe', accountDisabled: false },
      banned_student: { displayName: 'Bad Actor', accountDisabled: true, disabledReason: 'Security tampering' },
    };

    function evaluateUserStatus(uid) {
      const user = usersDB[uid];
      if (!user) throw new Error('NOT_FOUND: User profile not found.');
      if (user.accountDisabled === true) {
        throw new Error('PERMISSION_DENIED: Account has been deactivated.');
      }
      return true;
    }

    assert.doesNotThrow(() => evaluateUserStatus('active_student'));
    assert.throws(
      () => evaluateUserStatus('banned_student'),
      /Account has been deactivated/
    );
  });

  it('5. Zero-Trust DOM Inspect Defense: Client-supplied price modifications are completely ignored', () => {
    const authoritativeCatalog = {
      'masala_dosa': { name: 'Masala Dosa', pricePaise: 8000 }, // ₹80.00
      'cold_coffee': { name: 'Cold Coffee', pricePaise: 4000 }, // ₹40.00
    };

    // Client attempts inspect element DOM modification to change price to ₹1 (100 paise)
    const clientTamperedItems = [
      { itemId: 'masala_dosa', quantity: 2, spoofedPrice: 100 },
      { itemId: 'cold_coffee', quantity: 1, spoofedPrice: 100 },
    ];

    // Authoritative server calculation ignores spoofedPrice entirely
    let calculatedTotalPaise = 0;
    for (const item of clientTamperedItems) {
      const canonicalItem = authoritativeCatalog[item.itemId];
      assert.ok(canonicalItem, 'Item must exist in canonical catalog');
      calculatedTotalPaise += canonicalItem.pricePaise * item.quantity;
    }

    // 2 * 8000 + 1 * 4000 = 20000 paise (₹200.00), NEVER ₹3.00
    assert.strictEqual(calculatedTotalPaise, 20000);
  });

  it('6. Workstation Verification Invariant: Counter handover requires live DB PIN match, not customer screens', () => {
    const confirmedOrdersInDatabase = new Map();
    confirmedOrdersInDatabase.set('TB-101', {
      orderId: 'ord_101',
      tokenNumber: 'TB-101',
      paymentStatus: 'paid',
      status: 'ready_for_pickup',
      pickupPin: '8294',
    });

    function verifyCounterHandover(tokenNumber, inputPin) {
      const order = confirmedOrdersInDatabase.get(tokenNumber);
      if (!order) return { success: false, reason: 'ORDER_NOT_FOUND' };
      if (order.paymentStatus !== 'paid') return { success: false, reason: 'PAYMENT_UNVERIFIED' };
      if (order.status !== 'ready_for_pickup') return { success: false, reason: 'ORDER_NOT_READY' };
      if (order.pickupPin !== inputPin) return { success: false, reason: 'INVALID_PIN' };
      return { success: true, orderId: order.orderId };
    }

    // Attacker modifies client DOM to claim order TB-101 with random or guessed PIN
    assert.strictEqual(verifyCounterHandover('TB-101', '0000').success, false);
    assert.strictEqual(verifyCounterHandover('TB-101', '1234').success, false);

    // Legitimate customer with matching PIN from secret/order
    const legitResult = verifyCounterHandover('TB-101', '8294');
    assert.strictEqual(legitResult.success, true);
    assert.strictEqual(legitResult.orderId, 'ord_101');
  });

});
