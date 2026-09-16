import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:cloud_firestore/cloud_firestore.dart' hide Order;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/order.dart' as app;
import '../theme/app_theme.dart';
import '../widgets/receipt_print_reveal.dart';
import '../widgets/live_security_qr_badge.dart';
import '../services/clipboard_security_service.dart';
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

class _TicketScreenState extends State<TicketScreen> {
  String? _cachedPin;
  bool _copiedToken = false;
  bool _copiedPin = false;
  bool _hasPlayedIntro = false;
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
  }

  @override
  void dispose() {
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

                // Ticket body with Thermal Printer Print-Reveal
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(18, 12, 18, 28),
                    child: ReceiptPrintReveal(
                      playIntro: !_hasPlayedIntro,
                      onCompleted: () {
                        if (mounted) {
                          setState(() {
                            _hasPlayedIntro = true;
                          });
                        }
                      },
                      receipt: _buildTicket(currentOrder),
                      actions: _buildActionButtons(currentOrder),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildActionButtons(app.Order currentOrder) {
    return Column(
      children: [
        // Lightweight chef cooking GIF banner
        _buildChefGifBanner(),
        const SizedBox(height: 16),

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
        const SizedBox(height: 10),

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
    );
  }

  /// Upgraded Masterchef Kitchen Porthole Experience:
  /// - ShaderMask radial vignette removes the harsh solid yellow background
  /// - ColorFiltered warm-shifts tones to match the Thakur Bites chai/cream palette
  /// - Kitchen porthole window with double-ring brass/sandstone trim and stove glow
  /// - Energetic "LIVE 🔴" status pill badge
  /// - Rubber kitchen stamp styled text box with subtle rotation
  /// - Decorative kitchen dividers with fork-knife glyphs
  Widget _buildChefGifBanner() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Top kitchen divider
        _buildKitchenDivider(),
        const SizedBox(height: 12),

        // Main warm ivory card
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 16),
          decoration: BoxDecoration(
            color: const Color(0xFFFFFDF8),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: const Color(0xFFEADBCE),
              width: 1.2,
            ),
            boxShadow: const [
              BoxShadow(
                color: Color(0x103B281C),
                blurRadius: 16,
                offset: Offset(0, 6),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Kitchen Porthole Window with Stove Heat Aura and LIVE Badge
              SizedBox(
                width: 110,
                height: 110,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    // Ambient stove warmth backlight glow
                    Container(
                      width: 96,
                      height: 96,
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Color(0x40D97706),
                            blurRadius: 22,
                            spreadRadius: 4,
                          ),
                        ],
                      ),
                    ),

                    // Double-ring Porthole Frame
                    Container(
                      width: 104,
                      height: 104,
                      padding: const EdgeInsets.all(3.5),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            Color(0xFFEADBCE),
                            Color(0xFFD4B896),
                            Color(0xFFB8966E),
                          ],
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x22000000),
                            blurRadius: 10,
                            offset: Offset(0, 4),
                          ),
                        ],
                      ),
                      child: Container(
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: const Color(0xFFFAF6ED),
                          border: Border.all(
                            color: const Color(0xFF78350F).withAlpha(40),
                            width: 1,
                          ),
                        ),
                        child: ClipOval(
                          // ShaderMask radial gradient: dissolves the solid yellow background into transparency
                          child: ShaderMask(
                            shaderCallback: (Rect bounds) {
                              return const RadialGradient(
                                center: Alignment(0.0, -0.05),
                                radius: 0.52,
                                colors: [
                                  Colors.white,
                                  Colors.white,
                                  Color(0xCCFFFFFF),
                                  Color(0x44FFFFFF),
                                  Colors.transparent,
                                ],
                                stops: [0.0, 0.40, 0.65, 0.88, 1.0],
                              ).createShader(bounds);
                            },
                            blendMode: BlendMode.dstIn,
                            // ColorFiltered: warm-shifts palette toward chai/sandstone tones
                            child: ColorFiltered(
                              colorFilter: ColorFilter.mode(
                                const Color(0xFFFAF6ED).withAlpha(40),
                                BlendMode.softLight,
                              ),
                              child: Transform.scale(
                                scale: 1.15,
                                child: Image.asset(
                                  'assets/animations/chef_cooking.gif',
                                  width: 96,
                                  height: 96,
                                  fit: BoxFit.cover,
                                  alignment: const Alignment(0.05, 0.0),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),

                    // "LIVE 🔴" Pill Badge anchored at top-right of the porthole
                    Positioned(
                      top: 2,
                      right: 2,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1E293B),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: Colors.white.withAlpha(80),
                            width: 1,
                          ),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x35000000),
                              blurRadius: 5,
                              offset: Offset(0, 2),
                            ),
                          ],
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 5,
                              height: 5,
                              decoration: const BoxDecoration(
                                shape: BoxShape.circle,
                                color: Color(0xFFEF4444),
                                boxShadow: [
                                  BoxShadow(
                                    color: Color(0xAAEF4444),
                                    blurRadius: 4,
                                    spreadRadius: 1,
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 4),
                            Text(
                              'LIVE',
                              style: AppFonts.mono(
                                fontSize: 8,
                                fontWeight: FontWeight.w800,
                                color: Colors.white,
                                letterSpacing: 0.6,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 16),

              // Rubber Kitchen Stamp Styled Announcement Box (subtly angled)
              Transform.rotate(
                angle: -0.026, // ~-1.5 degrees rubber stamp tilt
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFBF6EE),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: AppColors.chai.withAlpha(90),
                      width: 1.2,
                    ),
                  ),
                  child: Text(
                    'YOUR ORDER IS BEING COOKED\nBY OUR MASTERCHEFS! 👨‍🍳',
                    textAlign: TextAlign.center,
                    style: AppFonts.display(
                      fontSize: 14.5,
                      color: AppColors.chai,
                      letterSpacing: 0.8,
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 8),

              // Sub-text with emoji separator
              Text(
                'Freshly prepared • Made with love 🍛',
                style: AppFonts.body(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w500,
                  color: AppColors.inkSoft,
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 12),
        // Bottom kitchen divider
        _buildKitchenDivider(),
      ],
    );
  }

  /// Decorative kitchen divider with centered fork & knife glyph
  Widget _buildKitchenDivider() {
    return Row(
      children: [
        Expanded(
          child: Container(
            height: 1,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  Colors.transparent,
                  AppColors.line.withAlpha(180),
                ],
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Text(
            '🍴',
            style: TextStyle(
              fontSize: 12,
              color: AppColors.inkSoft.withAlpha(150),
            ),
          ),
        ),
        Expanded(
          child: Container(
            height: 1,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppColors.line.withAlpha(180),
                  Colors.transparent,
                ],
              ),
            ),
          ),
        ),
      ],
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
        color: const Color(0xFFFAF6ED),
        border: Border.all(color: const Color(0xFFE4DCD0), width: 1.5),
        borderRadius: BorderRadius.circular(6),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1A3B281C),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 4,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Stack(
        children: [
          // 203-DPI Thermal Head Micro-Scanlines Overlay
          const Positioned.fill(
            child: CustomPaint(
              painter: ThermalPaperScanlinesPainter(),
            ),
          ),

          // Tractor-feed pinhole margins (continuous authentic sprocket punch holes)
          const Positioned(
            left: 0,
            top: 8,
            bottom: 16,
            width: 18,
            child: CustomPaint(
              painter: TractorFeedPinholesPainter(isLeft: true),
            ),
          ),
          const Positioned(
            right: 0,
            top: 8,
            bottom: 16,
            width: 18,
            child: CustomPaint(
              painter: TractorFeedPinholesPainter(isLeft: false),
            ),
          ),

          Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(26, 18, 26, 20),
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

                // Token number with copy micro-interaction
                GestureDetector(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    Clipboard.setData(ClipboardData(text: order.tokenNumber));
                    setState(() => _copiedToken = true);
                    Future.delayed(const Duration(milliseconds: 1500), () {
                      if (mounted) setState(() => _copiedToken = false);
                    });
                  },
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        order.tokenNumber,
                        style: AppFonts.mono(
                          fontSize: 44,
                          fontWeight: FontWeight.w700,
                          color: AppColors.red,
                        ).copyWith(letterSpacing: 0.5),
                      ),
                      const SizedBox(width: 8),
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 200),
                        child: _copiedToken
                            ? const Icon(Icons.check_circle_rounded,
                                key: ValueKey('token_copied'),
                                size: 22,
                                color: AppColors.green)
                            : Icon(Icons.copy_rounded,
                                key: const ValueKey('token_copy'),
                                size: 18,
                                color: AppColors.inkSoft.withAlpha(120)),
                      ),
                    ],
                  ),
                ),
                if (order.isFacultyPriority) ...[
                  const SizedBox(height: 6),
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
                        const SizedBox(width: 4),
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
                const SizedBox(height: 6),

                // Pin code
                if (order.isReady || order.isOnlyReadyMade || order.status == 'ready' || order.status == 'collected') ...[
                  GestureDetector(
                    onTap: () {
                      if (resolvedPin.isNotEmpty) {
                        HapticFeedback.lightImpact();
                        ClipboardSecurityService.copySensitiveText(resolvedPin);
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
                      padding:
                          const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
                      decoration: BoxDecoration(
                        color: AppColors.surface2,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: AppColors.line, width: 1),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'PICKUP PIN: ${resolvedPin.isEmpty ? "••••" : resolvedPin}',
                            style: AppFonts.mono(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink,
                            ),
                          ),
                          if (resolvedPin.isNotEmpty) ...[
                            const SizedBox(width: 6),
                            AnimatedSwitcher(
                              duration: const Duration(milliseconds: 200),
                              child: _copiedPin
                                  ? const Icon(Icons.check_circle_rounded,
                                      key: ValueKey('pin_copied'),
                                      size: 16,
                                      color: AppColors.green)
                                  : Icon(Icons.copy_rounded,
                                      key: const ValueKey('pin_copy'),
                                      size: 14,
                                      color: AppColors.inkSoft.withAlpha(120)),
                            ),
                          ],
                        ],
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

                // Verified Scannable QR Code Container with Live Pulsing Security Watermark
                LiveSecurityQrBadge(
                  qrData: 'TB:${order.id}:${order.tokenNumber}:$resolvedPin',
                  isReady: order.isReady || order.isOnlyReadyMade || order.status == 'ready' || order.status == 'collected',
                  size: 96,
                  tokenNumber: order.tokenNumber,
                ),

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
                  'Ordered on ${_formatDateTime(order.createdAt)}',
                  style: AppFonts.body(fontSize: 11, color: AppColors.inkSoft),
                ),
              ],
            ),
          ),

          // Perforation bottom
          _buildPerforation(),
        ],
      ),
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

  String _formatDateTime(DateTime dt) {
    final now = DateTime.now();
    final isToday =
        dt.year == now.year && dt.month == now.month && dt.day == now.day;
    final yesterday = now.subtract(const Duration(days: 1));
    final isYesterday = dt.year == yesterday.year &&
        dt.month == yesterday.month &&
        dt.day == yesterday.day;

    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    final monthName = months[dt.month - 1];

    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final m = dt.minute.toString().padLeft(2, '0');
    final ampm = dt.hour >= 12 ? 'PM' : 'AM';
    final timeStr = '$h:$m $ampm';

    if (isToday) {
      return 'Today, $timeStr';
    } else if (isYesterday) {
      return 'Yesterday, $timeStr';
    } else if (dt.year == now.year) {
      return '${dt.day} $monthName, $timeStr';
    } else {
      return '${dt.day} $monthName ${dt.year}, $timeStr';
    }
  }
}
