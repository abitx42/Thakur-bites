import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/menu_item.dart';

/// Firestore service for Thakur Bites.
/// Handles all database operations — read, write, real-time listeners.
class FirestoreService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  // ─── Collection References ────────────────────────────────────────
  CollectionReference<Map<String, dynamic>> get _menuItems =>
      _db.collection('menuItems');
  CollectionReference<Map<String, dynamic>> get _orders =>
      _db.collection('orders');
  DocumentReference<Map<String, dynamic>> get _dailyBoard =>
      _db.collection('dailyBoard').doc('today');

  // ─── Menu Items ───────────────────────────────────────────────────

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

  /// Read all menu items
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

  // ─── Seed Demo Data ───────────────────────────────────────────────

  /// Seeds 6 representative menu items from the existing menu catalog.
  /// Used for Phase 1 smoke testing and Phase 2 menu screen development.
  Future<void> seedDemoMenuItems() async {
    final demoItems = [
      MenuItem(
        id: 'thali_deluxe',
        name: 'Thakur Special Deluxe Thali',
        category: 'lunch_thali',
        tier: 'tier2_batch',
        station: 'thali_station',
        basePrice: 110,
        prepTime: 2,
        rating: 4.8,
        isVeg: true,
        isPopular: true,
        description:
            '2 Daily Sabjis, Dal Tadka, Jeera Rice, 4 Rotis or 4 Puris, Salad, Pickle, Roasted Papad & Sweet (Gulab Jamun).',
        customizable: true,
        options: {
          'breadChoice': ['4 Rotis', '4 Puris', '2 Roti + 2 Puri'],
        },
      ),
      MenuItem(
        id: 'masala_dosa',
        name: 'Crispy Butter Masala Dosa',
        category: 'south_indian',
        tier: 'tier3_cook',
        station: 'dosa_tawa',
        basePrice: 65,
        prepTime: 5,
        rating: 4.9,
        isVeg: true,
        isPopular: true,
        description:
            'Golden roasted fermented crepe filled with seasoned potato bhaji, served with piping hot sambhar & 2 chutneys.',
      ),
      MenuItem(
        id: 'schezwan_fried_rice',
        name: 'Veg Schezwan Fried Rice',
        category: 'chinese_wok',
        tier: 'tier3_cook',
        station: 'chinese_wok',
        basePrice: 85,
        prepTime: 7,
        rating: 4.9,
        isVeg: true,
        isPopular: true,
        hasVariants: true,
        variants: [
          MenuVariant(name: 'Half Plate', price: 55),
          MenuVariant(name: 'Full Plate', price: 85),
        ],
        description:
            'Wok-tossed basmati rice with shredded cabbage, carrots, bell peppers, spring onion and house-made fiery schezwan sauce.',
      ),
      MenuItem(
        id: 'veg_cheese_grill_sw',
        name: 'Mumbai Veg Cheese Grill Sandwich',
        category: 'sandwiches',
        tier: 'tier3_cook',
        station: 'grill_chaat',
        basePrice: 75,
        prepTime: 5,
        rating: 4.9,
        isVeg: true,
        isPopular: true,
        description:
            '3-layer jumbo bread filled with potato, cucumber, tomato, beetroot, spicy mint chutney, chaat masala and melted Amul cheese.',
      ),
      MenuItem(
        id: 'cutting_chai',
        name: 'Special Adrak Elaichi Cutting Chai',
        category: 'hot_beverages',
        tier: 'tier2_batch',
        station: 'beverage_counter',
        basePrice: 12,
        prepTime: 1,
        rating: 5.0,
        isVeg: true,
        isPopular: true,
        description:
            'Strong, aromatic tapri-style milk tea simmered with fresh crushed ginger and green cardamom.',
      ),
      MenuItem(
        id: 'cold_coffee_icecream',
        name: 'Thick Cold Coffee with Vanilla Ice Cream',
        category: 'cold_beverages',
        tier: 'tier3_cook',
        station: 'beverage_counter',
        basePrice: 60,
        prepTime: 3,
        rating: 5.0,
        isVeg: true,
        isPopular: true,
        description:
            'Rich blended espresso cold coffee poured over a scoop of vanilla ice cream and chocolate drizzle.',
      ),
    ];

    for (final item in demoItems) {
      await writeMenuItem(item);
    }
  }
}
