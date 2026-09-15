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
  final String status; // 'payment_pending' | 'confirmed' | 'placed' | 'preparing' | 'ready' | 'collected' | 'cancelled'
  final String paymentStatus; // 'pending' | 'initiated' | 'paid' | 'captured' | 'expired' | 'cancelled'
  final String paymentMethod; // 'online' | 'counter_cash'
  final String? cancellationReason;
  final DateTime? cancelledAt;
  final int? totalAmountPaise;
  final String? gatewayOrderId;
  final String? gatewayPaymentId;
  final String? refundId;
  final int? refundedAmountPaise;
  final String? refundLifecycleStatus;
  final DateTime createdAt;
  final DateTime? readyAt;
  final int estimatedMinutes; // max prep time of all items
  final double totalAmount;
  final List<OrderItem> items;
  final DateTime? reservationExpiresAt;
  final bool isOnlyReadyMade;
  final String? readyMadePreference;
  final int? priorityLevel;
  final String? priorityReason;

  Order({
    required this.id,
    required this.tokenNumber,
    required this.pinCode,
    this.studentId,
    this.studentName,
    this.studentRoll,
    required this.status,
    this.paymentStatus = 'pending',
    this.paymentMethod = 'online',
    this.cancellationReason,
    this.cancelledAt,
    this.totalAmountPaise,
    this.gatewayOrderId,
    this.gatewayPaymentId,
    this.refundId,
    this.refundedAmountPaise,
    this.refundLifecycleStatus,
    required this.createdAt,
    this.readyAt,
    this.reservationExpiresAt,
    required this.estimatedMinutes,
    required this.totalAmount,
    required this.items,
    this.isOnlyReadyMade = false,
    this.readyMadePreference,
    this.priorityLevel,
    this.priorityReason,
  });

  /// Status progression
  static const List<String> statusFlow = [
    'confirmed',
    'preparing',
    'ready',
    'collected',
  ];

  static const List<String> customerStatusFlow = [
    'payment_pending',
    'confirmed',
    'preparing',
    'ready',
    'collected',
  ];

  /// Status helpers
  bool get isPaymentPending => status == 'payment_pending' || paymentStatus == 'pending' || paymentStatus == 'initiated';
  bool get isPaymentInitiated => paymentStatus == 'initiated';
  bool get isConfirmed => (status == 'confirmed' || status == 'placed') && !isCancelled;
  bool get isPreparing => status == 'preparing' && !isCancelled;
  bool get isReady =>
      (status == 'ready' || (isOnlyReadyMade && !isPaymentPending && !isCollected)) &&
      !isCancelled;
  bool get isCollected => status == 'collected' && !isCancelled;
  bool get isCancelled => status == 'cancelled' || paymentStatus == 'cancelled';
  bool get isOnlinePayment => paymentMethod == 'online';
  bool get isCounterCash => paymentMethod == 'counter_cash';
  bool get isPaid => paymentStatus == 'paid' || paymentStatus == 'captured';
  bool get isRefunded => paymentStatus == 'refunded' || refundId != null;
  bool get isRefundPending => paymentStatus == 'refund_pending' || refundLifecycleStatus == 'REFUND_REQUESTED';
  bool get isFacultyPriority =>
      (priorityLevel != null && priorityLevel! >= 2) ||
      priorityReason == 'FACULTY_PRIORITY_APPLIED';

  /// Pre-preparation cancellation exclusivity (INV-007, INV-014)
  bool get canCancel => !isCancelled && !isPreparing && !isReady && !isCollected;

  /// Index of current status in the flow (0-3)
  int get statusIndex {
    final idx = statusFlow.indexOf(status);
    if (idx != -1) return idx;
    if (status == 'placed') return 0;
    return 0;
  }

  /// 5-Stage Customer Tracking Index (0-4, or -1 for cancelled)
  int get customerStatusIndex {
    if (isCancelled) return -1;
    if (isPaymentPending) return 0;
    if (isCollected) return 4;
    if (isReady) return 3;
    if (isPreparing) return 2;
    if (isConfirmed) return 1;
    return 0;
  }

  /// Human-friendly status label
  String get statusLabel {
    if (isCancelled) return 'Order Cancelled';
    if (isPaymentPending) return 'Payment Pending';
    if (isCollected) return 'Collected';
    if (isOnlyReadyMade || isReady) return 'Ready for pickup';
    switch (status) {
      case 'confirmed':
      case 'placed':
        return 'Order confirmed';
      case 'preparing':
        return 'Preparing in Kitchen';
      case 'ready':
        return 'Ready for pickup';
      default:
        return status;
    }
  }

  factory Order.fromFirestore(String docId, Map<String, dynamic> data) {
    final parsedItems = (data['items'] as List<dynamic>?)
            ?.map((item) => OrderItem.fromMap(
                item is Map ? Map<String, dynamic>.from(item) : const <String, dynamic>{}))
            .toList() ??
        [];
    final onlyReadyMade = data['isOnlyReadyMade'] == true ||
        (parsedItems.isNotEmpty && parsedItems.every((i) => i.isInstant));

    return Order(
      id: docId,
      tokenNumber: data['tokenNumber'] ?? '',
      pinCode: data['pinCode'] ?? data['pickupPin'] ?? '',
      studentId: data['studentId'],
      studentName: data['studentName'],
      studentRoll: data['studentRoll'],
      status: data['status'] ?? 'confirmed',
      paymentStatus: data['paymentStatus'] ?? 'pending',
      paymentMethod: data['paymentMethod'] ?? 'online',
      cancellationReason: data['cancellationReason'] as String?,
      cancelledAt: (data['cancelledAt'] as Timestamp?)?.toDate(),
      totalAmountPaise: (data['totalAmountPaise'] as num?)?.toInt(),
      gatewayOrderId: data['gatewayOrderId'] as String?,
      gatewayPaymentId: (data['gatewayPaymentId'] ?? data['paymentId']) as String?,
      refundId: data['refundId'] as String?,
      refundedAmountPaise: (data['refundedAmountPaise'] ?? data['amountRefundedPaise']) as int?,
      refundLifecycleStatus: data['refundLifecycleStatus'] as String?,
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      readyAt: (data['readyAt'] as Timestamp?)?.toDate(),
      reservationExpiresAt: (data['reservationExpiresAt'] as Timestamp?)?.toDate(),
      estimatedMinutes: data['estimatedMinutes'] ?? 0,
      totalAmount: (data['totalAmount'] as num?)?.toDouble() ??
          (((data['totalAmountPaise'] as num?)?.toDouble() ?? 0.0) / 100.0),
      items: parsedItems,
      isOnlyReadyMade: onlyReadyMade,
      readyMadePreference: data['readyMadePreference'] as String?,
      priorityLevel: (data['priorityLevel'] as num?)?.toInt(),
      priorityReason: data['priorityReason'] as String?,
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
      'paymentStatus': paymentStatus,
      'paymentMethod': paymentMethod,
      if (cancellationReason != null) 'cancellationReason': cancellationReason,
      if (cancelledAt != null) 'cancelledAt': Timestamp.fromDate(cancelledAt!),
      'createdAt': Timestamp.fromDate(createdAt),
      'readyAt': readyAt != null ? Timestamp.fromDate(readyAt!) : null,
      if (reservationExpiresAt != null) 'reservationExpiresAt': Timestamp.fromDate(reservationExpiresAt!),
      'estimatedMinutes': estimatedMinutes,
      'totalAmount': totalAmount,
      'totalAmountPaise': totalAmountPaise ?? (totalAmount * 100).round(),
      if (gatewayOrderId != null) 'gatewayOrderId': gatewayOrderId,
      if (gatewayPaymentId != null) 'gatewayPaymentId': gatewayPaymentId,
      if (refundId != null) 'refundId': refundId,
      if (refundedAmountPaise != null) 'refundedAmountPaise': refundedAmountPaise,
      if (refundLifecycleStatus != null) 'refundLifecycleStatus': refundLifecycleStatus,
      'items': items.map((item) => item.toMap()).toList(),
      'isOnlyReadyMade': isOnlyReadyMade,
      if (readyMadePreference != null) 'readyMadePreference': readyMadePreference,
      if (priorityLevel != null) 'priorityLevel': priorityLevel,
      if (priorityReason != null) 'priorityReason': priorityReason,
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
    String? paymentStatus,
    String? paymentMethod,
    String? cancellationReason,
    DateTime? cancelledAt,
    int? totalAmountPaise,
    String? gatewayOrderId,
    String? gatewayPaymentId,
    String? refundId,
    int? refundedAmountPaise,
    String? refundLifecycleStatus,
    DateTime? createdAt,
    DateTime? readyAt,
    DateTime? reservationExpiresAt,
    int? estimatedMinutes,
    double? totalAmount,
    List<OrderItem>? items,
    bool? isOnlyReadyMade,
    String? readyMadePreference,
    int? priorityLevel,
    String? priorityReason,
  }) {
    return Order(
      id: id ?? this.id,
      tokenNumber: tokenNumber ?? this.tokenNumber,
      pinCode: pinCode ?? this.pinCode,
      studentId: studentId ?? this.studentId,
      studentName: studentName ?? this.studentName,
      studentRoll: studentRoll ?? this.studentRoll,
      status: status ?? this.status,
      paymentStatus: paymentStatus ?? this.paymentStatus,
      paymentMethod: paymentMethod ?? this.paymentMethod,
      cancellationReason: cancellationReason ?? this.cancellationReason,
      cancelledAt: cancelledAt ?? this.cancelledAt,
      totalAmountPaise: totalAmountPaise ?? this.totalAmountPaise,
      gatewayOrderId: gatewayOrderId ?? this.gatewayOrderId,
      gatewayPaymentId: gatewayPaymentId ?? this.gatewayPaymentId,
      refundId: refundId ?? this.refundId,
      refundedAmountPaise: refundedAmountPaise ?? this.refundedAmountPaise,
      refundLifecycleStatus: refundLifecycleStatus ?? this.refundLifecycleStatus,
      createdAt: createdAt ?? this.createdAt,
      readyAt: readyAt ?? this.readyAt,
      reservationExpiresAt: reservationExpiresAt ?? this.reservationExpiresAt,
      estimatedMinutes: estimatedMinutes ?? this.estimatedMinutes,
      totalAmount: totalAmount ?? this.totalAmount,
      items: items ?? this.items,
      isOnlyReadyMade: isOnlyReadyMade ?? this.isOnlyReadyMade,
      readyMadePreference: readyMadePreference ?? this.readyMadePreference,
      priorityLevel: priorityLevel ?? this.priorityLevel,
      priorityReason: priorityReason ?? this.priorityReason,
    );
  }
}

