import 'dart:math';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import '../models/menu_item.dart';
import '../models/order.dart' as app;
import '../models/student.dart';
import '../providers/cart_provider.dart';

/// Thrown inside a transaction when an item cannot fulfill the requested quantity.
class InsufficientStockException implements Exception {
  final String itemId;
  final String itemName;
  final int availableStock;

  InsufficientStockException(this.itemId, this.itemName, this.availableStock);

  @override
  String toString() => '$itemName has only $availableStock available.';
}

/// Firestore service for Thakur Bites with ACID Transaction Order Placement.
class FirestoreService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _menuItems =>
      _db.collection('menuItems');
  CollectionReference<Map<String, dynamic>> get _orders =>
      _db.collection('orders');

  /// Real-time stream of available menu items (for menu browsing).
  Stream<List<MenuItem>> menuItemsStream() {
    return _menuItems
        .where('available', isEqualTo: true)
        .snapshots()
        .map((snapshot) => snapshot.docs
            .map((doc) => MenuItem.fromFirestore(doc.id, doc.data()))
            .toList());
  }

  /// Real-time stream of ALL menu items including out-of-stock items (for cart live stock sync).
  Stream<List<MenuItem>> allMenuItemsStream() {
    return _menuItems
        .snapshots()
        .map((snapshot) => snapshot.docs
            .map((doc) => MenuItem.fromFirestore(doc.id, doc.data()))
            .toList());
  }

  /// Pre-checkout quick validation (optimistic check).
  Future<Map<String, int>> verifyItemsStockQuantity(List<CartEntry> entries) async {
    final Map<String, int> stockIssues = {};

    for (final entry in entries) {
      try {
        final doc = await _menuItems.doc(entry.item.id).get();
        if (!doc.exists || doc.data() == null) {
          stockIssues[entry.item.id] = 0;
        } else {
          final data = doc.data()!;
          final isAvailable = data['available'] ?? false;
          final type = data['type'] ?? 'instant';
          final stockCount = (data['stockCount'] as num?)?.toInt() ?? (isAvailable ? 50 : 0);

          if (!isAvailable) {
            stockIssues[entry.item.id] = 0;
          } else if (type == 'instant' && entry.qty > stockCount) {
            stockIssues[entry.item.id] = stockCount;
          }
        }
      } catch (e) {
        debugPrint('Error verifying stock for item ${entry.item.id}: $e');
      }
    }

    return stockIssues;
  }

  Future<void> writeMenuItem(MenuItem item) async {
    await _menuItems.doc(item.id).set(item.toFirestore());
  }

  Future<void> deleteMenuItem(String itemId) async {
    await _menuItems.doc(itemId).delete();
  }

  /// Clears existing items and seeds the 6 Phase 2 demo items.
  Future<void> seedPhase2MenuItems() async {
    final existing = await _menuItems.get();
    for (final doc in existing.docs) {
      await doc.reference.delete();
    }

    final demoItems = [
      MenuItem(
        id: 'masala_dosa',
        name: 'Masala Dosa',
        price: 50,
        category: 'dosa',
        type: 'cooked',
        prepMinutes: 6,
        iconKey: 'dosa',
      ),
      MenuItem(
        id: 'roti_bhaji',
        name: 'Roti-Bhaji',
        price: 40,
        category: 'rotibhaji',
        type: 'cooked',
        prepMinutes: 8,
        iconKey: 'roti',
      ),
      MenuItem(
        id: 'masala_chai',
        name: 'Masala Chai',
        price: 15,
        category: 'drinks',
        type: 'cooked',
        prepMinutes: 3,
        iconKey: 'chai',
      ),
      MenuItem(
        id: 'cold_drink',
        name: 'Cold Drink',
        price: 20,
        category: 'drinks',
        type: 'instant',
        prepMinutes: 0,
        stockCount: 20,
        batchDate: '31-Aug',
        iconKey: 'bottle',
      ),
      MenuItem(
        id: 'chocolate',
        name: 'Chocolate',
        price: 15,
        category: 'snacks',
        type: 'instant',
        prepMinutes: 0,
        stockCount: 15,
        batchDate: '31-Aug',
        iconKey: 'choc',
      ),
      MenuItem(
        id: 'chips',
        name: 'Chips',
        price: 20,
        category: 'snacks',
        type: 'instant',
        prepMinutes: 0,
        stockCount: 25,
        batchDate: '31-Aug',
        iconKey: 'chips',
      ),
    ];

    for (final item in demoItems) {
      await writeMenuItem(item);
    }
  }

  // ─── Orders (Atomic Transaction & Daily Sequential Token) ─────────

  /// Place an order atomically inside a single ACID Firestore Transaction.
  /// 1. Reads stock & validates limits atomically.
  /// 2. Reads daily sequence counter and generates sequential token (TB-001, TB-002, ...).
  /// 3. Decrements inventory stock.
  /// 4. Creates order document & updates student order count.
  /// If stock is insufficient, transaction aborts completely with zero partial writes.
  Future<app.Order> placeOrder(
    CartProvider cart, {
    Student? student,
    String? idempotencyKey,
  }) async {
    final now = DateTime.now();
    final dateStr = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    final sequenceDocRef = _db.collection('counters').doc('orders_$dateStr');
    final newOrderRef = _orders.doc();

    DocumentReference<Map<String, dynamic>>? studentDocRef;
    if (student != null) {
      studentDocRef = _db.collection('students').doc(student.uid);
    }

    // Collect document references for each unique cart item
    final itemRefs = <String, DocumentReference<Map<String, dynamic>>>{};
    for (final entry in cart.entries) {
      itemRefs[entry.item.id] = _menuItems.doc(entry.item.id);
    }

    return await _db.runTransaction<app.Order>((transaction) async {
      // ═════════════════════════════════════════════════════════════
      // 1. ALL READS FIRST (Firestore Strict Requirement)
      // ═════════════════════════════════════════════════════════════

      // a. Read menu items
      final itemSnapshots = <String, DocumentSnapshot<Map<String, dynamic>>>{};
      for (final entry in itemRefs.entries) {
        final snap = await transaction.get(entry.value);
        itemSnapshots[entry.key] = snap;
      }

      // b. Read daily sequence counter
      final seqSnap = await transaction.get(sequenceDocRef);

      // c. Read student profile if logged in
      DocumentSnapshot<Map<String, dynamic>>? studentSnap;
      if (studentDocRef != null) {
        studentSnap = await transaction.get(studentDocRef);
      }

      // ═════════════════════════════════════════════════════════════
      // 2. ATOMIC INVENTORY & AVAILABILITY VALIDATION
      // ═════════════════════════════════════════════════════════════
      for (final entry in cart.entries) {
        final snap = itemSnapshots[entry.item.id];
        if (snap == null || !snap.exists || snap.data() == null) {
          throw InsufficientStockException(entry.item.id, entry.item.name, 0);
        }

        final data = snap.data()!;
        final isAvail = data['available'] ?? false;
        final type = data['type'] ?? 'instant';
        final currentStock = (data['stockCount'] as num?)?.toInt() ?? (isAvail ? 50 : 0);

        if (!isAvail) {
          throw InsufficientStockException(entry.item.id, entry.item.name, 0);
        }

        if (type == 'instant' && entry.qty > currentStock) {
          throw InsufficientStockException(entry.item.id, entry.item.name, currentStock);
        }
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

      final estimatedMins = cart.maxPrepMinutes;
      final orderItems = cart.entries.map((e) => app.OrderItem(
            menuItemId: e.item.id,
            name: e.item.name,
            quantity: e.qty,
            price: e.item.price,
          )).toList();

      final order = app.Order(
        id: newOrderRef.id,
        tokenNumber: tokenNumber,
        pinCode: pinCode,
        studentId: student?.uid,
        studentName: student?.name,
        studentRoll: student?.rollNo,
        status: 'placed',
        createdAt: now,
        readyAt: now.add(Duration(minutes: estimatedMins)),
        estimatedMinutes: estimatedMins,
        totalAmount: cart.totalPrice,
        items: orderItems,
      );

      // ═════════════════════════════════════════════════════════════
      // 4. ALL ATOMIC WRITES AFTER READS
      // ═════════════════════════════════════════════════════════════

      // a. Decrement store inventory
      for (final entry in cart.entries) {
        final snap = itemSnapshots[entry.item.id]!;
        final data = snap.data()!;
        final type = data['type'] ?? 'instant';
        if (type == 'instant') {
          final currentStock = (data['stockCount'] as num?)?.toInt() ?? 0;
          final newStock = currentStock - entry.qty; // Guaranteed >= 0 by step 2
          transaction.update(itemRefs[entry.item.id]!, {
            'stockCount': newStock,
            'available': newStock > 0,
          });
        }
      }

      // b. Update daily sequence counter
      transaction.set(
        sequenceDocRef,
        {
          'date': dateStr,
          'count': nextSequence,
          'lastUpdatedAt': Timestamp.now(),
        },
        SetOptions(merge: true),
      );

      // c. Create order document
      final orderMap = order.toFirestore();
      if (idempotencyKey != null) {
        orderMap['idempotencyKey'] = idempotencyKey;
      }
      transaction.set(newOrderRef, orderMap);

      // d. Increment student order count
      if (studentDocRef != null) {
        final currentTotal = (studentSnap?.data()?['totalOrders'] as num?)?.toInt() ?? 0;
        transaction.update(studentDocRef, {
          'totalOrders': currentTotal + 1,
        });
      }

      return order;
    });
  }

  /// Real-time stream of a single order by ID
  Stream<app.Order?> orderStream(String orderId) {
    return _orders.doc(orderId).snapshots().map((doc) {
      if (!doc.exists || doc.data() == null) return null;
      return app.Order.fromFirestore(doc.id, doc.data()!);
    });
  }

  /// Get all orders (most recent first)
  Stream<List<app.Order>> ordersStream() {
    return _orders
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) => snapshot.docs
            .map((doc) => app.Order.fromFirestore(doc.id, doc.data()))
            .toList());
  }

  /// Get orders for a specific student (most recent first)
  Stream<List<app.Order>> studentOrdersStream(String studentId) {
    return _orders
        .where('studentId', isEqualTo: studentId)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) => snapshot.docs
            .map((doc) => app.Order.fromFirestore(doc.id, doc.data()))
            .toList());
  }
}
