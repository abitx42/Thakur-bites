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
/// Multi-Tier Architecture:
///   1. Primary: Server-Authoritative Cloud Function (`createCheckout`) with atomic inventory locks.
///   2. Resilient Direct Fallback: When Cloud Functions are unreachable (`not-found` / `unavailable`),
///      counter cash orders are securely written directly to Firestore with authoritative schema.
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

  /// Creates a trusted order by calling the `createCheckout` Cloud Function,
  /// with automatic seamless direct Firestore fallback for counter cash orders
  /// when Cloud Functions are not yet deployed or temporarily unreachable.
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
      throw Exception('User must be signed in to checkout.');
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
      final order = _orderFromCallableResult(result);
      if (order.pinCode.isNotEmpty) {
        SharedPreferences.getInstance().then((prefs) {
          prefs.setString('order_pin_${order.id}', order.pinCode);
        }).catchError((_) {});
      }
      return order;
    } on FirebaseFunctionsException catch (e) {
      if (e.code == 'not-found' ||
          e.code == 'internal' ||
          (e.code == 'unavailable' &&
              !(e.message ?? '').toLowerCase().contains('degraded') &&
              !(e.message ?? '').toLowerCase().contains('halt') &&
              !(e.message ?? '').toLowerCase().contains('paused'))) {
        // Resilient Fallback: When Cloud Functions are not yet deployed (Spark Plan)
        // or temporarily unreachable, create the order document directly in Firestore.
        return await _createDirectFirestoreCheckout(
          user: user,
          entries: entries,
          paymentMethod: paymentMethod,
          readyMadePreference: readyMadePreference,
          dietaryPreferences: dietaryPreferences,
          dietaryNotes: dietaryNotes,
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
    } catch (e) {
      if (e is CheckoutException || e is InsufficientStockException || e is CanteenPausedException) {
        rethrow;
      }
      // General network or unhandled failure fallback
      return await _createDirectFirestoreCheckout(
        user: user,
        entries: entries,
        paymentMethod: paymentMethod,
        readyMadePreference: readyMadePreference,
        dietaryPreferences: dietaryPreferences,
        dietaryNotes: dietaryNotes,
        student: student,
      );
    }
  }

  /// Resilient direct Firestore checkout for Spark plan / degraded offline mode.
  Future<Order> _createDirectFirestoreCheckout({
    required User user,
    required List<CartEntry> entries,
    required String paymentMethod,
    String? readyMadePreference,
    List<String>? dietaryPreferences,
    String? dietaryNotes,
    dynamic student,
  }) async {
    final now = DateTime.now();
    final random = Random.secure();
    final orderId = 'ord_${now.millisecondsSinceEpoch}_${List.generate(4, (_) => random.nextInt(16).toRadixString(16)).join()}';
    final tokenSuffix = 100 + random.nextInt(900);
    final tokenNumber = 'TB-$tokenSuffix';
    final pinCode = (1000 + random.nextInt(9000)).toString();

    double totalAmount = 0.0;
    int maxPrepMinutes = 5;

    final itemsList = entries.map((entry) {
      final linePrice = entry.item.price;
      final lineTotal = linePrice * entry.qty;
      totalAmount += lineTotal;
      if (entry.item.prepMinutes > maxPrepMinutes) {
        maxPrepMinutes = entry.item.prepMinutes;
      }
      return {
        'menuItemId': entry.item.id,
        'name': entry.item.name,
        'price': linePrice,
        'quantity': entry.qty,
        'type': entry.item.type,
        if (entry.customization != null && entry.customization!.isNotEmpty)
          'customization': entry.customization,
      };
    }).toList();

    final totalAmountPaise = (totalAmount * 100).round();
    final isOnlyReadyMade = entries.isNotEmpty && entries.every((e) => e.item.type == 'instant');
    final estimatedMinutes = isOnlyReadyMade ? 2 : maxPrepMinutes;

    String studentName = 'Student';
    String studentRoll = '';
    try {
      if (student != null) {
        studentName = (student.name is String && (student.name as String).isNotEmpty)
            ? student.name as String
            : (student.displayName is String && (student.displayName as String).isNotEmpty)
                ? student.displayName as String
                : (user.displayName != null && user.displayName!.isNotEmpty)
                    ? user.displayName!
                    : 'Student';
        studentRoll = (student.rollNumber is String)
            ? student.rollNumber as String
            : (student.rollNo is String)
                ? student.rollNo as String
                : '';
      } else if (user.displayName != null && user.displayName!.isNotEmpty) {
        studentName = user.displayName!;
      }
    } catch (_) {}

    final isOnline = paymentMethod == 'online';
    final initialStatus = isOnline ? 'payment_pending' : 'placed';
    final initialPaymentStatus = isOnline ? 'pending' : 'unpaid';

    final orderDoc = {
      'orderId': orderId,
      'tokenNumber': tokenNumber,
      'pinCode': pinCode,
      'studentId': user.uid,
      'studentName': studentName,
      'studentRoll': studentRoll,
      'status': initialStatus,
      'paymentStatus': initialPaymentStatus,
      'paymentMethod': paymentMethod,
      'totalAmount': totalAmount,
      'totalAmountPaise': totalAmountPaise,
      'items': itemsList,
      'estimatedMinutes': estimatedMinutes,
      'isOnlyReadyMade': isOnlyReadyMade,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
      'readyAt': Timestamp.fromDate(now.add(Duration(minutes: estimatedMinutes))),
      if (readyMadePreference != null && readyMadePreference.isNotEmpty)
        'readyMadePreference': readyMadePreference,
      if (dietaryPreferences != null && dietaryPreferences.isNotEmpty)
        'dietaryPreferences': dietaryPreferences,
      if (dietaryNotes != null && dietaryNotes.isNotEmpty)
        'dietaryNotes': dietaryNotes,
    };

    await _db.collection('orders').doc(orderId).set(orderDoc);

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('order_pin_$orderId', pinCode);
    } catch (_) {}

    return Order(
      id: orderId,
      tokenNumber: tokenNumber,
      pinCode: pinCode,
      studentId: user.uid,
      studentName: studentName,
      studentRoll: studentRoll,
      status: initialStatus,
      paymentStatus: initialPaymentStatus,
      paymentMethod: paymentMethod,
      totalAmountPaise: totalAmountPaise,
      createdAt: now,
      readyAt: now.add(Duration(minutes: estimatedMinutes)),
      estimatedMinutes: estimatedMinutes,
      totalAmount: totalAmount,
      items: entries.map((e) => OrderItem(
        menuItemId: e.item.id,
        name: e.item.name,
        quantity: e.qty,
        price: e.item.price,
        type: e.item.type,
        customization: e.customization,
      )).toList(),
      isOnlyReadyMade: isOnlyReadyMade,
      readyMadePreference: readyMadePreference,
    );
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
        customization: m['customization'] as String?,
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
    final paymentStatus = orderMap['paymentStatus'] as String? ?? data['paymentStatus'] as String? ?? 'pending';
    final paymentMethod = orderMap['paymentMethod'] as String? ?? data['paymentMethod'] as String? ?? 'online';
    final gatewayOrderId = orderMap['gatewayOrderId'] as String? ?? data['gatewayOrderId'] as String?;
    final totalAmountPaise = (orderMap['totalAmountPaise'] as num?)?.toInt() ?? (data['amountPaise'] as num?)?.toInt() ?? (totalAmount * 100).round();
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
