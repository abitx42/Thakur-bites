import 'package:cloud_functions/cloud_functions.dart';

/// Typed, named callable references for all Thakur Bites Cloud Functions.
///
/// Use this class instead of calling FirebaseFunctions.instance.httpsCallable()
/// directly in feature code. It provides a single place to find callable names
/// and their typed request/response shapes.
class FunctionsService {
  final FirebaseFunctions _functions;

  FunctionsService({FirebaseFunctions? functions})
      : _functions = functions ?? FirebaseFunctions.instance;

  // ─── Checkout ───────────────────────────────────────────────────────────

  /// Creates an authoritative, idempotent checkout order with atomic inventory
  /// reservation. Returns the orderId and a per-item price snapshot.
  Future<Map<String, dynamic>> createCheckout({
    required String idempotencyKey,
    required List<Map<String, dynamic>> items,
    required String paymentMethod, // 'online' | 'counter_cash'
  }) async {
    final callable = _functions.httpsCallable('createCheckout');
    final result = await callable.call({
      'idempotencyKey': idempotencyKey,
      'items': items,
      'paymentMethod': paymentMethod,
      'appVersion': _appVersion,
    });
    return Map<String, dynamic>.from(result.data as Map);
  }

  // ─── Payments ────────────────────────────────────────────────────────────

  /// Creates a Razorpay payment session for an existing order.
  /// Returns: { razorpayOrderId, amount, currency, keyId }
  Future<Map<String, dynamic>> createPaymentSession({
    required String orderId,
  }) async {
    final callable = _functions.httpsCallable('createPaymentSession');
    final result = await callable.call({
      'orderId': orderId,
      'appVersion': _appVersion,
    });
    return Map<String, dynamic>.from(result.data as Map);
  }

  /// Verifies Razorpay payment by confirming HMAC signature server-side.
  /// Returns: { success, orderId, paymentStatus }
  Future<Map<String, dynamic>> verifyPayment({
    required String orderId,
    required String razorpayPaymentId,
    required String razorpayOrderId,
    required String razorpaySignature,
  }) async {
    final callable = _functions.httpsCallable('verifyPayment');
    final result = await callable.call({
      'orderId': orderId,
      'razorpayPaymentId': razorpayPaymentId,
      'razorpayOrderId': razorpayOrderId,
      'razorpaySignature': razorpaySignature,
      'appVersion': _appVersion,
    });
    return Map<String, dynamic>.from(result.data as Map);
  }

  /// Records a cash payment for an existing counter_cash order.
  /// Returns: { success, orderId }
  Future<Map<String, dynamic>> recordCashPayment({
    required String orderId,
    required int amountPaise,
  }) async {
    final callable = _functions.httpsCallable('recordCashPayment');
    final result = await callable.call({
      'orderId': orderId,
      'amountPaise': amountPaise,
      'appVersion': _appVersion,
    });
    return Map<String, dynamic>.from(result.data as Map);
  }

  // ─── User Profile Provisioning ──────────────────────────────────────────

  /// Authoritatively provisions or updates a user profile via Cloud Function.
  /// Enforces server-side identity classification, role boundaries, and custom claims.
  Future<Map<String, dynamic>> provisionUserProfile({
    String? displayName,
    String? phone,
    String? department,
    String? year,
    String? rollNo,
  }) async {
    final callable = _functions.httpsCallable('provisionUserProfile');
    final payload = <String, dynamic>{
      'appVersion': _appVersion,
    };
    if (displayName != null) payload['displayName'] = displayName;
    if (phone != null) payload['phone'] = phone;
    if (department != null) payload['department'] = department;
    if (year != null) payload['year'] = year;
    if (rollNo != null) payload['rollNo'] = rollNo;

    final result = await callable.call(payload);
    return Map<String, dynamic>.from(result.data as Map);
  }

  // ─── Verification ────────────────────────────────────────────────────────

  /// Submits faculty/staff verification application authoritatively.
  /// Server generates cryptographic ID, timestamps, and marks status UNDER_REVIEW.
  Future<Map<String, dynamic>> submitVerificationApplication({
    required String applicationType,
    required String employeeId,
    required String department,
    required String designation,
    String? officialEmail,
    String? idProofStoragePath,
  }) async {
    final callable = _functions.httpsCallable('submitVerificationApplication');
    final payload = <String, dynamic>{
      'applicationType': applicationType,
      'employeeId': employeeId,
      'department': department,
      'designation': designation,
      'appVersion': _appVersion,
    };
    if (officialEmail != null) payload['officialEmail'] = officialEmail;
    if (idProofStoragePath != null) payload['idProofStoragePath'] = idProofStoragePath;

    final result = await callable.call(payload);
    return Map<String, dynamic>.from(result.data as Map);
  }

  // ─── Version ─────────────────────────────────────────────────────────────

  static const String _appVersion = '1.0.0'; // Keep in sync with pubspec.yaml
}
