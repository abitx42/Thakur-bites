import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../theme/app_theme.dart';

/// Active anti-screenshot, live-watermarked scannable pickup QR badge.
/// Renders a dynamic breathing radar halo and live seconds heartbeat
/// so counter staff can instantly distinguish authentic live tickets from static screenshots.
class LiveSecurityQrBadge extends StatefulWidget {
  final String qrData;
  final bool isReady;
  final double size;
  final String? tokenNumber;

  const LiveSecurityQrBadge({
    super.key,
    required this.qrData,
    required this.isReady,
    this.size = 110,
    this.tokenNumber,
  });

  @override
  State<LiveSecurityQrBadge> createState() => _LiveSecurityQrBadgeState();
}

class _LiveSecurityQrBadgeState extends State<LiveSecurityQrBadge>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;
  Timer? _secondTimer;
  int _currentSeconds = 0;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);

    _pulseAnimation = CurvedAnimation(
      parent: _pulseController,
      curve: Curves.easeInOut,
    );

    _currentSeconds = DateTime.now().second;
    _secondTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() {
          _currentSeconds = DateTime.now().second;
        });
      }
    });
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _secondTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isReady) {
      return Container(
        width: widget.size,
        height: widget.size,
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: AppColors.surface2,
          border: Border.all(color: AppColors.line, width: 1.5),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.lock_clock_rounded, color: AppColors.inkSoft, size: 32),
            const SizedBox(height: 4),
            Text(
              'QR Locked',
              textAlign: TextAlign.center,
              style: AppFonts.mono(
                fontSize: 9.5,
                fontWeight: FontWeight.w700,
                color: AppColors.inkSoft,
              ),
            ),
          ],
        ),
      );
    }

    return GestureDetector(
      onTap: () {
        HapticFeedback.lightImpact();
      },
      child: AnimatedBuilder(
        animation: _pulseAnimation,
        builder: (context, child) {
          final glowOpacity = 0.25 + (_pulseAnimation.value * 0.35);
          final borderWidth = 1.8 + (_pulseAnimation.value * 0.8);

          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Dynamic Pulsing Halo Container
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: AppColors.green.withAlpha(((0.6 + (_pulseAnimation.value * 0.4)) * 255).round()),
                    width: borderWidth,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.green.withAlpha((glowOpacity * 255).round()),
                      blurRadius: 10 + (_pulseAnimation.value * 8),
                      spreadRadius: 1 + (_pulseAnimation.value * 2),
                    ),
                  ],
                ),
                child: QrImageView(
                  data: widget.qrData,
                  version: QrVersions.auto,
                  size: widget.size,
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

              const SizedBox(height: 8),

              // Live Security Watermark Beacon (Anti-Screenshot verification)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.green.withAlpha(25),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: AppColors.green.withAlpha(75),
                    width: 1,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Pulsing green radar dot
                    Container(
                      width: 6.5,
                      height: 6.5,
                      decoration: BoxDecoration(
                        color: AppColors.green,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.green.withAlpha((glowOpacity * 255).round()),
                            blurRadius: 4,
                            spreadRadius: 1,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'LIVE PASS • :${_currentSeconds.toString().padLeft(2, '0')}',
                      style: AppFonts.mono(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.greenInk,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
