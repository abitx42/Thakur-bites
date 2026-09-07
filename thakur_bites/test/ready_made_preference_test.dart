import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:thakur_bites/models/menu_item.dart';
import 'package:thakur_bites/models/order.dart';
import 'package:thakur_bites/providers/cart_provider.dart';
import 'package:thakur_bites/providers/auth_provider.dart';
import 'package:thakur_bites/screens/cart_screen.dart';

void main() {
  group('Ready-Made Preference Detection & State Management Unit Tests', () {
    late CartProvider cart;

    final coldDrink = MenuItem(
      id: 'coke_300',
      name: 'Coca Cola (300ml)',
      price: 40.0,
      category: 'drinks',
      parentCategory: 'BEVERAGES',
      type: 'instant',
      prepMinutes: 0,
    );

    final waterBottle = MenuItem(
      id: 'bisleri_500',
      name: 'Bisleri Mineral Water (500ml)',
      price: 20.0,
      category: 'drinks',
      parentCategory: 'BEVERAGES',
      type: 'instant',
      prepMinutes: 0,
    );

    final chips = MenuItem(
      id: 'lays_chips',
      name: 'Lay\'s Classic Salted',
      price: 20.0,
      category: 'snacks',
      parentCategory: 'SNACKS',
      type: 'instant',
      prepMinutes: 0,
    );

    final cookedDosa = MenuItem(
      id: 'masala_dosa',
      name: 'Masala Dosa',
      price: 70.0,
      category: 'dosa',
      parentCategory: 'FOOD',
      type: 'cooked',
      prepMinutes: 10,
    );

    setUp(() {
      cart = CartProvider(listenToLiveStock: false);
    });

    test('isOnlyReadyMade is false when cart is empty', () {
      expect(cart.isEmpty, isTrue);
      expect(cart.isOnlyReadyMade, isFalse);
    });

    test('isOnlyReadyMade is true when only instant items are added', () {
      cart.addItem(coldDrink);
      expect(cart.isOnlyReadyMade, isTrue);
      expect(cart.hasBeverage, isTrue);
      expect(cart.maxPrepMinutes, equals(0));
      expect(cart.readyTimeText, equals('Ready now'));

      cart.addItem(chips);
      expect(cart.isOnlyReadyMade, isTrue);
    });

    test('isOnlyReadyMade switches to false immediately when a cooked item is added', () {
      cart.addItem(coldDrink);
      expect(cart.isOnlyReadyMade, isTrue);

      cart.addItem(cookedDosa);
      expect(cart.isOnlyReadyMade, isFalse);
      expect(cart.maxPrepMinutes, equals(10));
      expect(cart.readyTimeText, equals('Ready in ~10 min'));

      // Remove cooked item — should automatically switch back to ready-made
      cart.deleteItem(cookedDosa.id);
      expect(cart.isOnlyReadyMade, isTrue);
      expect(cart.readyTimeText, equals('Ready now'));
    });

    test('Ready-made preference state management and summary', () {
      cart.addItem(coldDrink);
      expect(cart.temperaturePreference, equals('Chilled ❄️'));
      expect(cart.packagingPreference, equals('Direct Handover ✋'));
      expect(cart.readyMadePreferenceSummary, equals('Chilled ❄️ · Direct Handover ✋'));

      cart.setTemperaturePreference('Room Temp 🥤');
      expect(cart.temperaturePreference, equals('Room Temp 🥤'));
      expect(cart.readyMadePreferenceSummary, equals('Room Temp 🥤 · Direct Handover ✋'));

      cart.setPackagingPreference('Carry Bag 🛍️');
      expect(cart.packagingPreference, equals('Carry Bag 🛍️'));
      expect(cart.readyMadePreferenceSummary, equals('Room Temp 🥤 · Carry Bag 🛍️'));
    });

    test('Order model correctly identifies isOnlyReadyMade and stores preference', () {
      final order = Order(
        id: 'ord_123',
        tokenNumber: 'TB-042',
        pinCode: '1234',
        status: 'confirmed',
        createdAt: DateTime.now(),
        estimatedMinutes: 0,
        totalAmount: 60.0,
        isOnlyReadyMade: true,
        readyMadePreference: 'Chilled ❄️ · Carry Bag 🛍️',
        items: [
          OrderItem(menuItemId: 'coke_300', name: 'Coca Cola', quantity: 1, price: 40.0, type: 'instant'),
          OrderItem(menuItemId: 'bisleri_500', name: 'Bisleri', quantity: 1, price: 20.0, type: 'instant'),
        ],
      );

      expect(order.isOnlyReadyMade, isTrue);
      expect(order.readyMadePreference, equals('Chilled ❄️ · Carry Bag 🛍️'));

      final firestoreMap = order.toFirestore();
      expect(firestoreMap['isOnlyReadyMade'], isTrue);
      expect(firestoreMap['readyMadePreference'], equals('Chilled ❄️ · Carry Bag 🛍️'));

      final reconstructed = Order.fromFirestore(order.id, firestoreMap);
      expect(reconstructed.isOnlyReadyMade, isTrue);
      expect(reconstructed.readyMadePreference, equals('Chilled ❄️ · Carry Bag 🛍️'));
    });
  });

  group('CartScreen Automatic Preference Display Widget Tests', () {
    final coldDrink = MenuItem(
      id: 'coke_300',
      name: 'Coca Cola (300ml)',
      price: 40.0,
      category: 'drinks',
      parentCategory: 'BEVERAGES',
      type: 'instant',
      prepMinutes: 0,
    );

    final cookedDosa = MenuItem(
      id: 'masala_dosa',
      name: 'Masala Dosa',
      price: 70.0,
      category: 'dosa',
      parentCategory: 'FOOD',
      type: 'cooked',
      prepMinutes: 10,
    );

    testWidgets('ReadyMadePreferenceCard renders correctly and handles preference taps', (tester) async {
      final cart = CartProvider(listenToLiveStock: false);
      cart.addItem(coldDrink);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AnimatedBuilder(
              animation: cart,
              builder: (context, _) => ReadyMadePreferenceCard(cart: cart),
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // Verify Ready-Made Items Only badge is visible
      expect(find.text('Ready-Made Items Only'), findsOneWidget);
      expect(find.text('0 MIN WAIT'), findsOneWidget);
      expect(find.text('🥤 Beverage Temperature Preference:'), findsOneWidget);
      expect(find.text('Chilled / Cold ❄️'), findsOneWidget);
      expect(find.text('Room Temp 🥤'), findsOneWidget);
      expect(find.text('Direct Handover ✋'), findsOneWidget);
      expect(find.text('Carry Bag 🛍️'), findsOneWidget);
      expect(find.text('Preference: Chilled ❄️ · Direct Handover ✋'), findsOneWidget);

      // Tap on 'Room Temp 🥤'
      await tester.tap(find.text('Room Temp 🥤'));
      await tester.pumpAndSettle();

      expect(cart.temperaturePreference, equals('Room Temp 🥤'));
      expect(find.text('Preference: Room Temp 🥤 · Direct Handover ✋'), findsOneWidget);

      // Tap on 'Carry Bag 🛍️'
      await tester.tap(find.text('Carry Bag 🛍️'));
      await tester.pumpAndSettle();

      expect(cart.packagingPreference, equals('Carry Bag 🛍️'));
      expect(find.text('Preference: Room Temp 🥤 · Carry Bag 🛍️'), findsOneWidget);
    });
  });
}
