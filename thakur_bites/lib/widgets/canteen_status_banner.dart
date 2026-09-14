import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/canteen_operational_status.dart';
import '../theme/app_theme.dart';

/// Warm, polite banner displayed when the canteen operational status is
/// DEGRADED, EMERGENCY_HALT, or FINANCIAL_FROZEN.
class CanteenStatusBanner extends StatelessWidget {
  final CanteenOperationalStatus status;
  final EdgeInsetsGeometry? margin;
  final VoidCallback? onTap;

  const CanteenStatusBanner({
    super.key,
    required this.status,
    this.margin,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    if (status.isNormal) return const SizedBox.shrink();

    return Container(
      margin: margin ?? const EdgeInsets.fromLTRB(18, 10, 18, 6),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.lightImpact();
            if (onTap != null) {
              onTap!();
            } else {
              showCanteenStatusSheet(context, status);
            }
          },
          borderRadius: BorderRadius.circular(12),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.amberBg,
              border: Border.all(color: AppColors.amberBorder, width: 1.2),
              borderRadius: BorderRadius.circular(12),
              boxShadow: [
                BoxShadow(
                  color: AppColors.ink.withValues(alpha: 0.05),
                  blurRadius: 6,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: const BoxDecoration(
                    color: AppColors.warningBg,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Icon(
                      status.isHalted
                          ? Icons.block_rounded
                          : Icons.pause_circle_filled_rounded,
                      size: 20,
                      color: AppColors.warning,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        status.bannerTitle,
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.chai,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        status.bannerMessage,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppFonts.body(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w500,
                          color: AppColors.mustardInk,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.warningBg,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppColors.amberBorder, width: 0.8),
                  ),
                  child: Text(
                    'Info',
                    style: AppFonts.mono(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.chai,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Displays a warm, user-friendly bottom sheet explaining that canteen online
/// ordering is temporarily paused or halted, guiding students to the counter.
void showCanteenStatusSheet(
  BuildContext context,
  CanteenOperationalStatus status, {
  String? customMessage,
}) {
  HapticFeedback.lightImpact();

  showModalBottomSheet(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (ctx) => Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: const EdgeInsets.fromLTRB(22, 16, 22, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Drag handle
          Center(
            child: Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.line,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 18),

          // Header icon + title
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: const BoxDecoration(
                  color: AppColors.warningBg,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Icon(
                    status.isHalted
                        ? Icons.storefront_outlined
                        : Icons.pause_circle_outline_rounded,
                    color: AppColors.warning,
                    size: 28,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      status.modalTitle,
                      style: AppFonts.display(fontSize: 20),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      status.modalSubtitle,
                      style: AppFonts.body(
                        fontSize: 12.5,
                        color: AppColors.inkSoft,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Warm explanatory card
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.amberBg,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.amberBorder, width: 1),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Text('🙏', style: TextStyle(fontSize: 16)),
                    const SizedBox(width: 8),
                    Text(
                      'Sorry for the Inconvenience!',
                      style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.chai,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  customMessage != null && customMessage.isNotEmpty
                      ? customMessage
                      : status.modalDescription,
                  style: AppFonts.body(
                    fontSize: 13,
                    height: 1.45,
                    color: AppColors.chai,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),

          // Action button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => Navigator.of(ctx).pop(),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.ink,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                elevation: 0,
              ),
              child: Text(
                'Understood',
                style: AppFonts.body(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
