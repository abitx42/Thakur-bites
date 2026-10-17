const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// OFFLINE STRUCTURAL REGRESSIONS ONLY: this suite checks the Dart call-site
// boundaries while Flutter/Dart are unavailable. It does not compile Dart or
// simulate Firebase auth, lifecycle scheduling, Razorpay, or Firestore receipts.
const lib = path.resolve(__dirname, '../../thakur_bites/lib');
const auth = fs.readFileSync(path.join(lib, 'providers/auth_provider.dart'), 'utf8');
const cart = fs.readFileSync(path.join(lib, 'screens/cart_screen.dart'), 'utf8');

function section(source, start, end) {
  const first = source.indexOf(start);
  assert.ok(first >= 0, `missing section ${start}`);
  const last = source.indexOf(end, first + start.length);
  assert.ok(last > first, `missing section end ${end}`);
  return source.slice(first, last);
}

describe('T1 offline Flutter caller structural regressions (not Dart runtime tests)', () => {
  it('cached display profiles never initialize a logged-in provider', () => {
    assert.doesNotMatch(auth, /getCachedProfile\s*\(/);
    assert.doesNotMatch(auth, /_signOutExplicit|return cachedProfile/);
    assert.match(auth, /_currentUserProfile\?\.uid\s*==\s*_authService\.currentUser\?\.uid/);
  });

  it('every auth event invalidates earlier reads and clears identity/preferences before loading', () => {
    const load = section(auth, 'Future<bool> _loadProfile(', '/// Complete a possible web redirect');
    const invalidate = load.indexOf('++_stateVersion');
    const clear = load.indexOf('_clearIdentity();');
    const nullUser = load.indexOf('if (user == null');
    const read = load.indexOf('await _authService.getUserProfile(user.uid)');
    assert.ok(invalidate >= 0 && clear > invalidate && nullUser > clear && read > nullUser);
    assert.match(load.slice(read), /if \(!_isCurrent\(version, user\.uid\)\) return false;/);
    assert.match(load, /_failProfile\(e\)/);
    const clearIdentity = section(auth, 'void _clearIdentity()', 'void _failProfile(');
    assert.match(clearIdentity, /_currentUserProfile\s*=\s*null/);
    assert.match(clearIdentity, /_preferences\.clearCache\(\)/);
  });

  it('profile publication is disposed-, version-, UID- and account-disabled guarded', () => {
    const current = section(auth, 'bool _isCurrent(', 'void _notifyIfActive()');
    assert.match(current, /!_disposed/);
    assert.match(current, /version == _stateVersion/);
    assert.match(current, /_authService\.currentUser\?\.uid == uid/);
    const publish = section(auth, 'void _publishProfile(', 'Future<bool> _loadProfile(');
    assert.match(publish, /profile\.uid != uid \|\| profile\.accountDisabled/);
    assert.match(auth, /void _notifyIfActive\(\)[\s\S]*?if \(!_disposed\) notifyListeners\(\)/);
    const dispose = auth.slice(auth.lastIndexOf('void dispose()'));
    assert.match(dispose, /_disposed = true/);
    assert.match(dispose, /\+\+_stateVersion/);
    assert.match(dispose, /_authSub\?\.cancel\(\)/);
  });

  it('redirect and interactive sign-in results cannot directly publish stale profiles', () => {
    const redirect = section(auth, 'Future<void> _completeRedirect()', '/// Sign In with Google');
    assert.match(redirect, /version != _stateVersion/);
    assert.doesNotMatch(redirect, /_currentUserProfile\s*=/);
    const signIn = section(auth, 'Future<void> signInWithGoogle()', '/// Retry server profile');
    assert.match(signIn, /action != _actionVersion/);
    assert.match(signIn, /_authService\.currentUser\?\.uid != profile\.uid/);
    assert.match(signIn, /await retryProfile\(\)/);
    assert.doesNotMatch(signIn, /_currentUserProfile\s*=/);
  });

  it('profile updates wait for the write and a fresh server profile instead of publishing input authority', () => {
    const update = section(auth, 'Future<void> updateProfile(', '/// Update Profile fields');
    const write = update.indexOf('await _authService.updateUserProfile(profile)');
    const read = update.indexOf('await _authService.getUserProfile(user.uid)');
    const publish = update.indexOf('_publishProfile(saved, user.uid)');
    assert.ok(write >= 0 && read > write && publish > read);
    assert.ok((update.match(/_isCurrent\(version, user\.uid\)/g) || []).length >= 3);
    assert.doesNotMatch(update, /_currentUserProfile\s*=\s*profile/);
    assert.doesNotMatch(auth, /totalOrders:\s*.*totalOrders\s*\+\s*1/);
  });

  it('sign-out and guest mode synchronously invalidate old flows and clear preferences', () => {
    const signOut = section(auth, 'Future<void> signOut()', '@override\n  void dispose()');
    assert.ok(signOut.indexOf('_clearIdentity();') < signOut.indexOf('await _authService.signOut()'));
    assert.match(signOut, /\+\+_actionVersion/);
    assert.match(signOut, /\+\+_stateVersion/);
    const guest = section(auth, 'void enableGuestBrowsing()', '/// Sign in as Guest');
    assert.match(guest, /\+\+_actionVersion/);
    assert.match(guest, /\+\+_stateVersion/);
    assert.match(guest, /_clearIdentity\(\)/);
  });

  it('checkout fingerprints bind UID, normalized line identity, method and all request preferences', () => {
    const fingerprint = section(cart, 'String _checkoutFingerprint(', 'Map<String, String> _savedCheckoutIntents(');
    for (const field of ['uid', 'itemId', 'quantity', 'customization', 'paymentMethod', 'readyMadePreference', 'dietaryPreferences', 'dietaryNotes']) {
      assert.ok(fingerprint.includes(`'${field}'`), `missing fingerprint field ${field}`);
    }
    assert.match(fingerprint, /sort\(/);
    assert.match(fingerprint, /jsonEncode\(/);
    assert.doesNotMatch(fingerprint, /\.price|totalPrice|DateTime\.now|generateIdempotencyKey/);
  });

  it('account-scoped persisted keys survive lost checkout replies and retries', () => {
    assert.match(cart, /checkout_intents_v1_\$uid/);
    const checkout = section(cart, 'Future<void> _handleConfirmAndPay()', '/// Alert when checkout stock');
    assert.match(checkout, /intents\[fingerprint\]\s*\?\?\s*generateIdempotencyKey\(\)/);
    const persist = checkout.indexOf('await prefs.setString(');
    const request = checkout.indexOf('await _checkoutService.createCheckout(');
    assert.ok(persist >= 0 && request > persist, 'persist recovery key before creating an order');
    assert.match(checkout, /idempotencyKey:\s*idempotencyKey/);
    assert.doesNotMatch(checkout, /_currentIdempotencyKey\s*=\s*null|canReuseOrder|verifyItemsStockQuantity/);
    const failure = checkout.slice(checkout.indexOf('} on PaymentException'));
    assert.doesNotMatch(failure, /_forgetCheckoutIntent|intents\.remove|generateIdempotencyKey/);
  });

  it('cart never writes authoritative orders or fabricates paid/confirmed states or payment IDs', () => {
    assert.doesNotMatch(cart, /\.\s*(?:update|set|delete|runTransaction|batch)\s*\(/);
    assert.doesNotMatch(cart, /(?:status|paymentStatus):\s*['"](?:paid|captured|confirmed)['"]/);
    assert.doesNotMatch(cart, /['"](?:paymentStatus|paidAt|confirmedAt)['"]\s*:/);
    assert.doesNotMatch(cart, /CASH_\$|RZP_\$|FREE_\$|effectivePaymentId|last_payment_id_/);
  });

  it('authoritative order reads require server source and a complete account/key-bound receipt', () => {
    const read = section(cart, 'Future<app.Order> _readAuthoritativeOrder(', 'Future<void> _rememberActiveOrder(');
    assert.match(read, /GetOptions\(source: Source\.server\)/);
    assert.match(read, /data\['studentId'\] != uid/);
    assert.match(read, /data\['idempotencyKey'\] != idempotencyKey/);
    assert.match(read, /data\['totalAmountPaise'\] is! int/);
    assert.match(read, /data\['createdAt'\] is! Timestamp/);
    assert.match(read, /data\['status'\] is! String/);
    assert.match(read, /data\['paymentStatus'\] is! String/);
    assert.match(read, /snap\.metadata\.isFromCache/);
    assert.match(read, /snap\.metadata\.hasPendingWrites/);
  });

  it('checkout binds an immutable request snapshot and actual dietary preferences to the saved intent', () => {
    const checkout = section(cart, 'Future<void> _handleConfirmAndPay()', '/// Alert when checkout stock');
    assert.match(checkout, /cart\.entries\.map\(\(entry\) => CartEntry\(/);
    assert.match(checkout, /await PreferencesService\(\)\.getPreferences\(uid\)/);
    assert.match(checkout, /dietaryPreferences = List<String>\.unmodifiable\(preferences\.dietary\.labels\)/);
    assert.match(checkout, /dietaryNotes = preferences\.dietary\.customNotes\.trim\(\)/);
    const request = checkout.slice(checkout.indexOf('await _checkoutService.createCheckout('), checkout.indexOf('knownOrder = order'));
    assert.match(request, /entries:\s*entries/);
    assert.match(request, /dietaryPreferences:\s*dietaryPreferences/);
    assert.match(request, /dietaryNotes:\s*dietaryNotes/);
    assert.doesNotMatch(request, /entries:\s*cart\.entries|dietaryPreferences:\s*null|dietaryNotes:\s*null/);
  });

  it('late storage continuations cannot overwrite a new account/cart recovery session', () => {
    const remember = section(cart, 'Future<void> _rememberActiveOrder(', 'Future<void> _handleConfirmAndPay()');
    assert.ok((remember.match(/if \(!isCurrent\(\)\) return;/g) || []).length >= 3);
    const retire = section(cart, 'Future<void> _forgetCheckoutIntent(', 'Future<app.Order> _readAuthoritativeOrder(');
    assert.ok(retire.indexOf('if (!isCurrent()) return;') < retire.indexOf('intents.remove(fingerprint)'));
    assert.match(retire, /intents\[fingerprint\] != idempotencyKey/);
  });

  it('cash-pending checkout returns before Razorpay and uses the existing pending-order screen', () => {
    const checkout = section(cart, 'Future<void> _handleConfirmAndPay()', '/// Alert when checkout stock');
    const cash = checkout.indexOf('if (order.isCounterCash && !order.isPaid)');
    const launch = checkout.indexOf('await paymentService.initiateOnlinePayment(');
    assert.ok(cash >= 0 && launch > cash);
    const cashBranch = checkout.slice(cash, launch);
    assert.match(cashBranch, /OrderStatusScreen\(order: order\)/);
    assert.match(cashBranch, /return;/);
    assert.doesNotMatch(cashBranch, /TicketScreen|showOrderPlaced|PaymentResult/);
  });

  it('online success and zero-price success require a server-paid order before clearing the cart', () => {
    const checkout = section(cart, 'Future<void> _handleConfirmAndPay()', '/// Alert when checkout stock');
    const launch = checkout.indexOf('await paymentService.initiateOnlinePayment(');
    const freshRead = checkout.indexOf('await _readAuthoritativeOrder(', launch);
    const paidGate = checkout.indexOf('if (!order.isPaid ||', freshRead);
    const ticket = checkout.indexOf('TicketScreen(order: order)', paidGate);
    assert.ok(launch >= 0 && freshRead > launch && paidGate > freshRead && ticket > paidGate);
    assert.match(checkout, /if \(!order\.isPaid && order\.isOnlinePayment && order\.totalAmount > 0\)/);
    assert.match(checkout.slice(launch, freshRead), /!payRes\.isSuccess \|\| payRes\.orderId != order\.id/);
    assert.match(checkout.slice(paidGate, ticket), /throw const PaymentException/);
    assert.doesNotMatch(checkout, /incrementOrderCount\(/);
  });

  it('cancel, auth/cart changes and disposal invalidate in-flight checkout completions', () => {
    assert.match(cart, /widget\.cart\.addListener\(_handleCheckoutInputChange\)/);
    assert.match(cart, /auth\.addListener\(_handleCheckoutInputChange\)/);
    assert.match(cart, /_checkoutIsCurrent\s*=\s*isCurrent/);
    assert.match(cart, /attempt == _checkoutVersion/);
    assert.match(cart, /authProvider\.currentProfile\?\.uid == uid/);
    assert.match(cart, /fingerprint == currentFingerprint\(\)/);
    const cancel = section(cart, 'void _cancelPaymentInProgress()', 'String _checkoutFingerprint(');
    assert.match(cancel, /\+\+_checkoutVersion/);
    const checkout = section(cart, 'Future<void> _handleConfirmAndPay()', '/// Alert when checkout stock');
    assert.ok((checkout.match(/if \(!isCurrent\(\)\) return;/g) || []).length >= 6);
    assert.match(checkout, /finally\s*\{[\s\S]*?mounted && attempt == _checkoutVersion/);
  });
});
