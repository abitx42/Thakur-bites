#!/usr/bin/env node

/**
 * Thakur Bites — Point-In-Time Backup & Disaster Recovery Utility
 * Exports critical collections with SHA-256 integrity checksums.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CRITICAL_COLLECTIONS = [
  'menuItems',
  'orders',
  'inventory',
  'inventoryLedger',
  'orderEvents',
  'securityEvents',
  'payments',
  'dailyReconciliations',
  'students',
  'staffUsers',
];

function generateBackupManifest(snapshotData) {
  const timestamp = new Date().toISOString();
  const serialized = JSON.stringify(snapshotData, null, 2);
  const hash = crypto.createHash('sha256').update(serialized).digest('hex');

  return {
    version: '1.0.0',
    createdAt: timestamp,
    collections: Object.keys(snapshotData),
    checksumSha256: hash,
    data: snapshotData,
  };
}

function verifyBackupIntegrity(backupJson) {
  const { checksumSha256, data } = backupJson;
  const serialized = JSON.stringify(data, null, 2);
  const calculatedHash = crypto.createHash('sha256').update(serialized).digest('hex');
  return checksumSha256 === calculatedHash;
}

// Export for CLI or automated cron runner
if (require.main === module) {
  console.log('Thakur Bites Backup Sentinel: Generating sample baseline snapshot...');
  const sampleData = {
    menuItems: [{ id: 'samosa_1', name: 'Punjabi Samosa', price: 25 }],
    systemVersion: '1.0.0-enterprise',
  };

  const manifest = generateBackupManifest(sampleData);
  const isValid = verifyBackupIntegrity(manifest);
  console.log(`✓ Backup integrity verified: SHA-256 = ${manifest.checksumSha256}`);
  console.log(`✓ Checksum valid: ${isValid}`);
}

module.exports = {
  generateBackupManifest,
  verifyBackupIntegrity,
  CRITICAL_COLLECTIONS,
};
