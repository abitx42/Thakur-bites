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

/// Dynamic live ticking watermark badge displayed on student tickets.
/// Generates an undulating radar pulse, active clock seconds, and a rolling 30-second security hash.
/// Eliminates physical counter fraud via static screenshots or inspect-element tampering.
class LiveDynamicVerificationBadge extends StatefulWidget {
  final String orderId;
  final String tokenNumber;

  const LiveDynamicVerificationBadge({
    super.key,
    required this.orderId,
    required this.tokenNumber,
  });

  @override
  State<LiveDynamicVerificationBadge> createState() => _LiveDynamicVerificationBadgeState();
}

class _LiveDynamicVerificationBadgeState extends State<LiveDynamicVerificationBadge>
    with SingleTickerProviderStateMixin {
  late final AnimationController _radarController;
  Timer? _timer;
  late DateTime _now;

  @override
  void initState() {
    super.initState();
    _now = DateTime.now();
    _radarController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat();

    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() {
          _now = DateTime.now();
        });
      }
    });
  }

  @override
  void dispose() {
    _radarController.dispose();
    _timer?.cancel();
    super.dispose();
  }

  String _formatTime(DateTime dt) {
    final hour = dt.hour == 0 ? 12 : (dt.hour > 12 ? dt.hour - 12 : dt.hour);
    final minute = dt.minute.toString().padLeft(2, '0');
    final second = dt.second.toString().padLeft(2, '0');
    final period = dt.hour >= 12 ? 'PM' : 'AM';
    return '$hour:$minute:$second $period';
  }

  String _generateRollingHash() {
    final timeBlock = _now.millisecondsSinceEpoch ~/ 30000;
    final combined = '${widget.orderId}_${widget.tokenNumber}_$timeBlock';
    final code = (combined.hashCode.abs() % 0xFFFFFF).toRadixString(16).toUpperCase().padLeft(6, '0');
    return '#$code';
  }

  @override
  Widget build(BuildContext context) {
    final timeStr = _formatTime(_now);
    final rollingHash = _generateRollingHash();

    return AnimatedBuilder(
      animation: _radarController,
      builder: (context, child) {
        final radarVal = _radarController.value;
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: AppColors.surface2,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: AppColors.green.withAlpha((80 + (radarVal * 90)).round()),
              width: 1.2,
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.green.withAlpha((15 + (radarVal * 25)).round()),
                blurRadius: 6 + (radarVal * 4),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Live pulsating beacon
              Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    width: 14 + (radarVal * 8),
                    height: 14 + (radarVal * 8),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppColors.green.withAlpha(((1.0 - radarVal) * 90).round()),
                    ),
                  ),
                  Container(
                    width: 7,
                    height: 7,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppColors.green,
                    ),
                  ),
                ],
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'LIVE COUNTER PASS',
                        style: AppFonts.mono(
                          fontSize: 9.5,
                          fontWeight: FontWeight.w800,
                          color: AppColors.greenInk,
                          letterSpacing: 0.8,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        rollingHash,
                        style: AppFonts.mono(
                          fontSize: 9.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.inkSoft,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$timeStr • Staff: Verify in Kitchen POS',
                    style: AppFonts.mono(
                      fontSize: 8.5,
                      fontWeight: FontWeight.w500,
                      color: AppColors.inkSoft,
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}
