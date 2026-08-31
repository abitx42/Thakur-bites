import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/order.dart';
import 'package:thakur_bites/services/payment_service.dart';

void main() {
  group('PaymentService & Financial Invariants Tests', () {
    final now = DateTime.now();

    final testOrder = Order(
      id: 'order_pay_123',
      tokenNumber: 'TB-042',
      pinCode: '7788',
      studentId: 'student_xyz',
      studentName: 'Aditya Bodake',
      studentRoll: 'TE-IT-42',
      status: 'confirmed',
      createdAt: now,
      readyAt: now.add(const Duration(minutes: 6)),
      estimatedMinutes: 6,
      totalAmount: 180.0,
      items: [
        OrderItem(menuItemId: 'item_1', name: 'Thali', quantity: 1, price: 120.0),
        OrderItem(menuItemId: 'item_2', name: 'Cold Drink', quantity: 1, price: 60.0),
      ],
    );

    test('PaymentResult structure formats properly for digital payments', () {
      final res = PaymentResult(
        isSuccess: true,
        orderId: testOrder.id,
        amount: testOrder.totalAmount,
        method: PaymentMethod.campusUpi,
        paymentId: 'pay_tb_123_456',
        timestamp: now,
      );

      expect(res.isSuccess, isTrue);
      expect(res.amount, equals(180.0));
      expect(res.method, equals(PaymentMethod.campusUpi));
      expect(res.paymentId, equals('pay_tb_123_456'));
    });

    test('PaymentResult captures failure errors without losing order reference', () {
      final res = PaymentResult(
        isSuccess: false,
        orderId: testOrder.id,
        amount: testOrder.totalAmount,
        method: PaymentMethod.razorpayOnline,
        errorMessage: 'User dismissed UPI checkout sheet',
        timestamp: now,
      );

      expect(res.isSuccess, isFalse);
      expect(res.orderId, equals(testOrder.id));
      expect(res.errorMessage, contains('dismissed'));
    });
  });
}
