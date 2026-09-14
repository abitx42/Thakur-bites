import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/device_security_service.dart';
import '../theme/app_theme.dart';

class SecurityEnforcementScreen extends StatelessWidget {
  const SecurityEnforcementScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final securityService = Provider.of<DeviceSecurityService>(context);
    final isCritical = securityService.isCriticalTamperDetected;

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28.0, vertical: 32.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(
                    color: isCritical
                        ? AppColors.dangerBg
                        : AppColors.warningBg,
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: (isCritical ? AppColors.danger : AppColors.warning).withValues(alpha: 0.15),
                        blurRadius: 20,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: Icon(
                    isCritical ? Icons.gpp_bad_rounded : Icons.security_rounded,
                    size: 52,
                    color: isCritical ? AppColors.danger : AppColors.warning,
                  ),
                ),
                const SizedBox(height: 28),
                Text(
                  isCritical ? 'Integrity Protection Alert' : 'Security Mode Required',
                  style: AppFonts.display(
                    fontSize: 24,
                    letterSpacing: -0.5,
                    color: AppColors.ink,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  isCritical
                      ? 'Unauthorized system modifications or tampered application environment detected. For the safety of campus financial transactions, ordering has been restricted on this device.'
                      : 'Developer Options or USB Debugging is currently active on your device. To ensure payment integrity and prevent memory tampering, please turn off Developer Options to continue.',
                  style: AppFonts.body(
                    fontSize: 15,
                    height: 1.5,
                    color: AppColors.inkSecondary,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                if (!isCritical) ...[
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: AppRadius.radiusLg,
                      border: Border.all(color: AppColors.line),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.ink.withValues(alpha: 0.03),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      children: [
                        _buildStepItem(
                          stepNumber: '1',
                          title: 'Open Settings',
                          subtitle: 'Tap the button below to jump straight to Developer Settings.',
                        ),
                        const Divider(height: 24, color: AppColors.line),
                        _buildStepItem(
                          stepNumber: '2',
                          title: 'Turn Off Developer Options',
                          subtitle: 'Toggle the switch at the top to Off.',
                        ),
                        const Divider(height: 24, color: AppColors.line),
                        _buildStepItem(
                          stepNumber: '3',
                          title: 'Return & Verify',
                          subtitle: 'Come back to Thakur Bites and tap Re-check Security.',
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 32),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton.icon(
                      onPressed: () async {
                        await securityService.openDeveloperSettings();
                      },
                      icon: const Icon(Icons.settings_outlined, color: Colors.white),
                      label: Text(
                        'Open Device Settings',
                        style: AppFonts.body(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.red,
                        shape: RoundedRectangleBorder(
                          borderRadius: AppRadius.radiusMd,
                        ),
                        elevation: 0,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: OutlinedButton.icon(
                      onPressed: securityService.isChecking
                          ? null
                          : () async {
                              await securityService.checkSecurityPosture();
                            },
                      icon: securityService.isChecking
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.refresh_rounded, color: AppColors.ink),
                      label: Text(
                        securityService.isChecking ? 'Verifying...' : 'Re-check Security',
                        style: AppFonts.body(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: AppColors.mutedBorder, width: 1.5),
                        shape: RoundedRectangleBorder(
                          borderRadius: AppRadius.radiusMd,
                        ),
                      ),
                    ),
                  ),
                ] else ...[
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: AppColors.dangerBg,
                      borderRadius: AppRadius.radiusLg,
                      border: Border.all(color: AppColors.redSoft),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.contact_support_outlined, color: AppColors.danger),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Text(
                            'If you believe this is in error, please visit the canteen management counter or contact support with your Device ID.',
                            style: AppFonts.body(
                              fontSize: 14,
                              height: 1.4,
                              color: AppColors.redDeep,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStepItem({
    required String stepNumber,
    required String title,
    required String subtitle,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: AppColors.red.withValues(alpha: 0.12),
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              stepNumber,
              style: AppFonts.body(
                fontWeight: FontWeight.w800,
                fontSize: 14,
                color: AppColors.red,
              ),
            ),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: AppFonts.body(
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: AppFonts.body(
                  fontSize: 13,
                  color: AppColors.inkSecondary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
