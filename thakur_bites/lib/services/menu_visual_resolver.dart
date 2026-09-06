import 'package:flutter/material.dart';
import '../models/menu_item.dart';

/// Visual family metadata for curated rendering
class VisualFamily {
  final String key;
  final String label;
  final IconData icon;
  final String emoji;
  final Color primaryColor;
  final Color backgroundColor;

  const VisualFamily({
    required this.key,
    required this.label,
    required this.icon,
    required this.emoji,
    required this.primaryColor,
    required this.backgroundColor,
  });
}

/// The Universal Visual Resolver for Thakur Bites
class MenuVisualResolver {
  static const Map<String, VisualFamily> families = {
    // ─── South Indian ────────────────────────────────────────────────────────
    'dosa': VisualFamily(
      key: 'dosa',
      label: 'Crispy Dosa',
      icon: Icons.breakfast_dining_rounded,
      emoji: '🥞',
      primaryColor: Color(0xFFD97706),
      backgroundColor: Color(0xFFFEF3C7),
    ),
    'uttappa': VisualFamily(
      key: 'uttappa',
      label: 'Uttappa',
      icon: Icons.flatware_rounded,
      emoji: '🍳',
      primaryColor: Color(0xFFB45309),
      backgroundColor: Color(0xFFFFFBEB),
    ),
    'idli_vada': VisualFamily(
      key: 'idli_vada',
      label: 'Idli & Vada',
      icon: Icons.restaurant_rounded,
      emoji: '🥥',
      primaryColor: Color(0xFFD97706),
      backgroundColor: Color(0xFFFEF3C7),
    ),

    // ─── Sandwiches ──────────────────────────────────────────────────────────
    'sandwich_grill': VisualFamily(
      key: 'sandwich_grill',
      label: 'Grilled Sandwich',
      icon: Icons.lunch_dining_rounded,
      emoji: '🥪',
      primaryColor: Color(0xFFEA580C),
      backgroundColor: Color(0xFFFFEDD5),
    ),
    'sandwich_toast': VisualFamily(
      key: 'sandwich_toast',
      label: 'Toast Sandwich',
      icon: Icons.bakery_dining_rounded,
      emoji: '🍞',
      primaryColor: Color(0xFFD97706),
      backgroundColor: Color(0xFFFEF3C7),
    ),
    'sandwich_plain': VisualFamily(
      key: 'sandwich_plain',
      label: 'Fresh Sandwich',
      icon: Icons.lunch_dining_rounded,
      emoji: '🥪',
      primaryColor: Color(0xFF059669),
      backgroundColor: Color(0xFFD1FAE5),
    ),

    // ─── Chinese ─────────────────────────────────────────────────────────────
    'noodles': VisualFamily(
      key: 'noodles',
      label: 'Hakka Noodles',
      icon: Icons.ramen_dining_rounded,
      emoji: '🍜',
      primaryColor: Color(0xFFDC2626),
      backgroundColor: Color(0xFFFEE2E2),
    ),
    'fried_rice': VisualFamily(
      key: 'fried_rice',
      label: 'Fried Rice',
      icon: Icons.rice_bowl_rounded,
      emoji: '🍚',
      primaryColor: Color(0xFFD97706),
      backgroundColor: Color(0xFFFEF3C7),
    ),
    'manchurian': VisualFamily(
      key: 'manchurian',
      label: 'Manchurian & Chilli',
      icon: Icons.set_meal_rounded,
      emoji: '🥢',
      primaryColor: Color(0xFFB91C1C),
      backgroundColor: Color(0xFFFEE2E2),
    ),
    'chinese_soup': VisualFamily(
      key: 'chinese_soup',
      label: 'Chinese Soup',
      icon: Icons.soup_kitchen_rounded,
      emoji: '🍲',
      primaryColor: Color(0xFFC2410C),
      backgroundColor: Color(0xFFFFEDD5),
    ),

    // ─── Meals & Main Food ───────────────────────────────────────────────────
    'thali': VisualFamily(
      key: 'thali',
      label: 'Campus Thali',
      icon: Icons.dinner_dining_rounded,
      emoji: '🍱',
      primaryColor: Color(0xFFB45309),
      backgroundColor: Color(0xFFFEF3C7),
    ),
    'pav_bhaji': VisualFamily(
      key: 'pav_bhaji',
      label: 'Butter Pav Bhaji',
      icon: Icons.outdoor_grill_rounded,
      emoji: '🍛',
      primaryColor: Color(0xFFDC2626),
      backgroundColor: Color(0xFFFEE2E2),
    ),
    'meals_plate': VisualFamily(
      key: 'meals_plate',
      label: 'Meals & Roti Plate',
      icon: Icons.dinner_dining_rounded,
      emoji: '🍲',
      primaryColor: Color(0xFF0D9488),
      backgroundColor: Color(0xFFCCFBF1),
    ),

    // ─── Snacks ──────────────────────────────────────────────────────────────
    'vada_pav': VisualFamily(
      key: 'vada_pav',
      label: 'Mumbai Vada Pav',
      icon: Icons.bakery_dining_rounded,
      emoji: '🥖',
      primaryColor: Color(0xFFD97706),
      backgroundColor: Color(0xFFFEF3C7),
    ),
    'samosa_snack': VisualFamily(
      key: 'samosa_snack',
      label: 'Samosa & Snacks',
      icon: Icons.fastfood_rounded,
      emoji: '🥟',
      primaryColor: Color(0xFFB45309),
      backgroundColor: Color(0xFFFEF3C7),
    ),
    'fries': VisualFamily(
      key: 'fries',
      label: 'Crispy Fries',
      icon: Icons.fastfood_rounded,
      emoji: '🍟',
      primaryColor: Color(0xFFD97706),
      backgroundColor: Color(0xFFFEF3C7),
    ),
    'packaged_snack': VisualFamily(
      key: 'packaged_snack',
      label: 'Packaged Bites',
      icon: Icons.cookie_rounded,
      emoji: '🍫',
      primaryColor: Color(0xFF7C3AED),
      backgroundColor: Color(0xFFEDE9FE),
    ),

    // ─── Beverages ───────────────────────────────────────────────────────────
    'tea': VisualFamily(
      key: 'tea',
      label: 'Chai & Tea',
      icon: Icons.local_cafe_rounded,
      emoji: '☕',
      primaryColor: Color(0xFF92400E),
      backgroundColor: Color(0xFFFEF3C7),
    ),
    'coffee': VisualFamily(
      key: 'coffee',
      label: 'Coffee Brew',
      icon: Icons.coffee_rounded,
      emoji: '☕',
      primaryColor: Color(0xFF78350F),
      backgroundColor: Color(0xFFFFEDD5),
    ),
    'cold_drink': VisualFamily(
      key: 'cold_drink',
      label: 'Cold Drinks',
      icon: Icons.local_drink_rounded,
      emoji: '🥤',
      primaryColor: Color(0xFF0284C7),
      backgroundColor: Color(0xFFE0F2FE),
    ),
    'fresh_juice': VisualFamily(
      key: 'fresh_juice',
      label: 'Fresh Juices',
      icon: Icons.local_bar_rounded,
      emoji: '🧃',
      primaryColor: Color(0xFFEA580C),
      backgroundColor: Color(0xFFFFEDD5),
    ),
    'milkshake': VisualFamily(
      key: 'milkshake',
      label: 'Thick Milkshakes',
      icon: Icons.icecream_rounded,
      emoji: '🥛',
      primaryColor: Color(0xFFDB2777),
      backgroundColor: Color(0xFFFCE7F3),
    ),

    // ─── Default ─────────────────────────────────────────────────────────────
    'food_default': VisualFamily(
      key: 'food_default',
      label: 'Thakur Bites Food',
      icon: Icons.restaurant_rounded,
      emoji: '🍽️',
      primaryColor: Color(0xFF475569),
      backgroundColor: Color(0xFFF1F5F9),
    ),
  };

