/// Thakur Bites — Simplified Menu Item Model (Phase 2)
/// Maps to the `menuItems` Firestore collection.
///
/// Schema:
///   name       : string   — "Masala Dosa"
///   price      : number   — 50
///   category   : string   — "dosa"
///   type       : string   — "cooked" or "instant"
///   prepMinutes: number   — 6 (0 for instant items)
///   available  : boolean  — true (staff toggle in Phase 11)
///   imageUrl   : string   — "" (real photos in Phase 14)
class MenuItem {
  final String id;
  final String name;
  final double price;
  final String category;
  final String type; // 'cooked' | 'instant'
  final int prepMinutes;
  final bool available;
  final String imageUrl;

  MenuItem({
    required this.id,
    required this.name,
    required this.price,
    required this.category,
    required this.type,
    required this.prepMinutes,
    this.available = true,
    this.imageUrl = '',
  });

  bool get isCooked => type == 'cooked';
  bool get isInstant => type == 'instant';

  /// Human-friendly badge: "~6 min" for cooked, "Ready now" for instant
  String get badgeText => isInstant ? 'Ready now' : '~$prepMinutes min';

  /// Create from Firestore document
  factory MenuItem.fromFirestore(String docId, Map<String, dynamic> data) {
    return MenuItem(
      id: docId,
      name: data['name'] ?? '',
      price: (data['price'] ?? 0).toDouble(),
      category: data['category'] ?? '',
      type: data['type'] ?? 'instant',
      prepMinutes: data['prepMinutes'] ?? 0,
      available: data['available'] ?? true,
      imageUrl: data['imageUrl'] ?? '',
    );
  }

  /// Convert to Firestore document
  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      'price': price,
      'category': category,
      'type': type,
      'prepMinutes': prepMinutes,
      'available': available,
      'imageUrl': imageUrl,
    };
  }
}
