import 'package:cloud_firestore/cloud_firestore.dart';

/// Thakur Bites - Order Model
/// Maps directly to the `orders` Firestore collection.
class Order {
  final String id;
  final String tokenNumber;
  final String pinCode; // 4-digit pickup code
  final String? studentId; // Firebase Auth UID (null until Phase 7)
  final String studentName;
  final String studentRoll;
  final String status; // 'placed' | 'preparing' | 'ready' | 'collected'
  final String tierHighest;
  final String primaryStation;
  final DateTime createdAt;
  final DateTime? readyAt;
  final DateTime? collectedAt;
  final String pickupSlot;
  final String paymentMethod;
  final String paymentStatus; // 'PAID' | 'PENDING'
  final double totalAmount;
  final List<OrderItem> items;

  Order({
    required this.id,
    required this.tokenNumber,
    required this.pinCode,
    this.studentId,
    required this.studentName,
    required this.studentRoll,
    required this.status,
    required this.tierHighest,
    required this.primaryStation,
    required this.createdAt,
    this.readyAt,
    this.collectedAt,
    required this.pickupSlot,
    required this.paymentMethod,
    required this.paymentStatus,
    required this.totalAmount,
    required this.items,
  });

  /// Create from Firestore document
  factory Order.fromFirestore(String docId, Map<String, dynamic> data) {
    return Order(
      id: docId,
      tokenNumber: data['tokenNumber'] ?? '',
      pinCode: data['pinCode'] ?? '',
      studentId: data['studentId'],
      studentName: data['studentName'] ?? '',
      studentRoll: data['studentRoll'] ?? '',
      status: data['status'] ?? 'placed',
      tierHighest: data['tierHighest'] ?? 'tier1_instant',
      primaryStation: data['primaryStation'] ?? '',
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      readyAt: (data['readyAt'] as Timestamp?)?.toDate(),
      collectedAt: (data['collectedAt'] as Timestamp?)?.toDate(),
      pickupSlot: data['pickupSlot'] ?? '',
      paymentMethod: data['paymentMethod'] ?? 'placeholder',
      paymentStatus: data['paymentStatus'] ?? 'PENDING',
      totalAmount: (data['totalAmount'] ?? 0).toDouble(),
      items: (data['items'] as List<dynamic>?)
              ?.map((item) =>
                  OrderItem.fromMap(item as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }

  /// Convert to Firestore document
  Map<String, dynamic> toFirestore() {
    return {
      'tokenNumber': tokenNumber,
      'pinCode': pinCode,
      'studentId': studentId,
      'studentName': studentName,
      'studentRoll': studentRoll,
      'status': status,
      'tierHighest': tierHighest,
      'primaryStation': primaryStation,
      'createdAt': Timestamp.fromDate(createdAt),
      'readyAt': readyAt != null ? Timestamp.fromDate(readyAt!) : null,
      'collectedAt':
          collectedAt != null ? Timestamp.fromDate(collectedAt!) : null,
      'pickupSlot': pickupSlot,
      'paymentMethod': paymentMethod,
      'paymentStatus': paymentStatus,
      'totalAmount': totalAmount,
      'items': items.map((item) => item.toMap()).toList(),
    };
  }

  /// Status progression: placed → preparing → ready → collected
  static const List<String> statusFlow = [
    'placed',
    'preparing',
    'ready',
    'collected',
  ];
}

/// Individual item within an order
class OrderItem {
  final String menuItemId;
  final String name;
  final int quantity;
  final double price;
  final String? variant;
  final Map<String, dynamic>? customOptions;

  OrderItem({
    required this.menuItemId,
    required this.name,
    required this.quantity,
    required this.price,
    this.variant,
    this.customOptions,
  });

  factory OrderItem.fromMap(Map<String, dynamic> map) {
    return OrderItem(
      menuItemId: map['menuItemId'] ?? '',
      name: map['name'] ?? '',
      quantity: map['quantity'] ?? 1,
      price: (map['price'] ?? 0).toDouble(),
      variant: map['variant'],
      customOptions: map['customOptions'] as Map<String, dynamic>?,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'menuItemId': menuItemId,
      'name': name,
      'quantity': quantity,
      'price': price,
      'variant': variant,
      'customOptions': customOptions,
    };
  }
}