  static VisualFamily resolveFamily(MenuItem item) {
    if (item.visualKey.isNotEmpty && families.containsKey(item.visualKey)) {
      return families[item.visualKey]!;
    }
    // Fallback based on category/subCategory
    final sub = item.subCategory.toLowerCase();
    final cat = item.category.toLowerCase();
    final name = item.name.toLowerCase();

    if (sub.contains('dosa') || cat.contains('dosa') || name.contains('dosa')) return families['dosa']!;
    if (sub.contains('uttappa') || name.contains('uttappa')) return families['uttappa']!;
    if (sub.contains('sandwich') || cat.contains('sandwich') || name.contains('sandwich')) return families['sandwich_grill']!;
    if (sub.contains('noodle') || cat.contains('chinese') || name.contains('noodle')) return families['noodles']!;
    if (sub.contains('rice') || name.contains('rice')) return families['fried_rice']!;
    if (sub.contains('pav bhaji') || name.contains('pav bhaji')) return families['pav_bhaji']!;
    if (sub.contains('thali') || name.contains('thali')) return families['thali']!;
    if (sub.contains('fries') || name.contains('fries')) return families['fries']!;
    if (sub.contains('tea') || name.contains('chai') || cat.contains('tea')) return families['tea']!;
    if (sub.contains('coffee') || name.contains('coffee') || cat.contains('coffee')) return families['coffee']!;
    if (sub.contains('shake') || name.contains('shake')) return families['milkshake']!;
    if (sub.contains('juice') || name.contains('juice')) return families['fresh_juice']!;
    if (sub.contains('drink') || cat.contains('drink') || name.contains('soda')) return families['cold_drink']!;
    if (item.parentCategory == 'BEVERAGES') return families['cold_drink']!;
    if (item.parentCategory == 'SNACKS') return families['fries']!;

    return families['food_default']!;
  }
}

