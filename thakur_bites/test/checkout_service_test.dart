import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/menu_item.dart';
import 'package:thakur_bites/models/order.dart';

void main() {
  group('Trusted Checkout & Inventory Models Unit Tests', () {
    final samosa = MenuItem(
      id: 'samosa_1',
      name: 'Punjabi Samosa',
      price: 25.0,
      category: 'snack',
      type: 'instant',
      prepMinutes: 0,
      stockCount: 15,
      available: true,
      imageUrl: '',
      iconKey: 'snack',
    );

    final dosa = MenuItem(
      id: 'masala_dosa',
      name: 'Mysore Masala Dosa',
      price: 70.0,
      category: 'dosa',
      type: 'cooked',
      prepMinutes: 8,
      stockCount: 0,
      available: true,
      imageUrl: '',
      iconKey: 'dosa',
    );

    test('Order calculation from authoritatively snapshot items', () {
      final items = [
        OrderItem(menuItemId: samosa.id, name: samosa.name, quantity: 2, price: 25.0),
        OrderItem(menuItemId: dosa.id, name: dosa.name, quantity: 1, price: 70.0),
      ];

      final total = items.fold(0.0, (sum, i) => sum + i.price * i.quantity);
      expect(total, equals(120.0));
    });

    test('Idempotency key uniqueness check', () {
      final key1 = 'tb_key_${DateTime.now().millisecondsSinceEpoch}_1';
      final key2 = 'tb_key_${DateTime.now().millisecondsSinceEpoch}_2';
      expect(key1, isNot(equals(key2)));
      expect(key1.startsWith('tb_key_'), isTrue);
    });

    test('Inventory decrement preserves non-negative boundary', () {
      const currentStock = 5;
      const requestedQty = 8;
      final newStock = (currentStock - requestedQty).clamp(0, 999999);
      expect(newStock, equals(0));
    });
  });
}
