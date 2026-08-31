import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/order.dart';

void main() {
  group('Order Model & State Machine Verification Tests', () {
    final now = DateTime.now();

    final confirmedOrder = Order(
      id: 'order_test_1',
      tokenNumber: 'TB-001',
      pinCode: '4321',
      studentId: 'student_123',
      studentName: 'Aditya Bodake',
      studentRoll: 'TE-IT-42',
      status: 'confirmed',
      createdAt: now,
      readyAt: now.add(const Duration(minutes: 5)),
      estimatedMinutes: 5,
      totalAmount: 120.0,
      items: [
        OrderItem(menuItemId: 'item_1', name: 'Samosa', quantity: 2, price: 25.0),
        OrderItem(menuItemId: 'item_2', name: 'Dosa', quantity: 1, price: 70.0),
      ],
    );

    test('Confirmed order state flags', () {
      expect(confirmedOrder.isConfirmed, isTrue);
      expect(confirmedOrder.isPreparing, isFalse);
      expect(confirmedOrder.isReady, isFalse);
      expect(confirmedOrder.isCollected, isFalse);
    });

    test('Preparing order state flags', () {
      final preparingOrder = confirmedOrder.copyWith(status: 'preparing');
      expect(preparingOrder.isConfirmed, isFalse);
      expect(preparingOrder.isPreparing, isTrue);
      expect(preparingOrder.isReady, isFalse);
    });

    test('Ready order state flags', () {
      final readyOrder = confirmedOrder.copyWith(status: 'ready');
      expect(readyOrder.isReady, isTrue);
      expect(readyOrder.isCollected, isFalse);
    });

    test('Collected order state flags', () {
      final collectedOrder = confirmedOrder.copyWith(status: 'collected');
      expect(collectedOrder.isCollected, isTrue);
      expect(collectedOrder.isReady, isFalse);
    });

    test('Token number format matches TB-XXX daily sequential pattern', () {
      expect(RegExp(r'^TB-\d{3}$').hasMatch(confirmedOrder.tokenNumber), isTrue);
      expect(confirmedOrder.pinCode.length, equals(4));
    });
  });
}
