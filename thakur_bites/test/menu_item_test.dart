import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/menu_item.dart';

void main() {
  group('MenuItem Model & Availability Tests', () {
    test('Cooked item availability calculation', () {
      final item = MenuItem(
        id: 'dosa_1',
        name: 'Masala Dosa',
        price: 50,
        category: 'dosa',
        type: 'cooked',
        prepMinutes: 6,
        available: true,
      );

      expect(item.isCooked, isTrue);
      expect(item.isInstant, isFalse);
      expect(item.isInStock, isTrue);
      expect(item.badgeText, '~6 min');
      expect(item.availabilityLevel, AvailabilityLevel.available);
    });

    test('Cooked item when marked out of stock', () {
      final item = MenuItem(
        id: 'dosa_1',
        name: 'Masala Dosa',
        price: 50,
        category: 'dosa',
        type: 'cooked',
        prepMinutes: 6,
        available: false,
      );

      expect(item.isInStock, isFalse);
      expect(item.badgeText, 'Sold out');
      expect(item.availabilityLevel, AvailabilityLevel.soldOut);
    });

    test('Instant store item with plentiful stock', () {
      final item = MenuItem(
        id: 'chips_1',
        name: 'Chips',
        price: 20,
        category: 'snacks',
        type: 'instant',
        prepMinutes: 0,
        stockCount: 25,
        available: true,
      );

      expect(item.isInstant, isTrue);
      expect(item.isInStock, isTrue);
      expect(item.badgeText, 'Available');
      expect(item.availabilityLevel, AvailabilityLevel.available);
    });

    test('Instant store item with limited stock (<= 5)', () {
      final item = MenuItem(
        id: 'cold_drink',
        name: 'Cold Drink',
        price: 20,
        category: 'drinks',
        type: 'instant',
        prepMinutes: 0,
        stockCount: 3,
        available: true,
      );

      expect(item.badgeText, 'Few left');
      expect(item.availabilityLevel, AvailabilityLevel.limited);
    });

    test('Instant store item with 0 stock is sold out', () {
      final item = MenuItem(
        id: 'cold_drink',
        name: 'Cold Drink',
        price: 20,
        category: 'drinks',
        type: 'instant',
        prepMinutes: 0,
        stockCount: 0,
        available: true,
      );

      expect(item.isInStock, isFalse);
      expect(item.badgeText, 'Sold out');
      expect(item.availabilityLevel, AvailabilityLevel.soldOut);
    });
  });
}
