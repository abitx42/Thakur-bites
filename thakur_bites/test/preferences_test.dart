import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/user_preferences.dart';

void main() {
  group('UserPreferences & Dietary Settings Unit Tests', () {
    test('NotificationSettings defaults are enabled for order updates', () {
      const settings = NotificationSettings();
      expect(settings.orderConfirmed, isTrue);
      expect(settings.orderPreparing, isTrue);
      expect(settings.orderReady, isTrue);
      expect(settings.orderCollected, isTrue);
      expect(settings.dailySpecials, isTrue);
      expect(settings.rushHourAlerts, isFalse);
    });

    test('DietaryPreferences maps to Firestore map properly', () {
      const dietary = DietaryPreferences(
        lessSpicy: true,
        lessSugar: true,
        noCutlery: true,
        jainAvailableOnly: false,
        customNotes: 'Extra crispy',
      );

      final map = dietary.toMap();
      expect(map['lessSpicy'], isTrue);
      expect(map['lessSugar'], isTrue);
      expect(map['noCutlery'], isTrue);
      expect(map['jainAvailableOnly'], isFalse);
      expect(map['customNotes'], equals('Extra crispy'));

      final reconstructed = DietaryPreferences.fromMap(map);
      expect(reconstructed.lessSpicy, isTrue);
      expect(reconstructed.customNotes, equals('Extra crispy'));
    });

    test('UserPreferences copyWith produces updated instances safely', () {
      final prefs = UserPreferences(
        uid: 'user_123',
        dietary: const DietaryPreferences(lessSpicy: false),
      );

      final updated = UserPreferences(
        uid: prefs.uid,
        dietary: prefs.dietary.copyWith(lessSpicy: true),
      );

      expect(updated.uid, equals('user_123'));
      expect(updated.dietary.lessSpicy, isTrue);
    });
  });
}
