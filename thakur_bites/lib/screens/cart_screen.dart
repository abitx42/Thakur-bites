import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/order.dart' as app;
import '../models/canteen_operational_status.dart';
import '../models/daily_board.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../services/firestore_service.dart';
import '../services/checkout_service.dart';
import '../services/payment_service.dart';
import '../services/functions_service.dart';
import '../services/error_helper.dart';
import '../services/in_app_notification_service.dart';
import '../theme/app_theme.dart';
import '../widgets/bouncy_tap.dart';
import '../widgets/canteen_status_banner.dart';
import 'login_sheet.dart';
import 'order_status_screen.dart';
import 'ticket_screen.dart';

/// Cart screen — stock is checked ONLY at checkout, not at cart level.
/// Cart is a wishlist. Backend is the single source of truth.
class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  final FirestoreService _firestore = FirestoreService();
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

            // ─── Canteen Operational Status Banner (Degraded / Paused / Halted) ──
            StreamBuilder<CanteenOperationalStatus>(
              stream: _firestore.operationalStatusStream(),
              builder: (context, snapshot) {
                final status = snapshot.data;
                if (status == null || status.isNormal) return const SizedBox.shrink();
                return CanteenStatusBanner(
                  status: status,
                  margin: const EdgeInsets.fromLTRB(18, 12, 18, 0),
                );
              },
            ),

            // ─── Out of Stock Global Warning Banner ─────────────
            Consumer<CartProvider>(
              builder: (context, cart, _) {
                if (!cart.hasOutOfStockItems) return const SizedBox.shrink();

                return Container(
                  margin: const EdgeInsets.fromLTRB(18, 12, 18, 0),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.dangerBg,
                    border: Border.all(color: AppColors.danger.withAlpha(100), width: 1),
                    borderRadius: AppRadius.radiusMd,
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.warning_amber_rounded, size: 20, color: AppColors.danger),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${cart.outOfStockCount} item(s) in your cart are no longer available.',
                          style: AppFonts.body(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.danger),
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
                            color: AppColors.danger,
                            borderRadius: AppRadius.radiusSm,
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

            // ─── Price Change Revalidation Banner (INV-001, INV-010) ─────────
            Consumer<CartProvider>(
              builder: (context, cart, _) {
                if (!cart.hasPriceChangeAlerts) return const SizedBox.shrink();
                return Container(
                  margin: const EdgeInsets.fromLTRB(18, 12, 18, 0),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.warningBg,
                    border: Border.all(color: AppColors.warning.withAlpha(100), width: 1),
                    borderRadius: AppRadius.radiusMd,
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.info_outline_rounded, size: 20, color: AppColors.mustardInk),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${cart.priceChangeAlerts.length} item(s) updated prices while you were away.',
                          style: AppFonts.body(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.mustardInk),
                        ),
                      ),
                      GestureDetector(
                        onTap: () {
                          HapticFeedback.selectionClick();
                          cart.clearPriceChangeAlerts();
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: AppColors.mustardInk,
                            borderRadius: AppRadius.radiusSm,
                          ),
                          child: Text(
                            'OK',
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
                  final bool showReadyMadeCard = cart.isOnlyReadyMade;
                  final itemCount = cart.entries.length + (showReadyMadeCard ? 1 : 0);

                  return StreamBuilder<DailyBoard>(
                    stream: _firestore.dailyBoardStream(),
                    builder: (context, boardSnap) {
                      final dailyBoard = boardSnap.data ?? DailyBoard.defaultForDay(DateTime.now());

                      return ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                        itemCount: itemCount,
                        itemBuilder: (context, index) {
                          if (index < cart.entries.length) {
                            final entry = cart.entries[index];
                            final entryKey = CartProvider.entryKey(entry.item.id, entry.customization);
                            return Dismissible(
                              key: ValueKey('cart_dismiss_${entryKey}_$index'),
                              direction: DismissDirection.endToStart,
                              background: Container(
                                alignment: Alignment.centerRight,
                                padding: const EdgeInsets.only(right: 20),
                                margin: const EdgeInsets.symmetric(vertical: 4),
                                decoration: BoxDecoration(
                                  color: AppColors.dangerBg,
                                  borderRadius: AppRadius.radiusMd,
                                ),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  children: [
                                    Text(
                                      'Remove',
                                      style: AppFonts.body(
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.w700,
                                        color: AppColors.danger,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    const Icon(Icons.delete_outline_rounded,
                                        color: AppColors.danger, size: 20),
                                  ],
                                ),
                              ),
                              onDismissed: (_) {
                                HapticFeedback.mediumImpact();
                                final removedItem = entry.item;
                                final removedCustomization = entry.customization;
                                cart.deleteItem(entryKey);
                                ScaffoldMessenger.of(context).hideCurrentSnackBar();
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text('Removed ${removedItem.name} from tray'),
                                    duration: const Duration(seconds: 4),
                                    action: SnackBarAction(
                                      label: 'UNDO',
                                      textColor: AppColors.mustard,
                                      onPressed: () {
                                        HapticFeedback.selectionClick();
                                        cart.addItem(
                                          removedItem,
                                          customization: removedCustomization,
                                        );
                                      },
                                    ),
                                  ),
                                );
                              },
                              child: _CartItemRow(entry: entry, dailyBoard: dailyBoard),
                            );
                          }
                          return ReadyMadePreferenceCard(cart: cart);
                        },
                      );
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
                size: 56, color: AppColors.inkSoft.withAlpha(102)),
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
  final DailyBoard? dailyBoard;

  const _CartItemRow({required this.entry, this.dailyBoard});

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
              color: isAvailable ? AppColors.surface2 : AppColors.dangerBg,
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Icon(
                _iconForKey(item.iconKey),
                size: 20,
                color: isAvailable ? AppColors.ink : AppColors.danger,
              ),
            ),
          ),
          const SizedBox(width: 12),

          // Name + price + customization
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
                if (entry.customization != null && entry.customization!.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.mustardSoft,
                      borderRadius: AppRadius.radiusSm,
                      border: Border.all(color: AppColors.mustardInk.withAlpha(50), width: 0.8),
                    ),
                    child: Text(
                      entry.customization!,
                      style: AppFonts.body(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AppColors.mustardInk,
                      ),
                    ),
                  ),
                  if (dailyBoard != null &&
                      entry.customization!.contains('Rotis') &&
                      !dailyBoard!.rotiAvailable) ...[
                    const SizedBox(height: 3),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.warningBg,
                        borderRadius: AppRadius.radiusSm,
                        border: Border.all(color: AppColors.warning.withAlpha(100), width: 0.8),
                      ),
                      child: Text(
                        '⚠️ Chapatis finished: Kitchen will fulfill with fresh puris',
                        style: AppFonts.body(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: AppColors.mustardInk,
                        ),
                      ),
                    ),
                  ] else if (dailyBoard != null &&
                      entry.customization!.contains('Puris') &&
                      !dailyBoard!.puriAvailable) ...[
                    const SizedBox(height: 3),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.warningBg,
                        borderRadius: AppRadius.radiusSm,
                        border: Border.all(color: AppColors.warning.withAlpha(100), width: 0.8),
                      ),
                      child: Text(
                        '⚠️ Puris finished: Kitchen will fulfill with fresh tawa rotis',
                        style: AppFonts.body(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: AppColors.mustardInk,
                        ),
                      ),
                    ),
                  ],
                ],
                const SizedBox(height: 2),
                if (!isAvailable) ...[
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppColors.dangerBg,
                      borderRadius: AppRadius.radiusSm,
                    ),
                    child: Text(
                      'No longer available',
                      style: AppFonts.mono(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.danger),
                    ),
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
                final entryKey = CartProvider.entryKey(item.id, entry.customization);
                context.read<CartProvider>().deleteItem(entryKey);
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
            // Stepper — no stock limits, cart is a wishlist
            Container(
              decoration: BoxDecoration(
                color: AppColors.surface2,
                borderRadius: BorderRadius.circular(999),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  BouncyTap(
                    scaleFactor: 0.84,
                    onTap: () {
                      final entryKey = CartProvider.entryKey(item.id, entry.customization);
                      final removedItem = entry.item;
                      final removedCustomization = entry.customization;
                      final wasLastItem = entry.qty == 1;

                      context.read<CartProvider>().removeItem(entryKey);

                      if (wasLastItem) {
                        ScaffoldMessenger.of(context).hideCurrentSnackBar();
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text('Removed ${item.name} from tray'),
                            duration: const Duration(seconds: 4),
                            action: SnackBarAction(
                              label: 'UNDO',
                              textColor: AppColors.mustard,
                              onPressed: () {
                                HapticFeedback.selectionClick();
                                context.read<CartProvider>().addItem(
                                      removedItem,
                                      customization: removedCustomization,
                                    );
                              },
                            ),
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
                        child: Text('–',
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w500)),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 160),
                      transitionBuilder: (child, animation) {
                        return ScaleTransition(
                          scale: animation,
                          child: FadeTransition(opacity: animation, child: child),
                        );
                      },
                      child: Text(
                        '${entry.qty}',
                        key: ValueKey<int>(entry.qty),
                        style: AppFonts.mono(fontSize: 12.5, color: AppColors.ink),
                      ),
                    ),
                  ),
                  // Plus — guarded by live available stock
                  Builder(
                    builder: (btnContext) {
                      final isMaxStock = entry.qty >= item.availableStock;
                      return BouncyTap(
                        scaleFactor: 0.84,
                        onTap: () {
                          if (isMaxStock) {
                            HapticFeedback.lightImpact();
                            ScaffoldMessenger.of(btnContext).hideCurrentSnackBar();
                            ScaffoldMessenger.of(btnContext).showSnackBar(
                              SnackBar(
                                content: Text('Only ${item.availableStock} ${item.name} available in stock.'),
                                duration: const Duration(milliseconds: 1500),
                              ),
                            );
                          } else {
                            context.read<CartProvider>().addItem(item, customization: entry.customization);
                          }
                        },
                        child: Container(
                          width: 28,
                          height: 28,
                          decoration: BoxDecoration(
                            color: isMaxStock ? AppColors.surface2 : AppColors.ink,
                            shape: BoxShape.circle,
                            border: isMaxStock ? Border.all(color: AppColors.line) : null,
                          ),
                          child: Center(
                            child: Text(
                              '+',
                              style: TextStyle(
                                color: isMaxStock ? AppColors.inkSoft.withAlpha(120) : Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ),
                      );
                    },
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

// ─── Ready-Made Pickup Preference Card ──────────────────────────────

class ReadyMadePreferenceCard extends StatelessWidget {
  final CartProvider cart;

  const ReadyMadePreferenceCard({super.key, required this.cart});

  @override
  Widget build(BuildContext context) {
    final hasBeverage = cart.hasBeverage;

    return Container(
      margin: const EdgeInsets.only(top: 8, bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.successBg,
        border: Border.all(color: AppColors.green.withAlpha(100), width: 1.5),
        borderRadius: AppRadius.radiusLg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.successBg,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.green.withAlpha(100), width: 1),
                ),
                child: const Text('⚡', style: TextStyle(fontSize: 18)),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            'Ready-Made Items Only',
                            style: AppFonts.display(fontSize: 15),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.green,
                            borderRadius: AppRadius.radiusSm,
                          ),
                          child: Text(
                            '0 MIN WAIT',
                            style: AppFonts.mono(fontSize: 9.5, fontWeight: FontWeight.w800, color: Colors.white),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'No kitchen cooking required! Directly head to counter to collect your order.',
                      style: AppFonts.body(fontSize: 11.5, color: AppColors.greenInk),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Divider(color: AppColors.green.withAlpha(50), height: 1),
          const SizedBox(height: 10),

          // ── Temperature Preference ──
          Text(
            hasBeverage ? '🥤 Beverage Temperature Preference:' : '❄️ Temperature Preference:',
            style: AppFonts.body(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.greenInk),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _buildChoiceChip(
                label: 'Chilled / Cold ❄️',
                selected: cart.temperaturePreference.contains('Chilled'),
                onTap: () {
                  HapticFeedback.selectionClick();
                  cart.setTemperaturePreference('Chilled ❄️');
                },
              ),
              const SizedBox(width: 8),
              _buildChoiceChip(
                label: 'Room Temp 🥤',
                selected: cart.temperaturePreference.contains('Room'),
                onTap: () {
                  HapticFeedback.selectionClick();
                  cart.setTemperaturePreference('Room Temp 🥤');
                },
              ),
            ],
          ),

          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.successBg,
              borderRadius: AppRadius.radiusSm,
            ),
            child: Row(
              children: [
                const Icon(Icons.check_circle_outline_rounded, size: 14, color: AppColors.greenInk),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Preference: ${cart.readyMadePreferenceSummary}',
                    style: AppFonts.mono(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.greenInk),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChoiceChip({
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
          decoration: BoxDecoration(
            color: selected ? AppColors.green : Colors.white,
            borderRadius: AppRadius.radiusMd,
            border: Border.all(
              color: selected ? AppColors.greenInk : AppColors.green.withAlpha(100),
              width: 1.5,
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 12,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              color: selected ? Colors.white : AppColors.greenInk,
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Cart Summary & CTA — Atomic Stock Check at Checkout ────────────

class _CartSummary extends StatefulWidget {
  final CartProvider cart;

  const _CartSummary({required this.cart});

  @override
  State<_CartSummary> createState() => _CartSummaryState();
}

class _CartSummaryState extends State<_CartSummary> with WidgetsBindingObserver {
  final FirestoreService _firestore = FirestoreService();
  final CheckoutService _checkoutService = CheckoutService();
  String? _currentIdempotencyKey;
  app.Order? _activePendingOrder;
  bool _isProcessing = false;
  bool _tapLocked = false;
  DateTime? _paymentStartTime;
  final String _selectedPaymentMethod = 'online';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _restoreActiveOrder();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && (_isProcessing || _paymentStartTime != null)) {
      // Returned from external payment apps (e.g. Google Pay, PhonePe, Paytm)
      if (_paymentStartTime != null) {
        debugPrint('[CartScreen] Resumed with payment in progress');
      }
      if (mounted) {
        setState(() {});
      }
    }
  }

  void _cancelPaymentInProgress() {
    PaymentService.cancelActivePayment('Payment was cancelled by user.');
    if (mounted) {
      setState(() {
        _isProcessing = false;
        _tapLocked = false;
        _paymentStartTime = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Payment session cancelled. You can retry anytime.'),
          backgroundColor: AppColors.ink,
        ),
      );
    }
  }

  Future<void> _restoreActiveOrder() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedOrderId = prefs.getString('active_order_id');
      if (savedOrderId != null && savedOrderId.isNotEmpty) {
        final snap = await FirebaseFirestore.instance.collection('orders').doc(savedOrderId).get();
        if (snap.exists && mounted) {
          final order = app.Order.fromFirestore(snap.id, snap.data() ?? {});
          if (order.isPaymentPending && !order.isCancelled) {
            setState(() {
              _activePendingOrder = order;
            });
          } else {
            await prefs.remove('active_order_id');
          }
        }
      }
    } catch (_) {}
  }

  Future<void> _handleConfirmAndPay() async {
    if (_isProcessing || _tapLocked) return;
    _tapLocked = true;
    final cart = widget.cart;
    final authProvider = context.read<AuthProvider>();

    // If browsing as guest or unauthenticated, prompt to sign in before checkout
    if (!authProvider.isLoggedIn || authProvider.currentProfile == null || authProvider.isGuest) {
      _tapLocked = false;
      LoginSheet.show(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Please sign in or create an account to place your order! 🍕'),
          backgroundColor: AppColors.mustardInk,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
      return;
    }

    // 1. If cart has items that went completely unavailable, prompt to clean
    if (cart.hasOutOfStockItems) {
      _tapLocked = false;
      _showOutOfStockAlert(cart.outOfStockEntries);
      return;
    }

    setState(() => _isProcessing = true);
    HapticFeedback.mediumImpact();

    try {
      // ──────────────────────────────────────────────────────────────
      // 2. ATOMIC STOCK CHECK — Backend is the single source of truth.
      //    First student to reach this point and pass wins the stock.
      // ──────────────────────────────────────────────────────────────
      final stockIssues = await _firestore.verifyItemsStockQuantity(cart.entries);

      if (stockIssues.isNotEmpty) {
        // Cap cart quantities to what's actually available
        for (final entry in stockIssues.entries) {
          cart.capItemQuantity(entry.key, entry.value);
        }

        setState(() => _isProcessing = false);
        _tapLocked = false;

        if (mounted) {
          _showStockLimitedAlert(stockIssues);
        }
        return;
      }

      // ──────────────────────────────────────────────────────────────
      // 3. TRUSTED CHECKOUT & INVENTORY RESERVATION ENGINE
      //    Reuse existing pending order session on payment retry to prevent
      //    creating duplicate orphaned orders in Firestore.
      // ──────────────────────────────────────────────────────────────
      app.Order order;
      final student = authProvider.currentStudent;

      bool canReuseOrder = false;
      if (_activePendingOrder != null &&
          !_activePendingOrder!.isCancelled &&
          _activePendingOrder!.totalAmount == cart.totalPrice &&
          _activePendingOrder!.items.length == cart.entries.length) {
        canReuseOrder = true;
        for (final entry in cart.entries) {
          final matched = _activePendingOrder!.items.any((i) =>
              i.itemId == entry.item.id &&
              i.quantity == entry.qty &&
              (i.customization ?? '') == (entry.customization ?? ''));
          if (!matched) {
            canReuseOrder = false;
            break;
          }
        }
      }

      if (canReuseOrder) {
        // Reuse current pending order session
        order = _activePendingOrder!;
      } else {
        // Cancel prior pending order if cart items or totals changed (TB-R2-004 & TB-BUG-05)
        if (_activePendingOrder != null) {
          final oldOrderId = _activePendingOrder!.id;
          _activePendingOrder = null;
          // Guard: Verify order is not captured/paid before issuing cancellation
          FirebaseFirestore.instance.collection('orders').doc(oldOrderId).get().then((snap) {
            if (snap.exists) {
              final status = snap.data()?['paymentStatus'];
              if (status != 'paid' && status != 'captured') {
                FunctionsService().cancelOrder(orderId: oldOrderId, reason: 'Cart modified before payment retry')
                    .catchError((_) => <String, dynamic>{});
              }
            }
          }).catchError((_) {});
        }

        // Explicitly clear old idempotency key so retry generates fresh session
        _currentIdempotencyKey = null;
        _currentIdempotencyKey = generateIdempotencyKey();

        order = await _checkoutService.createCheckout(
          idempotencyKey: _currentIdempotencyKey!,
          entries: cart.entries,
          paymentMethod: _selectedPaymentMethod,
          readyMadePreference: cart.isOnlyReadyMade ? cart.readyMadePreferenceSummary : null,
          dietaryPreferences: null,
          dietaryNotes: null,
          student: student,
        );
        _activePendingOrder = order;
      }

      if (student != null) {
        authProvider.incrementOrderCount();
      }

      // Persist active_order_id and active_order_ids in SharedPreferences for crash/kill recovery
      try {
        final prefs = await SharedPreferences.getInstance();
        final list = prefs.getStringList('active_order_ids') ?? <String>[];
        if (!list.contains(order.id)) {
          list.insert(0, order.id);
          if (list.length > 10) list.removeLast();
          await prefs.setStringList('active_order_ids', list);
        }
        await prefs.setString('active_order_id', order.id);
      } catch (_) {}

      // 4. Online Payment via Razorpay (Bypass if 100% discounted / 0 paise)
      String effectivePaymentId = 'CASH_${order.id}';
      _paymentStartTime = DateTime.now();

      if (order.totalAmount > 0) {
        try {
          final paymentService = PaymentService();
          final payRes = await paymentService.initiateOnlinePayment(
            orderId: order.id,
            totalAmountRs: order.totalAmount,
            studentName: student?.displayName ?? order.studentName ?? 'Student',
            studentEmail: student?.email ?? 'student@tcetmumbai.in',
          );
          effectivePaymentId = payRes.paymentId ?? 'RZP_${order.id}';
          debugPrint('[CartScreen] Online payment verified successfully: $effectivePaymentId');
        } on PaymentException catch (pe) {
          // Payment dismissed, declined, or timed out.
          // DO NOT wipe the cart! Keep items so student can retry.
          _paymentStartTime = null;
          setState(() => _isProcessing = false);
          _tapLocked = false;
          if (mounted) {
            // Show in-app payment failed notification
            InAppNotificationService().showPaymentFailed(
              context: context,
              tokenNumber: order.tokenNumber,
              onRetry: () => _handleConfirmAndPay(),
            );

            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(pe.message),
                backgroundColor: AppColors.red,
                duration: const Duration(seconds: 5),
                action: SnackBarAction(
                  label: 'View Order',
                  textColor: Colors.white,
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => OrderStatusScreen(order: order),
                      ),
                    );
                  },
                ),
              ),
            );
          }
          return;
        }
      } else {
        effectivePaymentId = 'FREE_${order.id}';
      }

      // CRITICAL: Persist confirmed state directly to Firestore /orders/{orderId} with retry
      for (int updAttempt = 0; updAttempt < 3; updAttempt++) {
        try {
          await FirebaseFirestore.instance.collection('orders').doc(order.id).update({
            'status': 'confirmed',
            'paymentStatus': 'paid',
            'paymentId': effectivePaymentId,
            'paidAt': FieldValue.serverTimestamp(),
            'confirmedAt': FieldValue.serverTimestamp(),
          });
          break;
        } catch (dbErr) {
          debugPrint('[CartScreen] Order confirmation attempt $updAttempt notice: $dbErr');
          if (updAttempt < 2) {
            await Future.delayed(Duration(milliseconds: 250 * (updAttempt + 1)));
          }
        }
      }

      // Store payment ID and keep active_order_id in SharedPreferences for recovery
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('last_payment_id_${order.id}', effectivePaymentId);
        final list = prefs.getStringList('active_order_ids') ?? <String>[];
        if (!list.contains(order.id)) {
          list.insert(0, order.id);
          if (list.length > 10) list.removeLast();
          await prefs.setStringList('active_order_ids', list);
        }
        await prefs.setString('active_order_id', order.id);
      } catch (_) {}

      _paymentStartTime = null;

      // 5. Payment verified — clear pending session, clear cart & show ticket
      _activePendingOrder = null;
      _currentIdempotencyKey = null;
      _tapLocked = false;
      cart.clear();

      final confirmedOrder = order.copyWith(
        status: 'confirmed',
        paymentStatus: 'paid',
      );

      if (mounted) {
        // Fire "Track Here" notification — visible when user returns to menu
        InAppNotificationService().showOrderPlaced(
          context: context,
          tokenNumber: confirmedOrder.tokenNumber,
          onTrack: () {
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => OrderStatusScreen(orderId: confirmedOrder.id, order: confirmedOrder),
              ),
            );
          },
        );

        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => TicketScreen(order: confirmedOrder),
          ),
        );
      }
    } on CanteenPausedException catch (e) {
      _paymentStartTime = null;
      setState(() => _isProcessing = false);
      _tapLocked = false;
      if (mounted) {
        showCanteenStatusSheet(
          context,
          CanteenOperationalStatus(mode: e.mode ?? 'DEGRADED', orderingAvailable: false),
          customMessage: e.message,
        );
      }
    } on InsufficientStockException catch (e) {
      _paymentStartTime = null;
      setState(() => _isProcessing = false);
      _tapLocked = false;
      cart.capItemQuantity(e.itemId, e.availableStock);
      if (mounted) {
        _showStockLimitedAlert({e.itemId: e.availableStock});
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString()),
            backgroundColor: AppColors.red,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
      }
    } catch (e) {
      _paymentStartTime = null;
      setState(() => _isProcessing = false);
      _tapLocked = false;
      final errStr = e.toString().toLowerCase();
      // Intercept local network and connectivity dropouts
      if (errStr.contains('socket') ||
          errStr.contains('network') ||
          errStr.contains('failed host lookup') ||
          errStr.contains('connection refused') ||
          errStr.contains('connection timed out') ||
          errStr.contains('clientexception') ||
          errStr.contains('os error')) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('⚠️ Network connection issue. Please check your connection and retry.'),
              backgroundColor: AppColors.red,
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
        return;
      }
      if (errStr.contains('paused') ||
          errStr.contains('degraded') ||
          errStr.contains('counter') ||
          errStr.contains('closed') ||
          errStr.contains('halt')) {
        if (mounted) {
          showCanteenStatusSheet(
            context,
            const CanteenOperationalStatus(mode: 'DEGRADED', orderingAvailable: false),
            customMessage: e is CheckoutException ? e.message : null,
          );
        }
        return;
      }
      if (mounted) {
        final displayMsg = e is CheckoutException
            ? e.message
            : (ErrorHelper.getFriendlyErrorMessage(e, defaultFallback: 'Failed to place order. Please try again.') ?? 'Failed to place order.');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(displayMsg),
            backgroundColor: AppColors.red,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
      }
    }
  }

  /// Alert when checkout stock check finds insufficient quantity
  void _showStockLimitedAlert(Map<String, int> stockIssues) {
    // Build per-item breakdown
    final cart = widget.cart;
    final lines = <String>[];
    for (final entry in stockIssues.entries) {
      final cartEntry = cart.entries.where((e) => e.item.id == entry.key).firstOrNull;
      if (cartEntry != null) {
        if (entry.value <= 0) {
          lines.add('• ${cartEntry.item.name}: Sorry, you got late! Someone already grabbed it.');
        } else {
          lines.add('• ${cartEntry.item.name}: Only ${entry.value} available');
        }
      }
    }

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
                    color: AppColors.warningBg,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.inventory_2_outlined, color: AppColors.mustardInk, size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Stock Limited', style: AppFonts.display(fontSize: 20)),
                      Text(
                        'Some items have limited availability',
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
                '${lines.join('\n')}\n\nYour cart has been updated to the maximum available quantities. Please review and try again.',
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
                      // Cart is already capped, student can review and retry
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.red,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: Text('Review & Pay', style: AppFonts.body(fontSize: 13.5, fontWeight: FontWeight.w700, color: Colors.white)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Alert when items are completely out of stock
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
                    color: AppColors.dangerBg,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.remove_shopping_cart_rounded, color: AppColors.red, size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Item Unavailable', style: AppFonts.display(fontSize: 20)),
                      Text(
                        'Canteen is no longer serving this item',
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
                'The following item(s) are currently unavailable:\n• $names\n\nRemove them to proceed with the rest of your order.',
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
                      Navigator.of(context).pop();
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

    return StreamBuilder<CanteenOperationalStatus>(
      stream: _firestore.operationalStatusStream(),
      builder: (context, statusSnapshot) {
        final status = statusSnapshot.data ?? CanteenOperationalStatus.normal();
        final isCanteenPaused = !status.isNormal;

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
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Icon(
                          cart.isOnlyReadyMade ? Icons.flash_on_rounded : Icons.access_time_rounded,
                          size: 14,
                          color: cart.isOnlyReadyMade ? AppColors.green : AppColors.inkSoft,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          cart.isOnlyReadyMade ? 'Ready now · Direct counter pickup' : cart.readyTimeText,
                          style: AppFonts.body(
                            fontSize: 12,
                            fontWeight: cart.isOnlyReadyMade ? FontWeight.w700 : FontWeight.normal,
                            color: cart.isOnlyReadyMade ? AppColors.green : AppColors.inkSoft,
                          ),
                        ),
                      ],
                    ),
                    if (cart.isOnlyReadyMade)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.successBg,
                          borderRadius: AppRadius.radiusSm,
                          border: Border.all(color: AppColors.green.withAlpha(100), width: 1),
                        ),
                        child: Text(
                          cart.temperaturePreference,
                          style: AppFonts.mono(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.greenInk),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),

                // ── Payment Method Selector ──
                _buildPaymentMethodSelector(),
                const SizedBox(height: 8),

                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Total',
                        style: AppFonts.mono(
                            fontSize: 15, fontWeight: FontWeight.w600)),
                    AnimatedSwitcher(
                      duration: const Duration(milliseconds: 180),
                      transitionBuilder: (child, animation) {
                        return FadeTransition(
                          opacity: animation,
                          child: SlideTransition(
                            position: Tween<Offset>(
                              begin: const Offset(0, 0.25),
                              end: Offset.zero,
                            ).animate(animation),
                            child: child,
                          ),
                        );
                      },
                      child: Text(
                        '₹${cart.totalPrice.toInt()}',
                        key: ValueKey<int>(cart.totalPrice.toInt()),
                        style: AppFonts.mono(
                            fontSize: 15, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),

                // ── Low-Network Guidance Advisory ──
                Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                  decoration: BoxDecoration(
                    color: AppColors.surface2,
                    borderRadius: AppRadius.radiusSm,
                    border: Border.all(color: AppColors.line, width: 0.8),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.wifi_tethering_rounded, size: 14, color: AppColors.inkSecondary),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '⚡ Please ensure a good cellular / Wi-Fi network for smooth checkout.',
                          style: AppFonts.body(fontSize: 11, color: AppColors.inkSecondary),
                        ),
                      ),
                    ],
                  ),
                ),
              ],

              // CTA button
              SizedBox(
                width: double.infinity,
                child: BouncyTap(
                  scaleFactor: 0.98,
                  onTap: cart.isEmpty || _isProcessing
                      ? null
                      : isCanteenPaused
                          ? () => showCanteenStatusSheet(context, status)
                          : _handleConfirmAndPay,
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    decoration: BoxDecoration(
                      color: cart.isEmpty || _isProcessing
                          ? AppColors.line
                          : isCanteenPaused
                              ? AppColors.warning
                              : hasStockIssue
                                  ? AppColors.danger
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
                              Text('Placing order...', style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.white)),
                            ],
                          )
                        : isCanteenPaused
                            ? Text(
                                status.buttonText,
                                style: AppFonts.body(fontSize: 14.5, fontWeight: FontWeight.w700, color: Colors.white),
                              )
                            : Text(
                                cart.isEmpty
                                    ? 'Confirm & pay'
                                    : hasStockIssue
                                        ? 'Remove unavailable items'
                                        : 'Pay Online · ₹${cart.totalPrice.toInt()}',
                                style: AppFonts.body(
                                  fontSize: 14.5,
                                  fontWeight: FontWeight.w700,
                                  color: cart.isEmpty ? AppColors.inkSoft : Colors.white,
                                ),
                              ),
                  ),
                ),
              ),
              if (_isProcessing || _paymentStartTime != null) ...[
                const SizedBox(height: 8),
                GestureDetector(
                  onTap: _cancelPaymentInProgress,
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
                    decoration: BoxDecoration(
                      color: AppColors.surface2,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppColors.line),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.close_rounded, size: 14, color: AppColors.danger),
                        const SizedBox(width: 6),
                        Text(
                          'Payment taking long or app switched? Tap to Cancel / Retry',
                          style: AppFonts.body(fontSize: 11.5, fontWeight: FontWeight.w600, color: AppColors.danger),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _buildPaymentMethodSelector() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line, width: 1),
      ),
      child: Row(
        children: [
          const Text('💳', style: TextStyle(fontSize: 18)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Instant Online Payment',
                  style: AppFonts.body(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.ink),
                ),
                Text(
                  'UPI (GPay / PhonePe / Paytm) & Cards',
                  style: AppFonts.mono(fontSize: 11, color: AppColors.inkSoft),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.greenSoft,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              'FAST PICKUP',
              style: AppFonts.mono(fontSize: 9.5, fontWeight: FontWeight.w700, color: AppColors.greenInk),
            ),
          ),
        ],
      ),
    );
  }
}
