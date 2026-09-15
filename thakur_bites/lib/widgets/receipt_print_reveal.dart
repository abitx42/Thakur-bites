import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_theme.dart';

/// A retro physical POS "thermal printer" reveal for the order confirmation ticket:
///
/// Multi-phase 5.2-second physical burst-and-pause choreography:
/// 1. **Phase 1: Initial Feed (0ms – 400ms, 0–8%)**:
///    Top margin & header emerge from the chai printer slot.
/// 2. **Phase 2: Header Heating Pause (400ms – 750ms, 8%)**:
///    Paper holds stationary (350ms) while thermal line elements heat dark header data.
/// 3. **Phase 3: Burst 1 (750ms – 1850ms, 8% -> 42%)**:
///    Stepper motor runs with rhythmic micro-stepping pulses, advancing token & status.
/// 4. **Phase 4: Mid-Ticket Rasterization Pause (1850ms – 2300ms, 42%)**:
///    Paper holds still (450ms) as the buffer calculates line items and sub-totals.
/// 5. **Phase 5: Burst 2 (2300ms – 3500ms, 42% -> 82%)**:
///    Rapid line-by-line mechanical feed bursts unspooling line items and total.
/// 6. **Phase 6: Stamp & QR Micro-Pause (3500ms – 3800ms, 82%)**:
///    Brief 300ms pause preparing dense verification stamp / QR data.
/// 7. **Phase 7: Final Ejection Burst (3800ms – 4250ms, 82% -> 100%)**:
///    Paper advances rapidly to full length past the cutter blade anvil.
/// 8. **Phase 8: Guillotine Blade Cut (4250ms – 4500ms)**:
///    Feed halts completely. Metallic blade flash sweeps across the slot slit.
///    Fires tactile `HapticFeedback.mediumImpact()`.
/// 9. **Phase 9: Scrap Detachment & Gravity Settle (4500ms – 4850ms)**:
///    Detached paper scrap header flutters downward with air-drag rotation before vanishing.
///    The severed receipt drops 10px with an elastic settle bounce (`Curves.easeOutBack`).
///    Printer LED switches to emerald green (`READY`).
/// 10. **Phase 10: Below-Card & Action Buttons Entrance (4850ms – 5200ms)**:
///    The Masterchef cooking card and CTA buttons fade in and slide up smoothly.
class ReceiptPrintReveal extends StatefulWidget {
  /// The ticket/receipt content (token, status, items, total, QR, etc).
  final Widget receipt;

  /// Buttons/actions shown once the receipt has finished printing.
  final Widget actions;

  /// Set to false on rebuilds after the first (e.g. live Firestore status updates)
  /// so the print-in animation only ever plays once.
  final bool playIntro;

  /// Optional callback invoked when the print animation completes.
  final VoidCallback? onCompleted;

  /// Perforated tooth width along the reveal edge.
  final double toothWidth;

  /// Perforated tooth height along the reveal edge.
  final double toothHeight;

  /// Total duration of the print sequence. Defaults to 5200ms (5.2 seconds).
  final Duration duration;

  /// Evaluates the realistic physical burst-and-pause receipt feed progress.
  /// Maps master timeline fraction t (0.0 to 1.0) to reveal fraction (0.0 to 1.0).
  static double evaluateReceiptFeed(double t) =>
      _ReceiptPrintRevealState.evaluateReceiptFeed(t);

  const ReceiptPrintReveal({
    super.key,
    required this.receipt,
    required this.actions,
    this.playIntro = true,
    this.onCompleted,
    this.toothWidth = 10,
    this.toothHeight = 4,
    this.duration = const Duration(milliseconds: 5200),
  });

  @override
  State<ReceiptPrintReveal> createState() => _ReceiptPrintRevealState();
}

