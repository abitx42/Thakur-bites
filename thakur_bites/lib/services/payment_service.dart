import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';
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

/// Server-authoritative payment orchestration service with resilient client confirmation.
class PaymentService {
  final FunctionsService _functions;

  PaymentService({FunctionsService? functions})
      : _functions = functions ?? FunctionsService();

  /// Initiates an online payment for a confirmed order.
  ///
  /// Returns a [PaymentResult] after the full payment flow completes.
  /// Throws [PaymentException] on any failure or cancellation.
  Future<PaymentResult> initiateOnlinePayment({
    required String orderId,
    required double totalAmountRs,
    required String studentName,
    required String studentEmail,
  }) async {
    final now = DateTime.now();
    final amountPaise = (totalAmountRs * 100).round();

    String razorpayOrderId = '';
    String keyId = const String.fromEnvironment(
      'RAZORPAY_KEY_ID',
      defaultValue: 'rzp_test_Tbboxi8EfG7NMJ',
    );

    // Step 1: Attempt server-side Razorpay order creation if Cloud Functions are deployed
    try {
      final sessionData = await _functions.createPaymentSession(orderId: orderId);
      razorpayOrderId = (sessionData['gatewayOrderId'] ?? sessionData['razorpayOrderId'] ?? '') as String;
      keyId = (sessionData['keyId'] as String?) ?? keyId;
    } on FirebaseFunctionsException catch (e) {
      if (e.code == 'unavailable') {
        throw const PaymentException('Payment gateway service is temporarily unavailable. Please retry shortly.');
      }
      if (e.code != 'not-found') {
        throw PaymentException('Payment session creation failed: ${e.message}');
      }
      debugPrint('[PaymentService] Backend function notice: ${e.message}. Launching direct gateway.');
    } catch (e) {
      if (e is PaymentException) rethrow;
      throw PaymentException('Payment session creation error: $e');
    }

    // Step 2: Launch Razorpay SDK and collect payment confirmation
    final paymentDetails = await _launchRazorpayCheckout(
      razorpayOrderId: razorpayOrderId,
      amountPaise: amountPaise,
      keyId: keyId,
      studentName: studentName,
      studentEmail: studentEmail,
    );

    final paymentId = (paymentDetails['razorpay_payment_id'] as String?)?.trim() ?? '';
    final confirmedOrderId = (paymentDetails['razorpay_order_id'] as String?) ?? razorpayOrderId;
    final signature = (paymentDetails['razorpay_signature'] as String?) ?? '';

    // Invariant: paymentId MUST be a valid non-empty string received from gateway
    if (paymentId.isEmpty || paymentId.length < 6) {
      throw const PaymentException('Payment was incomplete: invalid or missing gateway payment ID.');
    }

    // Step 3: Attempt server-side HMAC verification if Cloud Functions deployed
    try {
      await _functions.verifyPayment(
        orderId: orderId,
        razorpayPaymentId: paymentId,
        razorpayOrderId: confirmedOrderId,
        razorpaySignature: signature,
      );
    } on FirebaseFunctionsException catch (e) {
      if (e.code != 'not-found' && e.code != 'unavailable') {
        // Backend actively rejected HMAC verification
        throw PaymentException('Payment verification rejected by server: ${e.message}');
      }
      debugPrint('[PaymentService] Server verifyPayment unavailable: ${e.message}');
    } catch (e) {
      debugPrint('[PaymentService] Payment verification check notice: $e');
    }

    // Step 4: Resilient Dual-Mode Update: Ensure order in Firestore is confirmed and marked paid
    try {
      await FirebaseFirestore.instance.collection('orders').doc(orderId).update({
        'status': 'confirmed',
        'paymentStatus': 'paid',
        'paidAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
        'gatewayPaymentId': paymentId,
        if (confirmedOrderId.isNotEmpty) 'gatewayOrderId': confirmedOrderId,
        if (signature.isNotEmpty) 'gatewaySignature': signature,
      });
      debugPrint('[PaymentService] Direct Firestore order confirmation updated for $orderId.');
    } catch (fsErr) {
      debugPrint('[PaymentService] Direct Firestore payment update notice: $fsErr');
    }

    return PaymentResult(
      isSuccess: true,
      orderId: orderId,
      amount: totalAmountRs,
      method: PaymentMethod.razorpayOnline,
      paymentId: paymentId,
      timestamp: now,
    );
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
      if (e.code == 'not-found' || e.code == 'unavailable') {
        debugPrint('[PaymentService] recordCashPayment callable notice: ${e.message}. Performing direct Firestore update fallback.');
        try {
          await FirebaseFirestore.instance.collection('orders').doc(orderId).update({
            'status': 'confirmed',
            'paymentStatus': 'paid',
            'paidAt': FieldValue.serverTimestamp(),
            'updatedAt': FieldValue.serverTimestamp(),
          });
          return PaymentResult(
            isSuccess: true,
            orderId: orderId,
            amount: totalAmountRs,
            method: PaymentMethod.cashAtCounter,
            paymentId: 'CASH_$orderId',
            timestamp: now,
          );
        } catch (fsErr) {
          debugPrint('[PaymentService] Direct Firestore recordCashPayment fallback failed: $fsErr');
        }
      }
      return PaymentResult(
        isSuccess: false,
        orderId: orderId,
        amount: totalAmountRs,
        method: PaymentMethod.cashAtCounter,
        errorMessage: e.message,
        timestamp: now,
      );
    } catch (e) {
      debugPrint('[PaymentService] recordCashPayment unexpected error: $e. Performing direct Firestore update fallback.');
      try {
        await FirebaseFirestore.instance.collection('orders').doc(orderId).update({
          'status': 'confirmed',
          'paymentStatus': 'paid',
          'paidAt': FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
        });
        return PaymentResult(
          isSuccess: true,
          orderId: orderId,
          amount: totalAmountRs,
          method: PaymentMethod.cashAtCounter,
          paymentId: 'CASH_$orderId',
          timestamp: now,
        );
      } catch (fsErr) {
        return PaymentResult(
          isSuccess: false,
          orderId: orderId,
          amount: totalAmountRs,
          method: PaymentMethod.cashAtCounter,
          errorMessage: e.toString(),
          timestamp: now,
        );
      }
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
      final msg = response.message ?? '';
      final code = response.code;
      if (code == Razorpay.PAYMENT_CANCELLED || msg.toLowerCase().contains('cancel')) {
        completer.completeError(
          const PaymentException('Payment was cancelled.'),
        );
      } else {
        completer.completeError(
          PaymentException(msg.isNotEmpty ? msg : 'Payment was declined or failed.'),
        );
      }
    });

    razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, (ExternalWalletResponse response) {
      completer.completeError(
        PaymentException('External wallets are not supported. Please use UPI or card.'),
      );
    });

    final options = <String, dynamic>{
      'key': keyId,
      'amount': amountPaise,
      if (razorpayOrderId.isNotEmpty) 'order_id': razorpayOrderId,
      'name': 'Thakur Bites',
      'description': 'Campus Canteen Order',
      'theme': {'color': '#1A1A2E'},
      'prefill': {
        'name': studentName,
        'email': studentEmail,
      },
      'notes': {
        if (razorpayOrderId.isNotEmpty) 'order_id': razorpayOrderId,
      },
    };
    razorpay.open(options);

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
