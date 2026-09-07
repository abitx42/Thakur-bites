import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/order.dart' as app;
import '../models/menu_item.dart';
import '../providers/cart_provider.dart';
import '../services/firestore_service.dart';
import '../services/functions_service.dart';
import '../services/eta_service.dart';
import '../theme/app_theme.dart';
import 'cart_screen.dart';

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
  Timer? _countdownTimer;

  bool _isCancelling = false;
  bool _isReconciling = false;

  int _selectedStars = 5;
  final Set<String> _selectedFeedbackTags = {'🔥 Crispy & Fresh', '⚡️ Fast Service'};
  bool _feedbackSubmitted = false;

  final List<String> _feedbackOptions = [
    '🔥 Crispy & Fresh',
    '⚡️ Fast Service',
    '😋 Super Tasty',
    '📦 Perfect Packaging',
  ];

  @override
  void initState() {
    super.initState();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final firestore = FirestoreService();

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
                stream: firestore.orderStream(widget.orderId),
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
        color: const Color(0xFFF0FDF4),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF86EFAC), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(
                  color: Color(0xFFDCFCE7),
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
                            color: const Color(0xFF16A34A),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            'EXPRESS',
                            style: AppFonts.mono(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.white),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Direct counter pickup · No kitchen wait',
                      style: AppFonts.body(fontSize: 11.5, color: const Color(0xFF166534)),
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
                color: const Color(0xFFDCFCE7),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle_rounded, size: 14, color: Color(0xFF15803D)),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Preference: ${order.readyMadePreference}',
                      style: AppFonts.mono(fontSize: 11, fontWeight: FontWeight.w700, color: const Color(0xFF15803D)),
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
                ? '⚡ Express Counter'
                : EtaService.getWaitTimeLabel(order.estimatedMinutes);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line, width: 1),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Your token',
                style: AppFonts.body(fontSize: 11, color: AppColors.inkSoft),
              ),
              const SizedBox(height: 2),
              Text(
                order.tokenNumber.isEmpty ? '—' : order.tokenNumber,
                style: AppFonts.mono(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: order.isCancelled ? AppColors.inkSoft : AppColors.red,
                ),
              ),
            ],
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
                          ? const Color(0xFFD97706)
                          : order.isOnlyReadyMade
                              ? const Color(0xFF16A34A)
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
                      ? const Color(0xFF16A34A)
                      : AppColors.ink,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// Cancelled status card
  Widget _buildCancelledCard(app.Order order) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFCA5A5), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.cancel_rounded, color: Color(0xFFDC2626), size: 22),
              const SizedBox(width: 8),
              Text(
                'Order Cancelled',
                style: AppFonts.display(fontSize: 16, color: const Color(0xFF991B1B)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            order.cancellationReason ?? 'Cancelled before kitchen preparation began.',
            style: AppFonts.body(fontSize: 13, color: const Color(0xFF7F1D1D)),
          ),
          if (order.isOnlinePayment && order.paymentStatus != 'pending') ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFFECACA)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.currency_rupee_rounded, size: 14, color: Color(0xFFB91C1C)),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Refund initiated: Funds will return to original payment method.',
                      style: AppFonts.body(fontSize: 11.5, color: const Color(0xFF991B1B)),
                    ),
                  ),
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
                side: const BorderSide(color: Color(0xFFDC2626)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              child: Text(
                'Return to Menu',
                style: AppFonts.body(fontSize: 13, fontWeight: FontWeight.w600, color: const Color(0xFFDC2626)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Reservation Countdown & Reconcile Card
  Widget _buildReservationCard(app.Order order) {
    final now = DateTime.now();
    final expiresAt = order.reservationExpiresAt ?? order.createdAt.add(const Duration(minutes: 15));
    final diff = expiresAt.difference(now);
    final isExpired = diff.isNegative;
    final totalSeconds = isExpired ? 0 : diff.inSeconds;
    final mins = (totalSeconds ~/ 60).toString().padLeft(2, '0');
    final secs = (totalSeconds % 60).toString().padLeft(2, '0');

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBEB),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFFCD34D), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(Icons.timer_outlined, color: Color(0xFFD97706), size: 20),
                  const SizedBox(width: 8),
                  Text(
                    isExpired ? 'Reservation Expired' : 'Holding Items for Payment',
                    style: AppFonts.display(fontSize: 15, color: const Color(0xFF92400E)),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: isExpired ? const Color(0xFFFEE2E2) : const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(
                    color: isExpired ? const Color(0xFFFCA5A5) : const Color(0xFFF59E0B),
                  ),
                ),
                child: Text(
                  isExpired ? '00:00' : '$mins:$secs',
                  style: AppFonts.mono(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: isExpired ? const Color(0xFFDC2626) : const Color(0xFFB45309),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            isExpired
                ? 'Your inventory reservation window has expired. If you were charged, verify below.'
                : 'Stock is reserved for you. Complete payment before the timer expires to confirm your order.',
            style: AppFonts.body(fontSize: 12, color: const Color(0xFF78350F)),
          ),
          const SizedBox(height: 14),

          // Action Buttons: Reconcile Payment + Cancel Order
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
                    backgroundColor: const Color(0xFFD97706),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: OutlinedButton(
                  onPressed: _isCancelling ? null : () => _showCancelDialog(order),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFFDC2626)),
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  child: Text(
                    'Cancel',
                    style: AppFonts.body(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: const Color(0xFFDC2626),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// Ready Pickup PIN Display Card
  Widget _buildPickupPinCard(app.Order order) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FDF4),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF4ADE80), width: 2),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 20),
              const SizedBox(width: 8),
              Text(
                'Ready for Pickup!',
                style: AppFonts.display(fontSize: 17, color: const Color(0xFF15803D)),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            order.isOnlyReadyMade
                ? 'Collect at Express Counter'
                : 'Collect at Main Canteen Counter',
            style: AppFonts.body(fontSize: 12.5, color: const Color(0xFF166534)),
          ),
          const SizedBox(height: 14),

          // PIN Container
          GestureDetector(
            onTap: () {
              if (order.pinCode.isNotEmpty) {
                Clipboard.setData(ClipboardData(text: order.pinCode));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('PIN copied to clipboard'),
                    duration: Duration(seconds: 1),
                  ),
                );
              }
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF86EFAC), width: 1.5),
              ),
              child: Column(
                children: [
                  Text(
                    'PICKUP PIN',
                    style: AppFonts.mono(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF15803D),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    order.pinCode.isEmpty ? '••••' : order.pinCode,
                    style: AppFonts.mono(
                      fontSize: 34,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 8,
                      color: const Color(0xFF166534),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Show this 4-digit PIN to the canteen staff at handover',
            style: AppFonts.body(fontSize: 11, color: const Color(0xFF166534)),
          ),
        ],
      ),
    );
  }

  /// 5-Step vertical order tracker
  Widget _buildTracker(app.Order order) {
    final currentIndex = order.customerStatusIndex;

    final steps = [
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
        title: order.isOnlyReadyMade ? '⚡ Express Packaging' : 'Preparing in kitchen',
        subtitle: order.isOnlyReadyMade
            ? 'Items packaged at counter — zero kitchen cooking wait!'
            : 'Your meal is cooking at the preparation station',
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

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        children: List.generate(steps.length, (i) {
          final isDone = !order.isCancelled && i < currentIndex;
          final isCurrent = !order.isCancelled && i == currentIndex;
          final isUpcoming = order.isCancelled || i > currentIndex;

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
    return Row(
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
                child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFDC2626)),
              )
            : const Icon(Icons.cancel_outlined, size: 16, color: Color(0xFFDC2626)),
        label: Text(
          _isCancelling ? 'Cancelling...' : 'Cancel order',
          style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: const Color(0xFFDC2626),
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
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            title: Row(
              children: [
                const Icon(Icons.warning_amber_rounded, color: Color(0xFFDC2626), size: 24),
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
                    'Are you sure you want to cancel token #${order.tokenNumber}? Once kitchen starts preparing food, cancellation is locked.',
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
                          color: isSelected ? const Color(0xFFFEE2E2) : AppColors.surface2,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: isSelected ? const Color(0xFFEF4444) : AppColors.line,
                          ),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              isSelected ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                              size: 16,
                              color: isSelected ? const Color(0xFFDC2626) : AppColors.inkSoft,
                            ),
                            const SizedBox(width: 8),
                            Text(
                              reason,
                              style: AppFonts.body(
                                fontSize: 12.5,
                                fontWeight: isSelected ? FontWeight.w700 : FontWeight.normal,
                                color: isSelected ? const Color(0xFF991B1B) : AppColors.ink,
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
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
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
                  backgroundColor: const Color(0xFFDC2626),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
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
    setState(() => _isCancelling = true);
    try {
      final res = await _functions.cancelOrder(orderId: order.id, reason: reason);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(res['message'] ?? 'Order cancelled successfully.'),
            backgroundColor: const Color(0xFF16A34A),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Cannot cancel: ${e.toString().replaceAll('Exception:', '').trim()}'),
            backgroundColor: const Color(0xFFDC2626),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isCancelling = false);
    }
  }

  Future<void> _handleReconcilePayment(app.Order order) async {
    setState(() => _isReconciling = true);
    try {
      final res = await _functions.reconcileOrderPayment(orderId: order.id);
      final reconciled = res['reconciled'] == true;
      final status = res['status'] as String?;

      if (mounted) {
        if (reconciled) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('✅ Payment verified authoritatively! Order confirmed.'),
              backgroundColor: Color(0xFF16A34A),
            ),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Status: $status. If you paid, it will reconcile automatically.'),
              backgroundColor: const Color(0xFFD97706),
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Reconciliation check: ${e.toString().replaceAll('Exception:', '').trim()}'),
            backgroundColor: const Color(0xFFDC2626),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isReconciling = false);
    }
  }

  /// Post-Pickup Card: Star Ratings, Feedback Tags & 1-Tap Quick Reorder
  Widget _buildPostPickupCard(app.Order order) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FDF7),
        border: Border.all(color: const Color(0xFF86EFAC), width: 1.5),
        borderRadius: BorderRadius.circular(14),
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
                onTap: () {
                  setState(() {
                    _selectedStars = star;
                    _feedbackSubmitted = true;
                  });
                },
                child: Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: Icon(
                    filled ? Icons.star_rounded : Icons.star_border_rounded,
                    color: const Color(0xFFEAB308),
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
                onTap: () {
                  setState(() {
                    if (isSelected) {
                      _selectedFeedbackTags.remove(tag);
                    } else {
                      _selectedFeedbackTags.add(tag);
                    }
                    _feedbackSubmitted = true;
                  });
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: isSelected ? const Color(0xFFDCFCE7) : Colors.white,
                    border: Border.all(
                      color: isSelected ? const Color(0xFF22C55E) : AppColors.line,
                      width: 1,
                    ),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    tag,
                    style: AppFonts.mono(
                      fontSize: 11,
                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                      color: isSelected ? const Color(0xFF15803D) : AppColors.ink,
                    ),
                  ),
                ),
              );
            }).toList(),
          ),

          const SizedBox(height: 16),
          const Divider(height: 1, color: Color(0xFF86EFAC)),
          const SizedBox(height: 14),

          // 🔁 1-Tap Quick Reorder Button
          SizedBox(
            width: double.infinity,
            child: GestureDetector(
              onTap: () {
                final cart = Provider.of<CartProvider>(context, listen: false);
                for (final item in order.items) {
                  cart.addItem(
                    MenuItem(
                      id: item.menuItemId,
                      name: item.name,
                      price: item.price,
                      category: 'snacks',
                      type: 'cooked',
                      prepMinutes: 5,
                      stockCount: 50,
                    ),
                  );
                }

                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const CartScreen()),
                );
              },
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(
                  color: AppColors.red,
                  borderRadius: BorderRadius.circular(10),
                ),
                alignment: Alignment.center,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.replay_rounded, color: Colors.white, size: 18),
                    const SizedBox(width: 6),
                    Text(
                      '🔁 Quick Reorder this meal',
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