class _ReceiptPrintRevealState extends State<ReceiptPrintReveal>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  bool _hasFiredBladeHaptic = false;
  bool _hasFiredCutCompleteHaptic = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.duration,
    );

    _controller.addListener(_handleAnimationTick);
    _controller.addStatusListener(_handleAnimationStatus);

    if (widget.playIntro) {
      Future.delayed(const Duration(milliseconds: 100), () {
        if (mounted) _controller.forward();
      });
    } else {
      _controller.value = 1.0; // skip straight to fully revealed
    }
  }

  void _handleAnimationTick() {
    // Fire blade cut haptic when guillotine engages (~0.817 of timeline)
    if (_controller.value >= 0.817 && !_hasFiredBladeHaptic) {
      _hasFiredBladeHaptic = true;
      _safeHeavyImpact();
    }
    // Fire paper detachment haptic when blade completes cut (~0.875)
    if (_controller.value >= 0.875 && !_hasFiredCutCompleteHaptic) {
      _hasFiredCutCompleteHaptic = true;
      _safeMediumImpact();
    }
  }

  void _handleAnimationStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed) {
      _safeLightImpact();
      widget.onCompleted?.call();
    }
  }

  void _safeHeavyImpact() {
    try {
      HapticFeedback.heavyImpact();
    } catch (_) {}
  }

  void _safeMediumImpact() {
    try {
      HapticFeedback.mediumImpact();
    } catch (_) {}
  }

  void _safeLightImpact() {
    try {
      HapticFeedback.lightImpact();
    } catch (_) {}
  }

  @override
  void didUpdateWidget(covariant ReceiptPrintReveal oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.playIntro && _controller.value < 1.0) {
      _controller.value = 1.0;
    }
  }

  @override
  void dispose() {
    _controller.removeListener(_handleAnimationTick);
    _controller.removeStatusListener(_handleAnimationStatus);
    _controller.dispose();
    super.dispose();
  }

  /// Evaluates the realistic physical burst-and-pause receipt feed progress
  /// Maps master timeline fraction t (0.0 to 1.0) to reveal fraction (0.0 to 1.0).
  static double evaluateReceiptFeed(double t) {
    if (t <= 0.0) return 0.0;
    if (t >= 0.817) return 1.0; // Full length reached at start of blade cut

    // 1. Initial emergence (0ms to 416ms)
    if (t < 0.08) {
      final p = t / 0.08;
      return p * 0.08;
    }

    // 2. PAUSE 1: Header heating pause (416ms to 728ms)
    if (t < 0.14) {
      return 0.08;
    }

    // 3. BURST 1: Token & Status print with micro-steps (728ms to 1820ms)
    if (t < 0.35) {
      final p = (t - 0.14) / (0.35 - 0.14);
      // 14 micro-stepping teeth
      const int steps = 14;
      final stepped = (p * steps).floorToDouble() / steps;
      final sub = (p * steps) - (p * steps).floorToDouble();
      final smoothSub = math.pow(sub, 0.65).toDouble();
      final micro = (stepped + (smoothSub / steps)).clamp(0.0, 1.0);
      final blended = micro * 0.80 + p * 0.20;
      return 0.08 + blended * (0.42 - 0.08);
    }

    // 4. PAUSE 2: Mid-receipt items rasterization pause (1820ms to 2184ms)
    if (t < 0.42) {
      return 0.42;
    }

    // 5. BURST 2: Line items & total unspooling (2184ms to 3380ms)
    if (t < 0.65) {
      final p = (t - 0.42) / (0.65 - 0.42);
      // 18 micro-stepping teeth
      const int steps = 18;
      final stepped = (p * steps).floorToDouble() / steps;
      final sub = (p * steps) - (p * steps).floorToDouble();
      final smoothSub = math.pow(sub, 0.65).toDouble();
      final micro = (stepped + (smoothSub / steps)).clamp(0.0, 1.0);
      final blended = micro * 0.80 + p * 0.20;
      return 0.42 + blended * (0.82 - 0.42);
    }

    // 6. PAUSE 3: Stamp & QR computation pause (3380ms to 3692ms)
    if (t < 0.71) {
      return 0.82;
    }

    // 7. BURST 3: Final ejection to clear cutter head (3692ms to 4250ms)
    final p = ((t - 0.71) / (0.817 - 0.71)).clamp(0.0, 1.0);
    final eased = Curves.easeOutCubic.transform(p);
    return 0.82 + eased * (1.0 - 0.82);
  }

  /// Derives current hardware state label for the printer bar LED
  String _derivePrinterState(double t) {
    if (t <= 0.0) return 'STANDBY';
    if (t >= 0.875) return 'READY';
    if (t >= 0.817) return 'CUTTING';
    if (t < 0.08) return 'FEEDING';
    if (t < 0.14) return 'HEATING';
    if (t < 0.35) return 'PRINTING';
    if (t < 0.42) return 'BUFFERING';
    if (t < 0.65) return 'PRINTING';
    if (t < 0.71) return 'PROCESSING';
    return 'EJECTING';
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final double t = _controller.value;
        final double revealFraction = evaluateReceiptFeed(t);

        // Blade cut progress: 0..1 during 0.817 -> 0.875 (~300ms window)
        final double bladeProgress = ((t - 0.817) / (0.875 - 0.817)).clamp(0.0, 1.0);

        // Scrap fall progress: 0..1 during 0.875 -> 0.950 (triggers after cut completes)
        final double scrapProgress = ((t - 0.875) / (0.950 - 0.875)).clamp(0.0, 1.0);
        final bool showScrap = widget.playIntro && scrapProgress > 0.0 && scrapProgress < 1.0;
        final double scrapDy = Curves.easeInQuad.transform(scrapProgress) * 48.0;
        final double scrapDx = math.sin(scrapProgress * math.pi) * 14.0;
        final double scrapRot = (scrapProgress * 0.16) - 0.04;
        final double scrapOpacity = (1.0 - scrapProgress).clamp(0.0, 1.0);

        // Receipt settle offset: drops 8px with elastic bounce upon cut completion 0.875 -> 0.940
        final double settleProgress = ((t - 0.875) / (0.940 - 0.875)).clamp(0.0, 1.0);
        final double settleY = Curves.easeOutBack.transform(settleProgress) * 8.0;

        // Actions & GIF Banner entrance: 0..1 during 0.92 -> 1.00
        final double actionsProgress = ((t - 0.92) / (1.0 - 0.92)).clamp(0.0, 1.0);
        final double actionsEase = Curves.easeOutCubic.transform(actionsProgress);

        final bool isPrinting = t > 0.0 && t < 0.817;
        final bool isCutComplete = t >= 0.875;
        final String stateLabel = _derivePrinterState(t);

        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // 1. Thermal Printer Head Unit with Status LED & Blade Slot
            _PrinterBar(
              isPrinting: isPrinting,
              bladeCutProgress: bladeProgress,
              isCutComplete: isCutComplete,
              stateLabel: stateLabel,
            ),

            // 2. Paper emergence zone — receipt feeds downward from behind the printer slot
            Stack(
              clipBehavior: Clip.none,
              children: [
                // The Printed Receipt with physical paper feed and settle bounce
                Transform.translate(
                  offset: Offset(0, settleY),
                  child: ClipPath(
                    clipper: PrintRevealClipper(
                      revealFraction: revealFraction,
                      toothWidth: widget.toothWidth,
                      toothHeight: widget.toothHeight,
                    ),
                    child: Stack(
                      children: [
                        widget.receipt,

                        // Active thermal scanline strip glowing at throat aperture during printing
                        if (isPrinting)
                          Positioned(
                            top: 0,
                            left: 0,
                            right: 0,
                            height: 4,
                            child: Container(
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  begin: Alignment.topCenter,
                                  end: Alignment.bottomCenter,
                                  colors: [
                                    AppColors.mustard.withAlpha(100),
                                    Colors.transparent,
                                  ],
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),

                // 3. Printer throat overhang drop shadow — paper visibly emerges from under casing
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 8,
                  child: IgnorePointer(
                    child: Container(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.black.withAlpha(140),
                            Colors.black.withAlpha(40),
                            Colors.transparent,
                          ],
                        ),
                      ),
                    ),
                  ),
                ),

                // 4. Prominent Guillotine Cutter Blade visibly slicing horizontally across the throat
                Positioned(
                  top: -6,
                  left: 0,
                  right: 0,
                  child: _GuillotineBladeCutter(progress: bladeProgress),
                ),

                // 5. Falling detached paper scrap strip
                if (showScrap)
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    child: Center(
                      child: Transform.translate(
                        offset: Offset(scrapDx, scrapDy),
                        child: Transform.rotate(
                          angle: scrapRot,
                          child: Opacity(
                            opacity: scrapOpacity,
                            child: const _PaperScrap(),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),

            const SizedBox(height: 18),

            // 6. Staggered Entrance for GIF Banner & Action Buttons
            Opacity(
              opacity: actionsEase,
              child: Transform.translate(
                offset: Offset(0, (1.0 - actionsEase) * 20.0),
                child: widget.actions,
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Fixed dark chai-charcoal printer head bar with metallic trim, live hardware state LED,
/// and recessed paper aperture slit with guillotine blade shear shimmer.
class _PrinterBar extends StatelessWidget {
  final bool isPrinting;
  final double bladeCutProgress;
  final bool isCutComplete;
  final String stateLabel;

  const _PrinterBar({
    required this.isPrinting,
    required this.bladeCutProgress,
    required this.isCutComplete,
    required this.stateLabel,
  });

  @override
  Widget build(BuildContext context) {
    final bool isStandby = stateLabel == 'STANDBY';
    final Color ledColor = isCutComplete
        ? AppColors.success
        : (isStandby ? Colors.white.withAlpha(100) : AppColors.mustard);

    return Container(
      height: 42,
      decoration: BoxDecoration(
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(12),
          topRight: Radius.circular(12),
        ),
        border: Border.all(
          color: AppColors.chai.withAlpha(60),
          width: 1,
        ),
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color(0xFF3B281C), // Deep Chai-Brown
            Color(0xFF23160E), // Warm Charcoal Depth
          ],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x38000000),
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Left: Retro Thermal Brand Label
          Positioned(
            left: 14,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.receipt_long_rounded,
                  size: 13,
                  color: Colors.white.withAlpha(140),
                ),
                const SizedBox(width: 5),
                Text(
                  'TCET SPEED-DISPATCH',
                  style: AppFonts.mono(
                    fontSize: 8.5,
                    color: Colors.white.withAlpha(150),
                    letterSpacing: 0.8,
                  ),
                ),
              ],
            ),
          ),

          // Right: Status LED Indicator with Dynamic Hardware State
          Positioned(
            right: 14,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  stateLabel,
                  style: AppFonts.mono(
                    fontSize: 7.5,
                    color: ledColor,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.6,
                  ),
                ),
                const SizedBox(width: 5),
                Container(
                  width: 7,
                  height: 7,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: ledColor,
                    boxShadow: [
                      BoxShadow(
                        color: ledColor.withAlpha(160),
                        blurRadius: 6,
                        spreadRadius: 1,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Bottom: Paper Aperture Slot (wider for visible blade cut)
          Positioned(
            bottom: 0,
            left: 12,
            right: 12,
            child: Container(
              height: 6,
              decoration: BoxDecoration(
                color: Colors.black.withAlpha(220),
                borderRadius: BorderRadius.circular(1.5),
                border: Border.all(
                  color: const Color(0xFF4A3B32),
                  width: 0.5,
                ),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(1.5),
                child: bladeCutProgress > 0.0 && bladeCutProgress < 1.0
                    ? LayoutBuilder(
                        builder: (context, constraints) {
                          // Metallic blade shimmer line sweeping horizontally across the slit
                          final double flashX = (bladeCutProgress *
                                  (constraints.maxWidth + 40)) -
                              20;
                          return Stack(
                            children: [
                              Positioned(
                                left: flashX - 25,
                                width: 50,
                                top: 0,
                                bottom: 0,
                                child: Container(
                                  decoration: BoxDecoration(
                                    gradient: LinearGradient(
                                      colors: [
                                        Colors.transparent,
                                        Colors.white.withAlpha(240),
                                        AppColors.mustardSoft,
                                        Colors.transparent,
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          );
                        },
                      )
                    : const SizedBox.shrink(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Animated mechanical guillotine cutter that visibly shears horizontally across the paper throat.
class _GuillotineBladeCutter extends StatelessWidget {
  final double progress; // 0.0 -> 1.0

  const _GuillotineBladeCutter({required this.progress});

  @override
  Widget build(BuildContext context) {
    if (progress <= 0.0 || progress >= 1.0) {
      return const SizedBox.shrink();
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final double width = constraints.maxWidth;
        // Blade shears across from left (-30px) to right (width + 30px)
        final double cutX = (progress * (width + 60)) - 30;

        return SizedBox(
          width: width,
          height: 18,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              // 1. Severed cut score line trailing behind the blade
              Positioned(
                left: 0,
                width: cutX.clamp(0.0, width),
                top: 8,
                height: 2,
                child: Container(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Colors.transparent,
                        const Color(0xFF4A3B32).withAlpha(180),
                        Colors.black.withAlpha(220),
                      ],
                    ),
                  ),
                ),
              ),

              // 2. The Steel Guillotine Blade Head
              Positioned(
                left: cutX - 28,
                top: 2,
                child: Container(
                  width: 36,
                  height: 14,
                  decoration: BoxDecoration(
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(2),
                      bottomRight: Radius.circular(8),
                    ),
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        Color(0xFFFFFFFF), // Chrome gleam
                        Color(0xFFE2E8F0), // Polished steel
                        Color(0xFF94A3B8), // Brushed metal
                        Color(0xFF475569), // Beveled edge shadow
                      ],
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withAlpha(140),
                        blurRadius: 4,
                        offset: const Offset(1, 2),
                      ),
                      BoxShadow(
                        color: Colors.white.withAlpha(200),
                        blurRadius: 2,
                        offset: const Offset(-1, -1),
                      ),
                    ],
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      // Razor cutting tip
                      Container(
                        width: 2.5,
                        height: 14,
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.only(
                            topRight: Radius.circular(1),
                            bottomRight: Radius.circular(4),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // 3. Cutting Spark & Flare at the blade tip
              Positioned(
                left: cutX - 16,
                top: -3,
                child: Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        Colors.white,
                        const Color(0xFFFDE68A).withAlpha(220), // Amber spark
                        AppColors.mustard.withAlpha(90),
                        Colors.transparent,
                      ],
                      stops: const [0.0, 0.3, 0.6, 1.0],
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// A cut paper scrap header that detaches from the cutter slit and flutters down.
class _PaperScrap extends StatelessWidget {
  const _PaperScrap();

  @override
  Widget build(BuildContext context) {
    return ClipPath(
      clipper: const _ScrapStripClipper(),
      child: Container(
        width: 220,
        height: 12,
        decoration: BoxDecoration(
          color: const Color(0xFFFAF6ED),
          border: Border.all(color: AppColors.line, width: 0.8),
          boxShadow: const [
            BoxShadow(
              color: Color(0x18000000),
              blurRadius: 4,
              offset: Offset(0, 2),
            ),
          ],
        ),
        alignment: Alignment.center,
        child: Text(
          '✂ - - - - - - - - - - - - - - - - - - - - ✂',
          style: AppFonts.mono(
            fontSize: 6.5,
            color: AppColors.inkSoft.withAlpha(120),
          ),
        ),
      ),
    );
  }
}

/// Double-sided perforated clipper for the detached paper scrap.
class _ScrapStripClipper extends CustomClipper<Path> {
  static const double toothWidth = 8.0;
  static const double toothHeight = 2.5;

  const _ScrapStripClipper();

  @override
  Path getClip(Size size) {
    final path = Path();
    path.moveTo(0, toothHeight);
    final teeth = (size.width / toothWidth).ceil();

    // Top edge zigzag
    for (int i = 0; i <= teeth; i++) {
      final x = (i * toothWidth).clamp(0.0, size.width);
      final y = i.isEven ? 0.0 : toothHeight;
      path.lineTo(x, y);
    }
    path.lineTo(size.width, size.height - toothHeight);

    // Bottom edge zigzag
    for (int i = teeth; i >= 0; i--) {
      final x = (i * toothWidth).clamp(0.0, size.width);
      final y = i.isEven ? size.height : size.height - toothHeight;
      path.lineTo(x, y);
    }
    path.lineTo(0, toothHeight);
    path.close();
    return path;
  }

  @override
  bool shouldReclip(covariant _ScrapStripClipper oldClipper) => false;
}

/// Clips the receipt from the top down, keeping a jagged perforated edge
/// exactly at the current reveal boundary — creating the physical illusion
/// of paper emerging from the thermal print head.
class PrintRevealClipper extends CustomClipper<Path> {
  final double revealFraction; // 0..1
  final double toothWidth;
  final double toothHeight;

  PrintRevealClipper({
    required this.revealFraction,
    this.toothWidth = 10,
    this.toothHeight = 4,
  });

  @override
  Path getClip(Size size) {
    if (revealFraction >= 1.0) {
      return Path()..addRect(Rect.fromLTWH(0, 0, size.width, size.height));
    }
    if (revealFraction <= 0.0) {
      return Path();
    }

    final revealedHeight =
        (size.height * revealFraction).clamp(0.0, size.height);
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width, revealedHeight);

    // Zigzag along the current bottom edge, right to left.
    final toothCount = (size.width / toothWidth).ceil();
    for (int i = toothCount; i >= 0; i--) {
      final x = (i * toothWidth).clamp(0.0, size.width);
      final y = i.isEven
          ? revealedHeight
          : (revealedHeight - toothHeight).clamp(0.0, size.height);
      path.lineTo(x, y);
    }

    path
      ..lineTo(0, revealedHeight)
      ..close();
    return path;
  }

  @override
  bool shouldReclip(covariant PrintRevealClipper oldClipper) =>
      oldClipper.revealFraction != revealFraction;
}

/// Custom painter rendering subtle 203-DPI horizontal thermal head micro-scanlines
/// across the ticket body for genuine thermal paper stock realism.
class ThermalPaperScanlinesPainter extends CustomPainter {
  const ThermalPaperScanlinesPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0x06000000)
      ..strokeWidth = 1.0;

    for (double y = 0; y < size.height; y += 3.5) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant ThermalPaperScanlinesPainter oldDelegate) => false;
}

/// Custom painter rendering authentic continuous tractor-feed sprocket punch holes
/// along the margin of the thermal ticket, with subtle punch depth and vertical perforation slits.
class TractorFeedPinholesPainter extends CustomPainter {
  final bool isLeft;

  const TractorFeedPinholesPainter({this.isLeft = true});

  @override
  void paint(Canvas canvas, Size size) {
    const holeRadius = 2.2;
    const holeSpacing = 15.0;
    final holeX = isLeft ? 7.0 : size.width - 7.0;
    final perforationX = isLeft ? size.width - 1.0 : 1.0;

    // Perforation dotted line
    final perfPaint = Paint()
      ..color = const Color(0x3078350F)
      ..strokeWidth = 0.8
      ..style = PaintingStyle.stroke;

    double y = 4.0;
    while (y < size.height - 4) {
      canvas.drawLine(
        Offset(perforationX, y),
        Offset(perforationX, y + 2.5),
        perfPaint,
      );
      y += 5.0;
    }

    // Outer hole shadow (embossed punch-hole depth)
    final shadowPaint = Paint()
      ..color = const Color(0x353B281C)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.8;

    // Inner hole cutout
    final holePaint = Paint()
      ..color = const Color(0xFFF1EAE0)
      ..style = PaintingStyle.fill;

    double holeY = 10.0;
    while (holeY < size.height - 6) {
      canvas.drawCircle(Offset(holeX, holeY), holeRadius, holePaint);
      canvas.drawCircle(Offset(holeX, holeY), holeRadius, shadowPaint);
      holeY += holeSpacing;
    }
  }

  @override
  bool shouldRepaint(covariant TractorFeedPinholesPainter oldDelegate) =>
      oldDelegate.isLeft != isLeft;
}
