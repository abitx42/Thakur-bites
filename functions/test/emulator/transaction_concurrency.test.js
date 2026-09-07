/**
 * ══════════════════════════════════════════════════════════════════
 * PHASE 11 — GATE B: REAL FIREBASE EMULATOR TRANSACTION CONCURRENCY TESTS
 * ══════════════════════════════════════════════════════════════════
 *
 * These tests run against the REAL Firebase Emulator Firestore instance.
 * They prove that Firestore transactions actually serialize concurrent
 * operations correctly — not by mocking a transaction object, but by
 * running real concurrent reads/writes against real Firestore.
 *
 * Run via: firebase emulators:exec --only firestore 'node --test test/emulator/transaction_concurrency.test.js'
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');

const PROJECT_ID = 'thakur-bites-txn-test';

let app;
let db;

describe('Real Firebase Emulator — Transaction Concurrency Tests', () => {

  before(async () => {
    // Connect to the real Firestore emulator
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

  // ─── Scenario A: Last-Item Race ──────────────────────────────

  it('1. Last-Item Race: Stock=1, 50 concurrent buyers → exactly 1 succeeds, stock=0, never -1', async () => {
    const itemRef = db.collection('test_inventory').doc('last_item_race');
    await itemRef.set({ availableStock: 1, onHand: 1, reserved: 0, itemName: 'Test Dosa' });

    const CONCURRENT_BUYERS = 50;
    let successCount = 0;
    let failCount = 0;

    // Simulate 50 concurrent reservation attempts
    const promises = Array.from({ length: CONCURRENT_BUYERS }, async (_, i) => {
      try {
        await db.runTransaction(async (transaction) => {
          const snap = await transaction.get(itemRef);
          const data = snap.data();
          if (data.availableStock <= 0) {
            throw new Error('OUT_OF_STOCK');
          }
          transaction.update(itemRef, {
            availableStock: data.availableStock - 1,
            reserved: data.reserved + 1,
          });
        });
        successCount++;
      } catch (err) {
        failCount++;
      }
    });

    await Promise.all(promises);

    // Verify exactly 1 succeeded
    assert.equal(successCount, 1, `Expected exactly 1 success, got ${successCount}`);
    assert.equal(failCount, CONCURRENT_BUYERS - 1, `Expected ${CONCURRENT_BUYERS - 1} failures`);

    // Verify final stock state
    const finalSnap = await itemRef.get();
    const finalData = finalSnap.data();
    assert.equal(finalData.availableStock, 0, 'Stock must be exactly 0');
    assert.ok(finalData.availableStock >= 0, 'Stock must NEVER go negative');
    assert.equal(finalData.reserved, 1, 'Exactly 1 reservation');

    // Clean up
    await itemRef.delete();
  });

  // ─── Scenario B: Double Payment Finalization ─────────────────

  it('2. Double Payment: Simultaneous client+webhook → exactly 1 financial capture', async () => {
    const orderRef = db.collection('test_orders').doc('double_pay_race');
    const ledgerRef = db.collection('test_ledger').doc('double_pay_ledger');

    await orderRef.set({
      status: 'payment_pending',
      totalPaise: 12500,
      paymentCaptured: false,
    });

    let captureCount = 0;

    // Simulate client confirmation and webhook arriving simultaneously
    const capturePayment = async (source) => {
      try {
        await db.runTransaction(async (transaction) => {
          const snap = await transaction.get(orderRef);
          const data = snap.data();
          if (data.paymentCaptured) {
            throw new Error('ALREADY_CAPTURED');
          }
          transaction.update(orderRef, {
            status: 'confirmed',
            paymentCaptured: true,
            capturedBy: source,
          });
          // Write ledger entry
          transaction.set(db.collection('test_ledger').doc(`capture_${source}`), {
            type: 'PAYMENT_CAPTURE',
            amountPaise: 12500,
            source,
          });
        });
        captureCount++;
      } catch {
        // Expected for the loser
      }
    };

    await Promise.all([
      capturePayment('client'),
      capturePayment('webhook'),
    ]);

    assert.equal(captureCount, 1, 'Exactly 1 payment capture must succeed');

    // Verify only 1 ledger entry exists
    const ledgerSnap = await db.collection('test_ledger')
      .where('type', '==', 'PAYMENT_CAPTURE')
      .get();
    const captureEntries = ledgerSnap.docs.filter(d => d.data().amountPaise === 12500);
    assert.equal(captureEntries.length, 1, 'Exactly 1 ledger entry for this payment');

    // Clean up
    await orderRef.delete();
    for (const doc of ledgerSnap.docs) {
      await doc.ref.delete();
    }
  });

  // ─── Scenario C: Refund Race ─────────────────────────────────

  it('3. Refund Race: Cancel+webhook+retry simultaneously → exactly 1 refund', async () => {
    const orderRef = db.collection('test_orders').doc('refund_race');
    await orderRef.set({
      status: 'confirmed',
      totalPaise: 9000,
      refunded: false,
      refundCount: 0,
    });

    let refundSuccessCount = 0;
    const CONCURRENT_REFUND_ATTEMPTS = 10;

    const attemptRefund = async (source) => {
      try {
        await db.runTransaction(async (transaction) => {
          const snap = await transaction.get(orderRef);
          const data = snap.data();
          if (data.refunded) {
            throw new Error('ALREADY_REFUNDED');
          }
          transaction.update(orderRef, {
            status: 'refunded',
            refunded: true,
            refundCount: data.refundCount + 1,
            refundedBy: source,
          });
        });
        refundSuccessCount++;
      } catch {
        // Expected for losers
      }
    };

    await Promise.all(
      Array.from({ length: CONCURRENT_REFUND_ATTEMPTS }, (_, i) =>
        attemptRefund(`source_${i}`)
      )
    );

    assert.equal(refundSuccessCount, 1, 'Exactly 1 refund must succeed');

    const finalSnap = await orderRef.get();
    const finalData = finalSnap.data();
    assert.equal(finalData.refunded, true);
    assert.equal(finalData.refundCount, 1, 'Exactly 1 refund counted');
    assert.equal(finalData.status, 'refunded');

    await orderRef.delete();
  });

  // ─── Scenario D: Inventory Reservation Expiry Under Contention ──

  it('4. Reservation Expiry: Mixed expire/pay/cancel → inventory always reconciles', async () => {
    const itemRef = db.collection('test_inventory').doc('reservation_expiry');
    const INITIAL_STOCK = 10;
    await itemRef.set({
      availableStock: INITIAL_STOCK,
      onHand: INITIAL_STOCK,
      reserved: 0,
    });

    // Phase 1: Create 5 reservations
    for (let i = 0; i < 5; i++) {
      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(itemRef);
        const data = snap.data();
        transaction.update(itemRef, {
          availableStock: data.availableStock - 1,
          reserved: data.reserved + 1,
        });
      });
    }

    let midSnap = await itemRef.get();
    let midData = midSnap.data();
    assert.equal(midData.availableStock, 5, 'After 5 reservations, available=5');
    assert.equal(midData.reserved, 5, 'After 5 reservations, reserved=5');
    assert.equal(midData.onHand, INITIAL_STOCK, 'onHand unchanged');

    // Phase 2: Concurrently — 2 expire (release), 2 pay (commit), 1 cancel (release)
    const operations = [
      // Expire 2 reservations (release stock back)
      async () => {
        await db.runTransaction(async (txn) => {
          const s = await txn.get(itemRef);
          const d = s.data();
          txn.update(itemRef, { availableStock: d.availableStock + 1, reserved: d.reserved - 1 });
        });
      },
      async () => {
        await db.runTransaction(async (txn) => {
          const s = await txn.get(itemRef);
          const d = s.data();
          txn.update(itemRef, { availableStock: d.availableStock + 1, reserved: d.reserved - 1 });
        });
      },
      // Pay 2 reservations (reduce onHand, reduce reserved)
      async () => {
        await db.runTransaction(async (txn) => {
          const s = await txn.get(itemRef);
          const d = s.data();
          txn.update(itemRef, { onHand: d.onHand - 1, reserved: d.reserved - 1 });
        });
      },
      async () => {
        await db.runTransaction(async (txn) => {
          const s = await txn.get(itemRef);
          const d = s.data();
          txn.update(itemRef, { onHand: d.onHand - 1, reserved: d.reserved - 1 });
        });
      },
      // Cancel 1 reservation (release stock back)
      async () => {
        await db.runTransaction(async (txn) => {
          const s = await txn.get(itemRef);
          const d = s.data();
          txn.update(itemRef, { availableStock: d.availableStock + 1, reserved: d.reserved - 1 });
        });
      },
    ];

    await Promise.all(operations.map(op => op()));

    // Verify final state reconciles
    const finalSnap = await itemRef.get();
    const finalData = finalSnap.data();

    // 2 expired + 1 cancelled = 3 returned to available. 2 paid = consumed from onHand.
    // reserved should be 0 (5 - 2 expired - 2 paid - 1 cancelled)
    assert.equal(finalData.reserved, 0, 'All reservations resolved');
    // availableStock = 5 + 3 returned = 8
    assert.equal(finalData.availableStock, 8, 'Available stock reconciles (5 + 3 returned)');
    // onHand = 10 - 2 paid = 8
    assert.equal(finalData.onHand, 8, 'On-hand stock reconciles (10 - 2 paid)');
    // Conservation equation: available = onHand - reserved
    assert.equal(
      finalData.availableStock,
      finalData.onHand - finalData.reserved,
      'Conservation equation: available = onHand - reserved'
    );

    await itemRef.delete();
  });
});
