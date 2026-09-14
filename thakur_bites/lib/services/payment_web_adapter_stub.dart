import 'payment_service.dart';

/// Stub implementation of [launchRazorpayWebCheckout] for non-web platforms.
Future<Map<String, dynamic>> launchRazorpayWebCheckout({
  required Map<String, dynamic> options,
}) async {
  throw const PaymentException('Web checkout is only supported on Web platform.');
}
