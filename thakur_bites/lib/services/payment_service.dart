import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'functions_service.dart';
import 'payment_web_adapter.dart';

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

/// Gateway UI is launched only for a complete, server-bound payment session.
/// A gateway callback is never treated as server payment verification.
class PaymentService {
  final FunctionsService _functions;
  final FirebaseAuth _auth;
  final FirebaseFirestore _db;

  PaymentService({FunctionsService? functions, FirebaseAuth? auth, FirebaseFirestore? firestore})
      : _functions = functions ?? FunctionsService(),
        _auth = auth ?? FirebaseAuth.instance,
        _db = firestore ?? FirebaseFirestore.instance;

  int _validatedAmountPaise(double totalAmountRs) {
    final rawPaise = totalAmountRs * 100;
    if (!totalAmountRs.isFinite || !rawPaise.isFinite || rawPaise <= 0 || rawPaise > 9007199254740991) {
      throw const PaymentException('A positive, finite payment amount is required.');
    }
    final paise = rawPaise.round();
    if (paise <= 0 || (rawPaise - paise).abs() > 0.000001) {
      throw const PaymentException('The payment amount must be an exact number of paise.');
    }
    return paise;
  }

  bool _validOrderId(String orderId) => orderId.isNotEmpty && orderId.length <= 128
      && orderId.trim() == orderId && orderId != '.' && orderId != '..'
      && !RegExp(r'[/\x00-\x1f\x7f]').hasMatch(orderId);

  void _assertActivePayment(String uid, int generation) {
    if (generation != _paymentGeneration || _auth.currentUser?.uid != uid) {
      throw const PaymentException('This payment session was cancelled or your sign-in changed. Check the existing order before retrying.');
    }
  }

  /// Initiates an online payment for a server-reserved, unpaid online order.
  ///
  /// Returns a [PaymentResult] after the full payment flow completes.
  /// Throws [PaymentException] on any failure or cancellation.
  Future<PaymentResult> initiateOnlinePayment({
    required String orderId,
    required double totalAmountRs,
    required String studentName,
    required String studentEmail,
  }) async {
    final amountPaise = _validatedAmountPaise(totalAmountRs);
    final user = _auth.currentUser;
    if (!_validOrderId(orderId) || user == null || user.isAnonymous) {
      throw const PaymentException('Sign in with your account and select a valid order before paying.');
    }
    final uid = user.uid;
    cancelActivePayment('A new payment session was started.');
    final generation = _paymentGeneration;
    var phase = 'session';
    try {
      final sessionData = await _functions.createPaymentSession(orderId: orderId);
      _assertActivePayment(uid, generation);
      final razorpayOrderId = sessionData['gatewayOrderId'];
      final keyId = sessionData['keyId'];
      final sessionPaise = sessionData['amountPaise'];
      final sessionAmount = sessionData['amount'];
      final currency = sessionData['currency'];
      final notes = sessionData['notes'];
      if (sessionData['success'] == false || sessionData['orderId'] != orderId
          || razorpayOrderId is! String || !RegExp(r'^order_[A-Za-z0-9]{1,58}$').hasMatch(razorpayOrderId)
          || (sessionData['razorpayOrderId'] != null && sessionData['razorpayOrderId'] != razorpayOrderId)
          || keyId is! String || !RegExp(r'^rzp_(test|live)_[A-Za-z0-9]{1,100}$').hasMatch(keyId)
          || sessionPaise is! int || sessionPaise != amountPaise
          || sessionAmount is! num || !sessionAmount.isFinite || sessionAmount != amountPaise / 100.0
          || currency != 'INR' || sessionData['adapterMode'] != 'PRODUCTION_GATEWAY'
          || notes is! Map || notes['orderId'] != orderId || notes['studentId'] != uid) {
        throw const PaymentException('The server did not return a complete, matching payment session. Checkout was not opened.');
      }
      phase = 'gateway';
      final paymentDetails = await _launchRazorpayCheckout(
        orderId: orderId,
        razorpayOrderId: razorpayOrderId,
        amountPaise: sessionPaise,
        currency: currency as String,
        keyId: keyId,
        studentName: studentName,
        studentEmail: studentEmail,
      );
      _assertActivePayment(uid, generation);
      final paymentId = paymentDetails['razorpay_payment_id'];
      final confirmedOrderId = paymentDetails['razorpay_order_id'];
      final signature = paymentDetails['razorpay_signature'];
      if (paymentId is! String || !RegExp(r'^pay_[A-Za-z0-9]{1,60}$').hasMatch(paymentId)
          || confirmedOrderId != razorpayOrderId
          || signature is! String || !RegExp(r'^[a-fA-F0-9]{64}$').hasMatch(signature)) {
        throw const PaymentException('The gateway response is incomplete or does not match this session. Check the existing order before paying again.');
      }
      phase = 'verification';
      final verified = await _functions.verifyPayment(
        orderId: orderId,
        razorpayPaymentId: paymentId,
        razorpayOrderId: razorpayOrderId,
        razorpaySignature: signature,
      );
      _assertActivePayment(uid, generation);
      // The real finalizer also returns success for orphaned captures on closed
      // orders. Those receipts are not successful customer order confirmations.
      if (verified['success'] != true || verified['orderId'] != orderId
          || verified['amountPaise'] is! int || verified['amountPaise'] != amountPaise
          || verified['alreadyCaptured'] is! bool || verified['orphaned'] == true
          || (verified['orphaned'] != null && verified['orphaned'] is! bool)
          || verified['tokenNumber'] is! String || (verified['tokenNumber'] as String).isEmpty
          || !const ['confirmed', 'ready'].contains(verified['status'])
          || (verified['currency'] != null && verified['currency'] != currency)) {
        throw const PaymentException('The server did not confirm a paid, active order. Check the existing order and any refund before paying again.');
      }
      return PaymentResult(
        isSuccess: true,
        orderId: orderId,
        amount: amountPaise / 100.0,
        method: PaymentMethod.razorpayOnline,
        paymentId: paymentId,
      );
    } on FirebaseFunctionsException catch (e) {
      throw PaymentException(phase == 'verification'
          ? 'The server could not verify this payment (${e.code}). Check the existing order before paying again.'
          : 'The server could not create a payment session (${e.code}). Please retry.');
    } on PaymentException {
      rethrow;
    } catch (_) {
      throw PaymentException(phase == 'session'
          ? 'Unable to confirm a server payment session. Checkout was not opened. Please retry.'
          : 'Payment completion could not be confirmed. Check the existing order before paying again.');
    }
  }

