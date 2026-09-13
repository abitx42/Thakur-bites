import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/daily_board.dart';
import 'package:thakur_bites/models/menu_item.dart';
import 'package:thakur_bites/providers/cart_provider.dart';

void main() {
  group('DailyBoard Model Tests', () {
    test('Default auto-pilot for Friday includes Pav Bhaji & Paneer Butter Masala', () {
      final fridayDate = DateTime(2026, 9, 18); // A Friday
      expect(fridayDate.weekday, equals(5));

      final board = DailyBoard.defaultForDay(fridayDate);
      expect(board.dayOfWeek, equals('FRIDAY'));
      expect(board.sabji1, equals('Paneer Butter Masala'));
      expect(board.sabji2, equals('Chana Masala'));
      expect(board.sweetOfTheDay, equals('Hot Gulab Jamun'));
      expect(board.canteenSpecial, contains('Pav Bhaji'));
      expect(board.specialBadge, equals('FRIDAY SPECIAL 🔥'));
      expect(board.rotiAvailable, isTrue);
      expect(board.puriAvailable, isTrue);
    });

    test('Default auto-pilot for Wednesday includes Biryani & Rajma Masala', () {
      final wednesdayDate = DateTime(2026, 9, 16); // A Wednesday
      expect(wednesdayDate.weekday, equals(3));

      final board = DailyBoard.defaultForDay(wednesdayDate);
      expect(board.dayOfWeek, equals('WEDNESDAY'));
      expect(board.sabji1, equals('Rajma Masala'));
      expect(board.canteenSpecial, contains('Biryani'));
    });

    test('Summary text generation for Thali and Roti Bhaji', () {
      final board = DailyBoard(
        sabji1: 'Aloo Palak',
        sabji2: 'Chana Masala',
        sweetOfTheDay: 'Kheer',
        canteenSpecial: 'Samosa',
      );

      expect(board.formatThaliSummary(), equals('Today: Aloo Palak, Chana Masala, Kheer'));
      expect(board.formatRotiBhajiSummary(), equals('Today\'s Sabjis: Aloo Palak or Chana Masala'));

      final singleSabjiBoard = DailyBoard(
        sabji1: 'Sev Bhaji',
        sabji2: '',
        sweetOfTheDay: '',
        canteenSpecial: '',
      );
      expect(singleSabjiBoard.formatRotiBhajiSummary(), equals('Today\'s Sabji: Sev Bhaji'));
    });

    test('Firestore serialization and deserialization roundtrip', () {
      final board = DailyBoard(
        date: '2026-09-18',
        dayOfWeek: 'FRIDAY',
        sabji1: 'Paneer Butter Masala',
        sabji2: 'Chana Masala',
        dalOfTheDay: 'Dal Tadka',
        sweetOfTheDay: 'Gulab Jamun',
        riceType: 'Jeera Rice',
        canteenSpecial: 'Butter Pav Bhaji',
        specialBadge: 'FRIDAY SPECIAL 🔥',
        rotiAvailable: true,
        puriAvailable: true,
        announcement: 'Fresh Pav Bhaji ready from 12 PM!',
        isRushHour: true,
        updatedBy: 'staff_1',
      );

      final data = board.toFirestore();
      expect(data['date'], equals('2026-09-18'));
      expect(data['dayOfWeek'], equals('FRIDAY'));
      expect(data['sabji1'], equals('Paneer Butter Masala'));
      expect(data['canteenSpecial'], equals('Butter Pav Bhaji'));
      expect(data['isRushHour'], isTrue);

      final reconstructed = DailyBoard.fromFirestore(data);
      expect(reconstructed.date, equals('2026-09-18'));
      expect(reconstructed.dayOfWeek, equals('FRIDAY'));
      expect(reconstructed.sabji1, equals('Paneer Butter Masala'));
      expect(reconstructed.sabji2, equals('Chana Masala'));
      expect(reconstructed.dalOfTheDay, equals('Dal Tadka'));
      expect(reconstructed.sweetOfTheDay, equals('Gulab Jamun'));
      expect(reconstructed.riceType, equals('Jeera Rice'));
      expect(reconstructed.canteenSpecial, equals('Butter Pav Bhaji'));
      expect(reconstructed.specialBadge, equals('FRIDAY SPECIAL 🔥'));
      expect(reconstructed.rotiAvailable, isTrue);
      expect(reconstructed.puriAvailable, isTrue);
      expect(reconstructed.announcement, equals('Fresh Pav Bhaji ready from 12 PM!'));
      expect(reconstructed.isRushHour, isTrue);
      expect(reconstructed.updatedBy, equals('staff_1'));
    });
  });

  group('Day-Specific MenuItem Availability Tests', () {
    test('Standard daily item without availableDays is always available', () {
      final item = MenuItem(
        id: 'masala_dosa',
        name: 'Masala Dosa',
        price: 50,
        category: 'dosa',
        type: 'cooked',
        prepMinutes: 8,
        available: true,
      );

      // Available regardless of weekday
      expect(item.isAvailableOnDay(DateTime.monday), isTrue);
      expect(item.isAvailableOnDay(DateTime.friday), isTrue);
      expect(item.isAvailableOnDay(DateTime.sunday), isTrue);
      expect(item.todaySpecialBadge, isNull);
    });

    test('Friday special item (Pav Bhaji) is available on Friday and hidden on Thursday', () {
      final specialItem = MenuItem(
        id: 'special_pav_bhaji',
        name: 'Special Pav Bhaji',
        price: 70,
        category: 'snacks',
        type: 'cooked',
        prepMinutes: 10,
        available: true,
        availableDays: ['FRIDAY'],
      );

      expect(specialItem.isAvailableOnDay(DateTime.friday), isTrue);
      expect(specialItem.isAvailableOnDay(DateTime.thursday), isFalse);
      expect(specialItem.isAvailableOnDay(DateTime.monday), isFalse);
    });
  });

  group('Cart Multi-Variant Customization Tests', () {
    test('Cart handles same item with different customizations as separate entries', () {
      final cart = CartProvider(listenToLiveStock: false, listenToAuth: false);
      final item = MenuItem(
        id: 'thali_deluxe',
        name: 'Deluxe Veg Thali',
        price: 80,
        category: 'meals',
        type: 'cooked',
        prepMinutes: 12,
        available: true,
      );

      // Add 1 Thali with 4 Rotis
      cart.addItem(item, customization: '4 Tawa Rotis • Paneer Butter Masala');
      expect(cart.totalItemCount, equals(1));
      expect(cart.totalPrice, equals(80.0));

      // Add 1 Thali with 4 Puris (same ₹0 price difference)
      cart.addItem(item, customization: '4 Fresh Puris • Paneer Butter Masala');
      expect(cart.totalItemCount, equals(2));
      expect(cart.totalPrice, equals(160.0));

      // Quantity lookup by distinct entry key
      expect(cart.getQty(item.id, customization: '4 Tawa Rotis • Paneer Butter Masala'), equals(1));
      expect(cart.getQty(item.id, customization: '4 Fresh Puris • Paneer Butter Masala'), equals(1));
      expect(cart.getQty(item.id), equals(2)); // uncustomized lookup gives total for this item

      // Increment rotis
      cart.addItem(item, customization: '4 Tawa Rotis • Paneer Butter Masala');
      expect(cart.getQty(item.id, customization: '4 Tawa Rotis • Paneer Butter Masala'), equals(2));
      expect(cart.totalItemCount, equals(3));
      expect(cart.totalPrice, equals(240.0));

      // Remove puris
      cart.removeItem(item.id, customization: '4 Fresh Puris • Paneer Butter Masala');
      expect(cart.getQty(item.id, customization: '4 Fresh Puris • Paneer Butter Masala'), equals(0));
      expect(cart.totalItemCount, equals(2));
      expect(cart.totalPrice, equals(160.0));
    });
  });
}
