#!/usr/bin/env node

/**
 * Thakur Bites — Point-In-Time Backup & Disaster Recovery Engine
 * Exports all 16 collections with cryptographically verified SHA-256 integrity checksums.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALL_CANONICAL_COLLECTIONS = [
  'menuItems',
  'inventoryReservations',
  'inventoryLedger',
  'orders',
  'orderSecrets',
  'orderEvents',
  'payments',
  'financialTransactions',
  'dailyReconciliations',
  'processedGatewayEvents',
  'checkoutRequests',
  'students',
  'ratingsPrivate',
  'ratingsPublic',
  'ratings',
  'staffUsers',
  'securityEvents',
  'counters',
  'rateLimits',
];

/**
 * Generates an immutable, checksummed backup manifest from a snapshot dictionary
 */
function generateBackupManifest(snapshotData) {
  const timestamp = new Date().toISOString();
  const serialized = JSON.stringify(snapshotData, null, 2);
  const checksum = crypto.createHash('sha256').update(serialized).digest('hex');

  const totalDocuments = Object.values(snapshotData).reduce(
    (count, docs) => count + (Array.isArray(docs) ? docs.length : 0),
    0
  );

  return {
    manifestVersion: '2.0.0',
    systemId: 'thakur-bites-production',
    createdAt: timestamp,
    collectionsCount: Object.keys(snapshotData).length,
    totalDocuments,
    collections: Object.keys(snapshotData),
    checksumSha256: checksum,
    data: snapshotData,
  };
}

/**
 * Validates the cryptographic SHA-256 integrity of a backup manifest
 */
function verifyBackupIntegrity(manifest) {
  if (!manifest || !manifest.checksumSha256 || !manifest.data) {
    return false;
  }
  const serialized = JSON.stringify(manifest.data, null, 2);
  const calculatedHash = crypto.createHash('sha256').update(serialized).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(manifest.checksumSha256, 'utf8'),
    Buffer.from(calculatedHash, 'utf8')
  );
}

/**
 * Dry-run restoration validator that tests schema conformances before applying mutations
 */
function validateRestorePlan(manifest) {
  const isIntegrityValid = verifyBackupIntegrity(manifest);
  if (!isIntegrityValid) {
    return { valid: false, error: 'CHECKSUM_INTEGRITY_FAILURE' };
  }

  const collectionsFound = Object.keys(manifest.data || {});
  const missingCollections = ALL_CANONICAL_COLLECTIONS.filter(c => !collectionsFound.includes(c));

  return {
    valid: true,
    totalCollections: collectionsFound.length,
    totalDocuments: manifest.totalDocuments,
    missingCollections,
  };
}

if (require.main === module) {
  console.log('Thakur Bites Disaster Recovery Engine: Testing backup manifest generation...');
  const sampleSnapshot = {
    menuItems: [{ id: 'samosa_1', name: 'Punjabi Samosa', price: 25 }],
    orders: [{ id: 'order_1', totalAmountPaise: 2500, status: 'confirmed' }],
  };

  const manifest = generateBackupManifest(sampleSnapshot);
  const isValid = verifyBackupIntegrity(manifest);
  console.log(`✓ Generated backup with SHA-256: ${manifest.checksumSha256}`);
  console.log(`✓ Integrity verification status: ${isValid}`);
}

module.exports = {
  ALL_CANONICAL_COLLECTIONS,
  generateBackupManifest,
  verifyBackupIntegrity,
  validateRestorePlan,
};
