import 'package:cloud_firestore/cloud_firestore.dart';

/// Thakur Bites — Order Model
/// Maps to the `orders` Firestore collection.
///
/// Flow: confirmed/placed → preparing → ready → collected
class Order {
  final String id;
  final String tokenNumber; // e.g. "TB-001"
  final String pinCode; // 4-digit pickup verification
  final String? studentId; // Firebase Auth UID
  final String? studentName;
  final String? studentRoll;
  final String status; // 'confirmed' | 'placed' | 'preparing' | 'ready' | 'collected'
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
    'confirmed',
    'preparing',
    'ready',
    'collected',
  ];

  /// Status helpers
  bool get isConfirmed => status == 'confirmed' || status == 'placed';
  bool get isPreparing => status == 'preparing';
  bool get isReady => status == 'ready';
  bool get isCollected => status == 'collected';

  /// Index of current status in the flow (0-3)
  int get statusIndex {
    final idx = statusFlow.indexOf(status);
    if (idx != -1) return idx;
    if (status == 'placed') return 0;
    return 0;
  }

  /// Human-friendly status label
  String get statusLabel {
    switch (status) {
      case 'confirmed':
      case 'placed':
        return 'Order confirmed';
      case 'preparing':
        return 'Preparing in Kitchen';
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
      pinCode: data['pinCode'] ?? data['pickupPin'] ?? '',
      studentId: data['studentId'],
      studentName: data['studentName'],
      studentRoll: data['studentRoll'],
      status: data['status'] ?? 'confirmed',
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      readyAt: (data['readyAt'] as Timestamp?)?.toDate(),
      estimatedMinutes: data['estimatedMinutes'] ?? 0,
      totalAmount: (data['totalAmount'] as num?)?.toDouble() ?? 0.0,
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

  Order copyWith({
    String? id,
    String? tokenNumber,
    String? pinCode,
    String? studentId,
    String? studentName,
    String? studentRoll,
    String? status,
    DateTime? createdAt,
    DateTime? readyAt,
    int? estimatedMinutes,
    double? totalAmount,
    List<OrderItem>? items,
  }) {
    return Order(
      id: id ?? this.id,
      tokenNumber: tokenNumber ?? this.tokenNumber,
      pinCode: pinCode ?? this.pinCode,
      studentId: studentId ?? this.studentId,
      studentName: studentName ?? this.studentName,
      studentRoll: studentRoll ?? this.studentRoll,
      status: status ?? this.status,
      createdAt: createdAt ?? this.createdAt,
      readyAt: readyAt ?? this.readyAt,
      estimatedMinutes: estimatedMinutes ?? this.estimatedMinutes,
      totalAmount: totalAmount ?? this.totalAmount,
      items: items ?? this.items,
    );
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
      menuItemId: map['menuItemId'] ?? map['itemId'] ?? '',
      name: map['name'] ?? '',
      quantity: map['quantity'] ?? 1,
      price: (map['price'] ?? map['unitPrice'] ?? 0).toDouble(),
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
