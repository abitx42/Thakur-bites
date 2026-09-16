import 'dart:async';
import 'package:flutter/services.dart';

/// Service protecting sensitive campus credentials (pickup PINs, security tokens)
/// from indefinite residency in the system clipboard or sniffing by background applications.
class ClipboardSecurityService {
  static Timer? _wipeTimer;
  static String? _lastCopiedSensitiveText;

  /// Copies sensitive text to the clipboard and starts an automatic erasure countdown
  /// (default: 30 seconds). If the clipboard still contains this exact text when the
  /// timer expires, it is overwritten with empty string.
  static Future<void> copySensitiveText(
    String text, {
    Duration autoClearDuration = const Duration(seconds: 30),
    VoidCallback? onAutoCleared,
  }) async {
    if (text.isEmpty) return;

    _wipeTimer?.cancel();
    _lastCopiedSensitiveText = text;

    await Clipboard.setData(ClipboardData(text: text));

    _wipeTimer = Timer(autoClearDuration, () async {
      try {
        final currentClip = await Clipboard.getData(Clipboard.kTextPlain);
        if (currentClip?.text == _lastCopiedSensitiveText) {
          await Clipboard.setData(const ClipboardData(text: ''));
          onAutoCleared?.call();
        }
      } catch (_) {}
      _wipeTimer = null;
      _lastCopiedSensitiveText = null;
    });
  }

  /// Explicitly cancels any active auto-wipe timer
  static void cancelAutoClear() {
    _wipeTimer?.cancel();
    _wipeTimer = null;
    _lastCopiedSensitiveText = null;
  }
}