  /// Records a cash payment for a counter_cash order.
  /// Should only be called from Cashier interface — requires cashier role.
  Future<PaymentResult> recordCashPayment({
    required String orderId,
    required double totalAmountRs,
  }) async {
    final now = DateTime.now();
    try {
      final amountPaise = _validatedAmountPaise(totalAmountRs);
      final uid = _auth.currentUser?.uid;
      if (uid == null || !_validOrderId(orderId)) {
        throw const PaymentException('An authorized sign-in and valid order are required.');
      }
      final result = await _functions.recordCashPayment(
        orderId: orderId,
        amountPaise: amountPaise,
      );
      if (_auth.currentUser?.uid != uid || result['success'] != true || result['orderId'] != orderId
          || result['orphaned'] == true
          || !const ['confirmed', 'placed', 'preparing', 'ready', 'collected'].contains(result['status'])) {
        throw const PaymentException('The server did not confirm cash settlement. Check the existing order before retrying.');
      }
      // The idempotent cash response omits amount/paymentId. Read the committed
      // order rather than inventing either value or treating a partial map as paid.
      final snap = await _db.collection('orders').doc(orderId).get(const GetOptions(source: Source.server));
      final data = snap.data();
      if (_auth.currentUser?.uid != uid || !snap.exists || data == null
          || snap.metadata.isFromCache || snap.metadata.hasPendingWrites
          || data['paymentMethod'] != 'counter_cash' || data['currency'] != 'INR'
          || data['totalAmountPaise'] is! int || data['totalAmountPaise'] != amountPaise
          || !const ['paid', 'captured'].contains(data['paymentStatus'])
          || !const ['confirmed', 'placed', 'preparing', 'ready', 'collected'].contains(data['status'])
          || data['gatewayPaymentId'] is! String || (data['gatewayPaymentId'] as String).isEmpty) {
        throw const PaymentException('Cash payment is not confirmed by the server. Check the existing order before retrying.');
      }
      return PaymentResult(
        isSuccess: true,
        orderId: orderId,
        amount: amountPaise / 100.0,
        method: PaymentMethod.cashAtCounter,
        paymentId: data['gatewayPaymentId'] as String,
        timestamp: now,
      );
    } on FirebaseFunctionsException catch (e) {
      // F-017 Remediation: Never fall back to direct Firestore writes for cash payments.
      // The Cloud Function is the ONLY authoritative path — it handles:
      //   • Payment verification & financial ledger posting
      //   • Inventory reservation commitment
      //   • Audit trail (orderEvents) creation
      return PaymentResult(
        isSuccess: false,
        orderId: orderId,
        amount: totalAmountRs,
        method: PaymentMethod.cashAtCounter,
        errorMessage: e.code == 'unavailable'
            ? 'Server is temporarily unavailable. Please retry in a moment.'
            : (e.message ?? 'Cash payment recording failed. Please retry.'),
        timestamp: now,
      );
    } catch (e) {
      // F-017 Remediation: Generic errors also must NOT bypass server authority.
      return PaymentResult(
        isSuccess: false,
        orderId: orderId,
        amount: totalAmountRs,
        method: PaymentMethod.cashAtCounter,
        errorMessage: e is PaymentException ? e.message : 'Cash payment recording was not confirmed. Check the order or contact a manager.',
        timestamp: now,
      );
    }
  }

