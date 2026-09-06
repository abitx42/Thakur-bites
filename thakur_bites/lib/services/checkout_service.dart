import 'dart:math';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/order.dart';
import '../providers/cart_provider.dart';
import 'functions_service.dart';

/// Trusted Checkout Orchestration Service.
///
/// SECURITY: This service NO LONGER writes directly to Firestore.
/// All mutations (inventory reservation, order creation, counter increment)
/// are performed server-side by the `createCheckout` Cloud Function which
/// enforces: authoritative pricing, atomic inventory reservation, RBAC, App Check,
/// rate limiting, and idempotency.
///
/// The client's only job is:
///   1. Build an idempotency key
///   2. Call createCheckout callable
///   3. Receive the server-constructed Order
class CheckoutService {
  final FirebaseAuth _auth;
  final FunctionsService _functions;

  CheckoutService({
    FirebaseAuth? auth,
    FunctionsService? functions,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _functions = functions ?? FunctionsService();

  /// Creates a trusted order by calling the `createCheckout` Cloud Function.
  ///
  /// The server handles: authoritative pricing, atomic inventory reservation,
  /// sequential token generation, cryptographic PIN hashing, audit events.
  Future<Order> createCheckout({
    required String idempotencyKey,
    required List<CartEntry> entries,
    String paymentMethod = 'online',
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
      );

      // Convert server response to local Order model
      return _orderFromCallableResult(result);
    } on FirebaseFunctionsException catch (e) {
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
          throw CheckoutException('Service temporarily unavailable. Please try again in a moment.');
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
    );
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
      : '"$itemName" is out of stock.';
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
