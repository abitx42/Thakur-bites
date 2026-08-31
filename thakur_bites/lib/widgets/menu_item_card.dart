import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/menu_item.dart';
import '../providers/cart_provider.dart';
import '../theme/app_theme.dart';

/// Menu item card with Swiggy/Zomato-style morphing add-to-cart stepper.
/// Supports out-of-stock disabling and max stock limits.
class MenuItemCard extends StatelessWidget {
  final MenuItem item;

  const MenuItemCard({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    final isCooked = item.isCooked;
    final inStock = item.isInStock;

    final cardBg = inStock
        ? (isCooked ? AppColors.mustardSoft : AppColors.greenSoft)
        : const Color(0xFFF3EFE8);
    final accentInk = inStock
        ? (isCooked ? AppColors.mustardInk : AppColors.greenInk)
        : AppColors.inkSoft;
    final iconBg = inStock
        ? (isCooked
            ? AppColors.mustardInk.withOpacity(0.14)
            : AppColors.greenInk.withOpacity(0.14))
        : AppColors.line;
    final badgeBg = inStock
        ? (isCooked
            ? AppColors.mustardInk.withOpacity(0.12)
            : AppColors.greenInk.withOpacity(0.12))
        : AppColors.line;

    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: inStock ? null : Border.all(color: AppColors.line, width: 1),
      ),
      child: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 13, 12, 48),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                // Badge
                Align(
                  alignment: Alignment.centerLeft,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                    decoration: BoxDecoration(
                      color: inStock ? badgeBg : const Color(0xFFFEE2E2),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      item.badgeText,
                      style: AppFonts.mono(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: inStock ? accentInk : AppColors.red,
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
                    child: Icon(
                      _iconForKey(item.iconKey),
                      size: 26,
                      color: accentInk,
                    ),
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

          // Add control — reads qty from CartProvider
          Positioned(
            bottom: 11,
            left: 12,
            right: 12,
            child: Consumer<CartProvider>(
              builder: (context, cart, _) {
                final qty = cart.getQty(item.id);

                if (!inStock) {
                  return Align(
                    alignment: Alignment.centerRight,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEE2E2),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        'Sold out',
                        style: AppFonts.mono(fontSize: 10.5, fontWeight: FontWeight.w700, color: AppColors.red),
                      ),
                    ),
                  );
                }

                return SizedBox(
                  height: 30,
                  child: qty == 0
                      ? _buildAddButton(context)
                      : _buildStepper(context, qty),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAddButton(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: GestureDetector(
        onTap: () {
          HapticFeedback.selectionClick();
          context.read<CartProvider>().addItem(item);
        },
        child: Container(
          width: 44,
          height: 44,
          alignment: Alignment.center,
          color: Colors.transparent,
          child: Container(
            width: 30,
            height: 30,
            decoration: const BoxDecoration(
              color: AppColors.ink,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.add, color: Colors.white, size: 17),
          ),
        ),
      ),
    );
  }

  Widget _buildStepper(BuildContext context, int qty) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.85, end: 1.0),
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      builder: (context, scale, child) =>
          Transform.scale(scale: scale, child: child),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.ink,
          borderRadius: BorderRadius.circular(999),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            // Minus
            GestureDetector(
              onTap: () {
                HapticFeedback.selectionClick();
                context.read<CartProvider>().removeItem(item.id);
              },
              child: const SizedBox(
                width: 44,
                height: 44,
                child: Center(
                  child: Text('–',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w500)),
                ),
              ),
            ),
            // Qty
            Text('$qty',
                style: AppFonts.mono(fontSize: 12.5, color: Colors.white)),
            // Plus
            GestureDetector(
              onTap: () {
                HapticFeedback.selectionClick();
                context.read<CartProvider>().addItem(item);
              },
              child: const SizedBox(
                width: 44,
                height: 44,
                child: Center(
                  child: Text('+',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w500)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static IconData _iconForKey(String key) {
    switch (key) {
      case 'dosa':
        return Icons.flatware_rounded;
      case 'roti':
        return Icons.dinner_dining_rounded;
      case 'chai':
        return Icons.local_cafe_rounded;
      case 'bottle':
        return Icons.local_drink_rounded;
      case 'choc':
        return Icons.cookie_rounded;
      case 'chips':
        return Icons.takeout_dining_rounded;
      default:
        return Icons.restaurant_rounded;
    }
  }
}
