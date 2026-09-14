import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_theme.dart';

/// A retro physical "thermal printer" reveal for the order confirmation ticket:
///
/// Multi-phase 2.2-second tactile choreography:
/// 1. **Phase 1: Thermal Feed & Print (0ms – 1450ms)**:
///    The paper unspools downwards from the chai printer slot with micro-stepped
///    stepper motor pulses and a traveling jagged/perforated bottom edge.
///    An active thermal scanline strip glows warm at the aperture throat.
/// 2. **Phase 2: Guillotine Blade Cut (1450ms – 1650ms)**:
///    The paper feed halts. A metallic blade flash sweeps across the slot slit,
///    accompanied by a tactile shear haptic (`HapticFeedback.mediumImpact()`).
/// 3. **Phase 3: Scrap Detachment & Gravity Settle (1650ms – 1950ms)**:
///    A realistic cut paper scrap header detaches from the slot, fluttering down
///    with air drag rotation before fading away.
///    The severed receipt drops 8px with an elastic settle bounce onto the counter.
///    The printer LED turns to emerald green (`READY`).
/// 4. **Phase 4: Action Buttons Entrance (1950ms – 2200ms)**:
///    The bottom CTA buttons slide up and fade in smoothly.
///    Fires completion haptic and invokes [onCompleted].
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

  /// Total duration of the print sequence. Defaults to 2200ms (2.2 seconds).
  final Duration duration;

  const ReceiptPrintReveal({
    super.key,
    required this.receipt,
    required this.actions,
    this.playIntro = true,
    this.onCompleted,
    this.toothWidth = 10,
    this.toothHeight = 4,
    this.duration = const Duration(milliseconds: 2200),
  });

  @override
  State<ReceiptPrintReveal> createState() => _ReceiptPrintRevealState();
}

