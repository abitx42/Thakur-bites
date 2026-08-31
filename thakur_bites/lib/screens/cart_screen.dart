import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/menu_item.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../services/firestore_service.dart';
import '../theme/app_theme.dart';
import 'ticket_screen.dart';

/// Cart screen with Real-Time Stock Sync and Pre-Payment Verification (Zepto/Instamart style).
class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  final FirestoreService _firestore = FirestoreService();

  @override
  Widget build(BuildContext context) {
    // Stream of all items to keep cart availability synced in real time
    return StreamBuilder<List<MenuItem>>(
      stream: _firestore.allMenuItemsStream(),
      builder: (context, snapshot) {
        if (snapshot.hasData) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            context.read<CartProvider>().syncAvailability(snapshot.data!);
          });
        }

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

                // ─── Out of Stock Global Warning Banner ─────────────
                Consumer<CartProvider>(
                  builder: (context, cart, _) {
                    if (!cart.hasOutOfStockItems) return const SizedBox.shrink();

                    return Container(
                      margin: const EdgeInsets.fromLTRB(18, 12, 18, 0),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEE2E2),
                        border: Border.all(color: const Color(0xFFFCA5A5), width: 1),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.warning_amber_rounded, size: 20, color: AppColors.red),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '${cart.outOfStockCount} item(s) in your cart just went out of stock.',
                              style: AppFonts.body(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.red),
                            ),
                          ),
                          GestureDetector(
                            onTap: () {
                              HapticFeedback.selectionClick();
                              cart.removeOutOfStockItems();
                            },
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppColors.red,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                'Remove',
                                style: AppFonts.body(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white),
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),

                // ─── Cart items list ────────────────────────────────
                Expanded(
                  child: Consumer<CartProvider>(
                    builder: (context, cart, _) {
                      if (cart.isEmpty) {
                        return _buildEmptyState();
                      }
                      return ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
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
      },
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
    final isAvailable = entry.isAvailable;

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
              color: isAvailable ? AppColors.surface2 : const Color(0xFFFEE2E2),
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Icon(
                _iconForKey(item.iconKey),
                size: 20,
                color: isAvailable ? AppColors.ink : AppColors.red,
              ),
            ),
          ),
          const SizedBox(width: 12),

          // Name + price + out of stock warning
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  style: AppFonts.body(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: isAvailable ? AppColors.ink : AppColors.inkSoft,
                  ),
                ),
                const SizedBox(height: 2),
                if (!isAvailable) ...[
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEE2E2),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          'Out of stock',
                          style: AppFonts.mono(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.red),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'Canteen ran out',
                        style: AppFonts.body(fontSize: 11, color: AppColors.inkSoft),
                      ),
                    ],
                  ),
                ] else ...[
                  Text(
                    '₹${item.price.toInt()} each',
                    style: AppFonts.mono(
                        fontSize: 12, color: AppColors.inkSoft),
                  ),
                ],
              ],
            ),
          ),

          // Stepper / Remove button
          if (!isAvailable) ...[
            GestureDetector(
              onTap: () {
                HapticFeedback.selectionClick();
                context.read<CartProvider>().deleteItem(item.id);
              },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppColors.surface2,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.line, width: 1),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.delete_outline_rounded, size: 16, color: AppColors.red),
                    const SizedBox(width: 4),
                    Text(
                      'Remove',
                      style: AppFonts.body(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.red),
                    ),
                  ],
                ),
              ),
            ),
          ] else ...[
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
                      final added = context.read<CartProvider>().addItem(item);
                      if (!added) {
                        HapticFeedback.vibrate();
                        ScaffoldMessenger.of(context).hideCurrentSnackBar();
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text('Only ${item.stockCount} ${item.name} available in stock!'),
                            backgroundColor: AppColors.red,
                            duration: const Duration(seconds: 2),
                            behavior: SnackBarBehavior.floating,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                        );
                      }
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

// ─── Cart Summary & CTA with Atomic Stock Check ─────────────────────

class _CartSummary extends StatefulWidget {
  final CartProvider cart;

  const _CartSummary({required this.cart});

  @override
  State<_CartSummary> createState() => _CartSummaryState();
}

class _CartSummaryState extends State<_CartSummary> {
  final FirestoreService _firestore = FirestoreService();
  bool _isProcessing = false;

