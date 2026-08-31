import 'dart:math';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import '../models/menu_item.dart';
import '../models/order.dart' as app;
import '../models/student.dart';
import '../providers/cart_provider.dart';

/// Firestore service for Thakur Bites.
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

  /// Live atomic stock verification before order placement (Instamart / Zepto style).
  /// Returns list of item IDs that are currently out of stock.
  Future<List<String>> verifyItemsStock(List<String> itemIds) async {
    final List<String> outOfStock = [];

    for (final id in itemIds) {
      try {
        final doc = await _menuItems.doc(id).get();
        if (!doc.exists || doc.data() == null) {
          outOfStock.add(id);
        } else {
          final isAvailable = doc.data()!['available'] ?? false;
          if (!isAvailable) {
            outOfStock.add(id);
          }
        }
      } catch (e) {
        debugPrint('Error verifying stock for item $id: $e');
      }
    }

    return outOfStock;
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

  // ─── Orders ─────────────────────────────────────────────────────

  /// Place a new order from the current cart.
  /// Returns the created Order object.
  Future<app.Order> placeOrder(CartProvider cart, {Student? student}) async {
    final rng = Random();

    // Generate token number (#100–#999)
    final tokenNum = 100 + rng.nextInt(900);
    final tokenNumber = '#$tokenNum';

    // Generate 4-digit pickup pin
    final pin = 1000 + rng.nextInt(9000);
    final pinCode = '$pin';

    // Convert cart entries to OrderItems
    final orderItems = cart.entries.map((e) => app.OrderItem(
          menuItemId: e.item.id,
          name: e.item.name,
          quantity: e.qty,
          price: e.item.price,
        )).toList();

    final now = DateTime.now();
    final estimatedMins = cart.maxPrepMinutes;

    final order = app.Order(
      id: '', // Firestore will generate
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

    // Write to Firestore
    final docRef = await _orders.add(order.toFirestore());

    // If student is logged in, increment their order count
    if (student != null) {
      try {
        await _db.collection('students').doc(student.uid).update({
          'totalOrders': FieldValue.increment(1),
        });
      } catch (e) {
        debugPrint('Could not update student totalOrders: $e');
      }
    }

    // Return with the generated ID
    return app.Order(
      id: docRef.id,
      tokenNumber: order.tokenNumber,
      pinCode: order.pinCode,
      studentId: order.studentId,
      studentName: order.studentName,
      studentRoll: order.studentRoll,
      status: order.status,
      createdAt: order.createdAt,
      readyAt: order.readyAt,
      estimatedMinutes: order.estimatedMinutes,
      totalAmount: order.totalAmount,
      items: order.items,
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
