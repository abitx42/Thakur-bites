import 'package:flutter/material.dart';
import '../models/order.dart' as app;
import '../theme/app_theme.dart';

/// Phase 5 — Perforated ticket confirmation screen.
/// Shows the token number, order items, total, ready time,
/// and a decorative QR placeholder — all matching the HTML prototype's
/// torn-paper receipt design.
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
    // Trigger the "printing" animation
    Future.delayed(const Duration(milliseconds: 100), () {
      _animController.forward();
    });
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final order = widget.order;

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
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
                        opacity: _fadeAnim.value,
                        child: child,
                      ),
                    );
                  },
                  child: _buildTicket(order),
                ),
              ),
            ),

            // Track order button
            Container(
              padding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
              child: SizedBox(
                width: double.infinity,
                child: GestureDetector(
                  onTap: () {
                    // Pop back to menu — Phase 6 will navigate to status screen
                    Navigator.of(context)
                        .popUntil((route) => route.isFirst);
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    decoration: BoxDecoration(
                      color: AppColors.ink,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      'Back to menu →',
                      style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
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

  Widget _buildTicket(app.Order order) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.line, width: 1.5),
        borderRadius: BorderRadius.circular(6), // receipt-style, not card-round
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
                  'Thakur Bites · Token',
                  style: AppFonts.mono(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w500,
                    color: AppColors.inkSoft,
                  ).copyWith(letterSpacing: 1.5),
                ),
                const SizedBox(height: 4),

                // Token number — big and red
                Text(
                  order.tokenNumber,
                  style: AppFonts.mono(
                    fontSize: 44,
                    fontWeight: FontWeight.w600,
                    color: AppColors.red,
                  ).copyWith(letterSpacing: 0.5),
                ),
                const SizedBox(height: 4),

                // Pin code
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.surface2,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    'PIN: ${order.pinCode}',
                    style: AppFonts.mono(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
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

                // QR placeholder
                Container(
                  width: 74,
                  height: 74,
                  decoration: BoxDecoration(
                    border: Border.all(color: AppColors.line, width: 1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Center(
                    child: Icon(Icons.qr_code_2_rounded,
                        size: 54, color: AppColors.ink.withOpacity(0.7)),
                  ),
                ),

                const SizedBox(height: 14),

                // Ready time
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
                decoration: BoxDecoration(
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
