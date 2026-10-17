'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = relativePath => fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8');

test('administrative browser views never fall back to direct Firestore authority mutations', () => {
  const adminView = source('js/views/adminView.js');
  const securityCenter = source('js/views/securityCenterView.js');

  for (const view of [adminView, securityCenter]) {
    assert.doesNotMatch(view, /falling back to direct Firestore update/i);
    assert.doesNotMatch(view, /\b(?:setDoc|updateDoc)\s*\(/);
  }
  assert.match(adminView, /httpsCallable\(functions, 'reviewVerificationApplication'\)/);
  assert.match(securityCenter, /httpsCallable\(functions, 'setSystemOperationalMode'\)/);
});

test('counter views escape untrusted quantities before HTML insertion', () => {
  const pickupView = source('js/views/pickupView.js');
  const cashierView = source('js/views/cashierView.js');

  assert.match(pickupView, /const quantity = displayQuantity\(item\.quantity\);/);
  assert.match(pickupView, /<strong>\$\{quantity\}x<\/strong>/);
  assert.match(cashierView, /const quantity = displayQuantity\(i\.quantity\);/);
  assert.match(cashierView, /<span>\$\{quantity\}x \$\{escapeHtml\(i\.name\)\}<\/span>/);
});

test('workstation and MFA views escape server-issued codes and identifiers', () => {
  const workstationView = source('js/views/workstationView.js');
  const mfaModal = source('js/views/mfaModal.js');

  assert.match(workstationView, /\$\{escapeHtml\(inv\.inviteCode\)\}/);
  assert.match(workstationView, /data-id="\$\{escapeHtml\(ws\.workstationId\)\}"/);
  assert.match(mfaModal, /\$\{escapeHtml\(enrollmentData\.secret\)\}/);
  assert.match(mfaModal, /\$\{escapeHtml\(code\)\}<\/div>/);
});