  static _PaymentCompleter? _activeCompleter;
  static Razorpay? _activeRazorpay;
  static int _paymentGeneration = 0;

  /// Cancels any currently pending in-app payment session (e.g. if user returned from external UPI app and wishes to cancel or retry)
  static void cancelActivePayment([String reason = 'Payment session was cancelled.']) {
    ++_paymentGeneration;
    try {
      _activeRazorpay?.clear();
    } catch (_) {}
    if (_activeCompleter != null && !_activeCompleter!.isCompleted) {
      _activeCompleter!.completeError(PaymentException(reason));
    }
    _activeCompleter = null;
    _activeRazorpay = null;
  }

  // ─── Private: Razorpay SDK Launch ────────────────────────────────────────

  /// Launches the Razorpay checkout and waits for payment success or failure.
  /// Returns the raw payment details map on success.
  /// Throws [PaymentException] on failure or user cancellation.
  Future<Map<String, dynamic>> _launchRazorpayCheckout({
    required String orderId,
    required String razorpayOrderId,
    required int amountPaise,
    required String currency,
    required String keyId,
    required String studentName,
    required String studentEmail,
  }) async {
    final options = <String, dynamic>{
      'key': keyId,
      'amount': amountPaise,
      'currency': currency,
      'order_id': razorpayOrderId,
      'name': 'Thakur Bites',
      'description': 'Campus Canteen Order',
      'theme': {'color': '#1A1A2E'},
      'prefill': {
        'name': studentName,
        'email': studentEmail,
      },
      'notes': {
        'order_id': orderId,
        'gateway_order_id': razorpayOrderId,
      },
    };

    // On Flutter Web, use official JS checkout bridge (checkout.js)
    if (kIsWeb) {
      return await launchRazorpayWebCheckout(options: options).timeout(
        const Duration(minutes: 5),
        onTimeout: () => throw const PaymentException('Payment session timed out. Check the order before retrying.'),
      );
    }

    // On native mobile (Android / iOS), invoke native Razorpay Flutter plugin
    final completer = _PaymentCompleter();
    _activeCompleter = completer;
    final razorpay = Razorpay();
    _activeRazorpay = razorpay;

    razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, (PaymentSuccessResponse response) {
      completer.complete({
        'razorpay_payment_id': response.paymentId ?? '',
        'razorpay_order_id': response.orderId ?? '',
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
        const PaymentException('External wallets are not supported. Please use UPI or card.'),
      );
    });

    try {
      razorpay.open(options);
      return await completer.future.timeout(
        const Duration(minutes: 5),
        onTimeout: () => throw const PaymentException('Payment session timed out. Please retry.'),
      );
    } finally {
      razorpay.clear();
      if (_activeCompleter == completer) {
        _activeCompleter = null;
      }
      if (_activeRazorpay == razorpay) {
        _activeRazorpay = null;
      }
    }
  }
}

/// Wraps Razorpay callback-based API into a Dart Future.
class _PaymentCompleter {
  final _inner = Completer<Map<String, dynamic>>();

  Future<Map<String, dynamic>> get future => _inner.future;
  bool get isCompleted => _inner.isCompleted;

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
