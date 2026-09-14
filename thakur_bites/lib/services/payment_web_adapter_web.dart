// ignore: avoid_web_libraries_in_flutter
import 'dart:async';
// ignore: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:js' as js;
import 'payment_service.dart';

/// Web implementation of Razorpay checkout using the official checkout.js script.
Future<Map<String, dynamic>> launchRazorpayWebCheckout({
  required Map<String, dynamic> options,
}) async {
  final completer = Completer<Map<String, dynamic>>();

  if (!js.context.hasProperty('openRazorpayCheckout')) {
    throw const PaymentException(
      'Payment checkout script is not loaded. Please refresh the page or check your connection/ad-blocker.',
    );
  }

  final jsOptions = js.JsObject.jsify(options);

  final successCb = js.JsFunction.withThis((_, paymentId, orderId, signature) {
    if (!completer.isCompleted) {
      completer.complete({
        'razorpay_payment_id': paymentId?.toString() ?? '',
        'razorpay_order_id': orderId?.toString() ?? '',
        'razorpay_signature': signature?.toString() ?? '',
      });
    }
  });

  final failureCb = js.JsFunction.withThis((_, errorMsg) {
    if (!completer.isCompleted) {
      completer.completeError(
        PaymentException(errorMsg?.toString() ?? 'Payment was cancelled or failed.'),
      );
    }
  });

  try {
    js.context.callMethod('openRazorpayCheckout', [jsOptions, successCb, failureCb]);
  } catch (e) {
    if (!completer.isCompleted) {
      completer.completeError(PaymentException('Failed to launch web checkout: $e'));
    }
  }

  return completer.future;
}
