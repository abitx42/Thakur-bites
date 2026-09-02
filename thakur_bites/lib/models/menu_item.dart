// Thakur Bites — Menu Item Model
// Maps to the `menuItems` Firestore collection.
//
// Stock architecture: the backend (Firestore) is the single source of truth.
// Canonical schema:
//   - `stockOnHand`: Physical stock on premise
//   - `reservedStock`: Active locks held by pending checkouts
//   - `availableStock`: stockOnHand - reservedStock (effective student-facing availability)
//
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
  final int stockOnHand; // physical units on premise
  final int reservedStock; // locked by active checkouts
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
    int? stockOnHand,
    this.reservedStock = 0,
    int? stockCount,
    this.batchDate,
    this.imageUrl = '',
    this.iconKey = '',
  }) : stockOnHand = stockOnHand ?? (stockCount ?? 100);

  /// Effective stock units available for new orders (stockOnHand - reservedStock)
  int get availableStock =>
      type == 'cooked' ? 100 : (stockOnHand - reservedStock).clamp(0, 999999);

  /// Backwards compatibility alias for code expecting `stockCount`
  int get stockCount => availableStock;

  bool get isCooked => type == 'cooked';
  bool get isInstant => type == 'instant';

  /// An item is truly in-stock if available == true AND (if instant) availableStock > 0
  bool get isInStock => available && (!isInstant || availableStock > 0);

  /// Availability level for student-facing UI (never shows exact counts)
  AvailabilityLevel get availabilityLevel {
    if (!isInStock) return AvailabilityLevel.soldOut;
    if (isInstant && availableStock <= 5 && availableStock > 0) return AvailabilityLevel.limited;
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
    
    // Canonical backend fields: stockOnHand and reservedStock
    // Fallback: legacy stockCount field
    final rawStockOnHand = (data['stockOnHand'] ?? data['stockCount'] ?? (type == 'cooked' ? 100 : 0)) as num;
    final rawReserved = (data['reservedStock'] ?? 0) as num;
    
    final stockOnHand = rawStockOnHand.toInt().clamp(0, 999999);
    final reservedStock = rawReserved.toInt().clamp(0, 999999);
    final effectiveAvailable = type == 'cooked' ? 100 : (stockOnHand - reservedStock).clamp(0, 999999);

    return MenuItem(
      id: docId,
      name: data['name'] ?? '',
      price: (data['price'] ?? 0).toDouble(),
      category: data['category'] ?? '',
      type: type,
      prepMinutes: data['prepMinutes'] ?? 0,
      available: isAvail && (type != 'instant' || effectiveAvailable > 0),
      stockOnHand: stockOnHand,
      reservedStock: reservedStock,
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
      'stockOnHand': stockOnHand,
      'reservedStock': reservedStock,
      'stockCount': availableStock, // legacy field write for old clients
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
    int? stockOnHand,
    int? reservedStock,
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
      stockOnHand: stockOnHand ?? (stockCount ?? this.stockOnHand),
      reservedStock: reservedStock ?? this.reservedStock,
      batchDate: batchDate ?? this.batchDate,
      imageUrl: imageUrl ?? this.imageUrl,
      iconKey: iconKey ?? this.iconKey,
    );
  }
}
