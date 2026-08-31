import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/menu_item.dart';
import 'package:thakur_bites/providers/cart_provider.dart';

void main() {
  group('CartProvider Wishlist & Pricing Unit Tests', () {
    late MenuItem dosa;
    late MenuItem chips;

    setUp(() {
      dosa = MenuItem(
        id: 'dosa_1',
        name: 'Masala Dosa',
        price: 50,
        category: 'dosa',
        type: 'cooked',
        prepMinutes: 6,
        available: true,
      );

      chips = MenuItem(
        id: 'chips_1',
        name: 'Chips',
        price: 20,
        category: 'snacks',
        type: 'instant',
        prepMinutes: 0,
        stockCount: 25,
        available: true,
      );
    });

    test('Initial cart is empty', () {
      final cart = CartProvider(listenToLiveStock: false);
      expect(cart.isEmpty, isTrue);
      expect(cart.totalItemCount, 0);
      expect(cart.totalPrice, 0.0);
    });

    test('Adding items increments count and calculates subtotal correctly', () {
      final cart = CartProvider(listenToLiveStock: false);
      cart.addItem(dosa);
      cart.addItem(dosa);
      cart.addItem(chips);

      expect(cart.totalItemCount, 3);
      expect(cart.getQty(dosa.id), 2);
      expect(cart.getQty(chips.id), 1);
      expect(cart.totalPrice, 120.0); // 2 * 50 + 1 * 20
    });

    test('Wishlist behavior: cart does not block adding multiple items', () {
      final cart = CartProvider(listenToLiveStock: false);
      for (int i = 0; i < 15; i++) {
        cart.addItem(chips);
      }

      expect(cart.getQty(chips.id), 15);
      expect(cart.totalPrice, 300.0);
    });

    test('Capping item quantity adjusts count correctly', () {
      final cart = CartProvider(listenToLiveStock: false);
      for (int i = 0; i < 10; i++) {
        cart.addItem(chips);
      }

      cart.capItemQuantity(chips.id, 4);
      expect(cart.getQty(chips.id), 4);
      expect(cart.totalPrice, 80.0);
    });

    test('Removing items reduces quantity and cleans up when 0', () {
      final cart = CartProvider(listenToLiveStock: false);
      cart.addItem(dosa);
      cart.addItem(dosa);
      cart.removeItem(dosa.id);

      expect(cart.getQty(dosa.id), 1);
      expect(cart.totalPrice, 50.0);

      cart.removeItem(dosa.id);
      expect(cart.getQty(dosa.id), 0);
      expect(cart.isEmpty, isTrue);
    });
  });
}
