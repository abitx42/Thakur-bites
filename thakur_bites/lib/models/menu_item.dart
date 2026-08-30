/// Thakur Bites — Menu Item Model (Phase 2)
/// Maps to the `menuItems` Firestore collection.
class MenuItem {
  final String id;
  final String name;
  final double price;
  final String category; // "dosa" | "rotibhaji" | "drinks" | "snacks"
  final String type; // "cooked" | "instant"
  final int prepMinutes; // 0 for instant items
  final bool available; // staff toggle (Phase 11)
  final String imageUrl; // real photos (Phase 14)
  final String iconKey; // placeholder icon key until real photos

  MenuItem({
    required this.id,
    required this.name,
    required this.price,
    required this.category,
    required this.type,
    required this.prepMinutes,
    this.available = true,
    this.imageUrl = '',
    this.iconKey = '',
  });

  bool get isCooked => type == 'cooked';
  bool get isInstant => type == 'instant';

  /// Human-friendly badge: "~6 min" for cooked, "Ready now" for instant
  String get badgeText => isInstant ? 'Ready now' : '~$prepMinutes min';

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
      iconKey: data['iconKey'] ?? data['category'] ?? '',
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      'price': price,
      'category': category,
      'type': type,
      'prepMinutes': prepMinutes,
      'available': available,
      'imageUrl': imageUrl,
      'iconKey': iconKey,
    };
  }
}
