import 'package:flutter/material.dart';
import '../models/menu_item.dart';
import '../theme/app_theme.dart';

/// Menu item card widget.
/// - Mustard background for cooked items (with "~X min" badge)
/// - Green background for instant items (with "Ready now" badge)
///
/// Matches the HTML prototype card design with icon circle,
/// item name, price, and a "+" add button (wired in Phase 3).
class MenuItemCard extends StatelessWidget {
  final MenuItem item;

  const MenuItemCard({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    final isCooked = item.isCooked;

    // Color sets per type
    final cardBg = isCooked ? AppColors.mustardSoft : AppColors.greenSoft;
    final accentInk = isCooked ? AppColors.mustardInk : AppColors.greenInk;
    final iconBg = isCooked
        ? AppColors.mustardInk.withOpacity(0.14)
        : AppColors.greenInk.withOpacity(0.14);
    final badgeBg = isCooked
        ? AppColors.mustardInk.withOpacity(0.12)
        : AppColors.greenInk.withOpacity(0.12);

    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Stack(
        children: [
          // Card content
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 13, 12, 48),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                // Badge — "~6 min" or "Ready now"
                Align(
                  alignment: Alignment.centerLeft,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                    decoration: BoxDecoration(
                      color: badgeBg,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      item.badgeText,
                      style: AppFonts.mono(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: accentInk,
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 8),

                // Icon circle
                Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    color: iconBg,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: _buildIcon(item, accentInk),
                  ),
                ),

                const SizedBox(height: 10),

                // Item name
                Text(
                  item.name,
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: accentInk,
                  ),
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),

                const SizedBox(height: 3),

                // Price
                Text(
                  '₹${item.price.toInt()}',
                  style: AppFonts.mono(
                    fontSize: 13,
                    color: accentInk.withOpacity(0.85),
                  ),
                ),
              ],
            ),
          ),

          // Add button (Phase 3 will wire this to cart)
          Positioned(
            bottom: 11,
            right: 12,
            child: _AddButton(accentInk: accentInk),
          ),
        ],
      ),
    );
  }

  /// Builds an icon for the item based on its category.
  /// Using simple custom-painted icons matching the HTML prototype's SVGs.
  Widget _buildIcon(MenuItem item, Color color) {
    final iconData = _categoryIcon(item.category);
    return Icon(iconData, size: 26, color: color);
  }

  /// Map category to an appropriate Material icon
  static IconData _categoryIcon(String category) {
    switch (category) {
      case 'dosa':
        return Icons.flatware_rounded;
      case 'rotibhaji':
        return Icons.dinner_dining_rounded;
      case 'drinks':
        return Icons.local_cafe_rounded;
      case 'snacks':
        return Icons.cookie_rounded;
      default:
        return Icons.restaurant_rounded;
    }
  }
}

/// The circular "+" add button at the bottom-right of each card.
/// Phase 3 will replace this with a stepper (+ / qty / −).
class _AddButton extends StatefulWidget {
  final Color accentInk;

  const _AddButton({required this.accentInk});

  @override
  State<_AddButton> createState() => _AddButtonState();
}

class _AddButtonState extends State<_AddButton>
    with SingleTickerProviderStateMixin {
  double _scale = 1.0;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => setState(() => _scale = 0.9),
      onTapUp: (_) => setState(() => _scale = 1.0),
      onTapCancel: () => setState(() => _scale = 1.0),
      onTap: () {
        // Phase 3: will add to cart
      },
      child: AnimatedScale(
        scale: _scale,
        duration: const Duration(milliseconds: 120),
        child: Container(
          width: 30,
          height: 30,
          decoration: const BoxDecoration(
            color: AppColors.ink,
            shape: BoxShape.circle,
          ),
          child: const Icon(
            Icons.add,
            color: Colors.white,
            size: 17,
          ),
        ),
      ),
    );
  }
}
