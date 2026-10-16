// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:js' as js;

void requestPushPermission() {
  try {
    if (js.context.hasProperty('requestStudentPushPermission')) {
      js.context.callMethod('requestStudentPushPermission');
    }
  } catch (_) {}
}

bool sendNativeSystemNotification(String title, String body, {String tag = 'tb-order-status'}) {
  try {
    if (js.context.hasProperty('sendStudentSystemNotification')) {
      final res = js.context.callMethod('sendStudentSystemNotification', [title, body, tag]);
      return res == true;
    }
  } catch (_) {}
  return false;
}
