// Thakur Bites — Menu Item Model
// Maps to the `menuItems` Firestore collection.
//
// Stock architecture: the backend (Firestore) is the single source of truth.
// Students see availability indicators (🟢/🟡/🔴), never exact stock counts.
// Staff sees exact counts in the Staff Hub.

/// Availability level shown to students instead of exact numbers.
enum AvailabilityLevel { available, limited, soldOut }

class MenuItem {
  final String id;
  final String name;
  final double price;
  final String category; // "dosa" | "rotibhaji" | "drinks" | "snacks"
  final String type; // "cooked" | "instant"
  final int prepMinutes; // 0 for instant items
  final bool available; // staff toggle
  final int stockCount; // internal only — never shown to students
  final String? batchDate; // optional restock / batch date
  final String imageUrl; // real photos (future)
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

  /// Availability level for student-facing UI (never shows exact counts)
  AvailabilityLevel get availabilityLevel {
    if (!isInStock) return AvailabilityLevel.soldOut;
    if (isInstant && stockCount <= 5 && stockCount > 0) return AvailabilityLevel.limited;
    return AvailabilityLevel.available;
  }

  /// Student-facing badge text — NEVER shows exact stock numbers.
  /// 🟢 Available / 🟡 Few left / 🔴 Sold out
  String get badgeText {
    if (isCooked) {
      if (!available) return 'Sold out';
      return '~$prepMinutes min';
    }
    switch (availabilityLevel) {
      case AvailabilityLevel.available:
        return 'Available';
      case AvailabilityLevel.limited:
        return 'Few left';
      case AvailabilityLevel.soldOut:
        return 'Sold out';
    }
  }

  factory MenuItem.fromFirestore(String docId, Map<String, dynamic> data) {
    final isAvail = data['available'] ?? true;
    final type = data['type'] ?? 'instant';
    final rawStock = data['stockCount'] != null ? (data['stockCount'] as num).toInt() : (type == 'cooked' ? 100 : 0);
    final stock = rawStock.clamp(0, 999999);

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
