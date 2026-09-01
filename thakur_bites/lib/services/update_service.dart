import 'package:flutter/foundation.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/app_version.dart';

class UpdateService extends ChangeNotifier {
  static final UpdateService _instance = UpdateService._internal();
  factory UpdateService() => _instance;
  UpdateService._internal();

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  // The authoritative embedded client version constant for this binary
  static const String currentAppVersion = '1.0.0';

  AppVersionPolicy? _currentPolicy;
  UpdateStatus _status = UpdateStatus.upToDate;
  bool _isChecking = false;

  AppVersionPolicy? get currentPolicy => _currentPolicy;
  UpdateStatus get status => _status;
  bool get isChecking => _isChecking;

  String get currentPlatform {
    if (kIsWeb) return 'web';
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'android';
      case TargetPlatform.iOS:
        return 'ios';
      default:
        return 'web';
    }
  }

  /// Checks the Firestore version registry for the current platform.
  Future<UpdateStatus> checkForUpdates({String? overrideVersion}) async {
    _isChecking = true;
    notifyListeners();

    final installedVersion = overrideVersion ?? currentAppVersion;

    try {
      final docSnap = await _firestore
          .collection('appConfig')
          .doc('versions')
          .collection('platforms')
          .doc(currentPlatform)
          .get();

      if (docSnap.exists && docSnap.data() != null) {
        _currentPolicy = AppVersionPolicy.fromMap(docSnap.data()!);
      } else {
        // Check global fallback document at appConfig/versions
        final globalSnap = await _firestore.collection('appConfig').doc('versions').get();
        if (globalSnap.exists && globalSnap.data() != null) {
          _currentPolicy = AppVersionPolicy.fromMap(globalSnap.data()!);
        } else {
          // Default baseline policy if unconfigured
          _currentPolicy = const AppVersionPolicy(
            latestVersion: '1.0.0',
            minimumSupportedVersion: '1.0.0',
            forceUpdate: false,
          );
        }
      }

      _status = _currentPolicy!.evaluate(installedVersion);
    } catch (e) {
      debugPrint('[UpdateService] Failed to check for updates: $e');
      _status = UpdateStatus.upToDate;
    } finally {
      _isChecking = false;
      notifyListeners();
    }

    return _status;
  }

  /// Listens to real-time version policy updates from Firestore.
  Stream<UpdateStatus> listenToVersionPolicy({String? overrideVersion}) {
    final installedVersion = overrideVersion ?? currentAppVersion;

    return _firestore
        .collection('appConfig')
        .doc('versions')
        .snapshots()
        .map((snap) {
      if (snap.exists && snap.data() != null) {
        _currentPolicy = AppVersionPolicy.fromMap(snap.data()!);
      } else {
        _currentPolicy = const AppVersionPolicy(
          latestVersion: '1.0.0',
          minimumSupportedVersion: '1.0.0',
          forceUpdate: false,
        );
      }
      _status = _currentPolicy!.evaluate(installedVersion);
      notifyListeners();
      return _status;
    });
  }
}
