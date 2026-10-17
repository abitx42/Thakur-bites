const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { initializeTestEnvironment, assertSucceeds, assertFails: expectPermissionDenied } = require('@firebase/rules-unit-testing');
const { setLogLevel } = require('firebase/firestore');

// Expected assertFails rejections should not drown out assertion/coverage errors.
setLogLevel('silent');

async function assertFails(operation) {
  const rejection = await expectPermissionDenied(operation);
  assert.doesNotMatch(rejection?.message || '', /maximum of 1000 expressions|expression.*limit/i,
    'A denied operation must fail its authority checks, not exhaust the rules expression budget');
  return rejection;
}

// This suite intentionally fails rather than silently skipping when its local
// emulator is absent. It never connects to production or simulates rule logic.
const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const emulatorURL = new URL(`http://${emulatorAddress}`);
const host = emulatorURL.hostname;
const port = Number(emulatorURL.port);
let environment;
const future = new Date(Date.now() + 60 * 60 * 1000);
const past = new Date(Date.now() - 60 * 60 * 1000);
const workstationDeviceId = 'TB_WS_KITCHEN_A1B2C3D4';
const workstationShiftDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const workstationPinId = `kitchen_${workstationShiftDate}_FULL_DAY`;
const workstationTokenHash = crypto.createHash('sha256').update('local-rules-fixture-workstation-token').digest('hex');
const workstationDeviceHash = crypto.createHash('sha256').update(`DEVICE_${workstationDeviceId}`).digest('hex').slice(0, 16);
const pinCreatedAt = new Date(Date.now() - 120000);
const sessionCreatedAt = new Date(Date.now() - 60000);
const pinExpiresAt = new Date(`${workstationShiftDate}T23:59:59.999+05:30`);
const workstationExpiresAt = new Date(Math.min(future.getTime(), pinExpiresAt.getTime()));
const loginGeneration = 'ab'.repeat(16);

function pinRecord(changes = {}) {
  const salt = 'cd'.repeat(16);
  return {
    pinId: workstationPinId, role: 'kitchen', shiftDate: workstationShiftDate, shiftWindow: 'FULL_DAY',
    status: 'ACTIVE', salt, pinHash: crypto.pbkdf2Sync('123456', salt, 20000, 32, 'sha256').toString('hex'),
    createdAt: pinCreatedAt, expiresAt: pinExpiresAt, boundDevices: [workstationDeviceId], maxDevices: 2,
    lockedUntil: null, ...changes,
  };
}

// This only builds the server-owned fixture fingerprint. Access decisions are
// executed by the actual Firestore rules emulator, never a JS rules model.
function pinFingerprint(pin) {
  return crypto.createHash('sha256').update(JSON.stringify([pin.pinId, pin.pinHash, pin.salt, pin.createdAt.getTime()])).digest('hex');
}

function registeredWorkstation(changes = {}) {
  return { workstationId: workstationDeviceId, stationType: 'kitchen', status: 'ACTIVE', tokenHash: workstationTokenHash, ...changes };
}
const board = {
  date: '2026-10-17', dayOfWeek: 'SATURDAY', sabji1: 'Paneer', sabji2: 'Aloo',
  dalOfTheDay: 'Dal', sweetOfTheDay: 'Kheer', riceType: 'Rice',
  canteenSpecial: 'Thali', specialBadge: 'SPECIAL', rotiAvailable: true,
  puriAvailable: true, announcement: '', isRushHour: false, updatedAt: new Date(),
};
const authoritativeDocuments = [
  ['orders/order-1', { studentId: 'student-1', status: 'ready', paymentStatus: 'paid', totalAmount: 90, totalAmountPaise: 9000, items: [{ itemId: 'item-1', quantity: 1 }] }],
  ['menuItems/item-1', { name: 'Meal', price: 90, stockOnHand: 12, reservedStock: 2 }],
  ['staffUsers/staff-target', { uid: 'staff-target', role: 'cashier', permissionsVersion: 1 }],
  ['shiftPins/pin-1', { pinId: 'pin-1', role: 'kitchen', shiftDate: '2026-10-17', status: 'ACTIVE', pinHash: 'test-only-hash', salt: 'test-only-salt', expiresAt: future, boundDevices: ['device-1'] }],
  ['registeredWorkstations/ws-1', { role: 'kitchen', status: 'ACTIVE', tokenHash: 'test-only-hash' }],
  ['workstationSessions/session-1', { sessionId: 'session-1', role: 'kitchen', status: 'ACTIVE', expiresAt: future, deviceId: 'device-1', pinId: 'pin-1', shiftDate: '2026-10-17' }],
  ['verificationApplications/application-1', { userId: 'student-1', status: 'SUBMITTED', applicationType: 'TEACHER' }],
  ['publicLiveQueue/current', { readyTokens: ['TB-123'], activeCount: 1 }],
  ['counters/dailyTokenCounter', { lastToken: 123, date: '2026-10-17' }],
  ['categories/food', { name: 'Food' }],
  ['categories/food/subcategories/lunch', { name: 'Lunch' }],
];

