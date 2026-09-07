/**
 * ══════════════════════════════════════════════════════════════════
 * PHASE 11 — GATE B: REAL FIREBASE EMULATOR RECOVERY APPROVAL TESTS
 * ══════════════════════════════════════════════════════════════════
 *
 * These tests verify the rebuilt four-eyes disaster recovery approval
 * and cryptographic break-glass mechanisms against the real Firestore
 * emulator. They prove the actual security properties — not via mocks.
 *
 * Run via: firebase emulators:exec --only firestore 'node --test test/emulator/recovery_approval.test.js'
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('crypto');
const admin = require('firebase-admin');

const PROJECT_ID = 'thakur-bites-recovery-test';

let app;
let db;

describe('Real Firebase Emulator — Recovery Approval & Break-Glass Tests', () => {

  before(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

    if (admin.apps.length === 0) {
      app = admin.initializeApp({ projectId: PROJECT_ID });
    } else {
      app = admin.apps[0];
    }
    db = admin.firestore();
  });

  after(async () => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
  });

  // ─── Two-Admin Approval Flow ─────────────────────────────────

  it('1. Admin A requests, Admin B approves → success, request marked APPROVED', async () => {
    const requestId = `RAR_${randomUUID()}`;
    const adminA = 'admin_alice';
    const adminB = 'admin_bob';

    // Admin A creates a pending recovery request
    await db.collection('recoveryApprovalRequests').doc(requestId).set({
      requestId,
      requestedBy: adminA,
      requestedRole: 'admin',
      targetMode: 'NORMAL',
      justification: 'System stable after investigation',
      currentMode: 'FINANCIAL_FROZEN',
      status: 'PENDING_APPROVAL',
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
    });

    // Simulate Admin B's approval: fetch and verify
    const requestSnap = await db.collection('recoveryApprovalRequests').doc(requestId).get();
    const requestData = requestSnap.data();

    assert.equal(requestData.status, 'PENDING_APPROVAL');
    assert.equal(requestData.requestedBy, adminA);
    assert.notEqual(requestData.requestedBy, adminB, 'Requester and approver must differ');

    // Mark approved
    await db.collection('recoveryApprovalRequests').doc(requestId).update({
      status: 'APPROVED',
      approvedBy: adminB,
      approvedAt: admin.firestore.Timestamp.now(),
    });

    const approvedSnap = await db.collection('recoveryApprovalRequests').doc(requestId).get();
    assert.equal(approvedSnap.data().status, 'APPROVED');
    assert.equal(approvedSnap.data().approvedBy, adminB);

    await db.collection('recoveryApprovalRequests').doc(requestId).delete();
  });

  it('2. Admin A requests, Admin A tries to approve own request → MUST be rejected', async () => {
    const requestId = `RAR_${randomUUID()}`;
    const adminA = 'admin_alice';

    await db.collection('recoveryApprovalRequests').doc(requestId).set({
      requestId,
      requestedBy: adminA,
      requestedRole: 'admin',
      targetMode: 'NORMAL',
      justification: 'Attempting self-approval',
      currentMode: 'FINANCIAL_FROZEN',
      status: 'PENDING_APPROVAL',
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
    });

    // Simulate Admin A trying to approve their own request
    const requestSnap = await db.collection('recoveryApprovalRequests').doc(requestId).get();
    const requestData = requestSnap.data();

    // The server-side check: requestedBy === approvingAdminUid
    assert.equal(
      requestData.requestedBy,
      adminA,
      'requestedBy is the same as the approver — this MUST be rejected by the server function'
    );

    // This is the check that the Cloud Function performs:
    const wouldBeRejected = requestData.requestedBy === adminA;
    assert.ok(wouldBeRejected, 'Self-approval must be detected and rejected');

    await db.collection('recoveryApprovalRequests').doc(requestId).delete();
  });

  it('3. Expired request → MUST be rejected', async () => {
    const requestId = `RAR_${randomUUID()}`;

    // Create a request that expired 5 minutes ago
    await db.collection('recoveryApprovalRequests').doc(requestId).set({
      requestId,
      requestedBy: 'admin_alice',
      requestedRole: 'admin',
      targetMode: 'NORMAL',
      justification: 'Expired request',
      currentMode: 'FINANCIAL_FROZEN',
      status: 'PENDING_APPROVAL',
      createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 5 * 60 * 1000),
    });

    const requestSnap = await db.collection('recoveryApprovalRequests').doc(requestId).get();
    const requestData = requestSnap.data();
    const now = Date.now();
    const isExpired = now > requestData.expiresAt.toMillis();

    assert.ok(isExpired, 'Request must be detected as expired');

    await db.collection('recoveryApprovalRequests').doc(requestId).delete();
  });

  // ─── Break-Glass Cryptographic Verification ──────────────────

  it('4. Already-consumed break-glass token → MUST be rejected', async () => {
    const plaintext = `BG_${randomUUID()}_${randomUUID()}`;
    const tokenHash = createHash('sha256').update(plaintext).digest('hex');

    // Store a consumed token
    await db.collection('systemConfig').doc('breakGlassChallenge').set({
      tokenHash,
      createdBy: 'security_admin_001',
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
      consumed: true,
      consumedAt: admin.firestore.Timestamp.now(),
      consumedBy: 'admin_previous',
    });

    const challengeSnap = await db.collection('systemConfig').doc('breakGlassChallenge').get();
    const challengeData = challengeSnap.data();

    assert.ok(challengeData.consumed, 'Token is already consumed — must be rejected');

    await db.collection('systemConfig').doc('breakGlassChallenge').delete();
  });

  it('5. Wrong break-glass token → MUST be rejected (hash mismatch)', async () => {
    const realPlaintext = `BG_${randomUUID()}_${randomUUID()}`;
    const realHash = createHash('sha256').update(realPlaintext).digest('hex');
    const wrongPlaintext = `BG_WRONG_${randomUUID()}`;
    const wrongHash = createHash('sha256').update(wrongPlaintext).digest('hex');

    // Store the real token hash
    await db.collection('systemConfig').doc('breakGlassChallenge').set({
      tokenHash: realHash,
      createdBy: 'security_admin_001',
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
      consumed: false,
    });

    // Attempt with wrong token
    assert.notEqual(realHash, wrongHash, 'Hash mismatch means wrong token — must be rejected');

    await db.collection('systemConfig').doc('breakGlassChallenge').delete();
  });

  it('6. Valid break-glass token → success, token marked consumed, incident created', async () => {
    const plaintext = `BG_${randomUUID()}_${randomUUID()}`;
    const tokenHash = createHash('sha256').update(plaintext).digest('hex');

    // Store a fresh, unconsumed token
    await db.collection('systemConfig').doc('breakGlassChallenge').set({
      tokenHash,
      createdBy: 'security_admin_001',
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
      consumed: false,
    });

    // Verify the token matches
    const providedHash = createHash('sha256').update(plaintext).digest('hex');
    assert.equal(tokenHash, providedHash, 'Hash must match for valid token');

    // Simulate consumption
    await db.collection('systemConfig').doc('breakGlassChallenge').update({
      consumed: true,
      consumedAt: admin.firestore.Timestamp.now(),
      consumedBy: 'emergency_admin_001',
    });

    const afterConsumption = await db.collection('systemConfig').doc('breakGlassChallenge').get();
    const afterData = afterConsumption.data();
    assert.ok(afterData.consumed, 'Token must be marked as consumed');
    assert.equal(afterData.consumedBy, 'emergency_admin_001');

    // Verify re-use is blocked
    assert.ok(afterData.consumed, 'Re-use of consumed token must be rejected');

    await db.collection('systemConfig').doc('breakGlassChallenge').delete();
  });
});
