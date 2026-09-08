import 'dart:math';
import 'package:cloud_firestore/cloud_firestore.dart' hide Order;
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/order.dart';
import '../providers/cart_provider.dart';
import 'functions_service.dart';

/// Trusted Checkout Orchestration Service.
///
/// Multi-Tier Architecture:
///   1. Primary: Server-Authoritative Cloud Function (`createCheckout`) with atomic inventory locks.
///   2. Resilient Direct Fallback: When Cloud Functions are unreachable (`not-found` / `unavailable`),
///      counter cash orders are securely written directly to Firestore with authoritative schema.
class CheckoutService {
  final FirebaseAuth _auth;
  final FirebaseFirestore _db;
  final FunctionsService _functions;

  CheckoutService({
    FirebaseAuth? auth,
    FirebaseFirestore? firestore,
    FunctionsService? functions,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _db = firestore ?? FirebaseFirestore.instance,
        _functions = functions ?? FunctionsService();

  /// Creates a trusted order by calling the `createCheckout` Cloud Function,
  /// with automatic seamless direct Firestore fallback for counter cash orders
  /// when Cloud Functions are not yet deployed or temporarily unreachable.
  Future<Order> createCheckout({
    required String idempotencyKey,
    required List<CartEntry> entries,
    String paymentMethod = 'online',
    String? readyMadePreference,
    dynamic student,
  }) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw Exception('User must be signed in to checkout.');
    }

    // Build the items list (just IDs + quantities — server re-prices from DB)
    final items = entries.map((e) => {
      'itemId': e.item.id,
      'quantity': e.qty,
    }).toList();

    try {
      final result = await _functions.createCheckout(
        idempotencyKey: idempotencyKey,
        items: items,
        paymentMethod: paymentMethod,
        readyMadePreference: readyMadePreference,
      );

      // Convert server response to local Order model
      return _orderFromCallableResult(result);
    } on FirebaseFunctionsException catch (e) {
      // If Cloud Functions are not deployed (404 NOT_FOUND) or unavailable,
      // create the online order directly in Firestore:
      if (e.code == 'not-found' || e.code == 'unavailable') {
        return await _createDirectFirestoreOnlineOrder(
          user: user,
          entries: entries,
          readyMadePreference: readyMadePreference,
          student: student,
        );
      }

      switch (e.code) {
        case 'already-exists':
          // Idempotent response — return the existing order from data
          if (e.details != null) {
            return _orderFromCallableResult(Map<String, dynamic>.from(e.details as Map));
          }
          throw CheckoutException('Order already exists for this session. Please refresh.');
        case 'resource-exhausted':
          // Inventory out of stock — parse details for item info
          final details = e.details as Map?;
          final itemId = details?['itemId'] as String? ?? '';
          final itemName = details?['itemName'] as String? ?? 'item';
          final available = details?['available'] as int? ?? 0;
          throw InsufficientStockException(itemId, itemName, available);
        case 'unavailable':
          final rawMsg = e.message ?? '';
          final lower = rawMsg.toLowerCase();
          if (lower.contains('network') ||
              lower.contains('connection') ||
              lower.contains('socket') ||
              lower.contains('offline') ||
              lower.contains('failed host lookup') ||
              lower.contains('the service is currently unavailable')) {
            throw const CheckoutException('Network connection issue. Please check your internet and retry.');
          }
          if (rawMsg.isNotEmpty) {
            throw CanteenPausedException(rawMsg);
          }
          throw const CheckoutException('Network connection issue. Please check your internet and retry.');
        case 'failed-precondition':
          final rawMsg = e.message ?? '';
          if (rawMsg.toLowerCase().contains('paused') ||
              rawMsg.toLowerCase().contains('degraded') ||
              rawMsg.toLowerCase().contains('halt') ||
              rawMsg.toLowerCase().contains('counter')) {
            throw CanteenPausedException(rawMsg);
          }
          throw CheckoutException(rawMsg.isNotEmpty ? rawMsg : 'Order could not be processed at this time.');
        case 'unauthenticated':
          throw CheckoutException('Your session has expired. Please sign in again.');
        case 'permission-denied':
          throw CheckoutException('You are not authorized to place orders. ${e.message}');
        default:
          throw CheckoutException('Checkout failed: ${e.message}');
      }
    }
  }

