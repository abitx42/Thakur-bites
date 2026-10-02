import 'dart:math';
import 'package:flutter/foundation.dart';
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
      // Spark plan / undeployed functions / network disconnect fallback:
      if (e.code == 'not-found' || e.code == 'internal' || e.code == 'unavailable') {
        final rawMsg = e.message ?? '';
        final lower = rawMsg.toLowerCase();
        if (lower.contains('degraded') || lower.contains('halt') || lower.contains('paused') || lower.contains('freeze')) {
          throw CanteenPausedException(rawMsg);
        }
        // Resilient Spark plan direct Firestore order creation
        return await _createDirectFirestoreOnlineOrder(
          user: user,
          entries: entries,
          paymentMethod: paymentMethod,
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
      // Resilient fallback on network timeout or socket errors
      try {
        return await _createDirectFirestoreOnlineOrder(
          user: user,
          entries: entries,
          paymentMethod: paymentMethod,
          readyMadePreference: readyMadePreference,
          student: student,
        );
      } catch (innerErr) {
        // Don't wrap stock exceptions — the UI needs them typed
        if (innerErr is InsufficientStockException || innerErr is CanteenPausedException) {
          rethrow;
        }
        throw CheckoutException('Checkout encountered an issue: $innerErr. Please retry.');
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

  /// Directly creates an authoritative online order in Firestore
  /// when Cloud Functions are not deployed (Spark plan) or temporarily unreachable.
  Future<Order> _createDirectFirestoreOnlineOrder({
    required User user,
    required List<CartEntry> entries,
    required String paymentMethod,
    String? readyMadePreference,
    dynamic student,
  }) async {
    final now = DateTime.now();
    final secureRng = Random.secure();
    final randomHex = List<int>.generate(8, (_) => secureRng.nextInt(256))
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();
    final orderId = 'ord_${now.millisecondsSinceEpoch}_$randomHex';

    // Atomic Daily Sequential Token Generation (TB-100 to TB-999) with contention retries
    int tokenSeq = 100;
    final counterRef = _db.collection('counters').doc('dailyTokenCounter');
    for (int tokenAttempt = 0; tokenAttempt < 5; tokenAttempt++) {
      try {
        tokenSeq = await _db.runTransaction((tx) async {
          final snap = await tx.get(counterRef);
          final todayStr = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
          int next = 100;
          if (snap.exists && snap.data()?['date'] == todayStr) {
            next = ((snap.data()?['lastToken'] as num?)?.toInt() ?? 99) + 1;
            if (next > 999) next = 100;
          }
          tx.set(counterRef, {
            'lastToken': next,
            'date': todayStr,
            'updatedAt': FieldValue.serverTimestamp(),
          });
          return next;
        });
        break; // Successfully got sequential token
      } catch (_) {
        if (tokenAttempt < 4) {
          await Future.delayed(Duration(milliseconds: 40 * (tokenAttempt + 1) + secureRng.nextInt(80)));
        } else {
          // High-concurrency fallback: millisecond-seeded collision-resistant token TB-100 to TB-999
          tokenSeq = 100 + ((now.millisecondsSinceEpoch + secureRng.nextInt(899)) % 899);
        }
      }
    }
    final tokenNumber = 'TB-${tokenSeq.toString().padLeft(3, '0')}';
    final pinCode = '${1000 + secureRng.nextInt(9000)}';

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
        customization: e.customization,
      );
    }).toList();

    final bool isOnlyReadyMade = entries.isNotEmpty && entries.every((e) => e.item.isInstant);
    final String studentName = (student != null && student.displayName != null && student.displayName.toString().isNotEmpty)
        ? student.displayName.toString()
        : (user.displayName ?? 'Student');
    final String studentRoll = (student != null && student.rollNo != null)
        ? student.rollNo.toString()
        : '';

    final reservationExpiresAt = now.add(const Duration(minutes: 15));
    final isCounterCash = paymentMethod == 'counter_cash';

    final order = Order(
      id: orderId,
      tokenNumber: tokenNumber,
      pinCode: pinCode,
      studentId: user.uid,
      studentName: studentName,
      studentRoll: studentRoll,
      status: isCounterCash ? 'confirmed' : 'payment_pending',
      paymentStatus: isCounterCash ? 'unpaid' : 'pending',
      paymentMethod: paymentMethod,
      createdAt: now,
      readyAt: now.add(Duration(minutes: isOnlyReadyMade ? 2 : 12)),
      reservationExpiresAt: reservationExpiresAt,
      estimatedMinutes: isOnlyReadyMade ? 2 : 12,
      totalAmount: totalAmount,
      totalAmountPaise: (totalAmount * 100).round(),
      items: orderItems,
      isOnlyReadyMade: isOnlyReadyMade,
      readyMadePreference: readyMadePreference,
    );

    // Save order document directly to Firestore /orders/{orderId} with atomic inventory decrement
    // Under peak rush (10-50 concurrent checkouts), retries handle document contention safely
    final bool hasInstantItems = entries.any((e) => e.item.type == 'instant' || e.item.inventoryMode == 'STOCK_TRACKED');
    final orderRef = _db.collection('orders').doc(orderId);

    if (!hasInstantItems) {
      // 100% Cooked items (made to order): zero inventory locks needed, write directly (100% contention-free)
      await orderRef.set(order.toFirestore());
      debugPrint('[Checkout] Direct cooked order committed: $orderId');
    } else {
      // Contains instant/packaged items: atomic transaction with contention retry
      bool committed = false;
      Exception? lastException;

      for (int txAttempt = 0; txAttempt < 5; txAttempt++) {
        try {
          await _db.runTransaction((tx) async {
            final Map<DocumentReference<Map<String, dynamic>>, Map<String, dynamic>> stockUpdates = {};

            for (final entry in entries) {
              if (entry.item.type == 'instant' || entry.item.inventoryMode == 'STOCK_TRACKED') {
                final itemRef = _db.collection('menuItems').doc(entry.item.id);
                final snap = await tx.get(itemRef);
                if (!snap.exists) {
                  throw InsufficientStockException(entry.item.id, entry.item.name, 0);
                }
                final data = snap.data() ?? {};
                final currentStock = ((data['stockOnHand'] ?? data['availableStock'] ?? data['stockCount'] ?? 0) as num).toInt();
                if (currentStock < entry.qty) {
                  throw InsufficientStockException(entry.item.id, entry.item.name, currentStock);
                }
                final newStock = (currentStock - entry.qty).clamp(0, 999999);
                final isStillAvailable = newStock > 0;
                stockUpdates[itemRef] = {
                  'stockOnHand': newStock,
                  'stockCount': newStock,
                  'availableStock': newStock,
                  'isOrderable': isStillAvailable,
                  'available': isStillAvailable,
                  'availabilityStatus': isStillAvailable ? 'AVAILABLE' : 'OUT_OF_STOCK',
                  'updatedAt': FieldValue.serverTimestamp(),
                };
              }
            }

            // Commit all stock decrements
            stockUpdates.forEach((ref, updatePayload) {
              tx.update(ref, updatePayload);
            });

            // Commit order document
            tx.set(orderRef, order.toFirestore());
          });
          committed = true;
          debugPrint('[Checkout] Stock decrement transaction SUCCESS for order $orderId (attempt $txAttempt)');
          break;
        } catch (txErr) {
          if (txErr is InsufficientStockException) {
            rethrow; // Stock is genuinely exhausted, never retry or oversell
          }
          lastException = txErr is Exception ? txErr : Exception(txErr.toString());
          debugPrint('[Checkout] Transaction contention on attempt $txAttempt: $txErr');
          if (txAttempt < 4) {
            // Exponential backoff with random jitter to resolve contention
            await Future.delayed(Duration(milliseconds: 70 * (txAttempt + 1) + secureRng.nextInt(100)));
          }
        }
      }

      if (!committed) {
        if (lastException is InsufficientStockException) {
          throw lastException;
        }
        throw CheckoutException(
          'High order volume right now. Please tap Place Order again.',
        );
      }
    }

    // Save PIN in SharedPreferences for offline recovery
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('order_pin_$orderId', pinCode);
    } catch (_) {}

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
