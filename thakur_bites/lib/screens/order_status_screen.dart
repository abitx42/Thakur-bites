import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/order.dart' as app;
import '../models/menu_item.dart';
import '../providers/cart_provider.dart';
import '../services/firestore_service.dart';
import '../services/eta_service.dart';
import '../theme/app_theme.dart';
import 'cart_screen.dart';

/// Phase 8 — Advanced Real-time order status screen with dynamic ETA,
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
                      children: [
                        _buildTokenCard(order),
                        const SizedBox(height: 24),
                        _buildTracker(order),
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

  /// Token + ready time card at the top
  Widget _buildTokenCard(app.Order order) {
    final waitLabel = EtaService.getWaitTimeLabel(order.estimatedMinutes);

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
              Text('Your token',
                  style: AppFonts.body(fontSize: 11, color: AppColors.inkSoft)),
              const SizedBox(height: 2),
              Text(order.tokenNumber,
                  style: AppFonts.mono(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: AppColors.red)),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(waitLabel,
                  style: AppFonts.body(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.inkSoft)),
              const SizedBox(height: 2),
              Text(
                order.readyAt != null ? _formatTime(order.readyAt!) : 'Ready Now',
                style: AppFonts.mono(
                    fontSize: 14, fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// The 4-step vertical tracker
  Widget _buildTracker(app.Order order) {
    final currentIndex = order.statusIndex;

    final steps = [
      _StepData(
        title: 'Order confirmed',
        subtitle: 'Payment verified, token issued',
      ),
      _StepData(
        title: 'Preparing in Kitchen',
        subtitle: 'Your dishes are cooking at the station',
      ),
      _StepData(
        title: 'Ready for pickup',
        subtitle: 'Show PIN: ${order.pinCode} at pickup counter',
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
          final isDone = i < currentIndex;
          final isCurrent = i == currentIndex;
          final isUpcoming = i > currentIndex;

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
                        child: Icon(Icons.check_rounded,
                            size: 14, color: Colors.white),
                      )
                    : null,
              ),
              // Line (unless last)
              if (!isLast)
                Container(
                  width: 2,
                  height: 40,
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
                    fontWeight: FontWeight.w600,
                    color: isUpcoming ? AppColors.inkSoft : AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  step.subtitle,
                  style:
                      AppFonts.body(fontSize: 11.5, color: AppColors.inkSoft),
                ),
              ],
            ),
          ),
        ),
      ],
    );
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
