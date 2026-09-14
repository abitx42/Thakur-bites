import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_theme.dart';

/// A "thermal printer" reveal for the order ticket:
/// A dark chai-brown printer bar sits fixed at the top, and the ticket content
/// feeds out progressively from underneath it — clipped with a jagged/perforated
/// edge that travels down as it unspools — before settling with a small overshoot
/// bounce and fading in the action buttons underneath.
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

  const ReceiptPrintReveal({
    super.key,
    required this.receipt,
    required this.actions,
    this.playIntro = true,
    this.onCompleted,
    this.toothWidth = 10,
    this.toothHeight = 4,
  });

  @override
  State<ReceiptPrintReveal> createState() => _ReceiptPrintRevealState();
}

class _ReceiptPrintRevealState extends State<ReceiptPrintReveal>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _reveal; // 0 -> 1, drives the paper feed
  late final Animation<double> _settle; // small bounce once fully out
  late final Animation<double> _actionsIn; // staggered fade+slide for buttons

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );

    _reveal = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.0, 0.75, curve: Curves.easeOutCubic),
    );
    _settle = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.75, 1.0, curve: Curves.easeOutBack),
    );
    _actionsIn = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0.70, 1.0, curve: Curves.easeOut),
    );

    _controller.addStatusListener((status) {
      if (status == AnimationStatus.completed) {
        HapticFeedback.lightImpact();
        widget.onCompleted?.call();
      }
    });

    if (widget.playIntro) {
      Future.delayed(const Duration(milliseconds: 80), () {
        if (mounted) _controller.forward();
      });
    } else {
      _controller.value = 1.0; // skip straight to fully revealed
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // 1. Fixed Printer Head Bar
        const _PrinterBar(),

        // 2. Unspooling Paper with Traveling Perforated Edge & Physical Settle
        AnimatedBuilder(
          animation: _controller,
          builder: (context, child) {
            // Small vertical overshoot as the paper "settles" after feeding.
            final bounce = _settle.value * 5 * (1 - _settle.value);
            return Transform.translate(
              offset: Offset(0, -bounce),
              child: ClipPath(
                clipper: PrintRevealClipper(
                  revealFraction: _reveal.value,
                  toothWidth: widget.toothWidth,
                  toothHeight: widget.toothHeight,
                ),
                child: child,
              ),
            );
          },
          child: widget.receipt,
        ),

        const SizedBox(height: 18),

        // 3. Staggered Fade & Slide-Up for Action Buttons
        FadeTransition(
          opacity: _actionsIn,
          child: AnimatedBuilder(
            animation: _actionsIn,
            builder: (context, child) => Transform.translate(
              offset: Offset(0, (1 - _actionsIn.value) * 16),
              child: child,
            ),
            child: widget.actions,
          ),
        ),
      ],
    );
  }
}

/// Fixed dark chai-brown bar standing in for the printer slot the receipt feeds from.
class _PrinterBar extends StatelessWidget {
  const _PrinterBar();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 32,
      margin: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        borderRadius: AppRadius.radiusPill,
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
      child: Center(
        child: Container(
          height: 3,
          margin: const EdgeInsets.symmetric(horizontal: 24),
          decoration: BoxDecoration(
            color: Colors.black.withAlpha(180),
            borderRadius: BorderRadius.circular(2),
          ),
        ),
      ),
    );
  }
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
