import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/app_version.dart';

void main() {
  group('AppVersion & Semantic Versioning Invariant Tests', () {
    test('1. Semantic version comparison correctly ranks versions', () {
      expect(AppVersionPolicy.compareSemver('1.0.0', '1.0.0'), 0);
      expect(AppVersionPolicy.compareSemver('1.0.0', '1.0.1'), -1);
      expect(AppVersionPolicy.compareSemver('1.1.0', '1.0.9'), 1);
      expect(AppVersionPolicy.compareSemver('2.0.0', '1.9.9'), 1);
      expect(AppVersionPolicy.compareSemver('1.2.3', '1.2.3+45'), 0);
      expect(AppVersionPolicy.compareSemver('1.2.3+1', '1.2.3+2'), 0);
      expect(AppVersionPolicy.compareSemver('1.2', '1.2.0'), 0);
    });

    test('2. Returns UpToDate when installed >= latest', () {
      const policy = AppVersionPolicy(
        latestVersion: '1.2.0',
        minimumSupportedVersion: '1.0.0',
        forceUpdate: false,
      );

      expect(policy.evaluate('1.2.0'), UpdateStatus.upToDate);
      expect(policy.evaluate('1.2.1'), UpdateStatus.upToDate);
      expect(policy.evaluate('1.3.0'), UpdateStatus.upToDate);
      expect(policy.evaluate('1.2.0+5'), UpdateStatus.upToDate);
    });

    test('3. Returns UpdateAvailable when minimum <= installed < latest', () {
      const policy = AppVersionPolicy(
        latestVersion: '1.3.0',
        minimumSupportedVersion: '1.1.0',
        forceUpdate: false,
        message: 'Bug fixes and performance improvements.',
      );

      expect(policy.evaluate('1.1.0'), UpdateStatus.updateAvailable);
      expect(policy.evaluate('1.2.0'), UpdateStatus.updateAvailable);
      expect(policy.evaluate('1.2.9'), UpdateStatus.updateAvailable);
    });

    test('4. Returns ForceUpdateRequired when installed < minimumSupported', () {
      const policy = AppVersionPolicy(
        latestVersion: '2.0.0',
        minimumSupportedVersion: '1.5.0',
        forceUpdate: false,
      );

      expect(policy.evaluate('1.0.0'), UpdateStatus.forceUpdateRequired);
      expect(policy.evaluate('1.4.9'), UpdateStatus.forceUpdateRequired);
      expect(policy.evaluate('0.9.0'), UpdateStatus.forceUpdateRequired);
    });

    test('5. Returns ForceUpdateRequired when emergency forceUpdate flag is true', () {
      const policy = AppVersionPolicy(
        latestVersion: '1.0.0',
        minimumSupportedVersion: '1.0.0',
        forceUpdate: true,
        message: 'Critical emergency maintenance in progress.',
      );

      expect(policy.evaluate('1.0.0'), UpdateStatus.forceUpdateRequired);
      expect(policy.evaluate('2.0.0'), UpdateStatus.forceUpdateRequired);
    });

    test('6. Parses AppVersionPolicy from Firestore map with release notes', () {
      final map = {
        'latestVersion': '1.4.0',
        'minimumSupportedVersion': '1.2.0',
        'forceUpdate': false,
        'message': 'Exciting new features available!',
        'releaseNotes': [
          'Instant QR pickup scanner',
          'Faculty priority queue optimizations',
          'Security hardening',
        ],
        'storeUrl': 'https://play.google.com/store/apps/details?id=com.tcet.thakurbites',
      };

      final policy = AppVersionPolicy.fromMap(map);
      expect(policy.latestVersion, '1.4.0');
      expect(policy.minimumSupportedVersion, '1.2.0');
      expect(policy.releaseNotes.length, 3);
      expect(policy.releaseNotes[0], 'Instant QR pickup scanner');
      expect(policy.storeUrl, contains('com.tcet.thakurbites'));
    });
  });
}