  Future<void> _handleConfirmAndPay() async {
    if (_isProcessing) return;
    final cart = widget.cart;

    // 1. If cart has out-of-stock items, prompt to clean cart
    if (cart.hasOutOfStockItems) {
      _showOutOfStockAlert(cart.outOfStockEntries);
      return;
    }

    setState(() => _isProcessing = true);
    HapticFeedback.mediumImpact();

    try {
      // 2. Pre-Payment Background Live Stock & Quantity Verification (Instamart / Zepto style)
      final stockIssues = await _firestore.verifyItemsStockQuantity(cart.entries);

      if (stockIssues.isNotEmpty) {
        // Adjust cart items to actual available stock
        for (final entry in stockIssues.entries) {
          cart.adjustItemQuantityToStock(entry.key, entry.value);
        }

        setState(() => _isProcessing = false);

        if (mounted) {
          _showQuantityAdjustedAlert(stockIssues);
        }
        return;
      }

      // 3. Place order in Firestore & automatically decrement inventory
      final student = context.read<AuthProvider>().currentStudent;
      final order = await _firestore.placeOrder(cart, student: student);

      if (student != null) {
        context.read<AuthProvider>().incrementOrderCount();
      }

      // 4. Clear cart & transition to ticket confirmation
      cart.clear();

      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => TicketScreen(order: order),
          ),
        );
      }
    } catch (e) {
      setState(() => _isProcessing = false);
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

  /// Alert when live stock quantity was insufficient (Zepto/Instamart style)
  void _showQuantityAdjustedAlert(Map<String, int> stockIssues) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.line,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: const BoxDecoration(
                    color: Color(0xFFFEE2E2),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.inventory_2_outlined, color: AppColors.red, size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Stock Availability Updated', style: AppFonts.display(fontSize: 20)),
                      Text(
                        'Live canteen inventory just changed',
                        style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.surface2,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.line, width: 1),
              ),
              child: Text(
                'Some items in your cart had limited stock and were adjusted to the maximum available units. Please review your updated total before completing payment.',
                style: AppFonts.body(fontSize: 13, color: AppColors.ink),
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      Navigator.of(ctx).pop();
                      Navigator.of(context).pop(); // Back to menu
                    },
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppColors.line, width: 1.5),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: Text('Explore Menu', style: AppFonts.body(fontSize: 13.5, fontWeight: FontWeight.w600, color: AppColors.ink)),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.of(ctx).pop();
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.red,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: Text('Review Cart', style: AppFonts.body(fontSize: 13.5, fontWeight: FontWeight.w700, color: Colors.white)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Instamart / Zepto style modal when items are out of stock
  void _showOutOfStockAlert(List<CartEntry> unavailableEntries) {
    final names = unavailableEntries.map((e) => e.item.name).join(', ');

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.line,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: const BoxDecoration(
                    color: Color(0xFFFEE2E2),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.remove_shopping_cart_rounded, color: AppColors.red, size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Item Out of Stock', style: AppFonts.display(fontSize: 20)),
                      Text(
                        'Canteen just ran out of stock',
                        style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.surface2,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.line, width: 1),
              ),
              child: Text(
                'The following item(s) are currently unavailable:\n• $names\n\nWould you like to remove them and proceed with the rest of your order, or explore other options?',
                style: AppFonts.body(fontSize: 13, color: AppColors.ink),
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      Navigator.of(ctx).pop();
                      Navigator.of(context).pop(); // Back to menu
                    },
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppColors.line, width: 1.5),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: Text('Explore Menu', style: AppFonts.body(fontSize: 13.5, fontWeight: FontWeight.w600, color: AppColors.ink)),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.of(ctx).pop();
                      widget.cart.removeOutOfStockItems();
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.red,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: Text('Remove & Proceed', style: AppFonts.body(fontSize: 13.5, fontWeight: FontWeight.w700, color: Colors.white)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cart = widget.cart;
    final hasStockIssue = cart.hasOutOfStockItems;

    return Container(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.line, width: 1)),
        color: AppColors.surface,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
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
                Text('₹${cart.availableTotalPrice.toInt()}',
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
              onTap: cart.isEmpty || _isProcessing ? null : _handleConfirmAndPay,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                padding: const EdgeInsets.symmetric(vertical: 14),
                decoration: BoxDecoration(
                  color: cart.isEmpty || _isProcessing
                      ? AppColors.line
                      : hasStockIssue
                          ? const Color(0xFFEF4444)
                          : AppColors.red,
                  borderRadius: BorderRadius.circular(14),
                ),
                alignment: Alignment.center,
                child: _isProcessing
                    ? Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          ),
                          const SizedBox(width: 10),
                          Text('Checking stock...', style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.white)),
                        ],
                      )
                    : Text(
                        cart.isEmpty
                            ? 'Confirm & pay'
                            : hasStockIssue
                                ? 'Remove Out-of-Stock Items (₹${cart.availableTotalPrice.toInt()})'
                                : 'Confirm & pay ₹${cart.totalPrice.toInt()}',
                        style: AppFonts.body(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w700,
                          color: cart.isEmpty ? AppColors.inkSoft : Colors.white,
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