/// Individual item within an order
class OrderItem {
  final String menuItemId;
  final String name;
  final int quantity;
  final double price;
  final String? type; // 'cooked' | 'instant'
  final String? customization; // e.g. '4 Rotis, Paneer Sabji'

  OrderItem({
    required this.menuItemId,
    required this.name,
    required this.quantity,
    required this.price,
    this.type,
    this.customization,
  });

  String get itemId => menuItemId;
  bool get isInstant => type == 'instant';
  bool get isCooked => type == 'cooked';

  double get subtotal => price * quantity;

  factory OrderItem.fromMap(Map<String, dynamic> map) {
    return OrderItem(
      menuItemId: (map['menuItemId'] ?? map['itemId'] ?? '').toString(),
      name: (map['name'] ?? '').toString(),
      quantity: (map['quantity'] as num?)?.toInt() ?? 1,
      price: (map['price'] as num?)?.toDouble() ?? (map['unitPrice'] as num?)?.toDouble() ?? 0.0,
      type: map['type'] as String?,
      customization: map['customization'] as String?,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'menuItemId': menuItemId,
      'name': name,
      'quantity': quantity,
      'price': price,
      if (type != null) 'type': type,
      if (customization != null && customization!.isNotEmpty) 'customization': customization,
    };
  }
}
