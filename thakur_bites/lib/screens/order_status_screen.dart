import 'package:flutter/material.dart';
import '../models/order.dart' as app;
import '../services/firestore_service.dart';
import '../theme/app_theme.dart';

/// Phase 6 — Real-time order status screen.
/// Subscribes to a single order document and shows a live stepper:
/// Placed → Preparing → Ready → Collected
class OrderStatusScreen extends StatelessWidget {
  final String orderId;

  const OrderStatusScreen({super.key, required this.orderId});

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
                stream: firestore.orderStream(orderId),
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(
                      child: CircularProgressIndicator(color: AppColors.red),
                    );
                  }

                  final order = snapshot.data;
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
                        const SizedBox(height: 26),
                        _buildTracker(order),
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
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: BorderRadius.circular(14),
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
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: AppColors.red)),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('Ready by',
                  style: AppFonts.body(fontSize: 11, color: AppColors.inkSoft)),
              const SizedBox(height: 2),
              Text(
                order.readyAt != null ? _formatTime(order.readyAt!) : '--:--',
                style: AppFonts.mono(
                    fontSize: 14, fontWeight: FontWeight.w600),
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
        title: 'Order placed',
        subtitle: 'Payment confirmed, token issued',
      ),
      _StepData(
        title: 'Preparing',
        subtitle: 'Your order is on the station',
      ),
      _StepData(
        title: 'Ready for pickup',
        subtitle: 'Show your token at the counter',
      ),
      _StepData(
        title: 'Collected',
        subtitle: 'Enjoy!',
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
