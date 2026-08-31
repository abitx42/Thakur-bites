import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/services/eta_service.dart';

void main() {
  group('EtaService Dynamic Wait & Rush Mode Tests', () {
    test('Calculates baseline ETA with zero queue', () {
      final eta = EtaService.calculateDynamicEta(
        baseEstimatedMinutes: 5,
        activeKitchenOrders: 0,
        isRushMode: false,
      );
      expect(eta, equals(5));
    });

    test('Scales ETA dynamically with active kitchen orders', () {
      // 5 min base + (4 orders * 1.5 min = 6 min) = 11 min
      final eta = EtaService.calculateDynamicEta(
        baseEstimatedMinutes: 5,
        activeKitchenOrders: 4,
        isRushMode: false,
      );
      expect(eta, equals(11));
    });

    test('Applies Rush Mode multiplier during lunch peak', () {
      // (5 min base + 4*1.5 = 11 min) * 1.25 = 13.75 -> 14 min
      final eta = EtaService.calculateDynamicEta(
        baseEstimatedMinutes: 5,
        activeKitchenOrders: 4,
        isRushMode: true,
      );
      expect(eta, equals(14));
    });

    test('Bounds ETA within safe boundary limits (3 to 45 min)', () {
      final minEta = EtaService.calculateDynamicEta(
        baseEstimatedMinutes: 1,
        activeKitchenOrders: 0,
      );
      expect(minEta, equals(3));

      final maxEta = EtaService.calculateDynamicEta(
        baseEstimatedMinutes: 30,
        activeKitchenOrders: 50,
      );
      expect(maxEta, equals(45));
    });

    test('Returns friendly user-facing labels', () {
      expect(EtaService.getWaitTimeLabel(4), contains('Fast Pickup'));
      expect(EtaService.getWaitTimeLabel(12), contains('Normal Queue'));
      expect(EtaService.getWaitTimeLabel(25), contains('High Demand'));
      expect(EtaService.getWaitTimeLabel(15, isRushMode: true), contains('Rush Hour'));
    });
  });
}
