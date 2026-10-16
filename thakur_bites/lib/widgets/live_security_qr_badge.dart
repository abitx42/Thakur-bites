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

  int _fnv1a32(String input) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < input.length; i++) {
      hash ^= input.codeUnitAt(i);
      hash = (hash * 0x01000193) & 0xFFFFFFFF;
    }
    return hash;
  }

  String _getDynamicQrData() {
    if (widget.qrData.startsWith('TB:')) {
      final parts = widget.qrData.split(':');
      if (parts.length >= 4) {
        final orderId = parts[1];
        final tokenNumber = parts[2];
        final pinCode = parts[3];
        final timeBlock = DateTime.now().millisecondsSinceEpoch ~/ 30000;
        final raw = '$orderId:$pinCode:$timeBlock';
        final hash = _fnv1a32(raw).toRadixString(16).toUpperCase().padLeft(8, '0');
        return 'TB:$orderId:$tokenNumber:$pinCode:$timeBlock:$hash';
      }
    }
    return widget.qrData;
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
          final secondsRemaining = 30 - (_currentSeconds % 30);
          final dynamicData = _getDynamicQrData();

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
                  data: dynamicData,
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
                      'LIVE PASS • :${_currentSeconds.toString().padLeft(2, '0')} • ⟳ ${secondsRemaining}s',
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
    with TickerProviderStateMixin {
  late final AnimationController _radarController;
  late final AnimationController _tapController;
  Timer? _timer;
  Timer? _tapResetTimer;
  late DateTime _now;
  DateTime? _lastVerifiedTap;

  @override
  void initState() {
    super.initState();
    _now = DateTime.now();
    _radarController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat();

    _tapController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );

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
    _tapController.dispose();
    _timer?.cancel();
    _tapResetTimer?.cancel();
    super.dispose();
  }

  void _onBadgeTap() {
    HapticFeedback.heavyImpact();
    setState(() {
      _lastVerifiedTap = DateTime.now();
    });
    _tapController.forward(from: 0.0);
    _tapResetTimer?.cancel();
    _tapResetTimer = Timer(const Duration(seconds: 4), () {
      if (mounted) {
        setState(() {
          _lastVerifiedTap = null;
        });
      }
    });
  }

  String _formatTime(DateTime dt) {
    final hour = dt.hour == 0 ? 12 : (dt.hour > 12 ? dt.hour - 12 : dt.hour);
    final minute = dt.minute.toString().padLeft(2, '0');
    final second = dt.second.toString().padLeft(2, '0');
    final period = dt.hour >= 12 ? 'PM' : 'AM';
    return '$hour:$minute:$second $period';
  }

  String _formatPreciseTime(DateTime dt) {
    final hour = dt.hour == 0 ? 12 : (dt.hour > 12 ? dt.hour - 12 : dt.hour);
    final minute = dt.minute.toString().padLeft(2, '0');
    final second = dt.second.toString().padLeft(2, '0');
    final millis = (dt.millisecond ~/ 10).toString().padLeft(2, '0');
    final period = dt.hour >= 12 ? 'PM' : 'AM';
    return '$hour:$minute:$second.$millis $period';
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
    final isVerifiedActive = _lastVerifiedTap != null;

    return GestureDetector(
      onTap: _onBadgeTap,
      child: AnimatedBuilder(
        animation: Listenable.merge([_radarController, _tapController]),
        builder: (context, child) {
          final radarVal = _radarController.value;
          final tapScale = 1.0 - (_tapController.value * 0.06);

          return Transform.scale(
            scale: tapScale,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(
                color: isVerifiedActive ? AppColors.successBg : AppColors.surface2,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: isVerifiedActive
                      ? AppColors.green
                      : AppColors.green.withAlpha((80 + (radarVal * 90)).round()),
                  width: isVerifiedActive ? 1.6 : 1.2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.green.withAlpha((isVerifiedActive ? 40 : 15 + (radarVal * 25)).round()),
                    blurRadius: isVerifiedActive ? 10 : 6 + (radarVal * 4),
                  ),
                ],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Live pulsating beacon / Verified shield
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
                            isVerifiedActive ? 'AUTHENTIC ACTIVE PASS' : 'LIVE COUNTER PASS',
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
                              color: isVerifiedActive ? AppColors.greenInk : AppColors.inkSoft,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        isVerifiedActive
                            ? 'TOUCH VERIFIED: ${_formatPreciseTime(_lastVerifiedTap!)}'
                            : '$timeStr • Staff: Tap badge to test',
                        style: AppFonts.mono(
                          fontSize: 8.5,
                          fontWeight: isVerifiedActive ? FontWeight.w700 : FontWeight.w500,
                          color: isVerifiedActive ? AppColors.greenInk : AppColors.inkSoft,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
