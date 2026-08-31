import 'package:cloud_firestore/cloud_firestore.dart';

/// Thakur Bites — Order Model
/// Maps to the `orders` Firestore collection.
///
/// Flow: placed → preparing → ready → collected
class Order {
  final String id;
  final String tokenNumber; // e.g. "#142"
  final String pinCode; // 4-digit pickup verification
  final String? studentId; // Firebase Auth UID
  final String? studentName;
  final String? studentRoll;
  final String status; // 'placed' | 'preparing' | 'ready' | 'collected'
  final DateTime createdAt;
  final DateTime? readyAt;
  final int estimatedMinutes; // max prep time of all items
  final double totalAmount;
  final List<OrderItem> items;

  Order({
    required this.id,
    required this.tokenNumber,
    required this.pinCode,
    this.studentId,
    this.studentName,
    this.studentRoll,
    required this.status,
    required this.createdAt,
    this.readyAt,
    required this.estimatedMinutes,
    required this.totalAmount,
    required this.items,
  });

  /// Status progression
  static const List<String> statusFlow = [
    'placed',
    'preparing',
    'ready',
    'collected',
  ];

  /// Index of current status in the flow (0-3)
  int get statusIndex => statusFlow.indexOf(status);

  /// Human-friendly status label
  String get statusLabel {
    switch (status) {
      case 'placed':
        return 'Order placed';
      case 'preparing':
        return 'Preparing';
      case 'ready':
        return 'Ready for pickup';
      case 'collected':
        return 'Collected';
      default:
        return status;
    }
  }

  factory Order.fromFirestore(String docId, Map<String, dynamic> data) {
    return Order(
      id: docId,
      tokenNumber: data['tokenNumber'] ?? '',
      pinCode: data['pinCode'] ?? '',
      studentId: data['studentId'],
      studentName: data['studentName'],
      studentRoll: data['studentRoll'],
      status: data['status'] ?? 'placed',
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      readyAt: (data['readyAt'] as Timestamp?)?.toDate(),
      estimatedMinutes: data['estimatedMinutes'] ?? 0,
      totalAmount: (data['totalAmount'] ?? 0).toDouble(),
      items: (data['items'] as List<dynamic>?)
              ?.map((item) => OrderItem.fromMap(item as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'tokenNumber': tokenNumber,
      'pinCode': pinCode,
      'studentId': studentId,
      'studentName': studentName,
      'studentRoll': studentRoll,
      'status': status,
      'createdAt': Timestamp.fromDate(createdAt),
      'readyAt': readyAt != null ? Timestamp.fromDate(readyAt!) : null,
      'estimatedMinutes': estimatedMinutes,
      'totalAmount': totalAmount,
      'items': items.map((item) => item.toMap()).toList(),
    };
  }
}

/// Individual item within an order
class OrderItem {
  final String menuItemId;
  final String name;
  final int quantity;
  final double price;

  OrderItem({
    required this.menuItemId,
    required this.name,
    required this.quantity,
    required this.price,
  });

  double get subtotal => price * quantity;

  factory OrderItem.fromMap(Map<String, dynamic> map) {
    return OrderItem(
      menuItemId: map['menuItemId'] ?? '',
      name: map['name'] ?? '',
      quantity: map['quantity'] ?? 1,
      price: (map['price'] ?? 0).toDouble(),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'menuItemId': menuItemId,
      'name': name,
      'quantity': quantity,
      'price': price,
    };
  }
}