function client(uid, claims = {}) {
  return environment.authenticatedContext(uid, claims).firestore();
}

async function seed(documents) {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all(documents.map(([documentPath, data]) => db.doc(documentPath).set(data)));
  });
}

async function denyAuthorityWrites(db) {
  for (const [documentPath, data] of authoritativeDocuments) {
    await assertFails(db.doc(`${documentPath}-new`).set(data));
    await assertFails(db.doc(documentPath).update(data));
    await assertFails(db.doc(documentPath).delete());
  }
}

function workstationClaims(role = 'kitchen', changes = {}) {
  return { role, isWorkstationSession: true, deviceId: workstationDeviceId, shiftDate: workstationShiftDate,
    shiftWindow: 'FULL_DAY', pinId: workstationPinId, sessionGeneration: loginGeneration, ...changes };
}

function workstationRecord(uid, changes = {}) {
  return {
    sessionId: uid, sessionGeneration: loginGeneration, pinId: workstationPinId, pinGeneration: pinFingerprint(pinRecord()),
    role: 'kitchen', staffUid: uid, deviceId: workstationDeviceId, deviceHash: workstationDeviceHash,
    workstationTokenHash, shiftDate: workstationShiftDate, shiftWindow: 'FULL_DAY', status: 'ACTIVE',
    createdAt: sessionCreatedAt, expiresAt: workstationExpiresAt,
    ...changes,
  };
}

async function seedWorkstation(uid, { record = {}, pin = {}, hardware = {}, claims = {} } = {}) {
  await seed([
    ['workstationSessions/' + uid, workstationRecord(uid, record)],
    ['shiftPins/' + workstationPinId, pinRecord(pin)],
    ['registeredWorkstations/' + workstationDeviceId, registeredWorkstation(hardware)],
  ]);
  return client(uid, workstationClaims('kitchen', claims));
}

