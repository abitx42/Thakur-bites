import 'dart:async';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'functions_service.dart';

/// Supported payment methods for campus canteen checkout
enum PaymentMethod {
  campusUpi,
  razorpayOnline,
  cashAtCounter,
}

/// Structured immutable payment outcome
class PaymentResult {
  final bool isSuccess;
  final String? paymentId;
  final String orderId;
  final double amount;
  final PaymentMethod method;
  final String? errorMessage;
  final DateTime timestamp;

  PaymentResult({
    required this.isSuccess,
    this.paymentId,
    required this.orderId,
    required this.amount,
    required this.method,
    this.errorMessage,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

/// Server-authoritative payment orchestration service.
///
/// SECURITY: This service no longer generates fake payment IDs or writes
/// paymentStatus directly to Firestore. All payment state mutations are
/// performed server-side by Cloud Functions after HMAC signature verification.
///
/// Flow for online payments:
///   1. Client → createPaymentSession(orderId) → Function returns {razorpayOrderId, amount, keyId}
///   2. Client launches Razorpay SDK with server-provided credentials
///   3. Razorpay SDK returns {razorpay_payment_id, razorpay_order_id, razorpay_signature}
///   4. Client → verifyPayment(paymentId, orderId, signature) → Function verifies HMAC
///   5. Function sets paymentStatus='paid' server-side — client NEVER writes this field
///
/// Flow for cash payments:
///   1. Cashier screen calls recordCashPayment(orderId, amountPaise)
///   2. Function verifies cashier role and records payment
class PaymentService {
  final FunctionsService _functions;

  PaymentService({FunctionsService? functions})
      : _functions = functions ?? FunctionsService();

  /// Initiates an online payment for a confirmed order.
  ///
  /// Returns a [PaymentResult] after the full server-verified flow completes.
  /// Throws [PaymentException] on any failure.
  Future<PaymentResult> initiateOnlinePayment({
    required String orderId,
    required double totalAmountRs,
    required String studentName,
    required String studentEmail,
  }) async {
    final now = DateTime.now();

    try {
      // Step 1: Create a Razorpay order on the server
      final sessionData = await _functions.createPaymentSession(orderId: orderId);
      final razorpayOrderId = sessionData['razorpayOrderId'] as String;
      final amountPaise = sessionData['amount'] as int;
      final keyId = sessionData['keyId'] as String;

      // Step 2: Launch Razorpay SDK and collect payment confirmation
      final paymentDetails = await _launchRazorpayCheckout(
        razorpayOrderId: razorpayOrderId,
        amountPaise: amountPaise,
        keyId: keyId,
        studentName: studentName,
        studentEmail: studentEmail,
      );

      // Step 3: Verify payment signature server-side (HMAC verification)
      final verifyResult = await _functions.verifyPayment(
        orderId: orderId,
        razorpayPaymentId: paymentDetails['razorpay_payment_id'] as String,
        razorpayOrderId: paymentDetails['razorpay_order_id'] as String,
        razorpaySignature: paymentDetails['razorpay_signature'] as String,
      );

      return PaymentResult(
        isSuccess: true,
        orderId: orderId,
        amount: totalAmountRs,
        method: PaymentMethod.razorpayOnline,
        paymentId: verifyResult['paymentId'] as String?,
        timestamp: now,
      );
    } on FirebaseFunctionsException catch (e) {
      throw PaymentException('Payment failed: ${e.message}');
    } on PaymentException {
      rethrow;
    } catch (e) {
      throw PaymentException('Payment error: $e');
    }
  }

  /// Records a cash payment for a counter_cash order.
  /// Should only be called from Cashier interface — requires cashier role.
  Future<PaymentResult> recordCashPayment({
    required String orderId,
    required double totalAmountRs,
  }) async {
    final now = DateTime.now();
    final amountPaise = (totalAmountRs * 100).round();

    try {
      final result = await _functions.recordCashPayment(
        orderId: orderId,
        amountPaise: amountPaise,
      );

      return PaymentResult(
        isSuccess: true,
        orderId: orderId,
        amount: totalAmountRs,
        method: PaymentMethod.cashAtCounter,
        paymentId: result['paymentId'] as String? ?? 'CASH_$orderId',
        timestamp: now,
      );
    } on FirebaseFunctionsException catch (e) {
      return PaymentResult(
        isSuccess: false,
        orderId: orderId,
        amount: totalAmountRs,
        method: PaymentMethod.cashAtCounter,
        errorMessage: e.message,
        timestamp: now,
      );
    }
  }

  // ─── Private: Razorpay SDK Launch ────────────────────────────────────────

  /// Launches the Razorpay checkout and waits for payment success or failure.
  /// Returns the raw payment details map on success.
  /// Throws [PaymentException] on failure or user cancellation.
  Future<Map<String, dynamic>> _launchRazorpayCheckout({
    required String razorpayOrderId,
    required int amountPaise,
    required String keyId,
    required String studentName,
    required String studentEmail,
  }) async {
    final completer = _PaymentCompleter();
    final razorpay = Razorpay();

    razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, (PaymentSuccessResponse response) {
      completer.complete({
        'razorpay_payment_id': response.paymentId ?? '',
        'razorpay_order_id': response.orderId ?? razorpayOrderId,
        'razorpay_signature': response.signature ?? '',
      });
    });

    razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, (PaymentFailureResponse response) {
      completer.completeError(
        PaymentException(response.message ?? 'Payment was declined or failed.'),
      );
    });

    razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, (ExternalWalletResponse response) {
      completer.completeError(
        PaymentException('External wallets are not supported. Please use UPI or card.'),
      );
    });

    razorpay.open({
      'key': keyId,
      'amount': amountPaise,
      'order_id': razorpayOrderId,
      'name': 'Thakur Bites',
      'description': 'Campus Canteen Order',
      'theme': {'color': '#1A1A2E'},
      'prefill': {
        'name': studentName,
        'email': studentEmail,
      },
      'notes': {
        'order_id': razorpayOrderId,
      },
    });

    try {
      return await completer.future;
    } finally {
      razorpay.clear();
    }
  }
}

/// Wraps Razorpay callback-based API into a Dart Future.
class _PaymentCompleter {
  final _inner = Completer<Map<String, dynamic>>();

  Future<Map<String, dynamic>> get future => _inner.future;

  void complete(Map<String, dynamic> value) {
    if (!_inner.isCompleted) _inner.complete(value);
  }

  void completeError(Object error) {
    if (!_inner.isCompleted) _inner.completeError(error);
  }
}

/// Thrown when a payment operation fails.
class PaymentException implements Exception {
  final String message;
  const PaymentException(this.message);

  @override
  String toString() => 'PaymentException: $message';
}
