import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/cart_provider.dart';
import '../services/firestore_service.dart';
import '../theme/app_theme.dart';
import 'ticket_screen.dart';

/// Cart screen — shows all items in cart with per-item steppers,
/// ready-time estimate, total, and a "Confirm & pay" CTA.
/// Matches the HTML prototype's cart design.
class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Column(
          children: [
            // ─── Header ─────────────────────────────────────────
            Container(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
              decoration: const BoxDecoration(
                border: Border(
                    bottom: BorderSide(color: AppColors.line, width: 1)),
              ),
              child: Row(
                children: [
                  // Back button
                  GestureDetector(
                    onTap: () => Navigator.of(context).pop(),
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: AppColors.line, width: 1.5),
                      ),
                      child: const Center(
                        child: Icon(Icons.chevron_left_rounded,
                            size: 20, color: AppColors.ink),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text('Your cart',
                      style: AppFonts.display(fontSize: 20)),
                ],
              ),
            ),

            // ─── Cart items list ────────────────────────────────
            Expanded(
              child: Consumer<CartProvider>(
                builder: (context, cart, _) {
                  if (cart.isEmpty) {
                    return _buildEmptyState();
                  }
                  return ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 18),
                    itemCount: cart.entries.length,
                    itemBuilder: (context, index) {
                      final entry = cart.entries[index];
                      return _CartItemRow(entry: entry);
                    },
                  );
                },
              ),
            ),

            // ─── Summary + CTA ──────────────────────────────────
            Consumer<CartProvider>(
              builder: (context, cart, _) {
                return _CartSummary(cart: cart);
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.shopping_cart_outlined,
                size: 56, color: AppColors.inkSoft.withOpacity(0.4)),
            const SizedBox(height: 16),
            Text(
              'Your cart is empty',
              style: AppFonts.body(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink),
            ),
            const SizedBox(height: 6),
            Text(
              'Add something tasty from the menu.',
              style: AppFonts.body(fontSize: 14, color: AppColors.inkSoft),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Cart Item Row ──────────────────────────────────────────────────

class _CartItemRow extends StatelessWidget {
  final CartEntry entry;

  const _CartItemRow({required this.entry});

  @override
  Widget build(BuildContext context) {
    final item = entry.item;

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.line, width: 1)),
      ),
      child: Row(
        children: [
          // Icon circle
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.surface2,
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Icon(
                _iconForKey(item.iconKey),
                size: 20,
                color: AppColors.ink,
              ),
            ),
          ),
          const SizedBox(width: 12),

          // Name + price
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  style: AppFonts.body(
                      fontSize: 14, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Text(
                  '₹${item.price.toInt()} each',
                  style: AppFonts.mono(
                      fontSize: 12, color: AppColors.inkSoft),
                ),
              ],
            ),
          ),

          // Stepper
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface2,
              borderRadius: BorderRadius.circular(999),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Minus
                GestureDetector(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    context.read<CartProvider>().removeItem(item.id);
                  },
                  child: Container(
                    width: 28,
                    height: 28,
                    decoration: const BoxDecoration(
                      color: AppColors.ink,
                      shape: BoxShape.circle,
                    ),
                    child: const Center(
                      child: Text('–',
                          style: TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                              fontWeight: FontWeight.w500)),
                    ),
                  ),
                ),
                // Qty
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Text(
                    '${entry.qty}',
                    style: AppFonts.mono(fontSize: 12.5, color: AppColors.ink),
                  ),
                ),
                // Plus
                GestureDetector(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    context.read<CartProvider>().addItem(item);
                  },
                  child: Container(
                    width: 28,
                    height: 28,
                    decoration: const BoxDecoration(
                      color: AppColors.ink,
                      shape: BoxShape.circle,
                    ),
                    child: const Center(
                      child: Text('+',
                          style: TextStyle(
                              color: Colors.white,
                              fontSize: 14,
                              fontWeight: FontWeight.w500)),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
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

// ─── Cart Summary & CTA ─────────────────────────────────────────────

class _CartSummary extends StatefulWidget {
  final CartProvider cart;

  const _CartSummary({required this.cart});

  @override
  State<_CartSummary> createState() => _CartSummaryState();
}

class _CartSummaryState extends State<_CartSummary> {
  final FirestoreService _firestore = FirestoreService();
  bool _isPlacing = false;

  Future<void> _placeOrder() async {
    if (_isPlacing) return;
    setState(() => _isPlacing = true);

    try {
      HapticFeedback.mediumImpact();
      final cart = widget.cart;
      final order = await _firestore.placeOrder(cart);

      // Clear the cart
      cart.clear();

      // Navigate to ticket screen
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => TicketScreen(order: order),
          ),
        );
      }
    } catch (e) {
      setState(() => _isPlacing = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to place order: $e'),
            backgroundColor: AppColors.red,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = widget.cart;

    return Container(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.line, width: 1)),
        color: AppColors.surface,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Ready time
          if (cart.isNotEmpty) ...[
            Row(
              children: [
                const Icon(Icons.access_time_rounded,
                    size: 13, color: AppColors.inkSoft),
                const SizedBox(width: 6),
                Text(
                  cart.readyTimeText,
                  style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                ),
              ],
            ),
            const SizedBox(height: 8),

            // Total row
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Total',
                    style: AppFonts.mono(
                        fontSize: 15, fontWeight: FontWeight.w600)),
                Text('₹${cart.totalPrice.toInt()}',
                    style: AppFonts.mono(
                        fontSize: 15, fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: 12),
          ],

          // CTA button
          SizedBox(
            width: double.infinity,
            child: GestureDetector(
              onTap: cart.isEmpty || _isPlacing ? null : _placeOrder,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                padding: const EdgeInsets.symmetric(vertical: 14),
                decoration: BoxDecoration(
                  color: cart.isEmpty || _isPlacing
                      ? AppColors.line
                      : AppColors.red,
                  borderRadius: BorderRadius.circular(14),
                ),
                alignment: Alignment.center,
                child: _isPlacing
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : Text(
                        cart.isEmpty
                            ? 'Confirm & pay'
                            : 'Confirm & pay ₹${cart.totalPrice.toInt()}',
                        style: AppFonts.body(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w700,
                          color:
                              cart.isEmpty ? AppColors.inkSoft : Colors.white,
                        ),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
