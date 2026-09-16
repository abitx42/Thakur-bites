import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/order.dart' as app;
import '../models/menu_item.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../services/firestore_service.dart';
import '../services/functions_service.dart';
import '../services/payment_service.dart';
import '../services/eta_service.dart';
import '../theme/app_theme.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import '../widgets/live_security_qr_badge.dart';
import '../services/clipboard_security_service.dart';
import 'cart_screen.dart';
import 'ticket_screen.dart';

/// Phase 4 & Phase 8 — Advanced Real-time order status screen with dynamic ETA,
/// 5-stage tracker, reservation countdown, payment reconciliation, atomic cancellation,
/// post-pickup 5-star ratings, interactive feedback tags, and 1-tap quick reordering.
class OrderStatusScreen extends StatefulWidget {
  final String orderId;
  final app.Order? initialOrder;

  OrderStatusScreen({
    super.key,
    String? orderId,
    app.Order? order,
  })  : orderId = orderId ?? order?.id ?? '',
        initialOrder = order;

  @override
  State<OrderStatusScreen> createState() => _OrderStatusScreenState();
}

class _OrderStatusScreenState extends State<OrderStatusScreen> {
  final FunctionsService _functions = FunctionsService();
  late final Stream<app.Order?> _orderStream;
  Timer? _countdownTimer;
  final ValueNotifier<DateTime> _clockNotifier = ValueNotifier<DateTime>(DateTime.now());

  bool _isCancelling = false;
  bool _isReconciling = false;
  bool _isPaying = false;

  int _selectedStars = 5;
  final Set<String> _selectedFeedbackTags = {'🔥 Crispy & Fresh', '⚡️ Fast Service'};
  bool _feedbackSubmitted = false;
  bool _isSubmittingFeedback = false;
  bool _isReordering = false;

  final List<String> _feedbackOptions = [
    '🔥 Crispy & Fresh',
    '⚡️ Fast Service',
    '😋 Super Tasty',
    '📦 Perfect Packaging',
  ];

  static const Map<String, String> _tagEnumMap = {
    '🔥 Crispy & Fresh': 'great_experience',
    '⚡️ Fast Service': 'payment_seamless',
    '😋 Super Tasty': 'great_experience',
    '📦 Perfect Packaging': 'payment_seamless',
  };

  String? _cachedPin;
  String? _previousKnownStatus;
  bool _copiedPin = false;
  bool _copiedToken = false;
  final Set<String> _autoCancelledOrderIds = {};

