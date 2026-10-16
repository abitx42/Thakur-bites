import 'web_push_adapter_stub.dart'
    if (dart.library.js) 'web_push_adapter_web.dart' as adapter;

void requestPushPermission() => adapter.requestPushPermission();

bool sendNativeSystemNotification(String title, String body, {String tag = 'tb-order-status'}) =>
    adapter.sendNativeSystemNotification(title, body, tag: tag);
