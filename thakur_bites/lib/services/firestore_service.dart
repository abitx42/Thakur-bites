import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/menu_item.dart';

/// Firestore service for Thakur Bites.
/// Handles all database operations — read, write, real-time streams.
class FirestoreService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  // ─── Collection References ────────────────────────────────────────
  CollectionReference<Map<String, dynamic>> get _menuItems =>
      _db.collection('menuItems');

  // ─── Menu Items (Stream) ──────────────────────────────────────────

  /// Real-time stream of available menu items.
  /// Uses a stream (not one-time .get()) so live stock/availability
  /// changes propagate instantly — costs nothing extra and future-proofs
  /// for Phase 11 staff toggles.
  Stream<List<MenuItem>> menuItemsStream() {
    return _menuItems
        .where('available', isEqualTo: true)
        .snapshots()
        .map((snapshot) => snapshot.docs
            .map((doc) => MenuItem.fromFirestore(doc.id, doc.data()))
            .toList());
  }

  /// Write a menu item to Firestore (uses item.id as document ID)
  Future<void> writeMenuItem(MenuItem item) async {
    await _menuItems.doc(item.id).set(item.toFirestore());
  }

  /// Read a single menu item by ID
  Future<MenuItem?> readMenuItem(String itemId) async {
    final doc = await _menuItems.doc(itemId).get();
    if (!doc.exists || doc.data() == null) return null;
    return MenuItem.fromFirestore(doc.id, doc.data()!);
  }

  /// Read all menu items (one-shot)
  Future<List<MenuItem>> readAllMenuItems() async {
    final snapshot = await _menuItems.get();
    return snapshot.docs
        .map((doc) => MenuItem.fromFirestore(doc.id, doc.data()))
        .toList();
  }

  /// Delete a menu item
  Future<void> deleteMenuItem(String itemId) async {
    await _menuItems.doc(itemId).delete();
  }

  // ─── Seed Demo Data (Phase 2) ─────────────────────────────────────

  /// Clears existing menu items and seeds the 6 items from the Phase 2 spec.
  Future<void> seedPhase2MenuItems() async {
    // Delete old Phase 1 items first
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
      ),
      MenuItem(
        id: 'roti_bhaji',
        name: 'Roti-Bhaji',
        price: 40,
        category: 'rotibhaji',
        type: 'cooked',
        prepMinutes: 8,
      ),
      MenuItem(
        id: 'masala_chai',
        name: 'Masala Chai',
        price: 15,
        category: 'drinks',
        type: 'cooked',
        prepMinutes: 3,
      ),
      MenuItem(
        id: 'cold_drink',
        name: 'Cold Drink',
        price: 20,
        category: 'drinks',
        type: 'instant',
        prepMinutes: 0,
      ),
      MenuItem(
        id: 'chocolate',
        name: 'Chocolate',
        price: 15,
        category: 'snacks',
        type: 'instant',
        prepMinutes: 0,
      ),
      MenuItem(
        id: 'chips',
        name: 'Chips',
        price: 20,
        category: 'snacks',
        type: 'instant',
        prepMinutes: 0,
      ),
    ];

    for (final item in demoItems) {
      await writeMenuItem(item);
    }
  }
}
