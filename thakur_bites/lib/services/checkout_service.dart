import 'dart:math';
import 'package:cloud_firestore/cloud_firestore.dart' hide Order;
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/order.dart';
import '../providers/cart_provider.dart';
import 'functions_service.dart';

/// Trusted Checkout Orchestration Service.
///
/// All orders, prices, token allocation and inventory reservations are committed
/// by createCheckout. An unavailable callable is an unconfirmed checkout.
class CheckoutService {
  final FirebaseAuth _auth;
  final FirebaseFirestore _db;
  final FunctionsService _functions;

  FirebaseFirestore get db => _db;

  CheckoutService({
    FirebaseAuth? auth,
    FirebaseFirestore? firestore,
    FunctionsService? functions,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _db = firestore ?? FirebaseFirestore.instance,
        _functions = functions ?? FunctionsService();

  /// Calls createCheckout once with the caller's existing idempotency key.
  /// A retry must reuse that key so a lost response cannot duplicate an order.
  Future<Order> createCheckout({
    required String idempotencyKey,
    required List<CartEntry> entries,
    String paymentMethod = 'online',
    String? readyMadePreference,
    List<String>? dietaryPreferences,
    String? dietaryNotes,
    dynamic student,
  }) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw const CheckoutException('User must be signed in to checkout.');
    }
    if (idempotencyKey.trim().isEmpty || entries.isEmpty) {
      throw const CheckoutException('A checkout session and at least one item are required.');
    }

    // Build the items list (just IDs + quantities + customization — server re-prices from DB)
    final items = entries.map((e) => {
      'itemId': e.item.id,
      'quantity': e.qty,
      if (e.customization != null && e.customization!.isNotEmpty)
        'customization': e.customization,
    }).toList();

    try {
      final result = await _functions.createCheckout(
        idempotencyKey: idempotencyKey,
        items: items,
        paymentMethod: paymentMethod,
        readyMadePreference: readyMadePreference,
        dietaryPreferences: dietaryPreferences,
        dietaryNotes: dietaryNotes,
      );

      // Convert server response to local Order model
      final order = _orderFromCallableResult(result, expectedIdempotencyKey: idempotencyKey);
      if (order.pinCode.isNotEmpty) {
        SharedPreferences.getInstance().then((prefs) {
          prefs.setString('order_pin_${order.id}', order.pinCode);
        }).catchError((_) {});
      }
      return order;
    } on FirebaseFunctionsException catch (e) {
      switch (e.code) {
        case 'already-exists':
          // Idempotent response — return the existing order from data
          if (e.details is Map) {
            return _orderFromCallableResult(Map<String, dynamic>.from(e.details as Map), expectedIdempotencyKey: idempotencyKey);
          }
          throw CheckoutException('Order already exists for this session. Please refresh.');
        case 'resource-exhausted':
          // Inventory out of stock — parse details for item info
          final details = e.details is Map ? e.details as Map : null;
          final itemId = details?['itemId'];
          final available = details?['availableStock'] ?? details?['available'];
          if (itemId is String && itemId.isNotEmpty && available is int && available >= 0) {
            final matchingItems = entries.where((entry) => entry.item.id == itemId);
            final itemName = details?['itemName'] is String
                ? details!['itemName'] as String
                : (matchingItems.isNotEmpty ? matchingItems.first.item.name : 'item');
            throw InsufficientStockException(itemId, itemName, available);
          }
          throw CheckoutException(e.message ?? 'Checkout is temporarily busy. Please retry with the same checkout session.');
        case 'unavailable':
          final rawMsg = e.message ?? '';
          final lower = rawMsg.toLowerCase();
          final details = e.details is Map ? e.details as Map : null;
          final canteenMode = details?['canteenMode']?.toString() ?? details?['mode']?.toString();
          if (canteenMode != null && canteenMode.isNotEmpty) {
            throw CanteenPausedException(rawMsg.isNotEmpty ? rawMsg : 'Canteen ordering is paused.', mode: canteenMode);
          }
          if (lower.contains('degraded') || lower.contains('halt') || lower.contains('paused') || lower.contains('freeze')) {
            throw CanteenPausedException(rawMsg);
          }
          throw const CheckoutException('Network connection issue. Please check your internet and retry.');
        case 'failed-precondition':
          final rawMsg = e.message ?? '';
          if (rawMsg.toLowerCase().contains('paused') ||
              rawMsg.toLowerCase().contains('degraded') ||
              rawMsg.toLowerCase().contains('halt') ||
              rawMsg.toLowerCase().contains('freeze')) {
            throw CanteenPausedException(rawMsg);
          }
          throw CheckoutException(rawMsg.isNotEmpty ? rawMsg : 'Order could not be processed at this time.');
        case 'unauthenticated':
          throw CheckoutException('Your session has expired. Please sign in again.');
        case 'permission-denied':
          throw CheckoutException('You are not authorized to place orders. ${e.message}');
        case 'not-found':
          throw CheckoutException(e.message ?? 'Checkout service or profile setup is unavailable. Please retry.');
        case 'internal':
        case 'deadline-exceeded':
          throw const CheckoutException('The server could not confirm checkout. Retry with the same checkout session.');
        default:
          throw CheckoutException('Checkout failed: ${e.message}');
      }
    } catch (e) {
      if (e is CheckoutException || e is InsufficientStockException || e is CanteenPausedException) {
        rethrow;
      }
      throw const CheckoutException('Unable to confirm checkout. Check your connection and retry with the same checkout session.');
    }
  }

