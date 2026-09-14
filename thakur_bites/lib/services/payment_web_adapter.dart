import 'payment_web_adapter_stub.dart'
    if (dart.library.js) 'payment_web_adapter_web.dart' as adapter;

/// Dispatches web checkout to the JS adapter on Web, or throws UnsupportedError on native.
Future<Map<String, dynamic>> launchRazorpayWebCheckout({
  required Map<String, dynamic> options,
}) =>
    adapter.launchRazorpayWebCheckout(options: options);
