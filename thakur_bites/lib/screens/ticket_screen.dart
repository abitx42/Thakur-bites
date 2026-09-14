import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart' hide Order;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
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
  String? _cachedPin;
  late final Stream<DocumentSnapshot<Map<String, dynamic>>> _orderSnapshotStream;

  @override
  void initState() {
    super.initState();
    _orderSnapshotStream = FirebaseFirestore.instance
        .collection('orders')
        .doc(widget.order.id)
        .snapshots();
    _cachedPin = widget.order.pinCode;
    if (_cachedPin == null || _cachedPin!.isEmpty) {
      SharedPreferences.getInstance().then((prefs) {
        final p = prefs.getString('order_pin_${widget.order.id}');
        if (p != null && p.isNotEmpty && mounted) {
          setState(() {
            _cachedPin = p;
          });
        }
      }).catchError((_) {});
    } else {
      SharedPreferences.getInstance().then((prefs) {
        prefs.setString('order_pin_${widget.order.id}', _cachedPin!);
      }).catchError((_) {});
    }
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
          stream: _orderSnapshotStream,
          builder: (context, snapshot) {
            app.Order currentOrder = widget.order;
            final effectivePin = widget.order.pinCode.isNotEmpty
                ? widget.order.pinCode
                : (_cachedPin ?? '');
            if (snapshot.hasData && snapshot.data != null && snapshot.data!.exists) {
              try {
                final fromDb = app.Order.fromFirestore(
                  snapshot.data!.id,
                  snapshot.data!.data()!,
                );
                final resolvedPin = fromDb.pinCode.isNotEmpty
                    ? fromDb.pinCode
                    : effectivePin;
                currentOrder = fromDb.copyWith(pinCode: resolvedPin);
              } catch (_) {}
            } else {
              currentOrder = widget.order.copyWith(pinCode: effectivePin);
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
    final resolvedPin = order.pinCode.isNotEmpty ? order.pinCode : (_cachedPin ?? '');

    final statusColor = order.isReady
        ? AppColors.green
        : order.isPreparing
            ? AppColors.warning
            : order.isCollected
                ? AppColors.inkSoft
                : order.isPaymentPending
                    ? AppColors.warning
                    : AppColors.danger;

    final statusText = order.isReady
        ? 'READY FOR PICKUP 🟢'
        : order.isPreparing
            ? 'PREPARING IN KITCHEN 🟡'
            : order.isCollected
                ? 'COLLECTED AT COUNTER ⚪️'
                : order.isPaymentPending
                    ? 'PAY AT CASHIER DESK 🟠'
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
                if (order.isReady || order.isOnlyReadyMade || order.status == 'ready' || order.status == 'collected') ...[
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppColors.surface2,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: AppColors.line, width: 1),
                    ),
                    child: Text(
                      'PICKUP PIN: ${resolvedPin.isEmpty ? "••••" : resolvedPin}',
                      style: AppFonts.mono(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                ] else ...[
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    decoration: BoxDecoration(
                      color: AppColors.warningBg,
                      borderRadius: AppRadius.radiusPill,
                      border: Border.all(color: AppColors.warning.withAlpha(100), width: 1),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text('🍳', style: TextStyle(fontSize: 12)),
                        const SizedBox(width: 6),
                        Text(
                          'PREPARING · PIN REVEALS WHEN READY',
                          style: AppFonts.mono(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.mustardInk,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],

                if (order.isOnlyReadyMade) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.successBg,
                      borderRadius: AppRadius.radiusMd,
                      border: Border.all(color: AppColors.green.withAlpha(100), width: 1.2),
                    ),
                    child: Column(
                      children: [
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Text('⚡', style: TextStyle(fontSize: 14)),
                            const SizedBox(width: 6),
                            Text(
                              'READY-MADE ORDER',
                              style: AppFonts.mono(
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                color: AppColors.greenInk,
                              ),
                            ),
                          ],
                        ),
                        if (order.readyMadePreference != null && order.readyMadePreference!.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Preference: ${order.readyMadePreference}',
                            style: AppFonts.body(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.greenInk,
                            ),
                          ),
                        ],
                        const SizedBox(height: 2),
                        Text(
                          'Directly head to counter to collect (0 min wait)',
                          style: AppFonts.body(
                            fontSize: 10.5,
                            color: AppColors.greenInk,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],

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

                // Verified Scannable QR Code Container
                if (order.isReady || order.isOnlyReadyMade || order.status == 'ready' || order.status == 'collected') ...[
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      border: Border.all(color: AppColors.line, width: 1.5),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: QrImageView(
                      data: 'TB:${order.id}:${order.tokenNumber}:$resolvedPin',
                      version: QrVersions.auto,
                      size: 96,
                      backgroundColor: Colors.white,
                      eyeStyle: const QrEyeStyle(
                        eyeShape: QrEyeShape.square,
                        color: AppColors.ink,
                      ),
                      dataModuleStyle: const QrDataModuleStyle(
                        dataModuleShape: QrDataModuleShape.square,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                ] else ...[
                  Container(
                    width: 96,
                    height: 96,
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: AppColors.surface2,
                      border: Border.all(color: AppColors.line, width: 1.5),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.lock_clock_rounded, color: AppColors.inkSoft, size: 32),
                        const SizedBox(height: 4),
                        Text(
                          'QR Locked',
                          textAlign: TextAlign.center,
                          style: AppFonts.mono(fontSize: 9.5, fontWeight: FontWeight.w700, color: AppColors.inkSoft),
                        ),
                      ],
                    ),
                  ),
                ],

                const SizedBox(height: 12),

                // Ready time & timestamp
                Text(
                  order.isOnlyReadyMade
                      ? '⚡ Ready for pickup — Head directly to counter'
                      : (order.estimatedMinutes > 0
                          ? 'Ready in ~${order.estimatedMinutes} min'
                          : 'Ready now'),
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: order.isOnlyReadyMade ? AppColors.green : AppColors.ink,
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