  /// Converts the Cloud Function response map to a local Order model.
  Order _orderFromCallableResult(Map<String, dynamic> data, {required String expectedIdempotencyKey}) {
    final Map<String, dynamic> orderMap = data['order'] is Map
        ? Map<String, dynamic>.from(data['order'] as Map)
        : data;

    final responseId = data['orderId'] ?? orderMap['id'];
    final responsePaise = orderMap['totalAmountPaise'] ?? data['amountPaise'];
    final rawItems = orderMap['items'];
    if (data['success'] == false || responseId is! String || responseId.isEmpty
        || orderMap['studentId'] != _auth.currentUser?.uid || _auth.currentUser == null
        || orderMap['idempotencyKey'] != expectedIdempotencyKey
        || orderMap['tokenNumber'] is! String || (orderMap['tokenNumber'] as String).isEmpty
        || orderMap['status'] is! String || orderMap['paymentStatus'] is! String
        || !const ['online', 'counter_cash'].contains(orderMap['paymentMethod'])
        || responsePaise is! int || responsePaise < 0
        || rawItems is! List || rawItems.isEmpty) {
      throw const CheckoutException('The server did not return a complete order receipt. Retry with the same checkout session.');
    }
    final items = rawItems.map((item) {
      if (item is! Map) throw const CheckoutException('Invalid item in the server order receipt. Please retry.');
      final m = Map<String, dynamic>.from(item);
      final price = m['unitPrice'] ?? m['priceRs'];
      if (m['itemId'] is! String || (m['itemId'] as String).isEmpty || m['name'] is! String
          || m['quantity'] is! int || (m['quantity'] as int) <= 0
          || price is! num || !price.isFinite || price < 0) {
        throw const CheckoutException('Invalid item in the server order receipt. Please retry.');
      }
      return OrderItem(
        menuItemId: m['itemId'] as String? ?? m['id'] as String? ?? '',
        name: m['name'] as String? ?? '',
        quantity: (m['quantity'] as num?)?.toInt() ?? 1,
        price: (m['unitPrice'] as num?)?.toDouble() ?? (m['priceRs'] as num?)?.toDouble() ?? 0.0,
        type: m['type'] as String?,
        customization: m['customization'] as String?,
      );
    }).toList();

    int createdAtMs;
    final rawCreatedAt = orderMap['createdAt'];
    if (rawCreatedAt is Timestamp) {
      createdAtMs = rawCreatedAt.millisecondsSinceEpoch;
    } else if (rawCreatedAt is Map && (rawCreatedAt['_seconds'] ?? rawCreatedAt['seconds']) is num) {
      createdAtMs = ((rawCreatedAt['_seconds'] ?? rawCreatedAt['seconds']) as num).toInt() * 1000;
    } else if (orderMap['createdAt'] is int) {
      createdAtMs = orderMap['createdAt'] as int;
    } else {
      throw const CheckoutException('The server order receipt has no creation timestamp. Please retry.');
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
    final totalAmount = responsePaise / 100.0;
    final paymentStatus = orderMap['paymentStatus'] as String? ?? data['paymentStatus'] as String? ?? 'pending';
    final paymentMethod = orderMap['paymentMethod'] as String? ?? data['paymentMethod'] as String? ?? 'online';
    final gatewayOrderId = orderMap['gatewayOrderId'] as String? ?? data['gatewayOrderId'] as String?;
    final totalAmountPaise = responsePaise;
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
      paymentStatus: paymentStatus,
      paymentMethod: paymentMethod,
      gatewayOrderId: gatewayOrderId,
      totalAmountPaise: totalAmountPaise,
      createdAt: createdAt,
      readyAt: createdAt.add(Duration(minutes: estimatedMinutes)),
      estimatedMinutes: estimatedMinutes,
      totalAmount: totalAmount,
      items: items,
      isOnlyReadyMade: isOnlyReadyMade,
      readyMadePreference: readyMadePref,
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
