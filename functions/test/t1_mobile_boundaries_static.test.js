const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// OFFLINE STRUCTURAL BOUNDARY TESTS ONLY. Flutter/Dart are unavailable here.
// These guard actual Dart sources against unsafe fallback paths; they do not
// compile Dart, execute payment callbacks, or simulate Firestore authorization.
const lib = path.resolve(__dirname, '../../thakur_bites/lib');
const payment = fs.readFileSync(path.join(lib, 'services/payment_service.dart'), 'utf8');
const status = fs.readFileSync(path.join(lib, 'screens/order_status_screen.dart'), 'utf8');
const verification = fs.readFileSync(path.join(lib, 'screens/verification_screen.dart'), 'utf8');
function has(source, pattern, message = String(pattern)) { assert.ok(pattern.test(source), message); }
function lacks(source, pattern, message = String(pattern)) { assert.ok(!pattern.test(source), message); }
function section(source, start, end) {
  const first = source.indexOf(start);
  assert.ok(first >= 0, `missing section ${start}`);
  const last = source.indexOf(end, first + start.length);
  assert.ok(last > first, `missing section end ${end}`);
  return source.slice(first, last);
}
const online = () => section(payment, 'Future<PaymentResult> initiateOnlinePayment(', '/// Records a cash payment');

