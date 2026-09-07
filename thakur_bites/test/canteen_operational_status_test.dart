import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/canteen_operational_status.dart';
import 'package:thakur_bites/services/checkout_service.dart';

void main() {
  group('CanteenOperationalStatus Unit Tests', () {
    test('Default normal status allows ordering without banners', () {
      final status = CanteenOperationalStatus.normal();
      expect(status.mode, equals('NORMAL'));
      expect(status.orderingAvailable, isTrue);
      expect(status.isNormal, isTrue);
      expect(status.isDegraded, isFalse);
      expect(status.isHalted, isFalse);
      expect(status.isFrozen, isFalse);
    });

    test('DEGRADED status provides polite counter messaging and paused button text', () {
      final status = CanteenOperationalStatus.fromMap({
        'mode': 'DEGRADED',
        'orderingAvailable': false,
        'reason': 'Heavy kitchen counter rush',
      });

      expect(status.isNormal, isFalse);
      expect(status.isDegraded, isTrue);
      expect(status.isHalted, isFalse);
      expect(status.isFrozen, isFalse);

      expect(status.bannerTitle, contains('Online Ordering Paused'));
      expect(status.bannerMessage, contains('Sorry for the inconvenience'));
      expect(status.bannerMessage.toLowerCase(), contains('counter'));

      expect(status.buttonText, equals('Online orders paused · Counter orders only'));
      expect(status.modalTitle, equals('Online Ordering Paused'));
      expect(status.modalDescription, contains('Sorry for the inconvenience'));
      expect(status.modalDescription, contains('counter'));
    });

    test('EMERGENCY_HALT status provides polite closed notice', () {
      final status = CanteenOperationalStatus.fromMap({
        'mode': 'EMERGENCY_HALT',
        'orderingAvailable': false,
      });

      expect(status.isNormal, isFalse);
      expect(status.isHalted, isTrue);
      expect(status.bannerTitle, contains('Canteen Temporarily Closed'));
      expect(status.buttonText, contains('Canteen temporarily closed'));
      expect(status.modalDescription, contains('Sorry for the inconvenience'));
    });

    test('FINANCIAL_FROZEN status directs to counter during maintenance', () {
      final status = CanteenOperationalStatus.fromMap({
        'mode': 'FINANCIAL_FROZEN',
        'orderingAvailable': false,
      });

      expect(status.isNormal, isFalse);
      expect(status.isFrozen, isTrue);
      expect(status.bannerTitle, contains('Checkout Temporarily Paused'));
      expect(status.buttonText, contains('Checkout paused'));
    });

    test('CanteenPausedException formats user-facing apology string', () {
      const ex = CanteenPausedException(
        'Sorry for the inconvenience! The canteen has temporarily paused accepting online orders.',
        mode: 'DEGRADED',
      );

      expect(ex.mode, equals('DEGRADED'));
      expect(ex.toString(), contains('Sorry for the inconvenience'));
    });
  });
}
