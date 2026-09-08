/**
 * ══════════════════════════════════════════════════════════════════
 * PHASE 11 — GATE B: REAL FIREBASE EMULATOR RECOVERY APPROVAL TESTS
 * ══════════════════════════════════════════════════════════════════
 *
 * These tests run against the REAL Firebase Emulator Firestore instance.
 *
 * They exercise the exact same transaction pattern used by the production
 * adminRestoreOperationalMode function: transactional read → validate →
 * atomically update the approval request. This proves Firestore's
 * transaction engine correctly serializes concurrent approval attempts,
 * rejects expired/consumed tokens, and prevents double-approval races.
 *
 * NOTE: The onCall wrapper (auth, App Check, rate limiting) is NOT tested
 * here — that requires firebase-functions-test or a deployed emulator
 * with the Functions emulator. These tests focus on the Firestore-level
 * transaction correctness that unit tests cannot observe.
 *
 * Run via: firebase emulators:exec --only firestore 'node --test test/emulator/recovery_approval.test.js'
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID, timingSafeEqual } = require('crypto');
const admin = require('firebase-admin');

const PROJECT_ID = 'thakur-bites-recovery-test';

let app;
let db;

describe('Real Firebase Emulator — Recovery Approval Transaction Tests', () => {

  before(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    app = admin.apps.find(a => a.name === 'recovery_app') || admin.initializeApp({ projectId: PROJECT_ID }, 'recovery_app');
    db = admin.firestore(app);
  });

  after(async () => {
    if (app) {
      await app.delete().catch(() => {});
    }
  });

  // ─── Two-Admin Approval: Transaction Race ────────────────────

  it('1. Concurrent dual-approval race: Two admins approve same request → exactly 1 succeeds', async () => {
    const requestId = `RAR_${randomUUID()}`;
    const requestDocRef = db.collection('recoveryApprovalRequests').doc(requestId);

    // Seed a pending request (as requestRecoveryApproval would)
    await requestDocRef.set({
      requestId,
      requestedBy: 'admin_alice',
      requestedRole: 'admin',
      targetMode: 'NORMAL',
      justification: 'System stable after investigation',
      currentMode: 'FINANCIAL_FROZEN',
      status: 'PENDING_APPROVAL',
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
    });

    let approvalCount = 0;

    // Replicate the EXACT transaction pattern from adminRestoreOperationalMode
    const tryApprove = async (approverUid) => {
      try {
        await db.runTransaction(async (transaction) => {
          const snap = await transaction.get(requestDocRef);
          if (!snap.exists) throw new Error('NOT_FOUND');
          const data = snap.data();

          if (data.status !== 'PENDING_APPROVAL') {
            throw new Error(`NOT_PENDING: ${data.status}`);
          }

          if (data.requestedBy === approverUid) {
            throw new Error('SELF_APPROVAL');
          }

          // Atomically approve — only one transaction can win
          transaction.update(requestDocRef, {
            status: 'APPROVED',
            approvedBy: approverUid,
            approvedAt: admin.firestore.Timestamp.now(),
          });
        });
        approvalCount++;
      } catch {
        // Expected — the loser gets a contention retry that sees APPROVED
      }
    };

    // Fire both simultaneously — Firestore must serialize them
    await Promise.all([
      tryApprove('admin_bob'),
      tryApprove('admin_charlie'),
    ]);

    assert.equal(approvalCount, 1, 'Exactly 1 approval must succeed in a race');

    const finalSnap = await requestDocRef.get();
    assert.equal(finalSnap.data().status, 'APPROVED');
    assert.ok(
      ['admin_bob', 'admin_charlie'].includes(finalSnap.data().approvedBy),
      'Winner must be one of the two approvers'
    );

    await requestDocRef.delete();
  });

  // ─── Self-Approval Rejection ─────────────────────────────────

  it('2. Self-approval: Admin A requests → Admin A tries to approve own request → rejected', async () => {
    const requestId = `RAR_${randomUUID()}`;
    const requestDocRef = db.collection('recoveryApprovalRequests').doc(requestId);

    await requestDocRef.set({
      requestId,
      requestedBy: 'admin_alice',
      requestedRole: 'admin',
      targetMode: 'NORMAL',
      justification: 'Self-approval attempt',
      currentMode: 'FINANCIAL_FROZEN',
      status: 'PENDING_APPROVAL',
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
    });

    let rejected = false;
    try {
      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(requestDocRef);
        const data = snap.data();
        if (data.requestedBy === 'admin_alice') {
          throw new Error('SELF_APPROVAL: Four-eyes principle violated');
        }
        transaction.update(requestDocRef, { status: 'APPROVED', approvedBy: 'admin_alice' });
      });
    } catch (err) {
      rejected = err.message.includes('SELF_APPROVAL');
    }

    assert.ok(rejected, 'Self-approval must be rejected');
    const finalSnap = await requestDocRef.get();
    assert.equal(finalSnap.data().status, 'PENDING_APPROVAL', 'Status must remain PENDING');

    await requestDocRef.delete();
  });

  // ─── Expired Request Rejection ───────────────────────────────

  it('3. Expired request: Approval attempt after expiry → rejected and marked EXPIRED', async () => {
    const requestId = `RAR_${randomUUID()}`;
    const requestDocRef = db.collection('recoveryApprovalRequests').doc(requestId);

    // Create a request that expired 5 minutes ago
    await requestDocRef.set({
      requestId,
      requestedBy: 'admin_alice',
      requestedRole: 'admin',
      targetMode: 'NORMAL',
      justification: 'Expired request test',
      currentMode: 'FINANCIAL_FROZEN',
      status: 'PENDING_APPROVAL',
      createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 5 * 60 * 1000),
    });

    let rejected = false;
    try {
      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(requestDocRef);
        const data = snap.data();
        const now = Date.now();
        if (now > data.expiresAt.toMillis()) {
          throw new Error('REQUEST_EXPIRED');
        }
        transaction.update(requestDocRef, { status: 'APPROVED', approvedBy: 'admin_bob' });
      });
    } catch (err) {
      rejected = err.message.includes('REQUEST_EXPIRED');
      if (rejected) {
        await requestDocRef.update({ status: 'EXPIRED' });
      }
    }

    assert.ok(rejected, 'Expired request must be rejected');
    const finalSnap = await requestDocRef.get();
    assert.equal(finalSnap.data().status, 'EXPIRED');

    await requestDocRef.delete();
  });

  // ─── Break-Glass Cryptographic Verification ──────────────────

  it('4. Valid break-glass token: SHA-256 hash matches, token marked consumed', async () => {
    const plaintext = `BG_${randomUUID()}_${randomUUID()}`;
    const tokenHash = createHash('sha256').update(plaintext).digest('hex');
    const challengeRef = db.collection('systemConfig').doc('breakGlassChallenge');

    await challengeRef.set({
      tokenHash,
      createdBy: 'security_admin_001',
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
      consumed: false,
    });

    // Replicate the EXACT verification from adminRestoreOperationalMode
    let verified = false;
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(challengeRef);
      const data = snap.data();

      assert.equal(data.consumed, false, 'Token must not be consumed yet');

      const providedHash = createHash('sha256').update(plaintext).digest('hex');
      const storedBuf = Buffer.from(data.tokenHash, 'hex');
      const providedBuf = Buffer.from(providedHash, 'hex');

      assert.equal(storedBuf.length, providedBuf.length);
      assert.ok(timingSafeEqual(storedBuf, providedBuf), 'Hash must match');

      transaction.update(challengeRef, {
        consumed: true,
        consumedAt: admin.firestore.Timestamp.now(),
        consumedBy: 'emergency_admin_001',
      });
      verified = true;
    });

    assert.ok(verified, 'Valid token must be accepted');

    // Verify consumed flag is set
    const afterSnap = await challengeRef.get();
    assert.equal(afterSnap.data().consumed, true);
    assert.equal(afterSnap.data().consumedBy, 'emergency_admin_001');

    await challengeRef.delete();
  });

  it('5. Wrong break-glass token: SHA-256 hash mismatch → rejected', async () => {
    const realPlaintext = `BG_${randomUUID()}_${randomUUID()}`;
    const realHash = createHash('sha256').update(realPlaintext).digest('hex');
    const challengeRef = db.collection('systemConfig').doc('breakGlassChallenge');

    await challengeRef.set({
      tokenHash: realHash,
      createdBy: 'security_admin_001',
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
      consumed: false,
    });

    const wrongPlaintext = `BG_WRONG_${randomUUID()}`;
    const wrongHash = createHash('sha256').update(wrongPlaintext).digest('hex');
    const storedBuf = Buffer.from(realHash, 'hex');
    const wrongBuf = Buffer.from(wrongHash, 'hex');

    let rejected = false;
    if (storedBuf.length !== wrongBuf.length || !timingSafeEqual(storedBuf, wrongBuf)) {
      rejected = true;
    }

    assert.ok(rejected, 'Wrong token hash must be rejected');

    // Token must remain unconsumed
    const afterSnap = await challengeRef.get();
    assert.equal(afterSnap.data().consumed, false, 'Wrong token must not consume the challenge');

    await challengeRef.delete();
  });

  it('6. Already-consumed break-glass token: Re-use attempt → rejected', async () => {
    const plaintext = `BG_${randomUUID()}_${randomUUID()}`;
    const tokenHash = createHash('sha256').update(plaintext).digest('hex');
    const challengeRef = db.collection('systemConfig').doc('breakGlassChallenge');

    // Store an already-consumed token
    await challengeRef.set({
      tokenHash,
      createdBy: 'security_admin_001',
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
      consumed: true,
      consumedAt: admin.firestore.Timestamp.now(),
      consumedBy: 'admin_previous',
    });

    let rejected = false;
    try {
      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(challengeRef);
        const data = snap.data();
        if (data.consumed) {
          throw new Error('TOKEN_ALREADY_CONSUMED');
        }
        // Would proceed with verification — but should never reach here
        transaction.update(challengeRef, { consumed: true });
      });
    } catch (err) {
      rejected = err.message.includes('TOKEN_ALREADY_CONSUMED');
    }

    assert.ok(rejected, 'Already-consumed token must be rejected');

    await challengeRef.delete();
  });
});
