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
  final String category; // "dosa" | "rotibhaji" | "drinks" | "snacks" | canonical category name
  final String parentCategory; // "FOOD" | "SNACKS" | "BEVERAGES" | "DESSERTS"
  final String subCategory; // "Dosa", "Noodles", "Sandwiches", etc.
  final String dietaryType; // "VEG" | "NON_VEG" | "EGG"
  final String description;
  final String type; // "cooked" | "instant"
  final int prepMinutes; // 0 for instant items
  final bool available; // staff toggle
  final bool isArchived; // soft delete flag
  final int stockOnHand; // physical units on premise
  final int reservedStock; // locked by active checkouts
  final String? batchDate; // optional restock / batch date
  final String imageUrl; // real photos (future)
  final String iconKey; // placeholder icon key
  final int displayOrder; // sort weight

  MenuItem({
    required this.id,
    required this.name,
    required this.price,
    required this.category,
    String? parentCategory,
    String? subCategory,
    this.dietaryType = 'VEG',
    this.description = '',
    required this.type,
    required this.prepMinutes,
    this.available = true,
    this.isArchived = false,
    int? stockOnHand,
    this.reservedStock = 0,
    int? stockCount,
    this.batchDate,
    this.imageUrl = '',
    this.iconKey = '',
    this.displayOrder = 0,
  })  : parentCategory = parentCategory ?? _inferParentCategory(category),
        subCategory = subCategory ?? category,
        stockOnHand = stockOnHand ?? (stockCount ?? 100);

  static String _inferParentCategory(String cat) {
    final lower = cat.toLowerCase();
    if (lower.contains('drink') || lower.contains('tea') || lower.contains('coffee') || lower.contains('juice') || lower.contains('shake') || lower.contains('beverage')) {
      return 'BEVERAGES';
    }
    if (lower.contains('snack') || lower.contains('fries') || lower.contains('pav') || lower.contains('samosa') || lower.contains('vada')) {
      return 'SNACKS';
    }
    return 'FOOD';
  }

  /// Price in Indian Paise (server-authoritative integer representation)
  int get pricePaise => (price * 100).round();
  int get effectivePricePaise => pricePaise;

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

    final isArchived = data['isArchived'] == true;
    final category = data['category'] ?? '';
    final parentCategory = data['parentCategory'] as String?;
    final subCategory = data['subCategory'] as String?;
    final dietaryType = (data['dietaryType'] as String?) ?? 'VEG';
    final description = (data['description'] as String?) ?? '';
    final displayOrder = ((data['displayOrder'] ?? 0) as num).toInt();

    return MenuItem(
      id: docId,
      name: data['name'] ?? '',
      price: (data['price'] ?? 0).toDouble(),
      category: category,
      parentCategory: parentCategory,
      subCategory: subCategory,
      dietaryType: dietaryType,
      description: description,
      type: type,
      prepMinutes: data['prepMinutes'] ?? 0,
      available: !isArchived && isAvail && (type != 'instant' || effectiveAvailable > 0),
      isArchived: isArchived,
      stockOnHand: stockOnHand,
      reservedStock: reservedStock,
      batchDate: data['batchDate'],
      imageUrl: data['imageUrl'] ?? '',
      iconKey: data['iconKey'] ?? data['category'] ?? '',
      displayOrder: displayOrder,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      'price': price,
      'category': category,
      'parentCategory': parentCategory,
      'subCategory': subCategory,
      'dietaryType': dietaryType,
      'description': description,
      'type': type,
      'prepMinutes': prepMinutes,
      'available': available,
      'isArchived': isArchived,
      'stockOnHand': stockOnHand,
      'reservedStock': reservedStock,
      'stockCount': availableStock, // legacy field write for old clients
      'batchDate': batchDate,
      'imageUrl': imageUrl,
      'iconKey': iconKey,
      'displayOrder': displayOrder,
    };
  }

  MenuItem copyWith({
    String? name,
    double? price,
    String? category,
    String? parentCategory,
    String? subCategory,
    String? dietaryType,
    String? description,
    String? type,
    int? prepMinutes,
    bool? available,
    bool? isArchived,
    int? stockOnHand,
    int? reservedStock,
    int? stockCount,
    String? batchDate,
    String? imageUrl,
    String? iconKey,
    int? displayOrder,
  }) {
    return MenuItem(
      id: id,
      name: name ?? this.name,
      price: price ?? this.price,
      category: category ?? this.category,
      parentCategory: parentCategory ?? this.parentCategory,
      subCategory: subCategory ?? this.subCategory,
      dietaryType: dietaryType ?? this.dietaryType,
      description: description ?? this.description,
      type: type ?? this.type,
      prepMinutes: prepMinutes ?? this.prepMinutes,
      available: available ?? this.available,
      isArchived: isArchived ?? this.isArchived,
      stockOnHand: stockOnHand ?? (stockCount ?? this.stockOnHand),
      reservedStock: reservedStock ?? this.reservedStock,
      batchDate: batchDate ?? this.batchDate,
      imageUrl: imageUrl ?? this.imageUrl,
      iconKey: iconKey ?? this.iconKey,
      displayOrder: displayOrder ?? this.displayOrder,
    );
  }
}
