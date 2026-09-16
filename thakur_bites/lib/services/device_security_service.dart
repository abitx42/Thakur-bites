import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:cloud_functions/cloud_functions.dart';

enum DeviceSecurityViolation {
  none,
  devOptionsActive,
  adbActive,
  rooted,
  tamperedSignature,
}

class DeviceSecurityService extends ChangeNotifier {
  static const MethodChannel _channel = MethodChannel('com.thakurbites.security/device_integrity');

  static final DeviceSecurityService _instance = DeviceSecurityService._internal();
  factory DeviceSecurityService() => _instance;
  DeviceSecurityService._internal();

  Timer? _heartbeatTimer;
  bool _isChecking = false;
  bool _isDevOptionsEnabled = false;
  bool _isAdbEnabled = false;
  bool _isRooted = false;
  bool _isHooked = false;
  bool _isDebuggerAttached = false;
  bool _isClonedOrSandboxed = false;
  bool _isEmulator = false;
  String _signatureHash = '';
  String _deviceId = '';
  bool _hasReportedViolation = false;

  bool get isChecking => _isChecking;
  bool get isDevOptionsEnabled => _isDevOptionsEnabled;
  bool get isAdbEnabled => _isAdbEnabled;
  bool get isRooted => _isRooted;
  bool get isHooked => _isHooked;
  bool get isDebuggerAttached => _isDebuggerAttached;
  bool get isClonedOrSandboxed => _isClonedOrSandboxed;
  bool get isEmulator => _isEmulator;
  String get signatureHash => _signatureHash;
  String get deviceId => _deviceId;

  /// In production release mode, active Developer Options or USB Debugging blocks the ordering flow.
  /// In debug mode (kDebugMode), this policy is bypassed to avoid blocking developers.
  bool get isDeveloperModeBlocked {
    if (kDebugMode || kIsWeb) return false;
    return _isDevOptionsEnabled || _isAdbEnabled;
  }

  /// Detects unauthorized APK repackaging or modding via invalid certificate digests
  bool get isTamperedSignature {
    if (kDebugMode || kIsWeb) return false;
    return _signatureHash.isEmpty || _signatureHash == 'UNSIGNED' || _signatureHash.startsWith('ERROR_');
  }

  /// Critical tampering (root exploit detected, Frida dynamic hooking, debugger attachment, sandboxed clone, or APK modding)
  bool get isCriticalTamperDetected {
    if (kDebugMode || kIsWeb) return false;
    return _isRooted || _isHooked || _isDebuggerAttached || _isClonedOrSandboxed || isTamperedSignature;
  }

  /// Starts periodic background heartbeat monitoring (every 5 seconds) to catch runtime Frida injection or debugger attachments
  void startContinuousMonitoring({Duration interval = const Duration(seconds: 5)}) {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(interval, (_) {
      checkSecurityPosture(silent: true);
    });
  }

  /// Stops periodic background heartbeat monitoring
  void stopContinuousMonitoring() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
  }

  @override
  void dispose() {
    stopContinuousMonitoring();
    super.dispose();
  }

  /// Evaluates device security posture against native sentinel
  Future<void> checkSecurityPosture({bool silent = false}) async {
    if (kIsWeb) return;
    if (defaultTargetPlatform != TargetPlatform.android) return;

    if (!silent) {
      _isChecking = true;
      notifyListeners();
    }

    try {
      final prevCritical = isCriticalTamperDetected;
      final prevBlocked = isDeveloperModeBlocked;

      final result = await _channel.invokeMapMethod<String, dynamic>('getDeviceSecurityPosture');
      if (result != null) {
        _isDevOptionsEnabled = result['isDevOptionsEnabled'] == true;
        _isAdbEnabled = result['isAdbEnabled'] == true;
        _isRooted = result['isRooted'] == true;
        _isHooked = result['isHooked'] == true;
        _isDebuggerAttached = result['isDebuggerAttached'] == true;
        _isClonedOrSandboxed = result['isClonedOrSandboxed'] == true;
        _isEmulator = result['isEmulator'] == true;
        _signatureHash = result['signatureHash']?.toString() ?? '';
        _deviceId = result['deviceId']?.toString() ?? '';

        // If posture changed during heartbeat check, notify listeners to immediately display lockdown
        if (silent && (prevCritical != isCriticalTamperDetected || prevBlocked != isDeveloperModeBlocked)) {
          notifyListeners();
        }

        // Automatically report critical tampering once per session
        if (!_hasReportedViolation && isCriticalTamperDetected) {
          _hasReportedViolation = true;
          final violationType = _isHooked
              ? 'FRIDA_HOOK_DETECTED'
              : (_isDebuggerAttached
                  ? 'DEBUGGER_ATTACHED'
                  : (_isClonedOrSandboxed
                      ? 'CLONED_APP_DETECTED'
                      : (isTamperedSignature ? 'TAMPERED_APK_SIGNATURE' : 'ROOT_DETECTED')));
          await reportSecurityViolation(
            violationType: violationType,
            details: {
              'isRooted': _isRooted,
              'isHooked': _isHooked,
              'isDebuggerAttached': _isDebuggerAttached,
              'isClonedOrSandboxed': _isClonedOrSandboxed,
              'isEmulator': _isEmulator,
              'isTamperedSignature': isTamperedSignature,
              'signatureHash': _signatureHash,
              'deviceId': _deviceId,
            },
          );
        }
      }
    } catch (e) {
      debugPrint('[SecuritySentinel] Failed to query device posture: $e');
    } finally {
      if (!silent) {
        _isChecking = false;
        notifyListeners();
      }
    }
  }

  /// Launches native Android Developer Options settings so the user can easily toggle it off
  Future<bool> openDeveloperSettings() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return false;
    try {
      final success = await _channel.invokeMethod<bool>('openDeveloperSettings');
      return success ?? false;
    } catch (e) {
      debugPrint('[SecuritySentinel] Failed to open developer settings: $e');
      return false;
    }
  }

  /// Reports a verified security violation to the backend Cloud Function
  Future<void> reportSecurityViolation({
    required String violationType,
    Map<String, dynamic>? details,
  }) async {
    try {
      final callable = FirebaseFunctions.instance.httpsCallable('reportSecurityViolation');
      await callable.call({
        'violationType': violationType,
        'deviceId': _deviceId,
        'details': details ?? {},
      });
      debugPrint('[SecuritySentinel] Violation successfully reported: $violationType');
    } catch (e) {
      debugPrint('[SecuritySentinel] Violation reporting notice: $e');
    }
  }

  /// Validates outgoing client payloads against fuzzed parameters or honeytokens
  static bool isPayloadClean(Map<String, dynamic> payload) {
    const prohibited = {
      'debug',
      'debugmode',
      'bypassauth',
      'bypasspayment',
      'overrideprice',
      'testmode',
      'forcerole',
      '__proto__',
    };
    for (final key in payload.keys) {
      final normalized = key.toLowerCase().replaceAll(RegExp(r'[^a-z0-9_]'), '');
      if (prohibited.contains(normalized)) {
        return false;
      }
    }
    return true;
  }
}
