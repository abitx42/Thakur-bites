import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/order.dart';
import 'package:thakur_bites/models/menu_item.dart';
import 'package:thakur_bites/providers/cart_provider.dart';

void main() {
  group('Phase 4: Customer Reliability & Lifecycle State Machine Tests', () {
    final now = DateTime.now();

    final basePendingOrder = Order(
      id: 'order_pending_1',
      tokenNumber: 'TB-042',
      pinCode: '7890',
      studentId: 'student_phase4',
      studentName: 'Aarav Sharma',
      studentRoll: 'SE-COMP-12',
      status: 'payment_pending',
      paymentStatus: 'pending',
      paymentMethod: 'online',
      createdAt: now,
      reservationExpiresAt: now.add(const Duration(minutes: 15)),
      estimatedMinutes: 8,
      totalAmount: 95.0,
      totalAmountPaise: 9500,
      items: [
        OrderItem(menuItemId: 'samosa_1', name: 'Samosa', quantity: 2, price: 25.0),
        OrderItem(menuItemId: 'chai_1', name: 'Masala Chai', quantity: 3, price: 15.0),
      ],
    );

    test('Stage 0: Payment Pending state properties and countdown', () {
      expect(basePendingOrder.isPaymentPending, isTrue);
      expect(basePendingOrder.customerStatusIndex, equals(0));
      expect(basePendingOrder.canCancel, isTrue);
      expect(basePendingOrder.isOnlinePayment, isTrue);
      expect(basePendingOrder.isCounterCash, isFalse);
      expect(basePendingOrder.totalAmountPaise, equals(9500));
      expect(basePendingOrder.reservationExpiresAt, isNotNull);
    });

    test('Stage 1: Confirmed order properties', () {
      final confirmed = basePendingOrder.copyWith(
        status: 'confirmed',
        paymentStatus: 'paid',
      );
      expect(confirmed.isPaymentPending, isFalse);
      expect(confirmed.isConfirmed, isTrue);
      expect(confirmed.customerStatusIndex, equals(1));
      expect(confirmed.canCancel, isTrue);
    });

    test('Stage 2: Preparing order strictly locks cancellation', () {
      final preparing = basePendingOrder.copyWith(
        status: 'preparing',
        paymentStatus: 'paid',
      );
      expect(preparing.isPreparing, isTrue);
      expect(preparing.customerStatusIndex, equals(2));
      // Pre-preparation boundary enforcement: cannot cancel once kitchen starts cooking
      expect(preparing.canCancel, isFalse);
    });

    test('Stage 3: Ready order displays PIN and locks cancellation', () {
      final ready = basePendingOrder.copyWith(
        status: 'ready',
        paymentStatus: 'paid',
      );
      expect(ready.isReady, isTrue);
      expect(ready.customerStatusIndex, equals(3));
      expect(ready.canCancel, isFalse);
      expect(ready.pinCode, equals('7890'));
    });

    test('Stage 4: Collected order locks cancellation and marks completion', () {
      final collected = basePendingOrder.copyWith(
        status: 'collected',
        paymentStatus: 'paid',
      );
      expect(collected.isCollected, isTrue);
      expect(collected.customerStatusIndex, equals(4));
      expect(collected.canCancel, isFalse);
    });

    test('Stage -1: Cancelled order properties and reasons', () {
      final cancelled = basePendingOrder.copyWith(
        status: 'cancelled',
        paymentStatus: 'cancelled',
        cancellationReason: 'Changed my mind',
        cancelledAt: now,
      );
      expect(cancelled.isCancelled, isTrue);
      expect(cancelled.customerStatusIndex, equals(-1));
      expect(cancelled.canCancel, isFalse);
      expect(cancelled.cancellationReason, equals('Changed my mind'));
      expect(cancelled.statusLabel, equals('Order Cancelled'));
    });

    test('Counter Cash payment method identification', () {
      final cashOrder = basePendingOrder.copyWith(paymentMethod: 'counter_cash');
      expect(cashOrder.isCounterCash, isTrue);
      expect(cashOrder.isOnlinePayment, isFalse);
    });

    test('Offline Cart Wishlist: Item additions and total calculations', () {
      final cart = CartProvider(listenToLiveStock: false);
      final item1 = MenuItem(
        id: 'coke_1',
        name: 'Coca Cola',
        price: 40.0,
        prepMinutes: 0,
        parentCategory: 'Store',
        category: 'cold_drinks',
        available: true,
        type: 'instant',
      );
      final item2 = MenuItem(
        id: 'chips_1',
        name: 'Lays Chips',
        price: 20.0,
        prepMinutes: 0,
        parentCategory: 'Store',
        category: 'packaged_snacks',
        available: true,
        type: 'instant',
      );

      cart.addItem(item1);
      cart.addItem(item2);
      cart.addItem(item1); // quantity becomes 2

      expect(cart.totalItemCount, equals(3));
      expect(cart.totalPrice, equals(100.0));
      expect(cart.isOnlyReadyMade, isTrue);

      cart.clear();
      expect(cart.isEmpty, isTrue);
      expect(cart.totalPrice, equals(0.0));
    });
  });
}
