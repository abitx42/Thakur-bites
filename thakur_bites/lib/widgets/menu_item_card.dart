import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../models/daily_board.dart';
import '../models/menu_item.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../screens/login_sheet.dart';
import '../services/preferences_service.dart';
import '../services/menu_visual_resolver.dart';
import '../theme/app_theme.dart';
import 'bouncy_tap.dart';
import 'meal_customizer_sheet.dart';

/// Menu item card with availability indicators (🟢/🟡/🔴) instead of exact stock numbers.
/// Students can freely add any quantity to cart — stock is checked only at checkout.
class MenuItemCard extends StatelessWidget {
  final MenuItem item;
  final DailyBoard? dailyBoard;

  const MenuItemCard({super.key, required this.item, this.dailyBoard});

  bool get _isCustomizableMeal {
    final lowerName = item.name.toLowerCase();
    final lowerSub = item.subCategory.toLowerCase();
    final lowerCat = item.category.toLowerCase();
    return lowerName.contains('thali') ||
        lowerSub.contains('thali') ||
        lowerName.contains('roti') ||
        lowerName.contains('puri') ||
        lowerCat.contains('rotibhaji');
  }

  String? _dynamicDailySubtitle(DailyBoard? board) {
    if (board == null) return null;
    final lowerName = item.name.toLowerCase();
    final lowerSub = item.subCategory.toLowerCase();
    final isMeal = lowerName.contains('thali') ||
        lowerSub.contains('thali') ||
        lowerName.contains('roti') ||
        lowerName.contains('puri') ||
        item.category.toLowerCase().contains('rotibhaji');

    if (!isMeal) return null;

    // Bread shortage notification alerts students upfront to prevent cancellations
    if (!board.rotiAvailable && board.puriAvailable) {
      return '⚠️ Chapati Over · Served with Fresh Puris';
    } else if (board.rotiAvailable && !board.puriAvailable) {
      return '⚠️ Puri Over · Served with Tawa Rotis';
    } else if (!board.hasAnyBread) {
      return '⚠️ Breads Sold Out for Today';
    }

    if (lowerName.contains('thali') || lowerSub.contains('thali')) {
      return board.formatThaliSummary();
    }
    return board.formatRotiBhajiSummary();
  }