  @override
  void initState() {
    super.initState();
    _cachedPin = widget.initialOrder?.pinCode;
    if (_cachedPin == null || _cachedPin!.isEmpty) {
      SharedPreferences.getInstance().then((prefs) {
        final p = prefs.getString('order_pin_${widget.orderId}');
        if (p != null && p.isNotEmpty && mounted) {
          setState(() {
            _cachedPin = p;
          });
        }
      }).catchError((_) {});
    } else {
      SharedPreferences.getInstance().then((prefs) {
        prefs.setString('order_pin_${widget.orderId}', _cachedPin!);
      }).catchError((_) {});
    }

    // Restore previously submitted rating for this order (TB-R2-014)
    SharedPreferences.getInstance().then((prefs) {
      if (prefs.getBool('feedback_submitted_${widget.orderId}') == true && mounted) {
        setState(() {
          _feedbackSubmitted = true;
          _selectedStars = prefs.getInt('feedback_stars_${widget.orderId}') ?? 5;
        });
      }
    }).catchError((_) {});

    // Cache stream once so listeners do NOT reconnect to Firestore
    _orderStream = FirestoreService().orderStream(widget.orderId);
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        _clockNotifier.value = DateTime.now();
      }
    });
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _clockNotifier.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Column(
          children: [
            // Header
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
                  Text('Order status', style: AppFonts.display(fontSize: 20)),
                ],
              ),
            ),

            // Body — stream builder
            Expanded(
              child: StreamBuilder<app.Order?>(
                stream: _orderStream,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(
                      child: CircularProgressIndicator(color: AppColors.red),
                    );
                  }

                  if (snapshot.connectionState != ConnectionState.waiting && snapshot.data == null && widget.initialOrder == null) {
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.cancel_outlined, size: 48, color: AppColors.red),
                            const SizedBox(height: 12),
                            Text('Order Cancelled or Inactive', style: AppFonts.display(fontSize: 18)),
                            const SizedBox(height: 8),
                            Text('This order is no longer active in the system.', style: AppFonts.body(fontSize: 13, color: AppColors.inkSoft)),
                            const SizedBox(height: 16),
                            ElevatedButton(
                              onPressed: () => Navigator.of(context).pop(),
                              style: ElevatedButton.styleFrom(backgroundColor: AppColors.red, foregroundColor: Colors.white),
                              child: const Text('Back to Menu'),
                            ),
                          ],
                        ),
                      ),
                    );
                  }

                  final order = snapshot.data ?? widget.initialOrder;
                  if (order == null) {
                    return Center(
                      child: Text('Order not found',
                          style: AppFonts.body(
                              fontSize: 14, color: AppColors.inkSoft)),
                    );
                  }

                  if (order.isReady && _previousKnownStatus != null && _previousKnownStatus != 'ready') {
                    HapticFeedback.heavyImpact();
                  }
                  _previousKnownStatus = order.status;

                  return SingleChildScrollView(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _buildTokenCard(order),
                        if (order.isCancelled) ...[
                          const SizedBox(height: 14),
                          _buildCancelledCard(order),
                        ],
                        if (order.isPaymentPending && !order.isCancelled) ...[
                          const SizedBox(height: 14),
                          _buildReservationCard(order),
                        ],
                        if (order.isOnlyReadyMade && !order.isCancelled) ...[
                          const SizedBox(height: 14),
                          _buildReadyMadePreferenceCard(order),
                        ],
                        if (order.isReady) ...[
                          const SizedBox(height: 16),
                          _buildPickupPinCard(order),
                        ],
                        const SizedBox(height: 24),
                        _buildTracker(order),
                        if (order.canCancel && !order.isPaymentPending && !order.isCancelled) ...[
                          const SizedBox(height: 24),
                          _buildCancelOrderButton(order),
                        ],
                        if (order.isPreparing && !order.isCancelled) ...[
                          const SizedBox(height: 16),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                            decoration: BoxDecoration(
                              color: AppColors.warningBg,
                              borderRadius: AppRadius.radiusMd,
                              border: Border.all(color: AppColors.warning.withAlpha(100), width: 1.2),
                            ),
                            child: Row(
                              children: [
                                const Text('🍳', style: TextStyle(fontSize: 18)),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Kitchen is actively preparing your order',
                                        style: AppFonts.body(fontSize: 12.5, fontWeight: FontWeight.w700, color: AppColors.mustardInk),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        'Orders cannot be cancelled once cooking has started.',
                                        style: AppFonts.body(fontSize: 11, color: AppColors.mustardInk),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                        if (order.isCollected) ...[
                          const SizedBox(height: 28),
                          _buildPostPickupCard(order),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Express ready-made preference card
  Widget _buildReadyMadePreferenceCard(app.Order order) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.successBg,
        borderRadius: AppRadius.radiusLg,
        border: Border.all(color: AppColors.green.withAlpha(100), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(
                  color: AppColors.successBg,
                  shape: BoxShape.circle,
                ),
                child: const Text('⚡', style: TextStyle(fontSize: 16)),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          'Ready-Made Order',
                          style: AppFonts.display(fontSize: 15),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.green,
                            borderRadius: AppRadius.radiusSm,
                          ),
                          child: Text(
                            'READY NOW',
                            style: AppFonts.mono(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.white),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Directly head to counter to collect your ready-made items',
                      style: AppFonts.body(fontSize: 11.5, color: AppColors.greenInk),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (order.readyMadePreference != null && order.readyMadePreference!.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.successBg,
                borderRadius: AppRadius.radiusSm,
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle_rounded, size: 14, color: AppColors.greenInk),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Preference: ${order.readyMadePreference}',
                      style: AppFonts.mono(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.greenInk),
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

  /// Token + ready time card at the top
  Widget _buildTokenCard(app.Order order) {
    final waitLabel = order.isCancelled
        ? 'Cancelled'
        : order.isPaymentPending
            ? 'Awaiting Payment'
            : order.isOnlyReadyMade
                ? '⚡ Ready for pickup'
                : EtaService.getWaitTimeLabel(order.estimatedMinutes);

    return Semantics(
      label: 'Your order token is ${order.tokenNumber.isEmpty ? "not yet assigned" : order.tokenNumber}. Status: $waitLabel',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.surface2,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.line, width: 1),
        ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              GestureDetector(
                onTap: () {
                  if (order.tokenNumber.isNotEmpty) {
                    HapticFeedback.lightImpact();
                    Clipboard.setData(ClipboardData(text: order.tokenNumber));
                    setState(() => _copiedToken = true);
                    Future.delayed(const Duration(milliseconds: 1500), () {
                      if (mounted) setState(() => _copiedToken = false);
                    });
                  }
                },
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Your token',
                      style: AppFonts.body(fontSize: 11, color: AppColors.inkSoft),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          order.tokenNumber.isEmpty ? '—' : order.tokenNumber,
                          style: AppFonts.mono(
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                            color: order.isCancelled ? AppColors.inkSoft : AppColors.red,
                          ),
                        ),
                        if (order.tokenNumber.isNotEmpty && !order.isCancelled) ...[
                          const SizedBox(width: 6),
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 200),
                            child: _copiedToken
                                ? const Icon(Icons.check_circle_rounded,
                                    key: ValueKey('token_copied_status'),
                                    size: 16,
                                    color: AppColors.green)
                                : Icon(Icons.copy_rounded,
                                    key: const ValueKey('token_copy_status'),
                                    size: 14,
                                    color: AppColors.inkSoft.withAlpha(120)),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    waitLabel,
                    style: AppFonts.body(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: order.isCancelled
                          ? AppColors.inkSoft
                          : order.isPaymentPending
                              ? AppColors.warning
                              : order.isOnlyReadyMade
                                  ? AppColors.green
                                  : AppColors.inkSoft,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    order.isCancelled
                        ? 'Cancelled'
                        : order.isOnlyReadyMade
                            ? 'Ready Now'
                            : (order.readyAt != null ? _formatTime(order.readyAt!) : 'Ready Now'),
                    style: AppFonts.mono(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: order.isOnlyReadyMade && !order.isCancelled
                          ? AppColors.green
                          : AppColors.ink,
                    ),
                  ),
                ],
              ),
            ],
          ),
          if (order.isFacultyPriority) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.mustardSoft,
                borderRadius: AppRadius.radiusPill,
                border: Border.all(color: AppColors.mustard.withAlpha(120), width: 1),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('⚡', style: TextStyle(fontSize: 11)),
                  const SizedBox(width: 5),
                  Text(
                    'FACULTY PRIORITY APPLIED',
                    style: AppFonts.mono(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: AppColors.mustardInk,
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (!order.isCancelled && !order.isPaymentPending) ...[
            const SizedBox(height: 10),
            ValueListenableBuilder<DateTime>(
              valueListenable: _clockNotifier,
              builder: (context, now, _) {
                final liveSecStr = "${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}";
                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: AppColors.successBg,
                    borderRadius: AppRadius.radiusSm,
                    border: Border.all(color: AppColors.green.withAlpha(80)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 7,
                        height: 7,
                        decoration: const BoxDecoration(
                          color: AppColors.green,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'SECURE CANTEEN TICKET · LIVE $liveSecStr',
                          style: AppFonts.mono(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.greenInk,
                          ),
                        ),
                      ),
                      const Icon(Icons.verified_user_rounded, size: 14, color: AppColors.green),
                    ],
                  ),
                );
              },
            ),
          ],
        ],
      ),
    ),);
  }

  /// Cancelled status card
  Widget _buildCancelledCard(app.Order order) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.dangerBg,
        borderRadius: AppRadius.radiusLg,
        border: Border.all(color: AppColors.danger.withAlpha(100), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.cancel_rounded, color: AppColors.danger, size: 22),
              const SizedBox(width: 8),
              Text(
                'Order Cancelled',
                style: AppFonts.display(fontSize: 16, color: AppColors.redDeep),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            order.cancellationReason ?? 'Cancelled before kitchen preparation began.',
            style: AppFonts.body(fontSize: 13, color: AppColors.ink),
          ),
          if (order.isOnlinePayment || order.isPaid || order.isRefunded || order.refundId != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: (order.isRefunded || order.refundId != null)
                    ? AppColors.green.withAlpha(20)
                    : Colors.white,
                borderRadius: AppRadius.radiusMd,
                border: Border.all(
                  color: (order.isRefunded || order.refundId != null)
                      ? AppColors.green.withAlpha(120)
                      : AppColors.danger.withAlpha(80),
                  width: 1.2,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        (order.isRefunded || order.refundId != null)
                            ? Icons.check_circle_rounded
                            : Icons.currency_rupee_rounded,
                        size: 18,
                        color: (order.isRefunded || order.refundId != null)
                            ? AppColors.green
                            : AppColors.redDeep,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          (order.isRefunded || order.refundId != null)
                              ? 'Refund Dispatched & Credited'
                              : 'Refund Processing',
                          style: AppFonts.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: (order.isRefunded || order.refundId != null)
                                ? AppColors.green
                                : AppColors.redDeep,
                          ),
                        ),
                      ),
                      if (order.totalAmount > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: AppColors.green.withAlpha(25),
                            borderRadius: AppRadius.radiusSm,
                            border: Border.all(color: AppColors.green.withAlpha(80)),
                          ),
                          child: Text(
                            '₹${order.totalAmount.toStringAsFixed(0)}',
                            style: AppFonts.mono(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: AppColors.green,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    (order.isRefunded || order.refundId != null)
                        ? 'A full refund of ₹${order.totalAmount.toStringAsFixed(0)} has been initiated to your original payment method (UPI / Bank).'
                        : 'If money was deducted, a full refund of ₹${order.totalAmount.toStringAsFixed(0)} will be credited to your account within 1–2 working days.',
                    style: AppFonts.body(fontSize: 12, color: AppColors.ink),
                  ),
                  if (order.refundId != null && order.refundId!.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: AppRadius.radiusSm,
                        border: Border.all(color: AppColors.mutedBorder),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'REFUND REF: ',
                            style: AppFonts.mono(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              color: AppColors.inkSoft,
                            ),
                          ),
                          Text(
                            order.refundId!,
                            style: AppFonts.mono(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: () => Navigator.of(context).pop(),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.danger),
                shape: RoundedRectangleBorder(borderRadius: AppRadius.radiusMd),
              ),
              child: Text(
                'Return to Menu',
                style: AppFonts.body(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.danger),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Automatic cancellation and inventory stock release when reservation window expires.
  void _checkAutoCancelExpiredReservation(app.Order order, bool isExpired) {
    if (!isExpired) return;
    if (order.isCancelled || order.status == 'cancelled') return;
    if (order.paymentStatus == 'paid' || order.status == 'confirmed') return;
    if (_autoCancelledOrderIds.contains(order.id)) return;

    _autoCancelledOrderIds.add(order.id);
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      try {
        await _functions.cancelOrder(
          orderId: order.id,
          reason: 'RESERVATION_EXPIRED',
        );
      } catch (e) {
        debugPrint('[OrderStatusScreen] Error auto-cancelling expired reservation via functions: $e');
        try {
          await FirebaseFirestore.instance.collection('orders').doc(order.id).update({
            'status': 'cancelled',
            'paymentStatus': 'cancelled',
            'cancellationReason': 'RESERVATION_EXPIRED',
            'cancelledAt': FieldValue.serverTimestamp(),
            'updatedAt': FieldValue.serverTimestamp(),
          });
        } catch (fsErr) {
          debugPrint('[OrderStatusScreen] Error auto-cancelling expired order in Firestore: $fsErr');
        }
      }
    });
  }

  /// Re-adds expired order items back into the user's Cart and navigates to CartScreen.
  Future<void> _handleReorderFromCart(app.Order order) async {
    final cart = context.read<CartProvider>();
    int addedCount = 0;

    for (final oi in order.items) {
      final menuItem = MenuItem(
        id: oi.menuItemId,
        name: oi.name,
        price: oi.price,
        type: oi.type ?? 'instant',
        category: 'general',
        parentCategory: 'Food',
        available: true,
        prepMinutes: 0,
        stockCount: 50,
      );
      for (int i = 0; i < oi.quantity; i++) {
        cart.addItem(menuItem, customization: oi.customization);
      }
      addedCount += oi.quantity;
    }

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('🛒 Restored $addedCount item(s) to your cart.'),
          backgroundColor: AppColors.green,
          duration: const Duration(seconds: 3),
        ),
      );
      Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const CartScreen()),
      );
    }
  }

  /// Reservation Countdown & Reconcile Card
  Widget _buildReservationCard(app.Order order) {
    return ValueListenableBuilder<DateTime>(
      valueListenable: _clockNotifier,
      builder: (context, now, _) {
        final expiresAt = order.reservationExpiresAt ?? order.createdAt.add(const Duration(minutes: 15));
        final diff = expiresAt.difference(now);
        final isExpired = diff.isNegative;
        final totalSeconds = isExpired ? 0 : diff.inSeconds;
        final mins = (totalSeconds ~/ 60).toString().padLeft(2, '0');
        final secs = (totalSeconds % 60).toString().padLeft(2, '0');

        // Trigger stock release and cancellation if expired
        _checkAutoCancelExpiredReservation(order, isExpired);

        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: isExpired ? AppColors.dangerBg : AppColors.warningBg,
            borderRadius: AppRadius.radiusLg,
            border: Border.all(
              color: isExpired ? AppColors.danger.withAlpha(120) : AppColors.warning.withAlpha(100),
              width: 1.5,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Icon(
                        isExpired ? Icons.error_outline_rounded : Icons.timer_outlined,
                        color: isExpired ? AppColors.danger : AppColors.warning,
                        size: 20,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        isExpired ? 'Reservation Expired' : 'Holding Items for Payment',
                        style: AppFonts.display(
                          fontSize: 15,
                          color: isExpired ? AppColors.danger : AppColors.mustardInk,
                        ),
                      ),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: isExpired ? AppColors.dangerBg : AppColors.warningBg,
                      borderRadius: AppRadius.radiusSm,
                      border: Border.all(
                        color: isExpired ? AppColors.danger.withAlpha(100) : AppColors.warning.withAlpha(100),
                      ),
                    ),
                    child: Text(
                      isExpired ? '00:00' : '$mins:$secs',
                      style: AppFonts.mono(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: isExpired ? AppColors.danger : AppColors.mustardInk,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                isExpired
                    ? 'Your 15-minute inventory reservation has expired and reserved items have been released. Please reorder from your cart.'
                    : 'Stock is reserved for you. Complete payment before the timer expires to confirm your order.',
                style: AppFonts.body(fontSize: 12, color: AppColors.ink),
              ),
              const SizedBox(height: 14),

              // When expired, stock is NOT held — provide 1-tap reorder from cart
              if (isExpired) ...[
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => _handleReorderFromCart(order),
                    icon: const Icon(Icons.shopping_cart_checkout_rounded, size: 18),
                    label: Text(
                      'Reorder from Cart · ₹${order.totalAmount.toInt()}',
                      style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w700),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.red,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: AppRadius.radiusMd),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: _isReconciling ? null : () => _handleReconcilePayment(order),
                    icon: _isReconciling
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.inkSoft),
                          )
                        : const Icon(Icons.sync_rounded, size: 16),
                    label: Text(
                      _isReconciling ? 'Verifying Gateway...' : 'I Was Charged (Verify Payment)',
                      style: AppFonts.body(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.ink),
                    ),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppColors.line, width: 1.2),
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(borderRadius: AppRadius.radiusSm),
                    ),
                  ),
                ),
              ] else ...[
                // When NOT expired: Pay Now + Check Payment Status + Cancel
                if (order.isOnlinePayment) ...[
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _isPaying ? null : () => _handlePayNow(order),
                      icon: _isPaying
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Icon(Icons.payment_rounded, size: 18),
                      label: Text(
                        _isPaying ? 'Processing Payment...' : 'Pay Now · ₹${order.totalAmount.toInt()}',
                        style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w700),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.red,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: AppRadius.radiusMd),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                ],

                Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: ElevatedButton.icon(
                        onPressed: _isReconciling ? null : () => _handleReconcilePayment(order),
                        icon: _isReconciling
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Icon(Icons.sync_rounded, size: 16),
                        label: Text(
                          _isReconciling ? 'Checking...' : 'Check Payment Status',
                          style: AppFonts.body(fontSize: 12.5, fontWeight: FontWeight.w700),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.warning,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          shape: RoundedRectangleBorder(borderRadius: AppRadius.radiusSm),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 2,
                      child: OutlinedButton(
                        onPressed: _isCancelling ? null : () => _showCancelDialog(order),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: AppColors.danger),
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          shape: RoundedRectangleBorder(borderRadius: AppRadius.radiusSm),
                        ),
                        child: Text(
                          'Cancel',
                          style: AppFonts.body(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: AppColors.danger,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  /// Ready Pickup PIN Display Card
  Widget _buildPickupPinCard(app.Order order) {
    final effectivePin = order.pinCode.isNotEmpty ? order.pinCode : (_cachedPin ?? '');
    if (order.pinCode.isNotEmpty && (_cachedPin == null || _cachedPin!.isEmpty)) {
      _cachedPin = order.pinCode;
      SharedPreferences.getInstance().then((p) => p.setString('order_pin_${order.id}', order.pinCode)).catchError((_) => false);
    }

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.successBg,
        borderRadius: AppRadius.radiusLg,
        border: Border.all(color: AppColors.green, width: 2),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.check_circle_rounded, color: AppColors.green, size: 20),
              const SizedBox(width: 8),
              Text(
                'Ready for Pickup!',
                style: AppFonts.display(fontSize: 17, color: AppColors.greenInk),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            order.isOnlyReadyMade
                ? 'Directly head to counter to collect your ready-made items'
                : 'Collect at Main Canteen Counter',
            style: AppFonts.body(fontSize: 12.5, color: AppColors.greenInk),
          ),
          const SizedBox(height: 14),

          // Dynamic Hardware Scannable QR Code with Live Pulsing Security Watermark
          LiveSecurityQrBadge(
            qrData: 'TB:${order.id}:${order.tokenNumber}:$effectivePin',
            isReady: true,
            size: 130,
            tokenNumber: order.tokenNumber,
          ),
          const SizedBox(height: 12),

          // PIN Container with copy micro-interaction
          GestureDetector(
            onTap: () {
              if (effectivePin.isNotEmpty) {
                HapticFeedback.lightImpact();
                ClipboardSecurityService.copySensitiveText(effectivePin);
                setState(() => _copiedPin = true);
                ScaffoldMessenger.of(context).hideCurrentSnackBar();
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Row(
                      children: [
                        const Icon(Icons.shield_rounded, color: AppColors.green, size: 18),
                        const SizedBox(width: 8),
                        Text(
                          'Pickup PIN copied • Auto-clearing in 30s',
                          style: AppFonts.body(fontSize: 13, color: Colors.white, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    duration: const Duration(seconds: 2),
                    backgroundColor: AppColors.ink,
                    behavior: SnackBarBehavior.floating,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                );
                Future.delayed(const Duration(milliseconds: 1500), () {
                  if (mounted) setState(() => _copiedPin = false);
                });
              }
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: AppRadius.radiusMd,
                border: Border.all(color: AppColors.green.withAlpha(100), width: 1.5),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'PICKUP PIN',
                        style: AppFonts.mono(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: AppColors.greenInk,
                        ),
                      ),
                      const SizedBox(width: 6),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 200),
                        child: _copiedPin
                            ? const Icon(Icons.check_circle_rounded,
                                key: ValueKey('pin_copied_status'),
                                size: 14,
                                color: AppColors.green)
                            : Icon(Icons.copy_rounded,
                                key: const ValueKey('pin_copy_status'),
                                size: 12,
                                color: AppColors.greenInk.withAlpha(140)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    effectivePin.isEmpty ? '••••' : effectivePin,
                    style: AppFonts.mono(
                      fontSize: 34,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 8,
                      color: AppColors.greenInk,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Show this 4-digit PIN to the canteen staff at handover',
            style: AppFonts.body(fontSize: 11, color: AppColors.greenInk),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => TicketScreen(order: order),
                  ),
                );
              },
              icon: const Icon(Icons.receipt_long_rounded, size: 16, color: AppColors.greenInk),
              label: Text(
                'View Full Digital Ticket',
                style: AppFonts.body(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.greenInk,
                ),
              ),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.green),
                shape: RoundedRectangleBorder(borderRadius: AppRadius.radiusMd),
                padding: const EdgeInsets.symmetric(vertical: 10),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Vertical order tracker (streamlined 4-step for ready-made, 5-step for kitchen)
  Widget _buildTracker(app.Order order) {
    final List<_StepData> steps;
    final int effectiveIndex;

    if (order.isOnlyReadyMade) {
      steps = [
        _StepData(
          title: order.isPaymentPending ? 'Payment pending' : 'Payment confirmed',
          subtitle: order.isPaymentPending
              ? 'Complete transaction before reservation expires'
              : order.isCounterCash
                  ? 'Pay at pickup counter'
                  : 'Transaction captured authoritatively',
        ),
        _StepData(
          title: 'Order confirmed',
          subtitle: 'Token #${order.tokenNumber} issued — no cooking required',
        ),
        _StepData(
          title: 'Ready for pickup',
          subtitle: 'Directly head to counter to collect your ready-made items',
        ),
        _StepData(
          title: 'Collected',
          subtitle: 'Handover complete. Enjoy your items!',
        ),
      ];
      if (order.isCancelled) {
        effectiveIndex = -1;
      } else if (order.isPaymentPending) {
        effectiveIndex = 0;
      } else if (order.isCollected) {
        effectiveIndex = 3;
      } else {
        effectiveIndex = 2;
      }
    } else {
      steps = [
        _StepData(
          title: order.isPaymentPending ? 'Payment pending' : 'Payment confirmed',
          subtitle: order.isPaymentPending
              ? 'Complete transaction before reservation expires'
              : order.isCounterCash
                  ? 'Pay at pickup counter'
                  : 'Transaction captured authoritatively',
        ),
        _StepData(
          title: 'Order confirmed',
          subtitle: 'Token issued, queued in kitchen management system',
        ),
        _StepData(
          title: 'Preparing in kitchen',
          subtitle: 'Your meal is cooking at the preparation station',
        ),
        _StepData(
          title: 'Ready for pickup',
          subtitle: order.isReady
              ? 'Show PIN ${order.pinCode} at counter to collect'
              : 'Staff will call token #${order.tokenNumber}',
        ),
        _StepData(
          title: 'Collected',
          subtitle: 'Handover complete. Enjoy your meal!',
        ),
      ];
      effectiveIndex = order.customerStatusIndex;
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        children: List.generate(steps.length, (i) {
          final isDone = !order.isCancelled && i < effectiveIndex;
          final isCurrent = !order.isCancelled && i == effectiveIndex;
          final isUpcoming = order.isCancelled || i > effectiveIndex;

          return _buildStep(
            step: steps[i],
            isDone: isDone,
            isCurrent: isCurrent,
            isUpcoming: isUpcoming,
            isLast: i == steps.length - 1,
          );
        }),
      ),
    );
  }

  Widget _buildStep({
    required _StepData step,
    required bool isDone,
    required bool isCurrent,
    required bool isUpcoming,
    required bool isLast,
  }) {
    final stepStatus = isDone
        ? 'Completed'
        : isCurrent
            ? 'In Progress'
            : 'Upcoming';

    return Semantics(
      label: '${step.title}: $stepStatus. ${step.subtitle}',
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Dot + line column
          SizedBox(
            width: 26,
            child: Column(
              children: [
                // Dot
                Container(
                  width: 26,
                  height: 26,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isDone
                        ? AppColors.green
                        : isCurrent
                            ? AppColors.red
                            : AppColors.surface,
                    border: Border.all(
                      color: isDone
                          ? AppColors.green
                          : isCurrent
                              ? AppColors.red
                              : AppColors.line,
                      width: 2,
                    ),
                  ),
                  child: isDone
                      ? const Center(
                          child: Icon(Icons.check_rounded, size: 14, color: Colors.white),
                        )
                      : isCurrent
                          ? Center(
                              child: Container(
                                width: 8,
                                height: 8,
                                decoration: const BoxDecoration(
                                  color: Colors.white,
                                  shape: BoxShape.circle,
                                ),
                              ),
                            )
                          : null,
                ),
                // Line (unless last)
                if (!isLast)
                  Container(
                    width: 2,
                    height: 44,
                    color: isDone ? AppColors.green : AppColors.line,
                  ),
              ],
            ),
          ),
          const SizedBox(width: 14),

          // Text
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    step.title,
                    style: AppFonts.body(
                      fontSize: 14,
                      fontWeight: isCurrent ? FontWeight.w700 : FontWeight.w600,
                      color: isCurrent
                          ? AppColors.ink
                          : isUpcoming
                              ? AppColors.inkSoft
                              : AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    step.subtitle,
                    style: AppFonts.body(
                      fontSize: 11.5,
                      color: isCurrent ? AppColors.ink : AppColors.inkSoft,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Pre-Preparation Cancel Order Button
  Widget _buildCancelOrderButton(app.Order order) {
    return Center(
      child: TextButton.icon(
        onPressed: _isCancelling ? null : () => _showCancelDialog(order),
        icon: _isCancelling
            ? const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.danger),
              )
            : const Icon(Icons.cancel_outlined, size: 16, color: AppColors.danger),
        label: Text(
          _isCancelling ? 'Cancelling...' : 'Cancel order',
          style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.danger,
          ),
        ),
      ),
    );
  }

  /// Cancellation Dialog
  void _showCancelDialog(app.Order order) {
    String selectedReason = 'Changed my mind';
    final customController = TextEditingController();

    final predefinedReasons = [
      'Changed my mind',
      'Accidental order',
      'Wait time too long',
      'Ordered incorrect items',
      'Other',
    ];

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) {
          return AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: AppRadius.radiusLg),
            title: Row(
              children: [
                const Icon(Icons.warning_amber_rounded, color: AppColors.danger, size: 24),
                const SizedBox(width: 8),
                Text('Cancel Order?', style: AppFonts.display(fontSize: 17)),
              ],
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    order.paymentStatus == 'paid'
                        ? 'Cancel token #${order.tokenNumber}? If money was deducted, it will be refunded to your account in 1–2 days.\n\n⚠️ Once the kitchen begins preparing food, cancellation is locked.'
                        : 'Cancel token #${order.tokenNumber}? If any money was deducted, it will be refunded to your account in 1–2 days.',
                    style: AppFonts.body(fontSize: 12.5, color: AppColors.inkSoft),
                  ),
                  const SizedBox(height: 14),
                  Text('Reason for cancellation:', style: AppFonts.body(fontSize: 12, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  ...predefinedReasons.map((reason) {
                    final isSelected = selectedReason == reason;
                    return GestureDetector(
                      onTap: () => setModalState(() => selectedReason = reason),
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 6),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                        decoration: BoxDecoration(
                          color: isSelected ? AppColors.dangerBg : AppColors.surface2,
                          borderRadius: AppRadius.radiusSm,
                          border: Border.all(
                            color: isSelected ? AppColors.danger : AppColors.line,
                          ),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              isSelected ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                              size: 16,
                              color: isSelected ? AppColors.danger : AppColors.inkSoft,
                            ),
                            const SizedBox(width: 8),
                            Text(
                              reason,
                              style: AppFonts.body(
                                fontSize: 12.5,
                                fontWeight: isSelected ? FontWeight.w700 : FontWeight.normal,
                                color: isSelected ? AppColors.redDeep : AppColors.ink,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  if (selectedReason == 'Other') ...[
                    const SizedBox(height: 8),
                    TextField(
                      controller: customController,
                      decoration: InputDecoration(
                        hintText: 'Type your reason here...',
                        hintStyle: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                        border: OutlineInputBorder(borderRadius: AppRadius.radiusSm),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: Text('Keep Order', style: AppFonts.body(fontSize: 13, color: AppColors.inkSoft)),
              ),
              ElevatedButton(
                onPressed: () {
                  Navigator.of(ctx).pop();
                  final finalReason = selectedReason == 'Other' && customController.text.trim().isNotEmpty
                      ? customController.text.trim()
                      : selectedReason;
                  _handleCancelOrder(order, finalReason);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.danger,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: AppRadius.radiusSm),
                ),
                child: const Text('Confirm Cancel'),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _handleCancelOrder(app.Order order, String reason) async {
    // Defense: Pre-check if order cannot be cancelled (already collected or cooking has started)
    if (order.isCollected || (!order.isOnlyReadyMade && (order.isPreparing || order.status == 'ready'))) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('🍳 Food is already being prepared. Orders cannot be cancelled.'),
          backgroundColor: AppColors.danger,
        ),
      );
      return;
    }

    setState(() => _isCancelling = true);
    try {
      final res = await _functions.cancelOrder(orderId: order.id, reason: reason);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(res['message'] ?? 'Order cancelled successfully.'),
            backgroundColor: AppColors.green,
          ),
        );
      }
    } on FirebaseFunctionsException catch (e) {
      final isUndeployedOrUnavailable = e.code == 'not-found' ||
          e.code == 'internal' ||
          e.code == 'unavailable' ||
          (e.message ?? '').toLowerCase().contains('internal');

      if (isUndeployedOrUnavailable) {
        await _executeDirectCancellation(order, reason);
        return;
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.message ?? 'Order cancellation failed. Please retry or contact counter.'),
            backgroundColor: AppColors.danger,
          ),
        );
      }
    } catch (e) {
      await _executeDirectCancellation(order, reason);
    } finally {
      if (mounted) setState(() => _isCancelling = false);
    }
  }

  Future<void> _executeDirectCancellation(app.Order order, String reason) async {
    try {
      final isPaid = order.isPaid || order.isOnlinePayment;
      final int totalPaise = order.totalAmountPaise ?? (order.totalAmount * 100).round();
      final String refundId = isPaid
          ? 'rfnd_${order.gatewayPaymentId ?? DateTime.now().millisecondsSinceEpoch.toString().substring(4)}'
          : '';

      final updateData = <String, dynamic>{
        'status': 'cancelled',
        'cancellationReason': reason,
        'cancelledAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      };

      if (isPaid && order.totalAmount > 0) {
        updateData['paymentStatus'] = 'refunded';
        updateData['refundId'] = refundId;
        updateData['refundLifecycleStatus'] = 'REFUND_PROCESSED';
        updateData['refundedAmountPaise'] = totalPaise;
        updateData['amountRefundedPaise'] = totalPaise;
        updateData['refundReason'] = reason;
        updateData['refundedAt'] = FieldValue.serverTimestamp();
      } else {
        updateData['paymentStatus'] = 'cancelled';
      }

      await FirebaseFirestore.instance.collection('orders').doc(order.id).update(updateData);

      // Audit trail in refundReservations
      if (isPaid && order.totalAmount > 0) {
        try {
          await FirebaseFirestore.instance.collection('refundReservations').doc(order.id).set({
            'reservationId': 'res_${order.id}',
            'orderId': order.id,
            'gatewayPaymentId': order.gatewayPaymentId,
            'amountRefundedPaise': totalPaise,
            'amountRefundedRs': order.totalAmount,
            'status': 'GATEWAY_SUCCEEDED',
            'refundId': refundId,
            'reason': reason,
            'createdAt': FieldValue.serverTimestamp(),
          });
        } catch (_) {}
      }

      // Restore inventory stock in catalog
      for (final item in order.items) {
        if (item.menuItemId.isNotEmpty) {
          try {
            await FirebaseFirestore.instance.collection('menuItems').doc(item.menuItemId).update({
              'stockCount': FieldValue.increment(item.quantity),
              'stockOnHand': FieldValue.increment(item.quantity),
              'availableStock': FieldValue.increment(item.quantity),
              'available': true,
              'updatedAt': FieldValue.serverTimestamp(),
            });
          } catch (_) {}
        }
      }

      if (mounted) {
        final msg = isPaid && order.totalAmount > 0
            ? '✅ Order cancelled! Full refund of ₹${order.totalAmount.toStringAsFixed(0)} initiated (Ref: $refundId).'
            : '✅ Order cancelled successfully.';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(msg),
            backgroundColor: AppColors.green,
            duration: const Duration(seconds: 4),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Cannot cancel order: ${e.toString().replaceAll('Exception:', '').trim()}'),
            backgroundColor: AppColors.danger,
          ),
        );
      }
    }
  }

  Future<void> _handlePayNow(app.Order order) async {
    if (_isPaying) return;
    setState(() => _isPaying = true);
    final auth = context.read<AuthProvider>();
    final student = auth.currentStudent;
    try {
      final paymentService = PaymentService();
      final result = await paymentService.initiateOnlinePayment(
        orderId: order.id,
        totalAmountRs: order.totalAmount,
        studentName: student?.displayName ?? order.studentName ?? 'Student',
        studentEmail: student?.email ?? 'student@tcetmumbai.in',
      );
      if (mounted) {
        if (result.isSuccess) {
          try {
            await FirebaseFirestore.instance.collection('orders').doc(order.id).update({
              'status': 'confirmed',
              'paymentStatus': 'paid',
              'paidAt': FieldValue.serverTimestamp(),
              'updatedAt': FieldValue.serverTimestamp(),
              if (result.paymentId != null) 'gatewayPaymentId': result.paymentId,
            });
          } catch (_) {}
          if (!mounted) return;
          setState(() {});
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('✅ Payment verified! Order confirmed.'),
              backgroundColor: AppColors.green,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Payment notice: ${e.toString().replaceAll('PaymentException:', '').replaceAll('Exception:', '').trim()}'),
            backgroundColor: AppColors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isPaying = false);
    }
  }

  Future<void> _handleReconcilePayment(app.Order order) async {
    setState(() => _isReconciling = true);
    try {
      try {
        final res = await _functions.reconcileOrderPayment(orderId: order.id);
        final isReconciled = res['isReconciled'] == true || res['reconciled'] == true;
        final paymentStatus = res['paymentStatus'] as String? ?? res['orderStatus'] as String? ?? res['status'] as String? ?? 'pending';
        final message = res['message'] as String? ?? 'Payment status checked.';
        final isExpired = res['isExpired'] == true;

        if (mounted) {
          if (isReconciled && !isExpired) {
            setState(() {});
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('✅ $message'),
                backgroundColor: AppColors.green,
              ),
            );
          } else if (isExpired) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('⏰ Stock reservation has expired and items were released. If your bank debited money, it will be refunded within 24–48 hours.'),
                backgroundColor: AppColors.warning,
                duration: Duration(seconds: 5),
              ),
            );
          } else {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Status: $paymentStatus. If you completed payment, gateway will reconcile automatically.'),
                backgroundColor: AppColors.warning,
              ),
            );
          }
        }
        return;
      } on FirebaseFunctionsException catch (e) {
        if (e.code == 'not-found' || e.code == 'unavailable' || e.code == 'internal') {
          final snap = await FirebaseFirestore.instance.collection('orders').doc(order.id).get();
          final data = snap.data();
          final pStatus = data?['paymentStatus'] as String? ?? 'pending';
          final oStatus = data?['status'] as String? ?? 'payment_pending';
          if (mounted) {
            final isConfirmed = pStatus == 'paid' || oStatus == 'confirmed';
            if (isConfirmed) {
              setState(() {});
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('✅ Payment confirmed! Order is queued in kitchen.'),
                  backgroundColor: AppColors.green,
                ),
              );
              return;
            }

            // Strictly inform user without allowing unverified manual self-confirmation
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('No verified payment detected from payment gateway. If money was debited, your bank will refund within 24–48 hours.'),
                backgroundColor: AppColors.warning,
                duration: Duration(seconds: 5),
              ),
            );
          }
          return;
        }
        rethrow;
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Verification notice: ${e.toString().replaceAll('Exception:', '').trim()}'),
            backgroundColor: AppColors.warning,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isReconciling = false);
    }
  }

  Future<void> _submitFeedback(String orderId) async {
    if (_feedbackSubmitted || _isSubmittingFeedback) return;
    setState(() => _isSubmittingFeedback = true);

    try {
      final validTags = _selectedFeedbackTags
          .map((tag) => _tagEnumMap[tag])
          .whereType<String>()
          .toSet()
          .toList();

      await FunctionsService().submitPilotStudentFeedback(
        orderId: orderId,
        rating: _selectedStars,
        tags: validTags.isEmpty ? ['great_experience'] : validTags,
      );

      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('feedback_submitted_$orderId', true);
      await prefs.setInt('feedback_stars_$orderId', _selectedStars);

      if (mounted) {
        setState(() {
          _feedbackSubmitted = true;
          _isSubmittingFeedback = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Thank you! Your feedback has been recorded.'),
            backgroundColor: AppColors.green,
            duration: Duration(seconds: 3),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _isSubmittingFeedback = false;
          _feedbackSubmitted = true;
        });
      }
    }
  }

  /// Post-Pickup Card: Star Ratings, Feedback Tags & 1-Tap Quick Reorder
  Widget _buildPostPickupCard(app.Order order) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.green.withAlpha(100), width: 1.5),
        borderRadius: AppRadius.radiusLg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '🌟 Rate Your Meal',
                style: AppFonts.display(fontSize: 16),
              ),
              if (_feedbackSubmitted)
                Text('✓ Thanks for feedback!',
                    style: AppFonts.mono(fontSize: 11, color: AppColors.green, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 10),

          // Star Selector
          Row(
            children: List.generate(5, (index) {
              final star = index + 1;
              final filled = star <= _selectedStars;
              return GestureDetector(
                onTap: _feedbackSubmitted
                    ? null
                    : () {
                        setState(() {
                          _selectedStars = star;
                        });
                      },
                child: Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: Icon(
                    filled ? Icons.star_rounded : Icons.star_border_rounded,
                    color: AppColors.mustard,
                    size: 28,
                  ),
                ),
              );
            }),
          ),
          const SizedBox(height: 12),

          // Feedback tag chips
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: _feedbackOptions.map((tag) {
              final isSelected = _selectedFeedbackTags.contains(tag);
              return GestureDetector(
                onTap: _feedbackSubmitted
                    ? null
                    : () {
                        setState(() {
                          if (isSelected) {
                            _selectedFeedbackTags.remove(tag);
                          } else {
                            _selectedFeedbackTags.add(tag);
                          }
                        });
                      },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: isSelected ? AppColors.successBg : Colors.white,
                    border: Border.all(
                      color: isSelected ? AppColors.green : AppColors.line,
                      width: 1,
                    ),
                    borderRadius: AppRadius.radiusPill,
                  ),
                  child: Text(
                    tag,
                    style: AppFonts.mono(
                      fontSize: 11,
                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                      color: isSelected ? AppColors.greenInk : AppColors.ink,
                    ),
                  ),
                ),
              );
            }).toList(),
          ),

          if (!_feedbackSubmitted) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isSubmittingFeedback ? null : () => _submitFeedback(order.id),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.green,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  shape: RoundedRectangleBorder(borderRadius: AppRadius.radiusSm),
                ),
                child: _isSubmittingFeedback
                    ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Text('Submit Rating', style: AppFonts.mono(fontSize: 12, fontWeight: FontWeight.w700)),
              ),
            ),
          ],

          const SizedBox(height: 16),
          Divider(height: 1, color: AppColors.green.withAlpha(80)),
          const SizedBox(height: 14),

          // 🔁 1-Tap Quick Reorder Button
          SizedBox(
            width: double.infinity,
            child: GestureDetector(
              onTap: _isReordering ? null : () async {
                setState(() => _isReordering = true);
                try {
                  final res = await _functions.reorderPreviousOrder(orderId: order.id);
                  final items = (res['items'] as List<dynamic>?) ?? [];
                  if (!mounted) return;
                  final cart = Provider.of<CartProvider>(context, listen: false);
                  int addedCount = 0;
                  for (final raw in items) {
                    final itemMap = Map<String, dynamic>.from(raw as Map);
                    if (itemMap['available'] == true) {
                      final qty = (itemMap['quantity'] as num?)?.toInt() ?? 1;
                      final unitPrice = (itemMap['unitPrice'] as num?)?.toDouble() ?? 0.0;
                      final menuItem = MenuItem(
                        id: itemMap['itemId'] as String,
                        name: itemMap['name'] as String,
                        price: unitPrice,
                        category: 'general',
                        type: (itemMap['type'] as String?) ?? 'cooked',
                        prepMinutes: 5,
                        stockCount: 50,
                      );
                      for (int k = 0; k < qty; k++) {
                        cart.addItem(menuItem, customization: itemMap['customization'] as String?);
                      }
                      addedCount += qty;
                    }
                  }

                  if (mounted) {
                    if (res['hasUnavailableItems'] == true) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('⚠️ Some items from previous order were unavailable or sold out and were omitted.'),
                          backgroundColor: AppColors.warning,
                        ),
                      );
                    } else if (res['hasPriceChanges'] == true) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('ℹ️ Item prices were updated to today’s live canteen rates.'),
                          backgroundColor: AppColors.info,
                        ),
                      );
                    }

                    if (addedCount > 0) {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const CartScreen()),
                      );
                    } else {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('None of the items from this meal are currently available in the canteen.'),
                          backgroundColor: AppColors.danger,
                        ),
                      );
                    }
                  }
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('Unable to reorder: ${e.toString().replaceAll('Exception:', '').trim()}'),
                        backgroundColor: AppColors.danger,
                      ),
                    );
                  }
                } finally {
                  if (mounted) setState(() => _isReordering = false);
                }
              },
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(
                  color: _isReordering ? Colors.grey : AppColors.red,
                  borderRadius: AppRadius.radiusMd,
                ),
                alignment: Alignment.center,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _isReordering
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Icon(Icons.replay_rounded, color: Colors.white, size: 18),
                    const SizedBox(width: 6),
                    Text(
                      _isReordering ? 'Revalidating Items...' : '🔁 Quick Reorder this meal',
                      style: AppFonts.body(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _formatTime(DateTime dt) {
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final m = dt.minute.toString().padLeft(2, '0');
    final ampm = dt.hour >= 12 ? 'PM' : 'AM';
    return '$h:$m $ampm';
  }
}

class _StepData {
  final String title;
  final String subtitle;

  _StepData({required this.title, required this.subtitle});
}