/// Widget providing 3-tier visual rendering:
/// Tier 1: Real Photo (imageUrl)
/// Tier 2: Visual Family Container with curated colors and family icon
/// Tier 3: Icon fallback with zero broken images or empty space
class MenuVisualWidget extends StatelessWidget {
  final MenuItem item;
  final double width;
  final double height;
  final double borderRadius;

  const MenuVisualWidget({
    super.key,
    required this.item,
    this.width = 90,
    this.height = 70,
    this.borderRadius = 12,
  });

  @override
  Widget build(BuildContext context) {
    final family = MenuVisualResolver.resolveFamily(item);

    // Tier 1: Real Item Photo if available
    if (item.imageUrl.isNotEmpty) {
      if (item.imageUrl.startsWith('assets/')) {
        return ClipRRect(
          borderRadius: BorderRadius.circular(borderRadius),
          child: SizedBox(
            width: width,
            height: height,
            child: Image.asset(
              item.imageUrl,
              fit: BoxFit.contain,
              errorBuilder: (context, error, stackTrace) => _buildFamilyFallback(family),
            ),
          ),
        );
      } else if (item.imageUrl.startsWith('http://') || item.imageUrl.startsWith('https://')) {
        return ClipRRect(
          borderRadius: BorderRadius.circular(borderRadius),
          child: SizedBox(
            width: width,
            height: height,
            child: Image.network(
              item.imageUrl,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) => _buildFamilyFallback(family),
              loadingBuilder: (context, child, loadingProgress) {
                if (loadingProgress == null) return child;
                return Container(
                  width: width,
                  height: height,
                  color: family.backgroundColor,
                  child: Center(
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(family.primaryColor),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        );
      }
    }

    // Tier 2 & 3: Curated Food Family Visual Container
    return _buildFamilyFallback(family);
  }

  Widget _buildFamilyFallback(VisualFamily family) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: family.backgroundColor,
        borderRadius: BorderRadius.circular(borderRadius),
        border: Border.all(
          color: family.primaryColor.withAlpha(50),
          width: 1.2,
        ),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Subtle circular halo
          Container(
            width: height * 0.72,
            height: height * 0.72,
            decoration: BoxDecoration(
              color: family.primaryColor.withAlpha(24),
              shape: BoxShape.circle,
            ),
          ),
          // Food family icon
          Icon(
            family.icon,
            size: height * 0.44,
            color: family.primaryColor,
          ),
          // Small corner emoji indicator
          Positioned(
            top: 4,
            right: 6,
            child: Text(
              family.emoji,
              style: TextStyle(fontSize: (height * 0.20).clamp(10, 16)),
            ),
          ),
        ],
      ),
    );
  }
}