  @override
  Widget build(BuildContext context) {
    if (!item.isValid) {
      return const SizedBox.shrink();
    }
    final isCooked = item.isCooked;
    final inStock = item.isInStock;
    final level = item.availabilityLevel;

    final cardBg = !inStock
        ? AppColors.surface2
        : (isCooked ? AppColors.mustardSoft : AppColors.greenSoft);
    final accentInk = !inStock
        ? AppColors.inkSoft
        : (isCooked ? AppColors.mustardInk : AppColors.greenInk);

    // Badge colors based on availability level
    Color badgeBg;
    Color badgeTextColor;
    if (!inStock) {
      badgeBg = AppColors.dangerBg;
      badgeTextColor = AppColors.danger;
    } else if (level == AvailabilityLevel.limited) {
      badgeBg = AppColors.warningBg;
      badgeTextColor = AppColors.mustardInk;
    } else {
      badgeBg = isCooked
          ? AppColors.mustardInk.withAlpha(30)
          : AppColors.greenInk.withAlpha(30);
      badgeTextColor = accentInk;
    }

    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: AppRadius.radiusLg,
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
                // Badges row: Availability + Popular tag with guaranteed clearance for favourite button
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Wrap(
                        spacing: 4,
                        runSpacing: 4,
                        children: [
                          Semantics(
                            label: !inStock
                                ? 'Status: Out of Stock'
                                : (level == AvailabilityLevel.limited
                                    ? 'Status: Limited availability, ${item.badgeText}'
                                    : 'Status: In Stock, ${item.badgeText}'),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 7,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: badgeBg,
                                borderRadius: AppRadius.radiusPill,
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
                                            ? AppColors.danger
                                            : level == AvailabilityLevel.limited
                                            ? AppColors.warning
                                            : AppColors.success,
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
                          if (item.todaySpecialBadge != null)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: AppColors.dangerBg,
                                borderRadius: AppRadius.radiusSm,
                                border: Border.all(color: AppColors.danger, width: 0.8),
                              ),
                              child: Text(
                                item.todaySpecialBadge!,
                                style: const TextStyle(
                                  fontSize: 9.5,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.danger,
                                ),
                              ),
                            )
                          else if (item.isPopular)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: AppColors.warningBg,
                                borderRadius: AppRadius.radiusSm,
                                border: Border.all(color: AppColors.warning, width: 0.8),
                              ),
                              child: const Text(
                                '🔥 Popular',
                                style: TextStyle(
                                  fontSize: 9.5,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.mustardInk,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 30), // Clearance for Positioned favourite button
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
                if (_dynamicDailySubtitle(dailyBoard) != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    _dynamicDailySubtitle(dailyBoard)!,
                    style: AppFonts.body(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: (dailyBoard != null && !dailyBoard!.hasAnyBread)
                          ? AppColors.danger
                          : (dailyBoard != null && !dailyBoard!.bothBreadsAvailable)
                              ? AppColors.mustardInk
                              : AppColors.mustardInk,
                    ),
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
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
                        color: AppColors.dangerBg,
                        borderRadius: AppRadius.radiusSm,
                      ),
                      child: Text(
                        'Sold out',
                        style: AppFonts.mono(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.danger,
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
            child: Consumer2<AuthProvider, PreferencesService>(
              builder: (context, auth, prefs, _) {
                final user = auth.currentProfile;
                final isFav = prefs.isItemFavourited(item.id);

                return _HeartButton(
                  isFav: isFav,
                  accentInk: accentInk,
                  itemName: item.name,
                  onTap: () async {
                    if (user == null) {
                      LoginSheet.show(context);
                      return;
                    }
                    await prefs.toggleFavourite(user.uid, item.id);
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAddButton(BuildContext context) {
    return _AddButtonWithBounce(
      item: item,
      isCustomizableMeal: _isCustomizableMeal,
      dailyBoard: dailyBoard,
    );
  }

  Widget _buildStepper(BuildContext context, int qty) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.85, end: 1.0),
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOutBack,
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
            Semantics(
              button: true,
              label: 'Decrease quantity of ${item.name}',
              child: BouncyTap(
                scaleFactor: 0.84,
                onTap: () {
                  final cart = context.read<CartProvider>();
                  final matchingEntries = cart.entries.where((e) => e.item.id == item.id).toList();
                  if (matchingEntries.length > 1) {
                    _showVariantPickerSheet(context, matchingEntries);
                  } else {
                    cart.removeItem(item.id, customization: matchingEntries.firstOrNull?.customization);
                  }
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
            ),
            // Qty
            Semantics(
              label: '$qty of ${item.name} in cart',
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 160),
                transitionBuilder: (child, animation) {
                  return ScaleTransition(
                    scale: animation,
                    child: FadeTransition(opacity: animation, child: child),
                  );
                },
                child: Text(
                  '$qty',
                  key: ValueKey<int>(qty),
                  style: AppFonts.mono(fontSize: 12.5, color: Colors.white),
                ),
              ),
            ),
            // Plus — opens customizer for meal or adds standard item
            Semantics(
              button: true,
              label: 'Increase quantity of ${item.name}',
              child: BouncyTap(
                scaleFactor: 0.84,
                onTap: () {
                  if (_isCustomizableMeal) {
                    MealCustomizerSheet.show(
                      context,
                      item: item,
                      dailyBoard: dailyBoard ?? DailyBoard.defaultForDay(DateTime.now()),
                    );
                  } else {
                    context.read<CartProvider>().addItem(item);
                  }
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
            ),
          ],
        ),
      ),
    );
  }

  void _showVariantPickerSheet(BuildContext context, List<CartEntry> entries) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                    color: AppColors.line,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Customized Items in Cart',
                    style: AppFonts.body(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.ink),
                  ),
                  GestureDetector(
                    onTap: () => Navigator.of(ctx).pop(),
                    child: const Icon(Icons.close, size: 20, color: AppColors.inkSoft),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'Select which customized variant to decrease:',
                style: AppFonts.body(fontSize: 12.5, color: AppColors.inkSoft),
              ),
              const SizedBox(height: 12),
              ...entries.map((e) {
                final label = (e.customization != null && e.customization!.isNotEmpty)
                    ? e.customization!
                    : 'Standard Option';
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.surface2,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.line),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              label,
                              style: AppFonts.body(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.ink),
                            ),
                            Text(
                              '₹${e.item.price.toInt()} each',
                              style: AppFonts.mono(fontSize: 11, color: AppColors.inkSoft),
                            ),
                          ],
                        ),
                      ),
                      Row(
                        children: [
                          GestureDetector(
                            onTap: () {
                              HapticFeedback.selectionClick();
                              ctx.read<CartProvider>().removeItem(e.item.id, customization: e.customization);
                              Navigator.of(ctx).pop();
                            },
                            child: Container(
                              width: 32,
                              height: 32,
                              decoration: BoxDecoration(
                                color: AppColors.red.withAlpha(25),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Center(
                                child: Icon(Icons.remove, size: 18, color: AppColors.red),
                              ),
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 10),
                            child: Text(
                              '${e.qty}',
                              style: AppFonts.mono(fontSize: 13, fontWeight: FontWeight.w700),
                            ),
                          ),
                          GestureDetector(
                            onTap: () {
                              HapticFeedback.selectionClick();
                              ctx.read<CartProvider>().addItem(e.item, customization: e.customization);
                              Navigator.of(ctx).pop();
                            },
                            child: Container(
                              width: 32,
                              height: 32,
                              decoration: BoxDecoration(
                                color: AppColors.green.withAlpha(25),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Center(
                                child: Icon(Icons.add, size: 18, color: AppColors.greenInk),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              }),
            ],
          ),
        );
      },
    );
  }
}

