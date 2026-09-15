import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// A culinary live status card displayed underneath the thermal receipt on the ticket screen.
/// Features the animated chef with a harmonious Chai-Sandstone ambient stage,
/// animated rising steam wisps, dynamic live status ticker, and sizzling heat gauge.
class ChefCookingCard extends StatefulWidget {
  const ChefCookingCard({super.key});

  @override
  State<ChefCookingCard> createState() => _ChefCookingCardState();
}

class _ChefCookingCardState extends State<ChefCookingCard>
    with TickerProviderStateMixin {
  late final AnimationController _pulseController;
  late final Animation<double> _pulseAnim;
  late final AnimationController _steamController;
  late final AnimationController _shimmerController;

  Timer? _stepTimer;
  int _stepIndex = 0;

  static const List<Map<String, String>> _cookingSteps = [
    {
      'title': 'Your order will be cooked soon by our masterchefs!',
      'subtitle': 'TCET Central Kitchen received your ticket. Watch live status update automatically.',
      'badge': 'Station: Kitchen Queue 🍳',
      'progress': '0.40',
    },
    {
      'title': 'Chef is seasoning and firing the pan on Counter!',
      'subtitle': 'Fresh batter poured on sizzling tawa with pure Amul butter & fresh herbs.',
      'badge': 'Station: Hot Pan Sizzling 🔥',
      'progress': '0.70',
    },
    {
      'title': 'Garnishing crisp dishes & pouring piping hot chai!',
      'subtitle': 'Quality inspection check passed. Assembling fresh sides & chutneys.',
      'badge': 'Station: Plating & Garnish ✨',
      'progress': '0.92',
    },
  ];

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);

    _pulseAnim = Tween<double>(begin: 0.85, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _steamController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    )..repeat();

    _shimmerController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat();

    _stepTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (mounted) {
        setState(() {
          _stepIndex = (_stepIndex + 1) % _cookingSteps.length;
        });
      }
    });
  }

  @override
  void dispose() {
    _stepTimer?.cancel();
    _pulseController.dispose();
    _steamController.dispose();
    _shimmerController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final currentStep = _cookingSteps[_stepIndex];
    final progressVal = double.tryParse(currentStep['progress'] ?? '0.40') ?? 0.40;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 18),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDF9),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFEADBCE),
          width: 1.5,
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F3B281C),
            blurRadius: 18,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        children: [
          // ─── Header: Live Dispatch & Station Chip ───
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  AnimatedBuilder(
                    animation: _pulseAnim,
                    builder: (context, _) => Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.green,
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.green
                                .withAlpha((180 * _pulseAnim.value).toInt()),
                            blurRadius: 6 * _pulseAnim.value,
                            spreadRadius: 1 * _pulseAnim.value,
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 7),
                  Text(
                    'LIVE KITCHEN DISPATCH',
                    style: AppFonts.mono(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.greenInk,
                      letterSpacing: 1.0,
                    ),
                  ),
                ],
              ),
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 300),
                child: Container(
                  key: ValueKey<String>(currentStep['badge'] ?? ''),
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF3C7),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: const Color(0xFFFDE68A), width: 1),
                  ),
                  child: Text(
                    currentStep['badge'] ?? 'Hot Pan 🍳',
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

          // ─── Masterchef Visual Stage (Ambient Radial Stage) ───
          Container(
            height: 175,
            width: double.infinity,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Color(0xFFFFFDF8),
                  Color(0xFFFAF3E8),
                  Color(0xFFF5EADB),
                ],
              ),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: const Color(0xFFEBDCCF),
                width: 1,
              ),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x08000000),
                  blurRadius: 8,
                  offset: Offset(0, 2),
                ),
              ],
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              alignment: Alignment.center,
              children: [
                // Ambient Kitchen Warm Glow Spotlight
                Positioned(
                  top: -20,
                  child: Container(
                    width: 180,
                    height: 120,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: RadialGradient(
                        colors: [
                          const Color(0xFFFDE68A).withAlpha(90),
                          Colors.transparent,
                        ],
                      ),
                    ),
                  ),
                ),

                // Countertop Pedestal Gradient
                Positioned(
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 35,
                  child: Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.transparent,
                          Color(0x2078350F),
                        ],
                      ),
                    ),
                  ),
                ),

                // Masterchef GIF with Rounded Mask & Shadow
                Positioned(
                  top: 10,
                  bottom: 28,
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

                // Rising Steam Particle Wisps Overlay
                Positioned.fill(
                  child: AnimatedBuilder(
                    animation: _steamController,
                    builder: (context, _) => CustomPaint(
                      painter: _RisingSteamPainter(_steamController.value),
                    ),
                  ),
                ),

                // Live Sizzle Heat Gauge / Queue Progress
                Positioned(
                  bottom: 8,
                  left: 16,
                  right: 16,
                  child: Column(
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
                              letterSpacing: 0.5,
                            ),
                          ),
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 300),
                            child: Text(
                              '${(progressVal * 100).toInt()}% READY',
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
                      const SizedBox(height: 3),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: Container(
                          height: 5,
                          width: double.infinity,
                          color: const Color(0xFFE5D7C5),
                          child: Stack(
                            children: [
                              TweenAnimationBuilder<double>(
                                tween: Tween<double>(begin: 0.35, end: progressVal),
                                duration: const Duration(milliseconds: 600),
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
                                  final shimmerPos = _shimmerController.value * 2.0 - 1.0;
                                  return Align(
                                    alignment: Alignment(shimmerPos, 0),
                                    child: Container(
                                      width: 40,
                                      height: double.infinity,
                                      decoration: BoxDecoration(
                                        gradient: LinearGradient(
                                          colors: [
                                            Colors.white.withAlpha(0),
                                            Colors.white.withAlpha(153),
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
                ),
              ],
            ),
          ),

          const SizedBox(height: 14),

          // ─── Dynamic Chef Announcement Typography (Animated Switcher) ───
          AnimatedSwitcher(
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
              children: [
                Text(
                  currentStep['title'] ?? '',
                  textAlign: TextAlign.center,
                  style: AppFonts.display(
                    fontSize: 17,
                    color: AppColors.chai,
                    letterSpacing: 0.3,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  currentStep['subtitle'] ?? '',
                  textAlign: TextAlign.center,
                  style: AppFonts.body(
                    fontSize: 11.5,
                    color: AppColors.inkSoft,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 10),

          // ─── Step Ticker Indicator Dots ───
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(_cookingSteps.length, (idx) {
              final isCurrent = idx == _stepIndex;
              return AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                margin: const EdgeInsets.symmetric(horizontal: 2.5),
                width: isCurrent ? 14 : 5,
                height: 5,
                decoration: BoxDecoration(
                  color: isCurrent ? const Color(0xFFD97706) : const Color(0xFFD6C7B2),
                  borderRadius: BorderRadius.circular(999),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }
}

/// Animated rising steam particles waving gently upwards from the cooking pot
class _RisingSteamPainter extends CustomPainter {
  final double progress;

  const _RisingSteamPainter(this.progress);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0
      ..strokeCap = StrokeCap.round;

    final centerX = size.width / 2;
    final bottomY = size.height * 0.42;

    for (int i = 0; i < 3; i++) {
      final offsetX = (i - 1) * 20.0;
      final phase = (progress + i * 0.33) % 1.0;
      final startY = bottomY - (phase * 34.0);
      final alpha = ((1.0 - phase) * 0.40).clamp(0.0, 1.0);

      paint.color = const Color(0xFFD97706).withAlpha((alpha * 255).round());

      final path = Path();
      path.moveTo(centerX + offsetX, startY + 16);
      path.quadraticBezierTo(
        centerX + offsetX + math.sin(phase * 2 * math.pi) * 7,
        startY + 8,
        centerX + offsetX,
        startY,
      );
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_RisingSteamPainter oldDelegate) =>
      oldDelegate.progress != progress;
}
