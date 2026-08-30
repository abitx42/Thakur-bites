import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/menu_item.dart';

/// Firestore service for Thakur Bites.
class FirestoreService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _menuItems =>
      _db.collection('menuItems');

  /// Real-time stream of available menu items.
  Stream<List<MenuItem>> menuItemsStream() {
    return _menuItems
        .where('available', isEqualTo: true)
        .snapshots()
        .map((snapshot) => snapshot.docs
            .map((doc) => MenuItem.fromFirestore(doc.id, doc.data()))
            .toList());
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
        iconKey: 'bottle',
      ),
      MenuItem(
        id: 'chocolate',
        name: 'Chocolate',
        price: 15,
        category: 'snacks',
        type: 'instant',
        prepMinutes: 0,
        iconKey: 'choc',
      ),
      MenuItem(
        id: 'chips',
        name: 'Chips',
        price: 20,
        category: 'snacks',
        type: 'instant',
        prepMinutes: 0,
        iconKey: 'chips',
      ),
    ];

    for (final item in demoItems) {
      await writeMenuItem(item);
    }
  }
}
