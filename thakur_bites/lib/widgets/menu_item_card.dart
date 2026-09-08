import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../models/menu_item.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../screens/login_sheet.dart';
import '../services/preferences_service.dart';
import '../services/menu_visual_resolver.dart';
import '../theme/app_theme.dart';

/// Menu item card with availability indicators (🟢/🟡/🔴) instead of exact stock numbers.
/// Students can freely add any quantity to cart — stock is checked only at checkout.
class MenuItemCard extends StatelessWidget {
  final MenuItem item;

  const MenuItemCard({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    if (!item.isValid) {
      return const SizedBox.shrink();
    }
    final isCooked = item.isCooked;
    final inStock = item.isInStock;
    final level = item.availabilityLevel;

    final cardBg = !inStock
        ? const Color(0xFFF3EFE8)
        : (isCooked ? AppColors.mustardSoft : AppColors.greenSoft);
    final accentInk = !inStock
        ? AppColors.inkSoft
        : (isCooked ? AppColors.mustardInk : AppColors.greenInk);

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
                // Badges row: Availability + Popular tag
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
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
                    if (item.isPopular)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF3C7),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: const Color(0xFFF59E0B), width: 0.8),
                        ),
                        child: const Text(
                          '🔥 Popular',
                          style: TextStyle(
                            fontSize: 9.5,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFFB45309),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 8),

                MenuVisualWidget(item: item, width: 88, height: 68),
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
}
