import 'dart:math';
import 'package:cloud_firestore/cloud_firestore.dart' hide Order;
import 'package:firebase_auth/firebase_auth.dart';
import '../models/order.dart';
import '../providers/cart_provider.dart';
import 'firestore_service.dart';

/// Trusted Checkout & Inventory Engine Service.
/// Implements ACID transaction ordering, true idempotency, authoritative price calculations,
/// and writes to immutable audit ledgers (`inventoryLedger`, `orderEvents`).
class CheckoutService {
  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  CheckoutService({
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
  })  : _db = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;

  /// Creates a trusted order with authoritative pricing, idempotency, and atomic stock reservation.
  Future<Order> createCheckout({
    required String idempotencyKey,
    required List<CartEntry> entries,
    dynamic student,
  }) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw Exception('User must be signed in to checkout.');
    }

    final studentId = user.uid;

    // 1. True Idempotency Lookup: Check if an order already exists for this idempotencyKey
    final existingQuery = await _db
        .collection('orders')
        .where('idempotencyKey', isEqualTo: idempotencyKey)
        .where('studentId', isEqualTo: studentId)
        .limit(1)
        .get();

    if (existingQuery.docs.isNotEmpty) {
      final existingDoc = existingQuery.docs.first;
      return Order.fromFirestore(existingDoc.id, existingDoc.data());
    }

    final now = DateTime.now();
    final dateStr =
        '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    final sequenceDocRef = _db.collection('counters').doc('orders_$dateStr');
    final newOrderRef = _db.collection('orders').doc();
    final userDocRef = _db.collection('users').doc(studentId);
    final studentDocRef = _db.collection('students').doc(studentId);

    // Collect unique menu item references
    final itemRefs = <String, DocumentReference<Map<String, dynamic>>>{};
    for (final entry in entries) {
      itemRefs[entry.item.id] = _db.collection('menuItems').doc(entry.item.id);
    }

    return await _db.runTransaction<Order>((transaction) async {
      // ═════════════════════════════════════════════════════════════
      // 1. ALL READS FIRST (Strict Firestore Transaction Invariant)
      // ═════════════════════════════════════════════════════════════
      final itemSnapshots = <String, DocumentSnapshot<Map<String, dynamic>>>{};
      for (final entry in itemRefs.entries) {
        final snap = await transaction.get(entry.value);
        itemSnapshots[entry.key] = snap;
      }

      final seqSnap = await transaction.get(sequenceDocRef);
      final userSnap = await transaction.get(userDocRef);
      final studentSnap = await transaction.get(studentDocRef);

      // ═════════════════════════════════════════════════════════════
      // 2. AUTHORITATIVE PRICING & INVENTORY VALIDATION
      // ═════════════════════════════════════════════════════════════
      double authoritativeTotal = 0.0;
      int maxPrepMinutes = 0;
      final orderItemSnapshots = <OrderItem>[];

      for (final entry in entries) {
        final snap = itemSnapshots[entry.item.id];
        if (snap == null || !snap.exists || snap.data() == null) {
          throw InsufficientStockException(entry.item.id, entry.item.name, 0);
        }

        final data = snap.data()!;
        final isAvail = data['available'] ?? false;
        final type = data['type'] ?? 'instant';
        final rawStock = (data['stockCount'] as num?)?.toInt() ?? 0;
        final currentStock = rawStock.clamp(0, 999999);
        final authoritativePrice =
            (data['price'] as num?)?.toDouble() ?? entry.item.price;
        final prepMinutes =
            (data['prepMinutes'] as num?)?.toInt() ?? entry.item.prepMinutes;

        if (!isAvail) {
          throw InsufficientStockException(
              entry.item.id, data['name'] ?? entry.item.name, 0);
        }

        if (type == 'instant' && entry.qty > currentStock) {
          throw InsufficientStockException(
            entry.item.id,
            data['name'] ?? entry.item.name,
            currentStock,
          );
        }

        final subtotal = authoritativePrice * entry.qty;
        authoritativeTotal += subtotal;
        if (prepMinutes > maxPrepMinutes) {
          maxPrepMinutes = prepMinutes;
        }

        orderItemSnapshots.add(OrderItem(
          menuItemId: entry.item.id,
          name: data['name'] ?? entry.item.name,
          quantity: entry.qty,
          price: authoritativePrice, // Authoritative price from DB snapshot
        ));
      }

      // ═════════════════════════════════════════════════════════════
      // 3. GENERATE DAILY SEQUENTIAL TOKEN (TB-001, TB-002, ...)
      // ═════════════════════════════════════════════════════════════
      int nextSequence = 1;
      if (seqSnap.exists && seqSnap.data() != null) {
        final currentCount = (seqSnap.data()!['count'] as num?)?.toInt() ?? 0;
        nextSequence = currentCount + 1;
      }
      final tokenNumber = 'TB-${nextSequence.toString().padLeft(3, '0')}';

      // 4-digit pickup verification PIN
      final rng = Random();
      final pin = 1000 + rng.nextInt(9000);
      final pinCode = '$pin';

      final studentName = student?.displayName ??
          student?.name ??
          userSnap.data()?['displayName'] ??
          studentSnap.data()?['name'] ??
          'Customer';
      final studentRoll = student?.rollNo ??
          userSnap.data()?['rollNo'] ??
          studentSnap.data()?['rollNo'] ??
          (userSnap.data()?['accountType'] == 'TEACHER' ? 'FACULTY' : 'TCET');

      final order = Order(
        id: newOrderRef.id,
        tokenNumber: tokenNumber,
        pinCode: pinCode,
        studentId: studentId,
        studentName: studentName,
        studentRoll: studentRoll,
        status: 'confirmed',
        createdAt: now,
        readyAt: now.add(Duration(minutes: maxPrepMinutes)),
        estimatedMinutes: maxPrepMinutes,
        totalAmount: authoritativeTotal,
        items: orderItemSnapshots,
      );

      // ═════════════════════════════════════════════════════════════
      // 4. ALL ATOMIC WRITES (Inventory, Ledger, Sequence, Order)
      // ═════════════════════════════════════════════════════════════

      // a. Decrement store inventory & log to immutable inventoryLedger
      for (final entry in entries) {
        final snap = itemSnapshots[entry.item.id]!;
        final data = snap.data()!;
        final type = data['type'] ?? 'instant';
        if (type == 'instant') {
          final rawStock = (data['stockCount'] as num?)?.toInt() ?? 0;
          final currentStock = rawStock.clamp(0, 999999);
          final newStock = (currentStock - entry.qty).clamp(0, 999999);

          transaction.update(itemRefs[entry.item.id]!, {
            'stockCount': newStock,
            'available': newStock > 0,
          });

          // Write to immutable inventoryLedger
          final ledgerRef = _db.collection('inventoryLedger').doc();
          transaction.set(ledgerRef, {
            'itemId': entry.item.id,
            'orderId': newOrderRef.id,
            'changeType': 'CHECKOUT_RESERVE',
            'deltaUnits': -entry.qty,
            'previousAvailable': currentStock,
            'newAvailable': newStock,
            'actorId': studentId,
            'timestamp': Timestamp.fromDate(now),
          });
        }
      }

      // b. Update daily sequence counter
      transaction.set(
        sequenceDocRef,
        {
          'date': dateStr,
          'count': nextSequence,
          'lastUpdatedAt': Timestamp.fromDate(now),
        },
        SetOptions(merge: true),
      );

      // c. Create order document with idempotencyKey
      final orderData = order.toFirestore();
      orderData['idempotencyKey'] = idempotencyKey;
      transaction.set(newOrderRef, orderData);

      // d. Record immutable orderEvent
      final eventRef = _db.collection('orderEvents').doc();
      transaction.set(eventRef, {
        'orderId': newOrderRef.id,
        'fromStatus': 'draft',
        'toStatus': 'confirmed',
        'actorId': studentId,
        'actorRole': 'student',
        'timestamp': Timestamp.fromDate(now),
        'metadata': {
          'totalAmount': authoritativeTotal,
          'tokenNumber': tokenNumber,
          'itemCount': orderItemSnapshots.length,
        },
      });

      // e. Increment user / student order count
      if (userSnap.exists) {
        final currentTotal =
            (userSnap.data()?['totalOrders'] as num?)?.toInt() ?? 0;
        final currentSpent =
            (userSnap.data()?['totalSpentPaise'] as num?)?.toInt() ?? 0;
        final newSpent = currentSpent + (authoritativeTotal * 100).round();
        final newTotal = currentTotal + 1;
        transaction.update(userDocRef, {
          'totalOrders': newTotal,
          'totalSpentPaise': newSpent,
          'averageOrderPaise': (newSpent / newTotal).round(),
          'lastOrderAt': Timestamp.fromDate(now),
          'updatedAt': Timestamp.fromDate(now),
        });
      } else if (studentSnap.exists) {
        final currentTotal =
            (studentSnap.data()?['totalOrders'] as num?)?.toInt() ?? 0;
        transaction.update(studentDocRef, {
          'totalOrders': currentTotal + 1,
        });
      }

      return order;
    });
  }
}
