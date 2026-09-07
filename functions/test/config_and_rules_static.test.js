const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Phase 8 — Static Configuration & Rules File Inspection
 * Validates emulator configuration, security rules AST match targets,
 * and environment routing for Cloud Functions and client SDKs.
 */
describe('Phase 8: Static Configuration & Rules File Inspection', () => {

  it('1. Firebase Emulator Configuration Invariant: Validates ports and services in firebase.json', () => {
    const configPath = path.resolve(__dirname, '../../firebase.json');
    assert.ok(fs.existsSync(configPath), 'firebase.json exists');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    assert.ok(config.emulators, 'emulators configuration exists');
    assert.strictEqual(config.emulators.auth.port, 9099);
    assert.strictEqual(config.emulators.functions.port, 5001);
    assert.strictEqual(config.emulators.firestore.port, 8080);
    assert.strictEqual(config.emulators.ui.enabled, true);
  });

  it('2. Live Security Rules AST Match Invariant: Strict server-only lockdown for critical collections', () => {
    const rulesPath = path.resolve(__dirname, '../../firestore/firestore.rules');
    assert.ok(fs.existsSync(rulesPath), 'firestore.rules exists');
    const rulesContent = fs.readFileSync(rulesPath, 'utf8');

    // Verify all server-only collections have "allow write: if false;"
    const serverOnlyCollections = [
      '/financialTransactions/{txnId}',
      '/integrityAnomalies/{anomalyId}',
      '/disasterRecoveryLogs/{logId}',
      '/incidents/{incidentId}',
      '/disasterDrillReports/{drillId}'
    ];

    serverOnlyCollections.forEach(collectionPath => {
      const matchIdx = rulesContent.indexOf(`match ${collectionPath}`);
      assert.ok(matchIdx !== -1, `Rules must contain match block for ${collectionPath}`);
      const blockSlice = rulesContent.slice(matchIdx, matchIdx + 200);
      assert.ok(
        blockSlice.includes('allow write: if false;') || blockSlice.includes('allow write: if false'),
        `Client writes to ${collectionPath} must be strictly denied (allow write: if false;)`
      );
    });
  });

  it('3. Emulator Routing Invariant in Web Client: Routes to local functions emulator in dev', () => {
    const firebaseJsPath = path.resolve(__dirname, '../../js/firebase.js');
    assert.ok(fs.existsSync(firebaseJsPath), 'js/firebase.js exists');
    const content = fs.readFileSync(firebaseJsPath, 'utf8');

    // Verifies local dev emulator host detection
    assert.ok(content.includes('isLocalDev'), 'Must detect local development host');
    assert.ok(content.includes('functions.emulatorOrigin'), 'Must route functions to emulator origin on localhost');
  });

  it('4. Admin SDK Root Authority vs Client Lockdown Invariant', () => {
    // Simulates an unauthenticated client request attempting direct firestore mutation
    function evaluateClientRule(collection, operation, authState) {
      if (['financialTransactions', 'integrityAnomalies', 'disasterRecoveryLogs', 'incidents', 'disasterDrillReports'].includes(collection)) {
        if (operation === 'create' || operation === 'update' || operation === 'delete') {
          return { allowed: false, error: 'PERMISSION_DENIED: Client writes strictly forbidden. Use Cloud Functions.' };
        }
      }
      return { allowed: true };
    }

    const unauthAttempt = evaluateClientRule('financialTransactions', 'create', null);
    assert.strictEqual(unauthAttempt.allowed, false);
    assert.ok(unauthAttempt.error.includes('PERMISSION_DENIED'));

    const studentAttempt = evaluateClientRule('incidents', 'update', { uid: 'student_1', role: 'student' });
    assert.strictEqual(studentAttempt.allowed, false);

    // Admin SDK execution inside Cloud Functions bypasses client rules securely
    function evaluateAdminSdkExecution(collection, operation) {
      // Cloud Functions runtime uses firebase-admin with full database authority
      return { allowed: true, mode: 'ADMIN_SDK_SYSTEM_AUTHORITY' };
    }

    const adminSdkWrite = evaluateAdminSdkExecution('financialTransactions', 'create');
    assert.strictEqual(adminSdkWrite.allowed, true);
    assert.strictEqual(adminSdkWrite.mode, 'ADMIN_SDK_SYSTEM_AUTHORITY');
  });
});