class _ReceiptPrintRevealState extends State<ReceiptPrintReveal>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  // Phase animations mapped along the 2200ms master timeline
  late final Animation<double> _feedAnim; // 0.0 -> 0.66: paper unspooling
  late final Animation<double> _bladeCutAnim; // 0.66 -> 0.75: blade sweep
  late final Animation<double> _scrapFallAnim; // 0.68 -> 0.88: scrap flutter & fade
  late final Animation<double> _settleAnim; // 0.75 -> 0.88: receipt drop & bounce
  late final Animation<double> _actionsAnim; // 0.88 -> 1.00: buttons fade & slide

  bool _hasFiredBladeHaptic = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.duration,
    );

    // 1. Paper Feed (0ms to 1452ms)
    _feedAnim = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.0, 0.66, curve: Curves.easeOutCubic),
    );

    // 2. Guillotine Blade Cut Flash (1452ms to 1650ms)
    _bladeCutAnim = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.66, 0.75, curve: Curves.easeInOut),
    );

    // 3. Falling Paper Scrap Detachment (1496ms to 1936ms)
    _scrapFallAnim = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.68, 0.88, curve: Curves.easeInCubic),
    );

    // 4. Receipt Gravity Settle Bounce (1650ms to 1936ms)
    _settleAnim = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.75, 0.88, curve: Curves.easeOutBack),
    );

    // 5. Action Buttons Fade & Slide-In (1936ms to 2200ms)
    _actionsAnim = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.88, 1.0, curve: Curves.easeOutCubic),
    );

    // Listeners for mechanical haptics and completion
    _controller.addListener(_handleAnimationTick);
    _controller.addStatusListener(_handleAnimationStatus);

    if (widget.playIntro) {
      Future.delayed(const Duration(milliseconds: 80), () {
        if (mounted) _controller.forward();
      });
    } else {
      _controller.value = 1.0; // skip straight to fully revealed
    }
  }

  void _handleAnimationTick() {
    // Fire blade cut haptic exactly as the guillotine activates (~1452ms)
    if (_controller.value >= 0.66 && !_hasFiredBladeHaptic) {
      _hasFiredBladeHaptic = true;
      _safeMediumImpact();
    }
  }

  void _handleAnimationStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed) {
      _safeLightImpact();
      widget.onCompleted?.call();
    }
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

  /// Evaluates smooth stepper-motor micro-stepping advances
  /// 36 rhythmic mechanical increments overlaid on the easeOut curve.
  double _calculateMicroStep(double rawProgress) {
    if (rawProgress <= 0.0) return 0.0;
    if (rawProgress >= 1.0) return 1.0;

    const int totalSteps = 36;
    final double stepped = (rawProgress * totalSteps).floorToDouble() / totalSteps;
    final double subProgress =
        (rawProgress * totalSteps) - (rawProgress * totalSteps).floorToDouble();
    final double subEase = math.pow(subProgress, 0.65).toDouble();
    final double smoothStep =
        (stepped + (subEase / totalSteps)).clamp(0.0, 1.0);

    // 82% micro-stepped + 18% continuous blend preserves physical tactile rhythm
    return (smoothStep * 0.82 + rawProgress * 0.18).clamp(0.0, 1.0);
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final double rawFeed = _feedAnim.value;
        final double microReveal = _calculateMicroStep(rawFeed);

        // Blade flash progress: 0..1 during cut phase
        final double bladeProgress = _bladeCutAnim.value;

        // Scrap fall physics
        final double scrapProgress = _scrapFallAnim.value;
        final bool showScrap =
            widget.playIntro && scrapProgress > 0.0 && scrapProgress < 1.0;
        final double scrapDy =
            Curves.easeInQuad.transform(scrapProgress) * 44.0;
        final double scrapDx = math.sin(scrapProgress * math.pi) * 12.0;
        final double scrapRot = (scrapProgress * 0.14) - 0.03;
        final double scrapOpacity = (1.0 - scrapProgress).clamp(0.0, 1.0);

        // Receipt settle offset: drops 8px when severed
        final double settleY = _settleAnim.value * 8.0;

        final bool isPrinting =
            _controller.value > 0.0 && _controller.value < 0.66;
        final bool isCutComplete = _controller.value >= 0.75;

        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // 1. Retro Thermal Printer Head Unit with Status LED & Blade Slot
            _PrinterBar(
              isPrinting: isPrinting,
              bladeCutProgress: bladeProgress,
              isCutComplete: isCutComplete,
            ),

            // 2. Relative viewport for paper emergence and fluttering scrap
            Stack(
              clipBehavior: Clip.none,
              children: [
                // The Printed Receipt with micro-stepped feed, clipper, and drop bounce
                Transform.translate(
                  offset: Offset(0, settleY),
                  child: ClipPath(
                    clipper: PrintRevealClipper(
                      revealFraction: microReveal,
                      toothWidth: widget.toothWidth,
                      toothHeight: widget.toothHeight,
                    ),
                    child: Stack(
                      children: [
                        widget.receipt,

                        // Active thermal scanline strip glowing at the throat during printing
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
                                    AppColors.mustard.withAlpha(90),
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

                // 3. Falling detached paper scrap strip
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

            // 4. Staggered Action Buttons Fade & Slide-In
            FadeTransition(
              opacity: _actionsAnim,
              child: Transform.translate(
                offset: Offset(0, (1.0 - _actionsAnim.value) * 16.0),
                child: widget.actions,
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Fixed dark chai-charcoal printer head bar with metallic trim, status LED,
/// and recessed paper aperture slit with guillotine blade shear shimmer.
class _PrinterBar extends StatelessWidget {
  final bool isPrinting;
  final double bladeCutProgress;
  final bool isCutComplete;

  const _PrinterBar({
    required this.isPrinting,
    required this.bladeCutProgress,
    required this.isCutComplete,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      margin: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        borderRadius: AppRadius.radiusPill,
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
                  'TCET THERMAL DISPATCH',
                  style: AppFonts.mono(
                    fontSize: 8.5,
                    color: Colors.white.withAlpha(150),
                    letterSpacing: 0.8,
                  ),
                ),
              ],
            ),
          ),

          // Right: Status LED Indicator
          Positioned(
            right: 14,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  isCutComplete
                      ? 'READY'
                      : (isPrinting ? 'PRINTING' : 'STANDBY'),
                  style: AppFonts.mono(
                    fontSize: 7.5,
                    color: isCutComplete
                        ? AppColors.success
                        : (isPrinting
                            ? AppColors.mustard
                            : Colors.white.withAlpha(100)),
                    letterSpacing: 0.6,
                  ),
                ),
                const SizedBox(width: 5),
                Container(
                  width: 7,
                  height: 7,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isCutComplete
                        ? AppColors.success
                        : (isPrinting
                            ? AppColors.mustard
                            : Colors.white.withAlpha(100)),
                    boxShadow: [
                      BoxShadow(
                        color: (isCutComplete
                                ? AppColors.success
                                : (isPrinting
                                    ? AppColors.mustard
                                    : Colors.transparent))
                            .withAlpha(160),
                        blurRadius: 6,
                        spreadRadius: 1,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Center-Bottom: Paper Aperture Slot with Guillotine Blade Shear Flash
          Positioned(
            bottom: 3,
            left: 28,
            right: 28,
            child: Container(
              height: 3.5,
              decoration: BoxDecoration(
                color: Colors.black.withAlpha(220),
                borderRadius: BorderRadius.circular(2),
                border: Border.all(
                  color: const Color(0xFF4A3B32),
                  width: 0.5,
                ),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(2),
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
          color: AppColors.surface,
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
