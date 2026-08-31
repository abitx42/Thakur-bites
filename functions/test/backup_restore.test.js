const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  generateBackupManifest,
  verifyBackupIntegrity,
  validateRestorePlan,
  ALL_CANONICAL_COLLECTIONS,
} = require('../scripts/backup_restore');

describe('Disaster Recovery & Backup/Restore Invariant Tests', () => {
  const sampleData = {
    menuItems: [
      { id: 'samosa_1', name: 'Punjabi Samosa', price: 25, stockOnHand: 50, reservedStock: 0 },
      { id: 'dosa_1', name: 'Masala Dosa', price: 70, stockOnHand: 0, reservedStock: 0 },
    ],
    orders: [
      { id: 'order_1', totalAmountPaise: 2500, status: 'confirmed', studentId: 'student_1' },
    ],
    financialTransactions: [
      {
        transactionId: 'txn_1',
        amountPaise: 2500,
        postings: [
          { account: 'GATEWAY_RECEIVABLE', debitPaise: 2500, creditPaise: 0 },
          { account: 'SALES_REVENUE', debitPaise: 0, creditPaise: 2500 },
        ],
      },
    ],
  };

  it('1. Generates cryptographic SHA-256 backup manifest with accurate document counts', () => {
    const manifest = generateBackupManifest(sampleData);
    assert.strictEqual(manifest.manifestVersion, '2.0.0');
    assert.strictEqual(manifest.collectionsCount, 3);
    assert.strictEqual(manifest.totalDocuments, 4);
    assert.strictEqual(typeof manifest.checksumSha256, 'string');
    assert.strictEqual(manifest.checksumSha256.length, 64);
  });

  it('2. Validates untampered backup integrity successfully', () => {
    const manifest = generateBackupManifest(sampleData);
    assert.strictEqual(verifyBackupIntegrity(manifest), true);
  });

  it('3. Detects data tampering in backup manifest and rejects restore', () => {
    const manifest = generateBackupManifest(sampleData);
    
    // Malicious attacker tampers with prices in backup JSON
    manifest.data.menuItems[0].price = 1;

    assert.strictEqual(verifyBackupIntegrity(manifest), false);

    const plan = validateRestorePlan(manifest);
    assert.strictEqual(plan.valid, false);
    assert.strictEqual(plan.error, 'CHECKSUM_INTEGRITY_FAILURE');
  });

  it('4. Validate restore plan identifies missing collections in partial backups', () => {
    const manifest = generateBackupManifest(sampleData);
    const plan = validateRestorePlan(manifest);

    assert.strictEqual(plan.valid, true);
    assert.strictEqual(plan.totalCollections, 3);
    assert.strictEqual(plan.totalDocuments, 4);
    assert.strictEqual(plan.missingCollections.length, ALL_CANONICAL_COLLECTIONS.length - 3);
  });
});
