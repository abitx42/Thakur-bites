import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import '../models/menu_item.dart';
import '../models/order.dart' as app;
import '../models/student.dart';
import '../providers/cart_provider.dart';
import 'checkout_service.dart';

// InsufficientStockException is defined in checkout_service.dart

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
        .map(
          (snapshot) => snapshot.docs
              .map((doc) => MenuItem.fromFirestore(doc.id, doc.data()))
              .toList(),
        );
  }

  /// Real-time stream of ALL menu items including out-of-stock items (for cart live stock sync).
  Stream<List<MenuItem>> allMenuItemsStream() {
    return _menuItems.snapshots().map(
      (snapshot) => snapshot.docs
          .map((doc) => MenuItem.fromFirestore(doc.id, doc.data()))
          .toList(),
    );
  }

  /// Fetch a single menu item by ID
  Future<MenuItem?> getMenuItem(String itemId) async {
    try {
      final doc = await _menuItems.doc(itemId).get();
      if (!doc.exists || doc.data() == null) return null;
      return MenuItem.fromFirestore(doc.id, doc.data()!);
    } catch (e) {
      debugPrint('Error fetching menu item $itemId: $e');
      return null;
    }
  }

  /// Pre-checkout quick validation (optimistic check).
  Future<Map<String, int>> verifyItemsStockQuantity(
    List<CartEntry> entries,
  ) async {
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
          final rawStock = (data['stockCount'] as num?)?.toInt() ?? 0;
          final stockCount = rawStock.clamp(0, 999999);

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
        stockCount: 100,
        iconKey: 'dosa',
      ),
      MenuItem(
        id: 'pav_bhaji',
        name: 'Pav Bhaji',
        price: 45,
        category: 'rotibhaji',
        type: 'cooked',
        prepMinutes: 7,
        stockCount: 100,
        imageUrl: 'assets/menu/pav_bhaji.png',
        iconKey: 'pav_bhaji',
      ),
      MenuItem(
        id: 'masala_chai',
        name: 'Masala Chai',
        price: 15,
        category: 'drinks',
        type: 'cooked',
        prepMinutes: 3,
        stockCount: 100,
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
        imageUrl: 'assets/menu/chocolate.png',
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
  /// Place an order via trusted authoritative checkout engine.
  /// (Deprecated: Prefer calling CheckoutService().createCheckout directly)
  Future<app.Order> placeOrder(
    CartProvider cart, {
    Student? student,
    String? idempotencyKey,
  }) async {
    final key = idempotencyKey ?? 'order_${DateTime.now().millisecondsSinceEpoch}';
    final checkout = CheckoutService();
    return await checkout.createCheckout(
      idempotencyKey: key,
      entries: cart.entries,
      student: student,
    );
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
        .map(
          (snapshot) => snapshot.docs
              .map((doc) => app.Order.fromFirestore(doc.id, doc.data()))
              .toList(),
        );
  }

  /// Get orders for a specific student (most recent first)
  Stream<List<app.Order>> studentOrdersStream(String studentId) {
    return _orders
        .where('studentId', isEqualTo: studentId)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map((doc) => app.Order.fromFirestore(doc.id, doc.data()))
              .toList(),
        );
  }
}
