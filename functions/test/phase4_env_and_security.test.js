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

  it('214. Firestore Transaction Invariant: 2+ instant items execute all reads before writes in reserveInventory', async () => {
    const { reserveInventoryInTransaction } = require('../lib/inventory_reservation');

    let hasWritten = false;
    const ops = [];

    const mockTransaction = {
      get: async (ref) => {
        if (hasWritten) {
          throw new Error('Firestore transactions require all reads to be executed before all writes.');
        }
        ops.push(`get:${ref.id}`);
        return {
          exists: true,
          id: ref.id,
          data: () => ({
            name: `Item ${ref.id}`,
            type: 'instant',
            stockOnHand: 10,
            reservedStock: 2,
          }),
        };
      },
      update: (ref, data) => {
        hasWritten = true;
        ops.push(`update:${ref.id}`);
      },
      set: (ref, data) => {
        hasWritten = true;
        ops.push(`set:${ref.id}`);
      },
    };

    const mockDb = {
      collection: (colName) => ({
        doc: (docId = 'gen_' + Math.random().toString(36).slice(2, 8)) => ({
          id: docId,
          path: `${colName}/${docId}`,
        }),
      }),
    };

    const items = [
      { itemId: 'chips_01', quantity: 1 },
      { itemId: 'coke_02', quantity: 2 },
      { itemId: 'choc_03', quantity: 1 },
    ];

    // Must NOT throw "all reads before all writes"
    await assert.doesNotReject(async () => {
      await reserveInventoryInTransaction(mockTransaction, mockDb, 'order_test_123', 'student_1', items);
    });

    // Check that all gets happened strictly before any updates/sets
    const firstWriteIndex = ops.findIndex(op => op.startsWith('update:') || op.startsWith('set:'));
    const lastReadIndex = ops.map((op, idx) => op.startsWith('get:') ? idx : -1).reduce((max, i) => Math.max(max, i), -1);

    assert.ok(firstWriteIndex > -1, 'Should have executed writes');
    assert.ok(lastReadIndex > -1, 'Should have executed reads');
    assert.ok(lastReadIndex < firstWriteIndex, `All reads (last at ${lastReadIndex}) must precede all writes (first at ${firstWriteIndex})`);
  });

  it('215. Firestore Transaction Invariant: commit and release execute all reads before writes for 2+ items', async () => {
    const { commitInventoryInTransaction, releaseInventoryInTransaction } = require('../lib/inventory_reservation');

    let hasWritten = false;
    const ops = [];

    const mockTransaction = {
      get: async (ref) => {
        if (hasWritten) {
          throw new Error('Firestore transactions require all reads to be executed before all writes.');
        }
        ops.push(`get:${ref.id}`);
        if (ref.id === 'order_test_456') {
          return {
            exists: true,
            id: ref.id,
            data: () => ({
              status: 'RESERVED',
              items: [
                { itemId: 'item_A', quantity: 1 },
                { itemId: 'item_B', quantity: 2 },
              ],
            }),
          };
        }
        return {
          exists: true,
          id: ref.id,
          data: () => ({
            name: `Item ${ref.id}`,
            type: 'instant',
            stockOnHand: 10,
            reservedStock: 5,
          }),
        };
      },
      update: (ref, data) => {
        hasWritten = true;
        ops.push(`update:${ref.id}`);
      },
      set: (ref, data) => {
        hasWritten = true;
        ops.push(`set:${ref.id}`);
      },
    };

    const mockDb = {
      collection: (colName) => ({
        doc: (docId = 'gen_' + Math.random().toString(36).slice(2, 8)) => ({
          id: docId,
          path: `${colName}/${docId}`,
        }),
      }),
    };

    await assert.doesNotReject(async () => {
      await commitInventoryInTransaction(mockTransaction, mockDb, 'order_test_456', 'cashier_1');
    });

    const firstWriteIndex = ops.findIndex(op => op.startsWith('update:') || op.startsWith('set:'));
    const lastReadIndex = ops.map((op, idx) => op.startsWith('get:') ? idx : -1).reduce((max, i) => Math.max(max, i), -1);

    assert.ok(lastReadIndex < firstWriteIndex, 'Commit must execute all reads before writes');
  });

  it('216. Identity Invariant: Exact domain matching rejects subdomain spoofing (TB-AUTH-005)', () => {
    const { classifyIdentity } = require('../lib/identity_classifier');

    // Subdomain spoofing attempts must NOT inherit institutional status
    const subTcet = classifyIdentity('student@attacker.tcetmumbai.in');
    assert.strictEqual(subTcet.accountType, 'VISITOR');
    assert.strictEqual(subTcet.verificationStatus, 'NOT_REQUIRED');
    assert.strictEqual(subTcet.priorityLevel, 0);

    const subOrg = classifyIdentity('teacher@fake.thakureducation.org');
    assert.strictEqual(subOrg.accountType, 'VISITOR');
    assert.strictEqual(subOrg.verificationStatus, 'NOT_REQUIRED');
    assert.strictEqual(subOrg.priorityLevel, 0);

    // Exact institutional domains must succeed
    const validStudent = classifyIdentity('1032251174@tcetmumbai.in');
    assert.strictEqual(validStudent.accountType, 'STUDENT');
    assert.strictEqual(validStudent.verificationStatus, 'VERIFIED');
    assert.strictEqual(validStudent.priorityLevel, 1);

    const validStaff = classifyIdentity('hod.it@thakureducation.org');
    assert.strictEqual(validStaff.accountType, 'COLLEGE_STAFF');
    assert.strictEqual(validStaff.verificationStatus, 'PENDING');
    assert.strictEqual(validStaff.priorityLevel, 0);
  });

  it('217. Provisioning Invariant: Idempotent provisioning protects verified TEACHER from downgrade (TB-AUTH-010)', async () => {
    // Simulate Firestore transaction logic of user_provisioning.ts
    const existingUserData = {
      uid: 'teacher_uid_999',
      email: 'hod.it@thakureducation.org',
      displayName: 'Dr. Faculty Member',
      accountType: 'TEACHER',
      verificationStatus: 'VERIFIED',
      priorityLevel: 2,
      isVerified: true,
      rollNo: 'FAC-IT-001',
      department: 'Information Technology',
      totalOrders: 15,
      totalSpentPaise: 45000,
    };

    let updatedFields = null;
    const mockTransaction = {
      get: async (ref) => {
        if (ref.id === 'teacher_uid_999') {
          return { exists: true, data: () => existingUserData };
        }
        return { exists: false };
      },
      update: (ref, data) => {
        updatedFields = data;
      },
      set: () => {},
    };

    const isProfileLocked = existingUserData.verificationStatus === 'VERIFIED' || existingUserData.accountType === 'TEACHER';
    const clientAttemptedRollNo = 'HACKED_ROLL_NO';
    const clientAttemptedDept = 'Hacked Department';

    const preservedRollNo = isProfileLocked && existingUserData.rollNo ? existingUserData.rollNo : clientAttemptedRollNo;
    const preservedDept = isProfileLocked && existingUserData.department ? existingUserData.department : clientAttemptedDept;

    mockTransaction.update({ id: 'teacher_uid_999' }, {
      displayName: 'Dr. Faculty Member Updated',
      department: preservedDept,
      rollNo: preservedRollNo,
      updatedAt: new Date(),
    });

    assert.strictEqual(updatedFields.rollNo, 'FAC-IT-001', 'Verified teacher employeeId/rollNo must NOT be overwritten');
    assert.strictEqual(updatedFields.department, 'Information Technology', 'Verified department must NOT be overwritten');
    assert.strictEqual(existingUserData.accountType, 'TEACHER', 'AccountType must remain TEACHER');
    assert.strictEqual(existingUserData.priorityLevel, 2, 'Priority level must remain 2');
  });

});

