import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../models/menu_item.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../screens/login_sheet.dart';
import '../services/preferences_service.dart';
import '../theme/app_theme.dart';

/// Menu item card with availability indicators (🟢/🟡/🔴) instead of exact stock numbers.
/// Students can freely add any quantity to cart — stock is checked only at checkout.
class MenuItemCard extends StatelessWidget {
  final MenuItem item;

  const MenuItemCard({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    final isCooked = item.isCooked;
    final inStock = item.isInStock;
    final level = item.availabilityLevel;

    final cardBg = !inStock
        ? const Color(0xFFF3EFE8)
        : (isCooked ? AppColors.mustardSoft : AppColors.greenSoft);
    final accentInk = !inStock
        ? AppColors.inkSoft
        : (isCooked ? AppColors.mustardInk : AppColors.greenInk);
    final iconBg = !inStock
        ? AppColors.line
        : (isCooked
              ? AppColors.mustardInk.withAlpha(36)
              : AppColors.greenInk.withAlpha(36));

    // Badge colors based on availability level
    Color badgeBg;
    Color badgeTextColor;
    if (!inStock) {
      badgeBg = const Color(0xFFFEE2E2);
      badgeTextColor = AppColors.red;
    } else if (level == AvailabilityLevel.limited) {
      badgeBg = const Color(0xFFFEF3C7);
      badgeTextColor = const Color(0xFFB45309);
    } else {
      badgeBg = isCooked
          ? AppColors.mustardInk.withAlpha(30)
          : AppColors.greenInk.withAlpha(30);
      badgeTextColor = accentInk;
    }

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
                // Availability badge
                Align(
                  alignment: Alignment.centerLeft,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: badgeBg,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // Availability dot
                        if (!isCooked || !inStock) ...[
                          Container(
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: !inStock
                                  ? AppColors.red
                                  : level == AvailabilityLevel.limited
                                  ? const Color(0xFFD97706)
                                  : const Color(0xFF16A34A),
                            ),
                          ),
                          const SizedBox(width: 4),
                        ],
                        Text(
                          item.badgeText,
                          style: AppFonts.mono(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w600,
                            color: badgeTextColor,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 8),

                _buildMenuVisual(iconBg, accentInk),
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
                    color: accentInk.withAlpha(217),
                  ),
                ),
              ],
            ),
          ),

          // Add control — cart is a wishlist, no stock limits here
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
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEE2E2),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        'Sold out',
                        style: AppFonts.mono(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.red,
                        ),
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

          // Heart / Favourite toggle button
          Positioned(
            top: 8,
            right: 8,
            child: Consumer<AuthProvider>(
              builder: (context, auth, _) {
                final user = auth.currentProfile;
                final prefsService = PreferencesService();
                final isFav = prefsService.isItemFavourited(item.id);

                return GestureDetector(
                  onTap: () async {
                    if (user == null) {
                      LoginSheet.show(context);
                      return;
                    }
                    HapticFeedback.selectionClick();
                    await prefsService.toggleFavourite(user.uid, item.id);
                  },
                  child: Container(
                    width: 26,
                    height: 26,
                    decoration: BoxDecoration(
                      color: isFav ? AppColors.red.withAlpha(25) : Colors.black.withAlpha(12),
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Icon(
                        isFav ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                        size: 15,
                        color: isFav ? AppColors.red : accentInk.withAlpha(150),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMenuVisual(Color iconBg, Color accentInk) {
    if (item.imageUrl.isNotEmpty) {
      if (item.imageUrl.startsWith('assets/')) {
        return SizedBox(
          width: 88,
          height: 68,
          child: Image.asset(
            item.imageUrl,
            fit: BoxFit.contain,
            errorBuilder: (context, error, stackTrace) => _buildIconFallback(iconBg, accentInk),
          ),
        );
      } else if (item.imageUrl.startsWith('http://') || item.imageUrl.startsWith('https://')) {
        return SizedBox(
          width: 88,
          height: 68,
          child: Image.network(
            item.imageUrl,
            fit: BoxFit.contain,
            errorBuilder: (context, error, stackTrace) => _buildIconFallback(iconBg, accentInk),
          ),
        );
      }
    }

    return _buildIconFallback(iconBg, accentInk);
  }

  Widget _buildIconFallback(Color iconBg, Color accentInk) {
    final icon = _resolveHierarchicalIcon(item);
    return Container(
      width: 58,
      height: 58,
      decoration: BoxDecoration(
        color: iconBg,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withAlpha(10),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Center(
        child: Icon(icon, size: 28, color: accentInk),
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
                  child: Text(
                    '–',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ),
            ),
            // Qty
            Text(
              '$qty',
              style: AppFonts.mono(fontSize: 12.5, color: Colors.white),
            ),
            // Plus — no stock limit on cart, student can add freely
            GestureDetector(
              onTap: () {
                HapticFeedback.selectionClick();
                context.read<CartProvider>().addItem(item);
              },
              child: const SizedBox(
                width: 44,
                height: 44,
                child: Center(
                  child: Text(
                    '+',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static IconData _resolveHierarchicalIcon(MenuItem item) {
    final sub = item.subCategory.toLowerCase();
    final cat = item.category.toLowerCase();
    final name = item.name.toLowerCase();

    if (sub.contains('dosa') || cat.contains('dosa') || name.contains('dosa')) {
      return Icons.breakfast_dining_rounded;
    }
    if (sub.contains('uttappa') || name.contains('uttappa') || sub.contains('idli') || name.contains('idli') || name.contains('vada')) {
      return Icons.flatware_rounded;
    }
    if (sub.contains('sandwich') || cat.contains('sandwich') || name.contains('sandwich') || name.contains('toast') || name.contains('grill')) {
      return Icons.lunch_dining_rounded;
    }
    if (sub.contains('noodle') || cat.contains('chinese') || name.contains('noodle') || name.contains('chowmein') || name.contains('manchurian')) {
      return Icons.ramen_dining_rounded;
    }
    if (sub.contains('rice') || name.contains('rice') || name.contains('biryani')) {
      return Icons.rice_bowl_rounded;
    }
    if (sub.contains('thali') || name.contains('thali') || cat.contains('rotibhaji') || name.contains('roti') || name.contains('bhaji') || name.contains('puri') || name.contains('chole')) {
      return Icons.dinner_dining_rounded;
    }
    if (sub.contains('fries') || name.contains('fries') || name.contains('chips')) {
      return Icons.fastfood_rounded;
    }
    if (sub.contains('pav') || name.contains('samosa') || name.contains('vada pav') || name.contains('cutlet')) {
      return Icons.bakery_dining_rounded;
    }
    if (sub.contains('tea') || sub.contains('coffee') || cat.contains('tea') || cat.contains('coffee') || name.contains('chai') || name.contains('coffee')) {
      return Icons.local_cafe_rounded;
    }
    if (sub.contains('shake') || name.contains('shake')) {
      return Icons.icecream_rounded;
    }
    if (sub.contains('juice') || name.contains('juice')) {
      return Icons.local_bar_rounded;
    }
    if (sub.contains('drink') || cat.contains('drink') || name.contains('soda') || name.contains('coke') || name.contains('sprite')) {
      return Icons.local_drink_rounded;
    }
    return _iconForKey(item.iconKey);
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
