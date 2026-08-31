/// Thakur Bites — Menu Item Model (Phase 2, 11 & Stock Inventory)
/// Maps to the `menuItems` Firestore collection.
class MenuItem {
  final String id;
  final String name;
  final double price;
  final String category; // "dosa" | "rotibhaji" | "drinks" | "snacks"
  final String type; // "cooked" | "instant"
  final int prepMinutes; // 0 for instant items
  final bool available; // staff toggle (Phase 11)
  final int stockCount; // for instant store items (chocolates, drinks, chips)
  final String? batchDate; // optional restock / batch date
  final String imageUrl; // real photos (Phase 14)
  final String iconKey; // placeholder icon key

  MenuItem({
    required this.id,
    required this.name,
    required this.price,
    required this.category,
    required this.type,
    required this.prepMinutes,
    this.available = true,
    this.stockCount = 100,
    this.batchDate,
    this.imageUrl = '',
    this.iconKey = '',
  });

  bool get isCooked => type == 'cooked';
  bool get isInstant => type == 'instant';

  /// An item is truly in-stock if available == true AND (if instant) stockCount > 0
  bool get isInStock => available && (!isInstant || stockCount > 0);

  /// Human-friendly badge: "~6 min" for cooked, "Ready now" / "X left" for instant
  String get badgeText {
    if (isCooked) return '~$prepMinutes min';
    if (!isInStock) return 'Out of stock';
    if (stockCount <= 5 && stockCount > 0) return 'Only $stockCount left!';
    return 'Ready now';
  }

  factory MenuItem.fromFirestore(String docId, Map<String, dynamic> data) {
    final isAvail = data['available'] ?? true;
    final stock = data['stockCount'] != null ? (data['stockCount'] as num).toInt() : (isAvail ? 50 : 0);
    final type = data['type'] ?? 'instant';

    return MenuItem(
      id: docId,
      name: data['name'] ?? '',
      price: (data['price'] ?? 0).toDouble(),
      category: data['category'] ?? '',
      type: type,
      prepMinutes: data['prepMinutes'] ?? 0,
      available: isAvail && (type != 'instant' || stock > 0),
      stockCount: stock,
      batchDate: data['batchDate'],
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
      'stockCount': stockCount,
      'batchDate': batchDate,
      'imageUrl': imageUrl,
      'iconKey': iconKey,
    };
  }

  MenuItem copyWith({
    String? name,
    double? price,
    String? category,
    String? type,
    int? prepMinutes,
    bool? available,
    int? stockCount,
    String? batchDate,
    String? imageUrl,
    String? iconKey,
  }) {
    return MenuItem(
      id: id,
      name: name ?? this.name,
      price: price ?? this.price,
      category: category ?? this.category,
      type: type ?? this.type,
      prepMinutes: prepMinutes ?? this.prepMinutes,
      available: available ?? this.available,
      stockCount: stockCount ?? this.stockCount,
      batchDate: batchDate ?? this.batchDate,
      imageUrl: imageUrl ?? this.imageUrl,
      iconKey: iconKey ?? this.iconKey,
    );
  }
}
