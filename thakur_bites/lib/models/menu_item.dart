/// Thakur Bites - Menu Item Model
/// Maps directly to the `menuItems` Firestore collection.
class MenuItem {
  final String id;
  final String name;
  final String category;
  final String tier; // 'tier1_instant' | 'tier2_batch' | 'tier3_cook'
  final String station;
  final double basePrice;
  final int prepTime; // minutes
  final double rating;
  final bool isVeg;
  final bool isPopular;
  final bool isAvailable;
  final String description;
  final String? imageUrl;
  final bool hasVariants;
  final List<MenuVariant> variants;
  final bool customizable;
  final Map<String, List<String>> options; // e.g., {breadChoice: ['4 Rotis', '4 Puris']}

  MenuItem({
    required this.id,
    required this.name,
    required this.category,
    required this.tier,
    required this.station,
    required this.basePrice,
    required this.prepTime,
    required this.rating,
    this.isVeg = true,
    this.isPopular = false,
    this.isAvailable = true,
    required this.description,
    this.imageUrl,
    this.hasVariants = false,
    this.variants = const [],
    this.customizable = false,
    this.options = const {},
  });

  /// Create from Firestore document
  factory MenuItem.fromFirestore(String docId, Map<String, dynamic> data) {
    return MenuItem(
      id: docId,
      name: data['name'] ?? '',
      category: data['category'] ?? '',
      tier: data['tier'] ?? 'tier1_instant',
      station: data['station'] ?? '',
      basePrice: (data['basePrice'] ?? 0).toDouble(),
      prepTime: data['prepTime'] ?? 0,
      rating: (data['rating'] ?? 0).toDouble(),
      isVeg: data['isVeg'] ?? true,
      isPopular: data['isPopular'] ?? false,
      isAvailable: data['isAvailable'] ?? true,
      description: data['description'] ?? '',
      imageUrl: data['imageUrl'],
      hasVariants: data['hasVariants'] ?? false,
      variants: (data['variants'] as List<dynamic>?)
              ?.map((v) => MenuVariant.fromMap(v as Map<String, dynamic>))
              .toList() ??
          [],
      customizable: data['customizable'] ?? false,
      options: (data['options'] as Map<String, dynamic>?)?.map(
            (key, value) => MapEntry(
              key,
              (value as List<dynamic>).map((e) => e.toString()).toList(),
            ),
          ) ??
          {},
    );
  }

  /// Convert to Firestore document
  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      'category': category,
      'tier': tier,
      'station': station,
      'basePrice': basePrice,
      'prepTime': prepTime,
      'rating': rating,
      'isVeg': isVeg,
      'isPopular': isPopular,
      'isAvailable': isAvailable,
      'description': description,
      'imageUrl': imageUrl,
      'hasVariants': hasVariants,
      'variants': variants.map((v) => v.toMap()).toList(),
      'customizable': customizable,
      'options': options,
    };
  }
}

/// Variant option for menu items (e.g., Half/Full plate)
class MenuVariant {
  final String name;
  final double price;

  MenuVariant({required this.name, required this.price});

  factory MenuVariant.fromMap(Map<String, dynamic> map) {
    return MenuVariant(
      name: map['name'] ?? '',
      price: (map['price'] ?? 0).toDouble(),
    );
  }

  Map<String, dynamic> toMap() {
    return {'name': name, 'price': price};
  }
}
