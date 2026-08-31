const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Phase 6 Canonical Schema & Model Alignment Invariants', () => {
  it('1. Persistent OrderDocument isolates secrets to OrderSecretDoc', () => {
    const typesFilePath = path.join(process.cwd(), 'src/types.ts');
    const typesContent = fs.readFileSync(typesFilePath, 'utf8');

    // Extract OrderDocument interface block
    const orderDocMatch = typesContent.match(/export interface OrderDocument\s*\{([\s\S]*?)\}/);
    assert.ok(orderDocMatch, 'OrderDocument interface must exist in types.ts');

    const orderDocBody = orderDocMatch[1];
    assert.strictEqual(
      orderDocBody.includes('pickupPin'),
      false,
      'OrderDocument must NOT define plaintext pickupPin or pickupPinHash'
    );
    assert.strictEqual(
      orderDocBody.includes('qrNonce'),
      false,
      'OrderDocument must NOT define qrNonce'
    );

    // Extract OrderSecretDoc interface block
    const secretDocMatch = typesContent.match(/export interface OrderSecretDoc\s*\{([\s\S]*?)\}/);
    assert.ok(secretDocMatch, 'OrderSecretDoc interface must exist in types.ts');
    const secretDocBody = secretDocMatch[1];
    assert.strictEqual(
      secretDocBody.includes('pickupPinHash: string'),
      true,
      'OrderSecretDoc must define pickupPinHash'
    );
    assert.strictEqual(
      secretDocBody.includes('qrNonce: string'),
      true,
      'OrderSecretDoc must define qrNonce'
    );
  });

  it('2. CheckoutResponse interface defines transient in-memory credentials for students', () => {
    const typesFilePath = path.join(process.cwd(), 'src/types.ts');
    const typesContent = fs.readFileSync(typesFilePath, 'utf8');

    const checkoutResMatch = typesContent.match(/export interface CheckoutResponse\s*\{([\s\S]*?)\}/);
    assert.ok(checkoutResMatch, 'CheckoutResponse interface must exist in types.ts');

    const checkoutResBody = checkoutResMatch[1];
    assert.strictEqual(checkoutResBody.includes('rawPin: string'), true);
    assert.strictEqual(checkoutResBody.includes('signedQrPayload: string'), true);
  });

  it('3. Double-entry FinancialTransactionRecord enforces balanced LedgerPosting schema', () => {
    const typesFilePath = path.join(process.cwd(), 'src/types.ts');
    const typesContent = fs.readFileSync(typesFilePath, 'utf8');

    assert.strictEqual(typesContent.includes('export interface LedgerPosting'), true);
    assert.strictEqual(typesContent.includes('postings: LedgerPosting[]'), true);
    assert.strictEqual(typesContent.includes('amountPaise: number'), true);
  });

  it('4. Schema documentation matches all 16 active Firestore collections', () => {
    const schemaFilePath = path.join(process.cwd(), '../docs/schema.md');
    const schemaContent = fs.readFileSync(schemaFilePath, 'utf8');

    const expectedCollections = [
      'menuItems',
      'inventoryReservations',
      'inventoryLedger',
      'orders',
      'orderEvents',
      'payments',
      'financialTransactions',
      'dailyReconciliations',
      'processedGatewayEvents',
      'checkoutRequests',
      'students',
      'ratings',
      'staffUsers',
      'securityEvents',
      'counters',
      'rateLimits',
    ];

    for (const col of expectedCollections) {
      assert.strictEqual(
        schemaContent.includes(`\`${col}\``),
        true,
        `docs/schema.md must document collection '${col}'`
      );
    }
  });
});
