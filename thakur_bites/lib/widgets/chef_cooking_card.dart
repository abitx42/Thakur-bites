import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../models/order.dart' as app;
import '../theme/app_theme.dart';

/// A culinary live status card displayed underneath the thermal receipt on the ticket screen.
/// Features the animated chef with an ambient Chai-Sandstone stage, ultrasonic live beacon,
/// dynamic 4-stage milestone stepper, rising steam & ember sparks FX, and live kitchen dispatch telemetry.
class ChefCookingCard extends StatefulWidget {
  final app.Order? order;

  const ChefCookingCard({super.key, this.order});

  @override
  State<ChefCookingCard> createState() => _ChefCookingCardState();
}

class _ChefCookingCardState extends State<ChefCookingCard>
    with TickerProviderStateMixin {
  late final AnimationController _radarController;
  late final AnimationController _pulseController;
  late final Animation<double> _pulseAnim;
  late final AnimationController _floatController;
  late final AnimationController _fxController;
  late final AnimationController _shimmerController;
  late final AnimationController _eqController;

  Timer? _stepTimer;
  int _stepIndex = 0;

  static const List<Map<String, dynamic>> _cookingSteps = [
    {
      'title': 'Order Dispatched to Masterchefs!',
      'subtitle':
          'TCET Central Kitchen received your ticket. Station assigned & ingredients staged.',
      'badge': 'Queue Station 🛎️',
      'station': 'LINE 1 · KITCHEN QUEUE',
      'progress': 0.28,
      'label': 'Dispatched',
      'icon': Icons.receipt_long_rounded,
      'tag': 'Ticket In KDS',
    },
    {
      'title': 'Chef is Firing the Pan & Tawa!',
      'subtitle':
          'Fresh ingredients tossed on sizzling cast-iron tawa with pure Amul butter & aromatic spices.',
      'badge': 'Hot Pan 🔥',
      'station': 'TAWA #2 · CHEF SUNIL',
      'progress': 0.62,
      'label': 'Cooking',
      'icon': Icons.local_fire_department_rounded,
      'tag': '185°C Sizzle',
    },
    {
      'title': 'Artisanal Plating & QC Inspection!',
      'subtitle':
          'Quality inspection check passed. Assembling crisp accompaniments, fresh chutneys & packing hot.',
      'badge': 'Plating ✨',
      'station': 'ASSEMBLY · STATION #4',
      'progress': 0.88,
      'label': 'Plating',
      'icon': Icons.auto_awesome_rounded,
      'tag': 'Packing Hot',
    },
    {
      'title': 'Fresh & Ready for Pickup!',
      'subtitle':
          'Piping hot order waiting at Central Counter. Show your 4-digit PIN for express handover.',
      'badge': 'Counter Call 🥡',
      'station': 'CENTRAL PICKUP COUNTER',
      'progress': 1.00,
      'label': 'Ready',
      'icon': Icons.check_circle_rounded,
      'tag': 'Ready Now',
    },
  ];

  @override
  void initState() {
    super.initState();

    _radarController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat();

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);

    _pulseAnim = Tween<double>(begin: 0.80, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _floatController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    )..repeat(reverse: true);

    _fxController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2800),
    )..repeat();

    _shimmerController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat();

    _eqController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 750),
    )..repeat(reverse: true);

    _initInitialStep();
    _startStepTimer();
  }

  void _initInitialStep() {
    final status = widget.order?.status;
    if (status == 'ready' || status == 'collected') {
      _stepIndex = 3;
    } else if (status == 'preparing') {
      _stepIndex = 1;
    } else {
      _stepIndex = 0;
    }
  }

  void _startStepTimer() {
    _stepTimer?.cancel();
    if (widget.order?.status == 'ready' || widget.order?.status == 'collected') {
      return;
    }

    _stepTimer = Timer.periodic(const Duration(milliseconds: 4500), (_) {
      if (mounted) {
        setState(() {
          _stepIndex = (_stepIndex + 1) % _cookingSteps.length;
        });
      }
    });
  }

  void _selectStep(int index) {
    setState(() {
      _stepIndex = index;
    });
    _startStepTimer();
  }

  @override
  void didUpdateWidget(covariant ChefCookingCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.order?.status != oldWidget.order?.status) {
      _initInitialStep();
    }
  }

  @override
  void dispose() {
    _stepTimer?.cancel();
    _radarController.dispose();
    _pulseController.dispose();
    _floatController.dispose();
    _fxController.dispose();
    _shimmerController.dispose();
    _eqController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final currentStep = _cookingSteps[_stepIndex];
    final progressVal = (currentStep['progress'] as num).toDouble();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 18),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDF9),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: const Color(0xFFEADBCE),
          width: 1.5,
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x123B281C),
            blurRadius: 20,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ─── Header: Ultrasonic Radar Beacon + Live Dispatch + Station Pill ───
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  // Ultrasonic Radar Beacon
                  SizedBox(
                    width: 22,
                    height: 22,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        AnimatedBuilder(
                          animation: _radarController,
                          builder: (context, _) {
                            final scale = 1.0 + (_radarController.value * 1.4);
                            final alpha =
                                ((1.0 - _radarController.value) * 160).round();
                            return Container(
                              width: 10 * scale,
                              height: 10 * scale,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: AppColors.green.withAlpha(alpha),
                                  width: 1.5,
                                ),
                              ),
                            );
                          },
                        ),
                        AnimatedBuilder(
                          animation: _pulseAnim,
                          builder: (context, _) => Container(
                            width: 8.5 * _pulseAnim.value,
                            height: 8.5 * _pulseAnim.value,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: AppColors.green,
                              boxShadow: [
                                BoxShadow(
                                  color: AppColors.green.withAlpha(
                                      (180 * _pulseAnim.value).toInt()),
                                  blurRadius: 6 * _pulseAnim.value,
                                  spreadRadius: 1 * _pulseAnim.value,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'LIVE KITCHEN DISPATCH',
                    style: AppFonts.mono(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.greenInk,
                      letterSpacing: 0.8,
                    ),
                  ),
                  const SizedBox(width: 6),
                  // Animated Telemetry Equalizer Bars
                  _buildEqualizer(),
                ],
              ),

              // Station Pill Chip
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 300),
                child: Container(
                  key: ValueKey<String>(currentStep['badge'] as String),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF3C7),
                    borderRadius: BorderRadius.circular(999),
                    border:
                        Border.all(color: const Color(0xFFFDE68A), width: 1.2),
                  ),
                  child: Text(
                    currentStep['badge'] as String,
                    style: AppFonts.mono(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF92400E),
                    ),
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // ─── Masterchef Visual Stage (Ambient Stage with Floating Chef & Sparks) ───
          Container(
            height: 180,
            width: double.infinity,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Color(0xFFFFFDF8),
                  Color(0xFFFAF2E6),
                  Color(0xFFF3E7D5),
                ],
              ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: const Color(0xFFEBDCCF),
                width: 1.2,
              ),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x0A000000),
                  blurRadius: 10,
                  offset: Offset(0, 3),
                ),
              ],
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              alignment: Alignment.center,
              children: [
                // 1. Ambient Warm Overhead Spotlight
                Positioned(
                  top: -24,
                  child: Container(
                    width: 200,
                    height: 130,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: RadialGradient(
                        colors: [
                          const Color(0xFFFDE68A).withAlpha(100),
                          Colors.transparent,
                        ],
                      ),
                    ),
                  ),
                ),

                // 2. Skillet Heat Burner Shimmer Aura (at pan base)
                Positioned(
                  bottom: 12,
                  child: AnimatedBuilder(
                    animation: _pulseAnim,
                    builder: (context, _) => Container(
                      width: 120 * _pulseAnim.value,
                      height: 38 * _pulseAnim.value,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(
                          colors: [
                            const Color(0xFFF59E0B)
                                .withAlpha((80 * _pulseAnim.value).toInt()),
                            const Color(0xFFDC2626)
                                .withAlpha((40 * _pulseAnim.value).toInt()),
                            Colors.transparent,
                          ],
                        ),
                      ),
                    ),
                  ),
                ),

                // 3. Countertop Grounding Pedestal
                Positioned(
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 36,
                  child: Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.transparent,
                          Color(0x2478350F),
                        ],
                      ),
                    ),
                  ),
                ),

                // 4. Chef Dynamic Contact Shadow (breathes with float)
                Positioned(
                  bottom: 22,
                  child: AnimatedBuilder(
                    animation: _floatController,
                    builder: (context, _) {
                      final floatVal = _floatController.value;
                      final shadowWidth = 90.0 - (floatVal * 12.0);
                      final shadowAlpha = (110 - (floatVal * 30)).round();
                      return Container(
                        width: shadowWidth,
                        height: 10,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(999),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFF3B281C)
                                  .withAlpha(shadowAlpha),
                              blurRadius: 10,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),

                // 5. Floating Masterchef Animated GIF
                Positioned(
                  top: 10,
                  bottom: 24,
                  child: AnimatedBuilder(
                    animation: _floatController,
                    builder: (context, child) {
                      final floatOffset =
                          math.sin(_floatController.value * math.pi) * 3.5;
                      return Transform.translate(
                        offset: Offset(0, -floatOffset),
                        child: child,
                      );
                    },
                    child: Center(
                      child: Image.asset(
                        'assets/animations/chef_cooking.gif',
                        fit: BoxFit.contain,
                        errorBuilder: (context, error, stackTrace) {
                          return Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.restaurant_rounded,
                                    size: 48, color: AppColors.mustard),
                                const SizedBox(height: 8),
                                Text(
                                  'Masterchefs in Action',
                                  style: AppFonts.body(
                                      fontSize: 12, color: AppColors.inkSoft),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                ),

                // 6. Multi-particle Steam Wisps & Golden Ember Sparks FX
                Positioned.fill(
                  child: AnimatedBuilder(
                    animation: _fxController,
                    builder: (context, _) => CustomPaint(
                      painter: _CulinaryStageFXPainter(_fxController.value),
                    ),
                  ),
                ),

                // 7. Micro-Telemetry Overlay Chip (Top-Right)
                Positioned(
                  top: 10,
                  right: 12,
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 300),
                    child: Container(
                      key: ValueKey<String>(currentStep['tag'] as String),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3.5),
                      decoration: BoxDecoration(
                        color: Colors.white.withAlpha(225),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                            color: const Color(0xFFEADBCE), width: 1),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x0A000000),
                            blurRadius: 4,
                            offset: Offset(0, 1),
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
                              color: Color(0xFFD97706),
                            ),
                          ),
                          const SizedBox(width: 5),
                          Text(
                            currentStep['tag'] as String,
                            style: AppFonts.mono(
                              fontSize: 9.5,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFF78350F),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                // 8. Station Route Label Overlay (Top-Left)
                Positioned(
                  top: 10,
                  left: 12,
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 300),
                    child: Container(
                      key: ValueKey<String>(currentStep['station'] as String),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3.5),
                      decoration: BoxDecoration(
                        color: const Color(0xFF3B281C).withAlpha(210),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        currentStep['station'] as String,
                        style: AppFonts.mono(
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                          color: const Color(0xFFFAF6ED),
                          letterSpacing: 0.4,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 14),

          // ─── Interactive 4-Stage Kitchen Milestone Stepper ───
          _buildMilestoneStepper(progressVal),

          const SizedBox(height: 12),

          // ─── Sizzling Heat Wave & Shimmer Progress Bar ───
          Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'KITCHEN DISPATCH QUEUE',
                    style: AppFonts.mono(
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF8C7A6B),
                      letterSpacing: 0.6,
                    ),
                  ),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 300),
                    child: Text(
                      '${(progressVal * 100).toInt()}% PREPPED',
                      key: ValueKey<double>(progressVal),
                      style: AppFonts.mono(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w800,
                        color: const Color(0xFFB45309),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 5),
              ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: Container(
                  height: 6,
                  width: double.infinity,
                  color: const Color(0xFFEAE0D3),
                  child: Stack(
                    children: [
                      TweenAnimationBuilder<double>(
                        tween: Tween<double>(begin: 0.28, end: progressVal),
                        duration: const Duration(milliseconds: 500),
                        curve: Curves.easeOutCubic,
                        builder: (context, val, _) => FractionallySizedBox(
                          widthFactor: val,
                          child: Container(
                            decoration: const BoxDecoration(
                              gradient: LinearGradient(
                                colors: [
                                  Color(0xFFD97706),
                                  Color(0xFFF59E0B),
                                  Color(0xFF10B981),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                      AnimatedBuilder(
                        animation: _shimmerController,
                        builder: (context, _) {
                          final shimmerPos =
                              _shimmerController.value * 2.0 - 1.0;
                          return Align(
                            alignment: Alignment(shimmerPos, 0),
                            child: Container(
                              width: 45,
                              height: double.infinity,
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  colors: [
                                    Colors.white.withAlpha(0),
                                    Colors.white.withAlpha(160),
                                    Colors.white.withAlpha(0),
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 14),

          // ─── Dynamic Sensory Announcement Speech Box ───
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: const Color(0xFFFAF5ED),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: const Color(0xFFEADBCE),
                width: 1.0,
              ),
            ),
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 400),
              transitionBuilder: (child, anim) {
                return FadeTransition(
                  opacity: anim,
                  child: SlideTransition(
                    position: Tween<Offset>(
                      begin: const Offset(0.0, 0.15),
                      end: Offset.zero,
                    ).animate(anim),
                    child: child,
                  ),
                );
              },
              child: Column(
                key: ValueKey<int>(_stepIndex),
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Text(
                    currentStep['title'] as String,
                    textAlign: TextAlign.center,
                    style: AppFonts.display(
                      fontSize: 16.5,
                      color: AppColors.chai,
                      letterSpacing: 0.3,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    currentStep['subtitle'] as String,
                    textAlign: TextAlign.center,
                    style: AppFonts.body(
                      fontSize: 11.5,
                      color: AppColors.inkSecondary,
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

  /// Interactive 4-Stage Milestone Stepper with glowing node progress
  Widget _buildMilestoneStepper(double activeProgress) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return Stack(
          alignment: Alignment.center,
          children: [
            // Background track line connecting all nodes
            Positioned(
              left: 20,
              right: 20,
              top: 15,
              child: Container(
                height: 2.5,
                color: const Color(0xFFE4DCD0),
              ),
            ),

            // Active progress fill line
            Positioned(
              left: 20,
              top: 15,
              child: TweenAnimationBuilder<double>(
                tween: Tween<double>(
                  begin: 0.0,
                  end: (constraints.maxWidth - 40) *
                      (_stepIndex / (_cookingSteps.length - 1)),
                ),
                duration: const Duration(milliseconds: 400),
                curve: Curves.easeOutQuad,
                builder: (context, widthVal, _) => Container(
                  width: widthVal,
                  height: 2.5,
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Color(0xFFD97706),
                        Color(0xFFF59E0B),
                        Color(0xFF10B981),
                      ],
                    ),
                  ),
                ),
              ),
            ),

            // Row of 4 interactive milestone nodes
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: List.generate(_cookingSteps.length, (idx) {
                final isCompleted = idx < _stepIndex;
                final isCurrent = idx == _stepIndex;
                final step = _cookingSteps[idx];

                return GestureDetector(
                  onTap: () => _selectStep(idx),
                  behavior: HitTestBehavior.opaque,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Node Icon Circle
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 300),
                        width: isCurrent ? 32 : 28,
                        height: isCurrent ? 32 : 28,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isCompleted
                              ? const Color(0xFF10B981)
                              : isCurrent
                                  ? const Color(0xFFD97706)
                                  : const Color(0xFFF3EFE2),
                          border: Border.all(
                            color: isCurrent
                                ? const Color(0xFFFEF3C7)
                                : isCompleted
                                    ? const Color(0xFFDCFCE7)
                                    : const Color(0xFFD6C7B2),
                            width: isCurrent ? 2.2 : 1.5,
                          ),
                          boxShadow: isCurrent
                              ? [
                                  BoxShadow(
                                    color:
                                        const Color(0xFFD97706).withAlpha(120),
                                    blurRadius: 10,
                                    spreadRadius: 2,
                                  ),
                                ]
                              : null,
                        ),
                        child: Center(
                          child: Icon(
                            isCompleted
                                ? Icons.check_rounded
                                : (step['icon'] as IconData),
                            size: isCurrent ? 16 : 14,
                            color: (isCompleted || isCurrent)
                                ? Colors.white
                                : const Color(0xFF8C7A6B),
                          ),
                        ),
                      ),

                      const SizedBox(height: 6),

                      // Step Label
                      Text(
                        step['label'] as String,
                        style: AppFonts.mono(
                          fontSize: 9.5,
                          fontWeight:
                              isCurrent ? FontWeight.w800 : FontWeight.w600,
                          color: isCurrent
                              ? const Color(0xFF78350F)
                              : isCompleted
                                  ? const Color(0xFF15803D)
                                  : const Color(0xFF8C7A6B),
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ),
          ],
        );
      },
    );
  }

  /// Equalizer micro-telemetry bars that bounce rhythmically
  Widget _buildEqualizer() {
    return AnimatedBuilder(
      animation: _eqController,
      builder: (context, _) {
        final v = _eqController.value;
        final h1 = 4.0 + (v * 7.0);
        final h2 = 11.0 - (v * 6.0);
        final h3 = 5.0 + ((1.0 - v) * 7.0);

        return Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            _eqBar(h1),
            const SizedBox(width: 2),
            _eqBar(h2),
            const SizedBox(width: 2),
            _eqBar(h3),
          ],
        );
      },
    );
  }

  Widget _eqBar(double height) {
    return Container(
      width: 2.5,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.green,
        borderRadius: BorderRadius.circular(999),
      ),
    );
  }
}

/// Advanced multi-particle canvas FX:
/// Combines 3 sinusoidal rising steam wisps with 6 golden sizzling ember sparks
class _CulinaryStageFXPainter extends CustomPainter {
  final double progress;

  const _CulinaryStageFXPainter(this.progress);

  @override
  void paint(Canvas canvas, Size size) {
    final centerX = size.width / 2;
    final panBaseY = size.height * 0.44;

    // ─── 1. Rising Steam Wisps ───
    final steamPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0
      ..strokeCap = StrokeCap.round;

    for (int i = 0; i < 3; i++) {
      final offsetX = (i - 1) * 22.0;
      final phase = (progress + i * 0.33) % 1.0;
      final startY = panBaseY - (phase * 38.0);
      final alpha = ((1.0 - phase) * 0.35).clamp(0.0, 1.0);

      steamPaint.color =
          const Color(0xFFD97706).withAlpha((alpha * 255).round());

      final path = Path();
      path.moveTo(centerX + offsetX, startY + 18);
      path.quadraticBezierTo(
        centerX + offsetX + math.sin(phase * 2 * math.pi) * 8,
        startY + 9,
        centerX + offsetX,
        startY,
      );
      canvas.drawPath(path, steamPaint);
    }

    // ─── 2. Golden Sizzling Ember Sparks ───
    final emberPaint = Paint()..style = PaintingStyle.fill;

    const int emberCount = 6;
    for (int i = 0; i < emberCount; i++) {
      final seed = i / emberCount;
      final emberPhase = (progress + seed) % 1.0;
      final emberX =
          centerX + math.sin((emberPhase + seed) * 4 * math.pi) * 28 +
              (seed - 0.5) * 40;
      final emberY = (panBaseY + 10) - (emberPhase * 60.0);
      final emberAlpha = ((1.0 - emberPhase) * 0.75).clamp(0.0, 1.0);
      final emberRadius = (1.2 + (seed * 1.2)) * (1.0 - emberPhase * 0.4);

      emberPaint.color = (i % 2 == 0
              ? const Color(0xFFF59E0B)
              : const Color(0xFFD97706))
          .withAlpha((emberAlpha * 255).round());

      canvas.drawCircle(Offset(emberX, emberY), emberRadius, emberPaint);
    }
  }

  @override
  bool shouldRepaint(_CulinaryStageFXPainter oldDelegate) =>
      oldDelegate.progress != progress;
}