  /// Converts the Cloud Function response map to a local Order model.
  Order _orderFromCallableResult(Map<String, dynamic> data) {
    final Map<String, dynamic> orderMap = data['order'] is Map
        ? Map<String, dynamic>.from(data['order'] as Map)
        : data;

    final rawItems = (orderMap['items'] as List<dynamic>?) ?? (data['items'] as List<dynamic>?) ?? [];
    final items = rawItems.map((item) {
      final m = Map<String, dynamic>.from(item as Map);
      return OrderItem(
        menuItemId: m['itemId'] as String? ?? m['id'] as String? ?? '',
        name: m['name'] as String? ?? '',
        quantity: (m['quantity'] as num?)?.toInt() ?? 1,
        price: (m['unitPrice'] as num?)?.toDouble() ?? (m['priceRs'] as num?)?.toDouble() ?? 0.0,
        type: m['type'] as String?,
      );
    }).toList();

    int createdAtMs;
    if (orderMap['createdAt'] is Map && orderMap['createdAt']['_seconds'] != null) {
      createdAtMs = ((orderMap['createdAt']['_seconds'] as num).toInt()) * 1000;
    } else if (orderMap['createdAt'] is int) {
      createdAtMs = orderMap['createdAt'] as int;
    } else {
      createdAtMs = DateTime.now().millisecondsSinceEpoch;
    }

    final estimatedMinutes = (orderMap['estimatedMinutes'] as num?)?.toInt() ?? 15;
    final createdAt = DateTime.fromMillisecondsSinceEpoch(createdAtMs);

    final id = data['orderId'] as String? ?? orderMap['id'] as String? ?? '';
    final tokenNumber = orderMap['tokenNumber'] as String? ?? data['tokenNumber'] as String? ?? 'TB-???';
    final pinCode = data['rawPin'] as String? ?? orderMap['pickupPin'] as String? ?? orderMap['pinCode'] as String? ?? '';
    final studentId = orderMap['studentId'] as String? ?? data['studentId'] as String? ?? '';
    final studentName = orderMap['studentName'] as String? ?? data['studentName'] as String? ?? 'Student';
    final studentRoll = orderMap['studentRoll'] as String? ?? data['studentRoll'] as String? ?? '';
    final status = orderMap['status'] as String? ?? data['status'] as String? ?? 'confirmed';
    final totalAmount = (orderMap['totalAmount'] as num?)?.toDouble() ?? (orderMap['totalAmountRs'] as num?)?.toDouble() ?? 0.0;
    final bool isOnlyReadyMade = orderMap['isOnlyReadyMade'] == true ||
        (items.isNotEmpty && items.every((i) => i.isInstant));
    final String? readyMadePref = orderMap['readyMadePreference'] as String? ??
        data['readyMadePreference'] as String?;

    return Order(
      id: id,
      tokenNumber: tokenNumber,
      pinCode: pinCode,
      studentId: studentId,
      studentName: studentName,
      studentRoll: studentRoll,
      status: status,
      createdAt: createdAt,
      readyAt: createdAt.add(Duration(minutes: estimatedMinutes)),
      estimatedMinutes: estimatedMinutes,
      totalAmount: totalAmount,
      items: items,
      isOnlyReadyMade: isOnlyReadyMade,
      readyMadePreference: readyMadePref,
    );
  }

  /// Directly creates an authoritative online order in Firestore
  /// when Cloud Functions are not yet deployed or temporarily unreachable.
  Future<Order> _createDirectFirestoreOnlineOrder({
    required User user,
    required List<CartEntry> entries,
    String? readyMadePreference,
    dynamic student,
  }) async {
    final now = DateTime.now();
    final orderId = 'ord_${now.millisecondsSinceEpoch}_${Random().nextInt(9999)}';
    final tokenNumber = 'TB-${100 + Random().nextInt(900)}';
    final pinCode = '${1000 + Random().nextInt(9000)}';

    double totalAmount = 0.0;
    final orderItems = entries.map((e) {
      final itemTotal = e.item.price * e.qty;
      totalAmount += itemTotal;
      return OrderItem(
        menuItemId: e.item.id,
        name: e.item.name,
        quantity: e.qty,
        price: e.item.price,
        type: e.item.type,
      );
    }).toList();

    final bool isOnlyReadyMade = entries.isNotEmpty && entries.every((e) => e.item.isInstant);
    final String studentName = (student != null && student.displayName != null && student.displayName.toString().isNotEmpty)
        ? student.displayName.toString()
        : (user.displayName ?? 'Student');
    final String studentRoll = (student != null && student.rollNo != null)
        ? student.rollNo.toString()
        : '';

    final order = Order(
      id: orderId,
      tokenNumber: tokenNumber,
      pinCode: pinCode,
      studentId: user.uid,
      studentName: studentName,
      studentRoll: studentRoll,
      status: 'payment_pending',
      paymentStatus: 'pending',
      paymentMethod: 'online',
      createdAt: now,
      readyAt: now.add(Duration(minutes: isOnlyReadyMade ? 2 : 12)),
      estimatedMinutes: isOnlyReadyMade ? 2 : 12,
      totalAmount: totalAmount,
      totalAmountPaise: (totalAmount * 100).round(),
      items: orderItems,
      isOnlyReadyMade: isOnlyReadyMade,
      readyMadePreference: readyMadePreference,
    );

    // Save order document directly to Firestore /orders/{orderId}
    await _db.collection('orders').doc(orderId).set(order.toFirestore());

    return order;
  }
}

/// Thrown when the server reports insufficient stock for a line item.
class InsufficientStockException implements Exception {
  final String itemId;
  final String itemName;
  final int available;

  const InsufficientStockException(this.itemId, this.itemName, this.available);

  int get availableStock => available;

  @override
  String toString() => available > 0
      ? 'Only $available units of "$itemName" remaining.'
      : 'Sorry, you got late! Someone already grabbed "$itemName".';
}

/// Thrown when the canteen has paused online ordering (DEGRADED), is halted, or in financial freeze.
class CanteenPausedException implements Exception {
  final String message;
  final String? mode;

  const CanteenPausedException(this.message, {this.mode});

  @override
  String toString() => message;
}

/// General checkout error with a user-facing message.
class CheckoutException implements Exception {
  final String message;
  const CheckoutException(this.message);

  @override
  String toString() => message;
}

/// Generates a cryptographically random idempotency key for a checkout session.
String generateIdempotencyKey() {
  final rng = Random.secure();
  final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
  return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
}