/// Contained tactile press-bounce button for adding items to the tray
class _AddButtonWithBounce extends StatefulWidget {
  final MenuItem item;
  final bool isCustomizableMeal;
  final DailyBoard? dailyBoard;

  const _AddButtonWithBounce({
    required this.item,
    required this.isCustomizableMeal,
    this.dailyBoard,
  });

  @override
  State<_AddButtonWithBounce> createState() => _AddButtonWithBounceState();
}

class _AddButtonWithBounceState extends State<_AddButtonWithBounce> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: Semantics(
        button: true,
        label: 'Add ${widget.item.name} to cart',
        child: GestureDetector(
          onTapDown: (_) => setState(() => _pressed = true),
          onTapUp: (_) => setState(() => _pressed = false),
          onTapCancel: () => setState(() => _pressed = false),
          onTap: () {
            HapticFeedback.selectionClick();
            if (widget.isCustomizableMeal) {
              MealCustomizerSheet.show(
                context,
                item: widget.item,
                dailyBoard: widget.dailyBoard ?? DailyBoard.defaultForDay(DateTime.now()),
              );
            } else {
              context.read<CartProvider>().addItem(widget.item);
            }
          },
          child: Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            color: Colors.transparent,
            child: AnimatedScale(
              scale: _pressed ? 0.86 : 1.0,
              duration: const Duration(milliseconds: 100),
              curve: Curves.easeOut,
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
        ),
      ),
    );
  }
}

/// Tactile heart button with spring-scale pop micro-interaction
class _HeartButton extends StatefulWidget {
  final bool isFav;
  final Color accentInk;
  final VoidCallback onTap;
  final String itemName;

  const _HeartButton({
    required this.isFav,
    required this.accentInk,
    required this.onTap,
    required this.itemName,
  });

  @override
  State<_HeartButton> createState() => _HeartButtonState();
}

class _HeartButtonState extends State<_HeartButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _animController;
  late final Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 260),
    );
    _scaleAnimation = TweenSequence<double>([
      TweenSequenceItem(
        tween: Tween<double>(begin: 1.0, end: 1.35)
            .chain(CurveTween(curve: Curves.easeOutBack)),
        weight: 50,
      ),
      TweenSequenceItem(
        tween: Tween<double>(begin: 1.35, end: 1.0)
            .chain(CurveTween(curve: Curves.easeInCubic)),
        weight: 50,
      ),
    ]).animate(_animController);
  }

  @override
  void didUpdateWidget(covariant _HeartButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isFav != oldWidget.isFav && widget.isFav) {
      _animController.forward(from: 0.0);
    }
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: widget.isFav
          ? 'Remove ${widget.itemName} from favourites'
          : 'Add ${widget.itemName} to favourites',
      child: BouncyTap(
        scaleFactor: 0.88,
        onTap: widget.onTap,
        child: Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: widget.isFav
                ? AppColors.red.withAlpha(25)
                : Colors.black.withAlpha(12),
            shape: BoxShape.circle,
          ),
          child: Center(
            child: ScaleTransition(
              scale: _scaleAnimation,
              child: Icon(
                widget.isFav
                    ? Icons.favorite_rounded
                    : Icons.favorite_border_rounded,
                size: 15,
                color: widget.isFav
                    ? AppColors.red
                    : widget.accentInk.withAlpha(150),
              ),
            ),
          ),
        ),
      ),
    );
  }
}


