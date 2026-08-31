import 'package:cloud_firestore/cloud_firestore.dart' hide Order;
import '../models/order.dart';

/// Supported payment methods for campus canteen checkout
enum PaymentMethod {
  campusUpi,
  razorpayOnline,
  cashAtCounter,
}

/// Structured immutable payment outcome
class PaymentResult {
  final bool isSuccess;
  final String? paymentId;
  final String orderId;
  final double amount;
  final PaymentMethod method;
  final String? errorMessage;
  final DateTime timestamp;

  PaymentResult({
    required this.isSuccess,
    this.paymentId,
    required this.orderId,
    required this.amount,
    required this.method,
    this.errorMessage,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

/// Provider-neutral payment orchestration service
class PaymentService {
  final FirebaseFirestore _db;

  PaymentService({FirebaseFirestore? firestore})
      : _db = firestore ?? FirebaseFirestore.instance;

  /// Process payment for confirmed order
  Future<PaymentResult> processPayment({
    required Order order,
    required PaymentMethod method,
  }) async {
    final now = DateTime.now();

    if (method == PaymentMethod.cashAtCounter) {
      // Record payment preference as cash at counter
      await _db.collection('orders').doc(order.id).update({
        'paymentMethod': 'CASH_AT_COUNTER',
        'paymentStatus': 'unpaid',
      });

      return PaymentResult(
        isSuccess: true,
        orderId: order.id,
        amount: order.totalAmount,
        method: method,
        paymentId: 'CASH_${order.id}',
        timestamp: now,
      );
    }

    // Digital Payment (Campus UPI / Gateway)
    final gatewayPaymentId = 'pay_tb_${order.id.slice(0, 6)}_${now.millisecondsSinceEpoch}';

    try {
      // 1. Update order with payment details
      await _db.collection('orders').doc(order.id).update({
        'paymentStatus': 'paid',
        'paymentMethod': method == PaymentMethod.campusUpi ? 'CAMPUS_UPI' : 'GATEWAY_ONLINE',
        'paymentId': gatewayPaymentId,
        'paidAt': Timestamp.fromDate(now),
      });

      // 2. Append to immutable payments collection
      await _db.collection('payments').doc(gatewayPaymentId).set({
        'paymentId': gatewayPaymentId,
        'orderId': order.id,
        'studentId': order.studentId,
        'amount': order.totalAmount,
        'currency': 'INR',
        'method': method.toString(),
        'status': 'captured',
        'createdAt': Timestamp.fromDate(now),
      });

      return PaymentResult(
        isSuccess: true,
        orderId: order.id,
        amount: order.totalAmount,
        method: method,
        paymentId: gatewayPaymentId,
        timestamp: now,
      );
    } catch (e) {
      return PaymentResult(
        isSuccess: false,
        orderId: order.id,
        amount: order.totalAmount,
        method: method,
        errorMessage: e.toString(),
        timestamp: now,
      );
    }
  }
}

extension _StringSlice on String {
  String slice(int start, int end) {
    if (length <= start) return this;
    if (length <= end) return substring(start);
    return substring(start, end);
  }
}
