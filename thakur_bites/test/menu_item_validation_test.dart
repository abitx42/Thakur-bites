import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/menu_item.dart';

void main() {
  group('MenuItem Defensive Validation & Ghost Item Invariants', () {
    test('Valid item passes isValid check', () {
      final item = MenuItem(
        id: 'masala_dosa',
        name: 'Masala Dosa',
        price: 45.0,
        category: 'dosa',
        type: 'cooked',
        prepMinutes: 8,
      );

      expect(item.isValid, isTrue);
      expect(item.isInStock, isTrue);
    });

    test('Unnamed item is rejected as invalid and marked not in stock', () {
      final item = MenuItem(
        id: 'bad_item_1',
        name: '',
        price: 50.0,
        category: 'dosa',
        type: 'cooked',
        prepMinutes: 5,
      );

      expect(item.isValid, isFalse);
      expect(item.isInStock, isFalse);
      expect(item.badgeText, 'Unavailable');
    });

    test('Whitespace-only named item is rejected as invalid', () {
      final item = MenuItem(
        id: 'bad_item_2',
        name: '   ',
        price: 30.0,
        category: 'snacks',
        type: 'instant',
        prepMinutes: 0,
      );

      expect(item.isValid, isFalse);
      expect(item.isInStock, isFalse);
    });

    test('Zero rupee (₹0) item is rejected as invalid', () {
      final item = MenuItem(
        id: 'zero_rupee_item',
        name: 'Ghost Water',
        price: 0.0,
        category: 'drinks',
        type: 'instant',
        prepMinutes: 0,
      );

      expect(item.isValid, isFalse);
      expect(item.isInStock, isFalse);
      expect(item.badgeText, 'Unavailable');
    });

    test('Negative price item is rejected as invalid', () {
      final item = MenuItem(
        id: 'negative_price_item',
        name: 'Faulty Samosa',
        price: -15.0,
        category: 'snacks',
        type: 'instant',
        prepMinutes: 0,
      );

      expect(item.isValid, isFalse);
      expect(item.isInStock, isFalse);
    });

    test('Empty ID item is rejected as invalid', () {
      final item = MenuItem(
        id: '',
        name: 'No Id Item',
        price: 20.0,
        category: 'snacks',
        type: 'instant',
        prepMinutes: 0,
      );

      expect(item.isValid, isFalse);
      expect(item.isInStock, isFalse);
    });

    test('MenuItem.fromFirestore defensively handles missing name and price', () {
      final rawDoc = <String, dynamic>{
        'stockOnHand': 50,
        'stockCount': 50,
      };

      final parsed = MenuItem.fromFirestore('bisleri_500ml', rawDoc);
      expect(parsed.isValid, isFalse);
      expect(parsed.name, isEmpty);
      expect(parsed.price, 0.0);
      expect(parsed.available, isFalse);
      expect(parsed.isInStock, isFalse);
    });

    test('Filtering a list of items completely removes invalid entries', () {
      final items = [
        MenuItem(id: '1', name: 'Valid Samosa', price: 15.0, category: 'snacks', type: 'instant', prepMinutes: 0),
        MenuItem(id: '2', name: '', price: 0.0, category: 'snacks', type: 'instant', prepMinutes: 0),
        MenuItem(id: '3', name: 'Valid Chai', price: 10.0, category: 'drinks', type: 'instant', prepMinutes: 0),
        MenuItem(id: '4', name: 'Ghost Item', price: 0.0, category: 'drinks', type: 'instant', prepMinutes: 0),
      ];

      final cleanItems = items.where((i) => i.isValid).toList();
      expect(cleanItems.length, 2);
      expect(cleanItems.map((e) => e.name), ['Valid Samosa', 'Valid Chai']);
    });
  });
}
