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

    test('Price in paise and effectivePricePaise calculate accurately', () {
      final item1 = MenuItem(
        id: 'masala_dosa',
        name: 'Masala Dosa',
        price: 50.0,
        category: 'FOOD',
        type: 'cooked',
        prepMinutes: 6,
      );
      expect(item1.pricePaise, 5000);
      expect(item1.effectivePricePaise, 5000);

      final item2 = MenuItem(
        id: 'cutting_chai',
        name: 'Cutting Chai',
        price: 12.0,
        category: 'BEVERAGES',
        type: 'cooked',
        prepMinutes: 2,
      );
      expect(item2.pricePaise, 1200);
    });

    test('Infers parentCategory when omitted based on category', () {
      final tea = MenuItem(
        id: 't1',
        name: 'Masala Chai',
        price: 18,
        category: 'tea_coffee',
        type: 'cooked',
        prepMinutes: 2,
      );
      expect(tea.parentCategory, 'BEVERAGES');

      final snack = MenuItem(
        id: 's1',
        name: 'Vada Pav',
        price: 18,
        category: 'pav_items',
        type: 'cooked',
        prepMinutes: 1,
      );
      expect(snack.parentCategory, 'SNACKS');

      final food = MenuItem(
        id: 'f1',
        name: 'Plain Dosa',
        price: 35,
        category: 'dosa',
        type: 'cooked',
        prepMinutes: 5,
      );
      expect(food.parentCategory, 'FOOD');
    });

    test('Serializes to and from Firestore with two-tier taxonomy', () {
      final item = MenuItem(
        id: 'schezwan_rice',
        name: 'Schezwan Fried Rice',
        price: 100.0,
        category: 'Chinese',
        parentCategory: 'FOOD',
        subCategory: 'Chinese',
        dietaryType: 'VEG',
        description: 'Wok tossed basmati rice with spicy schezwan sauce',
        type: 'cooked',
        prepMinutes: 8,
        isArchived: false,
        displayOrder: 21,
      );

      final firestoreMap = item.toFirestore();
      expect(firestoreMap['parentCategory'], 'FOOD');
      expect(firestoreMap['subCategory'], 'Chinese');
      expect(firestoreMap['dietaryType'], 'VEG');
      expect(firestoreMap['description'], contains('spicy schezwan'));
      expect(firestoreMap['isArchived'], isFalse);
      expect(firestoreMap['displayOrder'], 21);

      final parsed = MenuItem.fromFirestore('schezwan_rice', firestoreMap);
      expect(parsed.id, 'schezwan_rice');
      expect(parsed.name, 'Schezwan Fried Rice');
      expect(parsed.parentCategory, 'FOOD');
      expect(parsed.subCategory, 'Chinese');
      expect(parsed.price, 100.0);
      expect(parsed.pricePaise, 10000);
      expect(parsed.isArchived, isFalse);
    });

    test('Archived items are flagged as unavailable to students', () {
      final archivedItem = MenuItem.fromFirestore('old_item', {
        'name': 'Old Seasonal Dish',
        'price': 60,
        'category': 'dosa',
        'type': 'cooked',
        'available': true,
        'isArchived': true,
      });

      expect(archivedItem.isArchived, isTrue);
      expect(archivedItem.available, isFalse);
    });
  });
}
