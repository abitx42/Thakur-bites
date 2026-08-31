import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart' hide Order;
import '../models/order.dart' as app;
import '../theme/app_theme.dart';
import 'order_status_screen.dart';

/// Phase 4 — Perforated ticket confirmation screen with live Firestore status sync.
/// Shows the daily token number (TB-001), 4-digit pickup PIN, order items, total,
/// dynamic status badge, and verified QR payload.
class TicketScreen extends StatefulWidget {
  final app.Order order;

  const TicketScreen({super.key, required this.order});

  @override
  State<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends State<TicketScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _slideAnim;
  late Animation<double> _fadeAnim;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      duration: const Duration(milliseconds: 600),
      vsync: this,
    );
    _slideAnim = Tween<double>(begin: -22, end: 0).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeOutBack),
    );
    _fadeAnim = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeOut),
    );
    Future.delayed(const Duration(milliseconds: 100), () {
      if (mounted) _animController.forward();
    });
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          stream: FirebaseFirestore.instance
              .collection('orders')
              .doc(widget.order.id)
              .snapshots(),
          builder: (context, snapshot) {
            app.Order currentOrder = widget.order;
            if (snapshot.hasData && snapshot.data != null && snapshot.data!.exists) {
              try {
                currentOrder = app.Order.fromFirestore(
                  snapshot.data!.id,
                  snapshot.data!.data()!,
                );
              } catch (_) {}
            }

            return Column(
              children: [
                // Header
                Container(
                  padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
                  decoration: const BoxDecoration(
                    border: Border(
                        bottom: BorderSide(color: AppColors.line, width: 1)),
                    color: AppColors.surface,
                  ),
                  child: Row(
                    children: [
                      GestureDetector(
                        onTap: () => Navigator.of(context)
                            .popUntil((route) => route.isFirst),
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
                      Text('Order confirmed',
                          style: AppFonts.display(fontSize: 20)),
                    ],
                  ),
                ),

                // Ticket body
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(18),
                    child: AnimatedBuilder(
                      animation: _animController,
                      builder: (context, child) {
                        return Transform.translate(
                          offset: Offset(0, _slideAnim.value),
                          child: Opacity(
                            opacity: _fadeAnim.value.clamp(0.0, 1.0),
                            child: _buildTicket(currentOrder),
                          ),
                        );
                      },
                    ),
                  ),
                ),

                // Bottom action buttons
                Container(
                  padding: const EdgeInsets.fromLTRB(18, 12, 18, 18),
                  decoration: const BoxDecoration(
                    border: Border(
                        top: BorderSide(color: AppColors.line, width: 1)),
                    color: AppColors.surface,
                  ),
                  child: Column(
                    children: [
                      // View Status button
                      SizedBox(
                        width: double.infinity,
                        child: GestureDetector(
                          onTap: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) =>
                                    OrderStatusScreen(order: currentOrder),
                              ),
                            );
                          },
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            decoration: BoxDecoration(
                              color: AppColors.red,
                              borderRadius: BorderRadius.circular(14),
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              'Track live preparation →',
                              style: AppFonts.body(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w700,
                                color: Colors.white,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),

                      // Back to menu button
                      SizedBox(
                        width: double.infinity,
                        child: GestureDetector(
                          onTap: () {
                            Navigator.of(context)
                                .popUntil((route) => route.isFirst);
                          },
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            decoration: BoxDecoration(
                              color: Colors.transparent,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: AppColors.line, width: 1.5),
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              'Back to menu',
                              style: AppFonts.body(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w600,
                                color: AppColors.ink,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildTicket(app.Order order) {
    final statusColor = order.isReady
        ? const Color(0xFF16A34A)
        : order.isPreparing
            ? const Color(0xFFD97706)
            : order.isCollected
                ? const Color(0xFF6B7280)
                : AppColors.red;

    final statusText = order.isReady
        ? 'READY FOR PICKUP 🟢'
        : order.isPreparing
            ? 'PREPARING IN KITCHEN 🟡'
            : order.isCollected
                ? 'COLLECTED AT COUNTER ⚪️'
                : 'ORDER CONFIRMED 🔴';

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.line, width: 1.5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        children: [
          // Perforation top
          _buildPerforation(),

          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
            child: Column(
              children: [
                // Header
                Text(
                  'Thakur Bites · Canteen Token',
                  style: AppFonts.mono(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w500,
                    color: AppColors.inkSoft,
                  ).copyWith(letterSpacing: 1.5),
                ),
                const SizedBox(height: 6),

                // Live status badge
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withAlpha(25),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: statusColor.withAlpha(60), width: 1),
                  ),
                  child: Text(
                    statusText,
                    style: AppFonts.mono(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: statusColor,
                    ),
                  ),
                ),
                const SizedBox(height: 8),

                // Token number
                Text(
                  order.tokenNumber,
                  style: AppFonts.mono(
                    fontSize: 44,
                    fontWeight: FontWeight.w700,
                    color: AppColors.red,
                  ).copyWith(letterSpacing: 0.5),
                ),
                const SizedBox(height: 4),

                // Pin code
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
                  decoration: BoxDecoration(
                    color: AppColors.surface2,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: AppColors.line, width: 1),
                  ),
                  child: Text(
                    'PICKUP PIN: ${order.pinCode}',
                    style: AppFonts.mono(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                ),

                const SizedBox(height: 14),

                // Dashed divider
                _buildDashedDivider(),

                const SizedBox(height: 14),

                // Order items
                ...order.items.map((item) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            '${item.quantity}x ${item.name}',
                            style: AppFonts.mono(fontSize: 12.5),
                          ),
                          Text(
                            '₹${item.subtotal.toInt()}',
                            style: AppFonts.mono(fontSize: 12.5),
                          ),
                        ],
                      ),
                    )),

                const SizedBox(height: 8),

                // Total row
                Container(
                  padding: const EdgeInsets.only(top: 8),
                  decoration: const BoxDecoration(
                    border:
                        Border(top: BorderSide(color: AppColors.line, width: 1)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Total',
                          style: AppFonts.mono(
                              fontSize: 13.5, fontWeight: FontWeight.w600)),
                      Text('₹${order.totalAmount.toInt()}',
                          style: AppFonts.mono(
                              fontSize: 13.5, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),

                const SizedBox(height: 14),

                // Dashed divider
                _buildDashedDivider(),

                const SizedBox(height: 14),

                // Verified QR Code Container
                Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: AppColors.line, width: 1.5),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Center(
                    child: Icon(Icons.qr_code_2_rounded,
                        size: 64, color: AppColors.ink),
                  ),
                ),

                const SizedBox(height: 12),

                // Ready time & timestamp
                Text(
                  order.estimatedMinutes > 0
                      ? 'Ready in ~${order.estimatedMinutes} min'
                      : 'Ready now',
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Ordered at ${_formatTime(order.createdAt)}',
                  style: AppFonts.body(fontSize: 11, color: AppColors.inkSoft),
                ),
              ],
            ),
          ),

          // Perforation bottom
          _buildPerforation(),
        ],
      ),
    );
  }

  /// Perforated edge — row of semicircles
  Widget _buildPerforation() {
    return SizedBox(
      height: 12,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final count = (constraints.maxWidth / 16).floor();
          return Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: List.generate(count, (i) {
              return Container(
                width: 10,
                height: 10,
                decoration: const BoxDecoration(
                  color: AppColors.bg,
                  shape: BoxShape.circle,
                ),
              );
            }),
          );
        },
      ),
    );
  }

  /// Dashed divider line
  Widget _buildDashedDivider() {
    return LayoutBuilder(
      builder: (context, constraints) {
        final dashCount = (constraints.maxWidth / 8).floor();
        return Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: List.generate(dashCount, (i) {
            return Container(
              width: 4,
              height: 2,
              color: AppColors.line,
            );
          }),
        );
      },
    );
  }

  String _formatTime(DateTime dt) {
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final m = dt.minute.toString().padLeft(2, '0');
    final ampm = dt.hour >= 12 ? 'PM' : 'AM';
    return '$h:$m $ampm';
  }
}