describe('T1 offline remaining mobile boundary regressions (not Dart runtime tests)', () => {
  it('all three scoped files have no direct core Firestore writes or inventory restoration', () => {
    for (const [name, source] of Object.entries({ payment, status, verification })) {
      lacks(source, /\.\s*(?:set|update|delete|runTransaction|batch)\s*\(/, `${name} must not write Firestore documents`);
      lacks(source, /FieldValue\.|_executeDirectCancellation/, `${name} must not restore stock or fabricate core state`);
    }
  });

  it('payment session failures cannot launch an unbound gateway or use a fallback key', () => {
    lacks(payment, /String\.fromEnvironment|rzp_test_[A-Za-z0-9]+|rzp_live_[A-Za-z0-9]+/);
    lacks(payment, /Launching direct gateway|isUndeployedOrUnavailable|Fall back seamlessly/i);
    const source = online();
    const session = source.indexOf('await _functions.createPaymentSession(');
    const sdk = source.indexOf('await _launchRazorpayCheckout(');
    const failureHandler = source.indexOf('on FirebaseFunctionsException catch');
    assert.ok(session >= 0 && sdk > session && failureHandler > sdk, 'one fail-closed flow must contain the gateway launch');
    has(source.slice(failureHandler), /throw PaymentException/);
  });

  it('server sessions bind exact order, owner, gateway aliases, positive integer paise, key and INR', () => {
    const source = online();
    has(source, /sessionData\['orderId'\] != orderId/);
    has(source, /sessionPaise is! int \|\| sessionPaise != amountPaise/);
    has(source, /currency != 'INR'/);
    has(source, /keyId is! String/);
    has(source, /razorpayOrderId is! String/);
    has(source, /sessionData\['razorpayOrderId'\] != razorpayOrderId/);
    has(source, /notes\['studentId'\] != uid/);
    has(source, /notes\['orderId'\] != orderId/);
    has(source, /'currency': currency|currency: currency/);
  });

  it('gateway callback IDs and signature are mandatory and cannot inherit the requested order ID', () => {
    const source = online();
    has(source, /confirmedOrderId != razorpayOrderId/);
    has(source, /paymentId is! String/);
    has(source, /signature is! String/);
    has(source, /\{64\}/);
    lacks(source, /confirmedOrderId\s*=[^;]*\?\?\s*razorpayOrderId/);
    lacks(payment, /response\.orderId\s*\?\?\s*razorpayOrderId/);
    has(payment, /'order_id': razorpayOrderId/);
  });

  it('online success requires a complete verified backend result and rejects orphaned/cancelled captures', () => {
    const source = online();
    const verify = source.indexOf('await _functions.verifyPayment(');
    const gate = source.indexOf("verified['success'] != true", verify);
    const success = source.indexOf('isSuccess: true', gate);
    assert.ok(verify >= 0 && gate > verify && success > gate);
    has(source, /verified\['orderId'\] != orderId/);
    has(source, /verified\['amountPaise'\] != amountPaise/);
    has(source, /verified\['alreadyCaptured'\] is! bool/);
    has(source, /verified\['orphaned'\] == true/);
    has(source, /\['confirmed', 'ready'\]\.contains\(verified\['status'\]\)/);
    lacks(source.slice(source.indexOf('on FirebaseFunctionsException catch')), /isSuccess:\s*true/);
  });

  it('cancelled or account-switched payment attempts cannot launch or complete later', () => {
    const source = online();
    has(payment, /generation != _paymentGeneration/);
    has(payment, /_auth\.currentUser\?\.uid != uid/);
    assert.ok((source.match(/_assertActivePayment\(uid, generation\)/g) || []).length >= 3);
    const cancel = section(payment, 'static void cancelActivePayment(', '// ─── Private: Razorpay');
    has(cancel, /\+\+_paymentGeneration/);
  });

  it('cash recording requires both a successful handler and an actual paid server receipt without invented IDs', () => {
    const cash = section(payment, 'Future<PaymentResult> recordCashPayment(', 'static _PaymentCompleter?');
    has(cash, /result\['success'\] != true/);
    has(cash, /result\['orderId'\] != orderId/);
    has(cash, /GetOptions\(source: Source\.server\)/);
    has(cash, /data\['paymentMethod'\] != 'counter_cash'/);
    has(cash, /data\['totalAmountPaise'\] != amountPaise/);
    has(cash, /data\['gatewayPaymentId'\] is! String/);
    lacks(payment, /CASH_\$|RZP_\$|FREE_\$/);
  });

  it('order actions read complete, owner-bound, committed server receipts', () => {
    const read = section(status, 'Future<app.Order> _readServerOrder(', 'Future<app.Order> _cancelOnServer(');
    has(read, /GetOptions\(source: Source\.server\)/);
    has(read, /snap\.metadata\.isFromCache|snapshot\.metadata\.isFromCache/);
    has(read, /snap\.metadata\.hasPendingWrites|snapshot\.metadata\.hasPendingWrites/);
    has(read, /data\['studentId'\] != uid/);
    has(read, /data\['status'\] is! String/);
    has(read, /data\['paymentStatus'\] is! String/);
    has(read, /data\['totalAmountPaise'\] is! int/);
  });

  it('manual and expiry cancellation share a trusted handler plus a confirmed server cancellation', () => {
    const cancel = section(status, 'Future<app.Order> _cancelOnServer(', '/// Automatic cancellation');
    has(cancel, /await _functions\.cancelOrder\(/);
    has(cancel, /result\['success'\] != true/);
    has(cancel, /result\['orderId'\] != order\.id/);
    has(cancel, /result\['status'\] != 'cancelled'/);
    has(cancel, /await _readServerOrder\(/);
    has(cancel, /cancelled\.status != 'cancelled'/);
    const auto = section(status, 'void _checkAutoCancelExpiredReservation(', '/// Re-adds expired order items');
    has(auto, /await _cancelOnServer\(/);
    lacks(auto, /_executeDirect|\.update\(|\.set\(/);
    const manual = section(status, 'Future<void> _handleCancelOrder(', 'Future<void> _handlePayNow(');
    has(manual, /await _cancelOnServer\(/);
    lacks(status, /reserved items have been released|stock reservation has expired and items were released/i);
  });

  it('expired-order cart restoration first confirms a closed unpaid order with the server', () => {
    const restore = section(status, 'Future<void> _handleReorderFromCart(', '/// Reservation Countdown');
    const read = restore.indexOf('await _readServerOrder(');
    const paid = restore.indexOf('current.isPaid');
    const cancel = restore.indexOf('await _cancelOnServer(');
    const cartWrite = restore.indexOf('cart.addItem(');
    assert.ok(read >= 0 && paid > read && cancel > paid && cartWrite > cancel);
  });

  it('Pay Now requires a fresh paid server receipt bound to the real gateway payment before success', () => {
    const pay = section(status, 'Future<void> _handlePayNow(', 'Future<void> _handleReconcilePayment(');
    const sdk = pay.indexOf('await paymentService.initiateOnlinePayment(');
    const read = pay.indexOf('await _readServerOrder(', sdk);
    const paid = pay.indexOf('_isPaidOrder(confirmed)', read);
    const message = pay.indexOf('Payment verified!', paid);
    assert.ok(sdk >= 0 && read > sdk && paid > read && message > paid);
    has(pay, /confirmed\.gatewayPaymentId != result\.paymentId/);
    has(pay, /!result\.isSuccess \|\| result\.orderId != order\.id/);
    lacks(pay, /last_payment_id_|effectivePaymentId|copyWith\([\s\S]*?paymentStatus:/);
  });

  it('reconciliation failures remain errors and cannot recover paid authority from local storage', () => {
    const reconcile = section(status, 'Future<void> _handleReconcilePayment(', 'Future<void> _submitFeedback(');
    assert.equal((reconcile.match(/await _functions\.reconcileOrderPayment\(/g) || []).length, 1);
    has(reconcile, /result\['success'\] != true/);
    has(reconcile, /result\['orderId'\] != order\.id/);
    has(reconcile, /await _readServerOrder\(/);
    has(reconcile, /if \(_isPaidOrder\(current\)\)/);
    lacks(reconcile, /getString\(|last_payment_id_|isUndeployedOrUnavailable/);
    lacks(reconcile.slice(reconcile.indexOf('} catch (e)')), /_readServerOrder\(|confirmed!|verified!|backgroundColor: AppColors\.green/);
  });

  it('pickup QR uses the existing signed server token without inventing mobile cryptography', () => {
    const qr = section(status, 'Future<String> _requestPickupQr(', 'Widget _buildPickupQrBadge(');
    has(qr, /httpsCallable\(\s*'getStudentPickupQr'/);
    has(qr, /data\['success'\] != true/);
    has(qr, /data\['orderId'\] != order\.id/);
    has(qr, /parts\[0\] != order\.id \|\| parts\[1\] != uid/);
    has(qr, /return payload;/);
    lacks(status, /hashCode|Hmac\(|SHA256|_fnv1a32/);
    const badge = section(status, 'Widget _buildPickupQrBadge(', '/// Ready Pickup PIN');
    has(badge, /qrData: ready \? snapshot\.data! : ''/);
    has(badge, /LiveSecurityQrBadge\(/);
  });

  it('verification only trusts complete callable submission receipts and refreshes the server profile', () => {
    const submit = section(verification, 'Future<void> _submitApplication()', '@override\n  Widget build(');
    has(submit, /await functionsService\.submitVerificationApplication\(/);
    has(submit, /result\['success'\] != true/);
    has(submit, /result\['status'\] != 'SUBMITTED'/);
    has(submit, /applicationId is! String/);
    has(submit, /await auth\.retryProfile\(\)/);
    lacks(verification, /FirebaseFirestore|verificationApplications|FieldValue\.|DateTime\.now\(\)/);
    lacks(submit, /copyWith\(|auth\.updateProfile\(|\?\? 'Pending'|falling back/i);
    has(submit, /submittedApplicationId == null/);
  });

  it('pickup PIN copy and full-ticket navigation remain owner-bound and require a current paid ticket', () => {
    const pin = section(status, 'Widget _buildPickupPinCard(', '/// Vertical order tracker');
    has(pin, /uid != null && _isCurrentOwner\(version, uid, order\.id\) && effectivePin\.isNotEmpty/);
    const fresh = pin.indexOf('await _readServerOrder(');
    const gate = pin.indexOf('_isPaidOrder(current)', fresh);
    const ticket = pin.indexOf('TicketScreen(order: current)', gate);
    assert.ok(fresh >= 0 && gate > fresh && ticket > gate);
  });

  it('account switches and disposal invalidate async order/verification results and pickup credentials', () => {
    const owner = section(status, 'bool _isCurrentOwner(', 'Future<void> _restoreCachedPin(');
    has(owner, /if \(!mounted \|\| version != _boundaryVersion/);
    has(owner, /_currentUid != uid \|\| widget\.orderId != orderId\) return false/);
    has(owner, /auth\.currentProfile\?\.uid == uid/);
    has(status, /\+\+_boundaryVersion/);
    has(status, /_pickupQrFuture = null/);
    has(status, /_cachedPin = null/);
    has(verification, /version == _submissionVersion/);
    has(verification, /FirebaseAuth\.instance\.currentUser\?\.uid == uid/);
    has(verification, /\+\+_submissionVersion/);
  });
});
