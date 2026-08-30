import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/menu_item.dart';
import '../theme/app_theme.dart';

/// Menu item card with Swiggy/Zomato-style add-to-cart stepper.
/// - Mustard background for cooked items ("~X min" badge)
/// - Green background for instant items ("Ready now" badge)
/// - First tap on "+" morphs into a stepper (−/qty/+)
class MenuItemCard extends StatefulWidget {
  final MenuItem item;

  const MenuItemCard({super.key, required this.item});

  @override
  State<MenuItemCard> createState() => _MenuItemCardState();
}

class _MenuItemCardState extends State<MenuItemCard> {
  int _qty = 0;

  MenuItem get item => widget.item;

  @override
  Widget build(BuildContext context) {
    final isCooked = item.isCooked;

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

          // Add control — morphs from "+" to stepper
          Positioned(
            bottom: 11,
            left: 12,
            right: 12,
            child: SizedBox(
              height: 30,
              child: _qty == 0
                  ? _buildAddButton()
                  : _buildStepper(),
            ),
          ),
        ],
      ),
    );
  }

  /// Initial "+" button (right-aligned circle)
  Widget _buildAddButton() {
    return Align(
      alignment: Alignment.centerRight,
      child: GestureDetector(
        onTap: () {
          HapticFeedback.selectionClick();
          setState(() => _qty = 1);
        },
        child: Container(
          width: 44, // minimum 44x44 tap target
          height: 44,
          alignment: Alignment.center,
          color: Colors.transparent, // expanded tap area
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

  /// Stepper (−/qty/+) — animated pop-in, pill shape
  Widget _buildStepper() {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.85, end: 1.0),
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      builder: (context, scale, child) {
        return Transform.scale(scale: scale, child: child);
      },
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.ink,
          borderRadius: BorderRadius.circular(999),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            // Minus button
            GestureDetector(
              onTap: () {
                HapticFeedback.selectionClick();
                setState(() {
                  _qty--;
                  if (_qty <= 0) _qty = 0;
                });
              },
              child: Container(
                width: 44,
                height: 44,
                alignment: Alignment.center,
                color: Colors.transparent,
                child: Container(
                  width: 24,
                  height: 24,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                  ),
                  child: const Center(
                    child: Text('–',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w500)),
                  ),
                ),
              ),
            ),

            // Qty
            Text(
              '$_qty',
              style: AppFonts.mono(
                fontSize: 12.5,
                color: Colors.white,
              ),
            ),

            // Plus button
            GestureDetector(
              onTap: () {
                HapticFeedback.selectionClick();
                setState(() => _qty++);
              },
              child: Container(
                width: 44,
                height: 44,
                alignment: Alignment.center,
                color: Colors.transparent,
                child: Container(
                  width: 24,
                  height: 24,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                  ),
                  child: const Center(
                    child: Text('+',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w500)),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Map iconKey to a Material icon
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