describe('Authority boundaries in the actual Firestore rules emulator', () => {
  before(async () => {
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(host), 'tests require an explicitly local emulator');
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: host === '[::1]' ? '::1' : host, port });
      socket.setTimeout(1000);
      socket.once('connect', () => { socket.end(); resolve(); });
      socket.once('timeout', () => { socket.destroy(); reject(new Error(`Local Firestore emulator required at ${emulatorAddress}`)); });
      socket.once('error', error => reject(new Error(`Local Firestore emulator required at ${emulatorAddress}: ${error.code}`)));
    });
    environment = await initializeTestEnvironment({
      projectId: 'demo-thakur-authority-rules',
      firestore: {
        host, port,
        rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore/firestore.rules'), 'utf8'),
      },
    });
    await environment.clearFirestore();
    const user = {
      uid: 'student-1', displayName: 'Test Student', phone: '', rollNo: '', department: '', year: '',
      accountType: 'STUDENT', verificationStatus: 'PENDING', isVerified: false, accountDisabled: false,
      priorityLevel: 0, totalOrders: 1, totalSpentPaise: 9000, averageOrderPaise: 9000,
      preferences: {},
    };
    await seed([
      ...authoritativeDocuments,
      ['users/student-1', user],
      ['users/student-2', { ...user, uid: 'student-2', displayName: 'Other Student' }],
      ['students/student-1', { name: 'Test Student', year: 'FE', department: 'CS', preferences: {} }],
      ['payments/payment-1', { studentId: 'student-1', amountPaise: 9000 }],
      ['financialTransactions/transaction-1', { amountPaise: 9000 }],
      ['inventoryLedger/entry-1', { itemId: 'item-1', deltaUnits: 12 }],
      ['systemConfig/global', { mode: 'NORMAL' }],
      ['canteenConfig/dailyMenuBoard', board],
      ['dailyBoard/today', board],
      ['publicLiveQueue/private', { internal: 'not-public' }],
      ['staffUsers/recorded-manager', { role: 'manager', permissionsVersion: 1 }],
      ['staffUsers/demoted-student', { role: 'admin', permissionsVersion: 1 }],
      ['staffUsers/legacy-staff', { role: 'staff' }],
    ]);
  });

  after(async () => { if (environment) await environment.cleanup(); });

  for (const [label, claims] of [
    ['ordinary student', { role: 'student', email: 'student@example.test' }],
    ['institutional student', { role: 'student', email: 'student@tcetmumbai.in', email_verified: true }],
    ['institutional employee', { email: 'teacher@thakureducation.org', email_verified: true }],
    ['legacy allowlisted address', { email: 'adi@tcetmumbai.in', email_verified: true }],
    ['legacy gmail allowlist', { email: 'moreaboutastram@gmail.com', email_verified: true }],
    ['workstation flag only', { isWorkstationSession: true }],
    ['student with workstation flag', { role: 'student', isWorkstationSession: true }],
    ['forged administrative workstation', workstationClaims('admin')],
    ['forged kitchen workstation', workstationClaims()],
  ]) {
    it(`${label} has no administrative reads or authoritative writes`, async () => {
      const db = client(`attacker-${label.replaceAll(' ', '-')}`, claims);
      for (const documentPath of [
        'orders/order-1', 'users/student-1', 'staffUsers/staff-target', 'shiftPins/pin-1',
        'registeredWorkstations/ws-1', 'verificationApplications/application-1',
        'financialTransactions/transaction-1', 'inventoryLedger/entry-1', 'systemConfig/global',
      ]) {
        await assertFails(db.doc(documentPath).get());
      }
      for (const [documentPath, data] of authoritativeDocuments) {
        await assertFails(db.doc(documentPath).set(data, { merge: true }));
      }
      await assertFails(db.doc('canteenConfig/dailyMenuBoard').set(board, { merge: true }));
      await assertFails(db.doc('dailyBoard/today').set(board, { merge: true }));
    });
  }

  for (const role of ['admin', 'manager', 'developer', 'security_admin', 'system']) {
    it(`${role} retains trusted reads but cannot bypass any authority command`, async () => {
      const db = client(`trusted-${role}`, { role });
      for (const documentPath of [
        'orders/order-1', 'users/student-1', 'staffUsers/staff-target', 'shiftPins/pin-1',
        'registeredWorkstations/ws-1', 'verificationApplications/application-1',
        'financialTransactions/transaction-1', 'inventoryLedger/entry-1',
      ]) {
        await assertSucceeds(db.doc(documentPath).get());
      }
      await assertSucceeds(db.collection('orders').get());
      await denyAuthorityWrites(db);
      for (const update of [
        { role: 'admin' }, { priorityLevel: 3 }, { isVerified: true }, { accountDisabled: false },
        { accountType: 'COLLEGE_STAFF' }, { verificationStatus: 'VERIFIED' },
        { totalSpentPaise: 0 }, { permissionsVersion: 99 },
      ]) {
        await assertFails(db.doc('users/student-1').update(update));
      }
      await assertFails(db.doc('users/student-1').delete());
      await assertFails(db.doc(`users/trusted-${role}`).set({ displayName: 'Admin', role: 'admin' }));
    });
  }

  for (const role of ['kitchen', 'pickup', 'cashier']) {
    it(`canonical ${role} reads operational orders without administrative access`, async () => {
      const db = client(`trusted-${role}`, { role });
      await assertSucceeds(db.doc('orders/order-1').get());
      await assertSucceeds(db.collection('orders').get());
      await assertSucceeds(db.doc('systemConfig/global').get());
      await assertFails(db.doc('users/student-1').get());
      await assertFails(db.doc('payments/payment-1').get());
      await assertFails(db.doc('financialTransactions/transaction-1').get());
      await assertFails(db.doc('orders/order-1').update({ status: 'collected' }));
      await assertFails(db.doc('menuItems/item-1').update({ stockOnHand: 0 }));
    });
  }

  it('server-owned staff roles work without claims, while explicit customer claims take precedence', async () => {
    await assertSucceeds(client('recorded-manager').doc('financialTransactions/transaction-1').get());
    await assertSucceeds(client('recorded-manager').doc('orders/order-1').get());
    await assertFails(client('demoted-student', { role: 'student' }).doc('orders/order-1').get());
    await assertFails(client('legacy-staff').doc('orders/order-1').get());
    await assertFails(client('legacy-kitchen', { role: 'kitchen_staff' }).doc('orders/order-1').get());
  });

  it('an outdated administrator token cannot override a demoted live staffUsers role', async () => {
    const uid = 'demoted-administrator';
    await seed([['staffUsers/' + uid, { role: 'student', permissionsVersion: 2 }]]);
    const stale = client(uid, { role: 'admin', permissionsVersion: 1 });
    for (const documentPath of ['orders/order-1', 'financialTransactions/transaction-1', 'users/student-1', 'systemConfig/global']) {
      await assertFails(stale.doc(documentPath).get());
    }
    await assertFails(stale.collection('orders').get());
    await assertFails(stale.doc('dailyBoard/today').set({ ...board, updatedBy: uid }, { merge: true }));
  });

  it('customers retain own reads and bounded profile/preference updates without authority changes', async () => {
    const db = client('student-1', { role: 'student', email: 'student@tcetmumbai.in' });
    for (const documentPath of ['users/student-1', 'students/student-1', 'orders/order-1', 'payments/payment-1', 'verificationApplications/application-1']) {
      await assertSucceeds(db.doc(documentPath).get());
    }
    await assertSucceeds(db.collection('orders').where('studentId', '==', 'student-1').get());
    await assertFails(db.doc('users/student-2').get());
    await assertFails(db.collection('orders').get());
    await assertSucceeds(db.doc('users/student-1').update({ displayName: 'New Name', phone: '9876543210', preferences: { dietary: 'veg' } }));
    await assertSucceeds(db.doc('students/student-1').update({ preferences: { notifications: true } }));
    for (const update of [
      { role: 'admin' }, { accountType: 'TEACHER' }, { verificationStatus: 'VERIFIED' },
      { isVerified: true }, { priorityLevel: 3 }, { totalOrders: 100 }, { accountDisabled: true },
    ]) await assertFails(db.doc('users/student-1').update(update));
    await assertFails(db.doc('users/student-1').update({ preferences: {}, role: 'manager' }));
    await assertFails(db.doc('users/student-1').update({ displayName: 'x' }));
    await assertFails(db.doc('users/student-1').update({ phone: 'x'.repeat(30) }));
    await assertFails(db.doc('users/student-1').update({ preferences: 'not-a-map' }));
    await assertFails(db.doc('users/student-1').delete());
    await assertFails(db.doc('orders/student-supplied-order').set({
      studentId: 'student-1', status: 'placed', paymentStatus: 'unpaid', totalAmount: 0,
      items: [{ itemId: 'item-1', quantity: 100, price: 0 }],
    }));
    await assertFails(db.doc('orders/order-1').update({ status: 'cancelled' }));
    await seed([['orders/cancellable-order', {
      studentId: 'student-1', status: 'placed', paymentStatus: 'pending', totalAmount: 90,
      items: [{ itemId: 'item-1', quantity: 1 }],
    }]]);
    await assertFails(db.doc('orders/cancellable-order').update({
      status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Bypass server cancellation', updatedAt: new Date(),
    }));
    await assertFails(db.doc('verificationApplications/self-created').set({ userId: 'student-1', status: 'APPROVED' }));
    await seed([['users/disabled-student', { displayName: 'Disabled Student', accountDisabled: true }]]);
    await assertFails(client('disabled-student', { role: 'student' }).doc('users/disabled-student').update({ accountDisabled: false }));
  });

  it('profile creation is server-only even with superficially unprivileged initial defaults', async () => {
    const db = client('new-customer', { role: 'student' });
    await assertFails(db.doc('users/new-customer').set({
      displayName: 'New Customer', priorityLevel: 0, isVerified: false, accountType: 'STUDENT',
      verificationStatus: 'VERIFIED', accountDisabled: false, totalSpentPaise: -1,
    }));
    await assertFails(db.doc('users/new-customer').set({ displayName: 'New Customer', priorityLevel: 0, isVerified: false, accountType: 'STUDENT' }));
  });

  it('customer-owned preference and favourite documents remain functional and isolated', async () => {
    const db = client('student-1', { role: 'student' });
    const other = client('student-2', { role: 'student' });
    for (const [documentPath, data] of [
      ['userPreferences/student-1', { notifications: true, dietary: { vegetarian: true } }],
      ['userFavourites/student-1', { items: ['item-1'] }],
    ]) {
      await assertSucceeds(db.doc(documentPath).set(data));
      await assertSucceeds(db.doc(documentPath).get());
      await assertFails(other.doc(documentPath).get());
      await assertFails(other.doc(documentPath).update(data));
      await assertFails(db.doc(documentPath).update({ role: 'admin' }));
      await assertSucceeds(db.doc(documentPath).delete());
    }
  });

  it('public catalog, board and sanitized queue reads remain available without authentication', async () => {
    const db = environment.unauthenticatedContext().firestore();
    for (const documentPath of ['menuItems/item-1', 'categories/food', 'publicLiveQueue/current', 'canteenConfig/dailyMenuBoard', 'dailyBoard/today']) {
      await assertSucceeds(db.doc(documentPath).get());
    }
    await assertFails(db.doc('publicLiveQueue/private').get());
    await assertFails(db.doc('orders/order-1').get());
    await assertFails(db.doc('canteenConfig/dailyMenuBoard').set(board));
  });

  it('a canonical staff member can create both real board singletons in one atomic batch', async () => {
    await environment.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('canteenConfig/dailyMenuBoard').delete();
      await context.firestore().doc('dailyBoard/today').delete();
    });
    const db = client('first-cook', { role: 'kitchen' });
    const batch = db.batch();
    batch.set(db.doc('canteenConfig/dailyMenuBoard'), { ...board, updatedBy: 'first-cook' }, { merge: true });
    batch.set(db.doc('dailyBoard/today'), { ...board, updatedBy: 'first-cook' }, { merge: true });
    await assertSucceeds(batch.commit());
  });

  it('canonical staff can publish only validated daily-board singleton documents', async () => {
    for (const role of ['kitchen', 'pickup', 'cashier', 'manager', 'admin', 'developer', 'security_admin', 'system']) {
      const uid = `board-${role}`;
      const db = client(uid, { role });
      for (const documentPath of ['canteenConfig/dailyMenuBoard', 'dailyBoard/today']) {
        await assertSucceeds(db.doc(documentPath).set({ ...board, updatedBy: uid }, { merge: true }));
        await assertSucceeds(db.doc(documentPath).update({ rotiAvailable: false }));
        await assertFails(db.doc(documentPath).update({ stockOnHand: 100, price: 1 }));
        await assertFails(db.doc(documentPath).update({ announcement: 'x'.repeat(1001) }));
        await assertFails(db.doc(documentPath).update({ puriAvailable: 'yes' }));
        await assertFails(db.doc(documentPath).update({ updatedBy: 'someone-else' }));
        await assertFails(db.doc(documentPath).delete());
      }
      await assertFails(db.doc('canteenConfig/pricing').set({ price: 1 }));
      await assertFails(db.doc('dailyBoard/arbitrary').set(board));
    }
    // Legacy callers updating a board field need not overwrite unchanged author
    // metadata, while setting a different person's author stamp is forbidden.
    await assertSucceeds(client('another-cook', { role: 'kitchen' }).doc('dailyBoard/today').update({ rotiAvailable: true }));
  });

  it('a real active, bound workstation can read orders and publish the board, but cannot write authority', async () => {
    const uid = 'staff_kitchen_active';
    const db = await seedWorkstation(uid);
    await assertSucceeds(db.doc('orders/order-1').get());
    await assertSucceeds(db.doc('canteenConfig/dailyMenuBoard').set({ ...board, updatedBy: uid }, { merge: true }));
    await assertSucceeds(db.doc('dailyBoard/today').set({ ...board, updatedBy: uid }, { merge: true }));
    await assertFails(db.doc('orders/order-1').update({ status: 'collected' }));
    await assertFails(db.doc('staffUsers/staff-target').update({ role: 'admin' }));
    await assertFails(db.doc('publicLiveQueue/current').set({ readyTokens: ['FORGED'] }));
    await assertFails(db.doc('shiftPins/pin-1').get());
  });

  for (const [label, recordChanges, claimChanges] of [
    ['revoked', { status: 'REVOKED' }, {}],
    ['expired', { expiresAt: past }, {}],
    ['wrong role', { role: 'pickup' }, {}],
    ['wrong device', { deviceId: 'different-device' }, {}],
    ['wrong shift', { shiftDate: '2026-10-16' }, {}],
    ['wrong session id', { sessionId: 'another-uid' }, {}],
    ['missing pin', { pinId: 'nonexistent' }, {}],
    ['missing device claim', {}, { deviceId: null }],
    ['removed workstation flag', {}, { isWorkstationSession: false }],
  ]) {
    it(`${label} workstation credentials cannot read orders or publish the board`, async () => {
      const uid = `staff_kitchen_${label.replaceAll(' ', '_')}`;
      const db = await seedWorkstation(uid, { record: recordChanges, claims: claimChanges });
      await assertFails(db.doc('orders/order-1').get());
      await assertFails(db.doc('canteenConfig/dailyMenuBoard').set({ ...board, updatedBy: uid }, { merge: true }));
    });
  }

  for (const [label, pinChanges] of [
    ['revoked PIN', { status: 'REVOKED' }],
    ['expired PIN', { expiresAt: past }],
    ['unbound device', { boundDevices: [] }],
    ['PIN role mismatch', { role: 'pickup' }],
    ['PIN shift mismatch', { shiftDate: '2026-10-16' }],
  ]) {
    it(`${label} immediately denies workstation reads and daily-board writes`, async () => {
      const uid = `staff_kitchen_${label.replaceAll(' ', '_')}`;
      const db = await seedWorkstation(uid, { pin: pinChanges });
      await assertFails(db.doc('orders/order-1').get());
      await assertFails(db.doc('dailyBoard/today').set({ ...board, updatedBy: uid }, { merge: true }));
    });
  }

  it('T3 relogin immediately rejects an old token generation while accepting the new token', async () => {
    const uid = 'staff_kitchen_relogin';
    const old = await seedWorkstation(uid);
    await assertSucceeds(old.doc('orders/order-1').get());
    const nextGeneration = 'ef'.repeat(16);
    await seed([['workstationSessions/' + uid, workstationRecord(uid, { sessionGeneration: nextGeneration })]]);
    await assertFails(old.doc('orders/order-1').get());
    await assertFails(old.doc('dailyBoard/today').set({ ...board, updatedBy: uid }, { merge: true }));
    const current = client(uid, workstationClaims('kitchen', { sessionGeneration: nextGeneration }));
    await assertSucceeds(current.doc('orders/order-1').get());
    await assertSucceeds(current.doc('dailyBoard/today').set({ ...board, updatedBy: uid }, { merge: true }));
  });

  for (const [label, record, claims] of [
    ['missing token generation', {}, { sessionGeneration: null }],
    ['missing stored generation', { sessionGeneration: null }, {}],
    ['stale token generation', {}, { sessionGeneration: 'ef'.repeat(16) }],
    ['wrong token PIN', {}, { pinId: `pickup_${workstationShiftDate}_FULL_DAY` }],
    ['wrong token window', {}, { shiftWindow: 'MORNING' }],
    ['wrong stored window', { shiftWindow: 'MORNING' }, {}],
    ['missing PIN fingerprint', { pinGeneration: null }, {}],
    ['wrong device digest', { deviceHash: '01'.repeat(8) }, {}],
    ['missing hardware binding', { workstationTokenHash: null }, {}],
    ['missing issued-at timestamp', { createdAt: null }, {}],
    ['future issued-at timestamp', { createdAt: future }, {}],
    ['missing required expiry', { expiresAt: null }, {}],
    ['overlong session lifetime', { expiresAt: new Date(sessionCreatedAt.getTime() + 9 * 3600000) }, {}],
  ]) {
    it(`T3 ${label} denies operational reads and board publication`, async () => {
      const uid = 'staff_kitchen_binding_regression';
      const db = await seedWorkstation(uid, { record, claims });
      await assertFails(db.doc('orders/order-1').get());
      await assertFails(db.doc('dailyBoard/today').set({ ...board, updatedBy: uid }, { merge: true }));
    });
  }

  for (const [label, pin] of [
    ['changed PIN hash with unchanged issuance time', { pinHash: '01'.repeat(32) }],
    ['changed PIN salt with unchanged issuance time', { salt: '02'.repeat(16) }],
    ['changed PIN issuance before the session', { createdAt: new Date(sessionCreatedAt.getTime() - 1000) }],
    ['PIN issuance after the session', { createdAt: new Date(sessionCreatedAt.getTime() + 1000) }],
    ['missing PIN issuance', { createdAt: null }],
    ['missing PIN expiry', { expiresAt: null }],
    ['PIN expiry beyond its shift', { expiresAt: new Date(pinExpiresAt.getTime() + 60000) }],
    ['invalid PIN window', { shiftWindow: 'INVALID' }],
  ]) {
    it(`T3 ${label} cannot reuse a previously active session`, async () => {
      const uid = 'staff_kitchen_pin_issuance_regression';
      const db = await seedWorkstation(uid, { pin });
      await assertFails(db.doc('orders/order-1').get());
      await assertFails(db.doc('dailyBoard/today').set({ ...board, updatedBy: uid }, { merge: true }));
    });
  }

  for (const [label, hardware] of [
    ['revoked hardware', { status: 'REVOKED' }],
    ['rotated hardware secret', { tokenHash: '03'.repeat(32) }],
    ['wrong hardware role', { stationType: 'cashier' }],
    ['wrong hardware identity', { workstationId: 'TB_WS_KITCHEN_DIFFERENT' }],
  ]) {
    it(`T3 ${label} invalidates an otherwise active bound session`, async () => {
      const uid = 'staff_kitchen_hardware_regression';
      const db = await seedWorkstation(uid, { hardware });
      await assertFails(db.doc('orders/order-1').get());
      await assertFails(db.doc('dailyBoard/today').set({ ...board, updatedBy: uid }, { merge: true }));
    });
  }

  it('T3 missing PIN or registered hardware records deny access despite an active session', async () => {
    const uid = 'staff_kitchen_missing_origin';
    for (const documentPath of ['shiftPins/' + workstationPinId, 'registeredWorkstations/' + workstationDeviceId]) {
      const db = await seedWorkstation(uid);
      await environment.withSecurityRulesDisabled(context => context.firestore().doc(documentPath).delete());
      await assertFails(db.doc('orders/order-1').get());
    }
  });

  it('T3 a restored past shift cannot become current merely by extending both expiries', async () => {
    const uid = 'staff_kitchen_restored_shift';
    const shiftDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(Date.now() - 86400000));
    const pinId = `kitchen_${shiftDate}_FULL_DAY`;
    const pin = pinRecord({ pinId, shiftDate });
    await seed([
      ['shiftPins/' + pinId, pin], ['registeredWorkstations/' + workstationDeviceId, registeredWorkstation()],
      ['workstationSessions/' + uid, workstationRecord(uid, { pinId, shiftDate, pinGeneration: pinFingerprint(pin) })],
    ]);
    const db = client(uid, workstationClaims('kitchen', { pinId, shiftDate }));
    await assertFails(db.doc('orders/order-1').get());
  });

  it('T3 regenerating a PIN and logging in cannot restore the old token generation', async () => {
    const uid = 'staff_kitchen_pin_regenerated';
    const old = await seedWorkstation(uid);
    await assertSucceeds(old.doc('orders/order-1').get());
    const pin = pinRecord({ salt: '04'.repeat(16), pinHash: '05'.repeat(32), createdAt: new Date(Date.now() - 10000) });
    await seed([['shiftPins/' + workstationPinId, pin]]);
    await assertFails(old.doc('orders/order-1').get());
    const nextGeneration = '06'.repeat(16);
    await seed([['workstationSessions/' + uid, workstationRecord(uid, {
      sessionGeneration: nextGeneration, pinGeneration: pinFingerprint(pin), createdAt: new Date(Date.now() - 5000),
    })]]);
    await assertFails(old.doc('orders/order-1').get());
    const current = client(uid, workstationClaims('kitchen', { sessionGeneration: nextGeneration }));
    await assertSucceeds(current.doc('orders/order-1').get());
  });
});
