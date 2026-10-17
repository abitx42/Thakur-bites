const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Flutter/Dart are unavailable in this environment. These deliberately narrow
// source guardrails prevent the removed authority-write paths from returning;
// they do NOT compile Dart, execute a checkout, or replace Flutter runtime tests.
const services = path.resolve(__dirname, '../../thakur_bites/lib/services');
const checkout = fs.readFileSync(path.join(services, 'checkout_service.dart'), 'utf8');
const auth = fs.readFileSync(path.join(services, 'auth_service.dart'), 'utf8');
function section(source, start, end) {
  const begin = source.indexOf(start);
  assert.ok(begin >= 0, `missing section ${start}`);
  const finish = source.indexOf(end, begin + start.length);
  assert.ok(finish > begin, `missing section end ${end}`);
  return source.slice(begin, finish);
}

describe('T1 offline Flutter authority-boundary structural guardrails (not Dart runtime tests)', () => {
  it('checkout has no Firestore writes, authority collections or local-order fallback helper', () => {
    assert.doesNotMatch(checkout, /\.\s*(?:set|update|delete|runTransaction|batch)\s*\(/);
    assert.doesNotMatch(checkout, /\.collection\s*\(\s*['"](?:orders|menuItems|counters)['"]/);
    assert.doesNotMatch(checkout, /_createDirectFirestore|order\.toFirestore\s*\(/);
  });

  it('checkout forwards the caller key once and retains explicit typed failure paths', () => {
    const create = section(checkout, 'Future<Order> createCheckout(', '/// Converts the Cloud Function');
    assert.equal((create.match(/_functions\.createCheckout\s*\(/g) || []).length, 1);
    assert.match(create, /idempotencyKey:\s*idempotencyKey/);
    assert.doesNotMatch(create, /generateIdempotencyKey\s*\(|Random\.|DateTime\.now\s*\(/);
    for (const code of ['not-found', 'unavailable', 'internal', 'deadline-exceeded', 'already-exists', 'resource-exhausted']) {
      assert.ok(create.includes(`case '${code}':`), `missing honest ${code} handling`);
    }
    assert.match(create, /throw (?:const )?CheckoutException/);
    assert.match(create, /throw CanteenPausedException/);
    assert.match(create, /throw InsufficientStockException/);
    assert.match(create, /e is CheckoutException[\s\S]*?rethrow/);
    assert.match(create, /details\?\['availableStock'\]/, 'use the real backend stock-detail field');
    assert.match(create, /same checkout session/);
  });

  it('a malformed or cross-session server receipt is rejected instead of synthesizing an order', () => {
    const parse = section(checkout, 'Order _orderFromCallableResult(', '/// Thrown when the server reports');
    assert.match(parse, /orderMap\['idempotencyKey'\]\s*!=\s*expectedIdempotencyKey/);
    assert.match(parse, /orderMap\['studentId'\]\s*!=\s*_auth\.currentUser\?\.uid/);
    assert.match(parse, /rawItems is! List\s*\|\|\s*rawItems\.isEmpty/);
    assert.match(parse, /responsePaise is! int/);
    assert.match(parse, /throw const CheckoutException/);
    assert.doesNotMatch(parse, /DateTime\.now\s*\(/, 'a missing server timestamp must not be fabricated');
  });

  it('profile provisioning waits for server success, token refresh and a server-source document', () => {
    const provision = section(auth, 'Future<UserProfile> _ensureUserProfile(', '/// Translates Firebase Auth');
    const callable = provision.indexOf('await _functions.provisionUserProfile(');
    const refreshed = provision.indexOf('await user.getIdToken(true)');
    const serverRead = provision.indexOf('GetOptions(source: Source.server)');
    const profile = provision.indexOf('UserProfile.fromFirestore(');
    assert.ok(callable >= 0 && refreshed > callable && serverRead > refreshed && profile > serverRead);
    assert.match(provision, /result\['success'\]\s*!=\s*true/);
    assert.match(provision, /result\['userId'\]\s*!=\s*user\.uid/);
    assert.match(provision, /refreshedToken == null \|\| refreshedToken\.isEmpty/);
    assert.match(provision, /data\['isVerified'\] is! bool/);
    assert.match(provision, /throw const ProfileProvisioningException/);
    assert.doesNotMatch(provision, /getIdentityHintFromEmail|toInitialCreateMap|\.set\s*\(/);
    assert.doesNotMatch(auth, /\.\s*(?:set|runTransaction|batch)\s*\(/, 'profile creation remains server-only');
  });

  it('offline cached profiles are account-bound display data without verified priority authority', () => {
    const display = section(auth, 'UserProfile _asUnverifiedDisplayProfile(', '/// Provision and load');
    assert.match(display, /accountType:\s*AccountType\.visitor/);
    assert.match(display, /verificationStatus:\s*VerificationStatus\.pending/);
    assert.match(display, /isVerified:\s*false/);
    assert.match(display, /priorityLevel:\s*0/);
    const cache = section(auth, 'Future<void> saveCachedProfile(', '/// Clear local disk profile cache');
    assert.match(cache, /_asUnverifiedDisplayProfile\(profile\)/);
    assert.match(cache, /_asUnverifiedDisplayProfile\(cached\)/);
    assert.match(cache, /_auth\.currentUser\?\.uid\s*!=\s*cached\.uid/);
  });

  it('normal profile loading cannot convert provisioning errors into cached or synthesized success', () => {
    const load = section(auth, 'Future<UserProfile?> getUserProfile(', '/// Checks for any pending');
    assert.match(load, /return await _ensureUserProfile\(user\)/);
    assert.match(load, /throw const ProfileProvisioningException/);
    assert.doesNotMatch(load, /return cached|_synthesizeProfileFromUser|getCachedProfile\s*\(/);
    assert.doesNotMatch(auth, /_synthesizeProfileFromUser|toInitialCreateMap/);
    const update = section(auth, 'Future<void> updateUserProfile(', '/// Sign out current user');
    for (const authority of ['role', 'priorityLevel', 'isVerified', 'verificationStatus', 'accountType', 'accountDisabled']) {
      assert.ok(!update.includes(`'${authority}'`), `profile preferences must not write ${authority}`);
    }
  });
});
