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
      backgroundColor: const Color(0xFFF8F9FC),
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
                        ? const Color(0xFFFFEBEE)
                        : const Color(0xFFFFF3E0),
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: (isCritical ? Colors.red : Colors.orange).withOpacity(0.15),
                        blurRadius: 20,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: Icon(
                    isCritical ? Icons.gpp_bad_rounded : Icons.security_rounded,
                    size: 52,
                    color: isCritical ? const Color(0xFFD32F2F) : const Color(0xFFE65100),
                  ),
                ),
                const SizedBox(height: 28),
                Text(
                  isCritical ? 'Integrity Protection Alert' : 'Security Mode Required',
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.5,
                    color: Color(0xFF1E293B),
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  isCritical
                      ? 'Unauthorized system modifications or tampered application environment detected. For the safety of campus financial transactions, ordering has been restricted on this device.'
                      : 'Developer Options or USB Debugging is currently active on your device. To ensure payment integrity and prevent memory tampering, please turn off Developer Options to continue.',
                  style: const TextStyle(
                    fontSize: 15,
                    height: 1.5,
                    color: Color(0xFF64748B),
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                if (!isCritical) ...[
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.03),
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
                        const Divider(height: 24, color: Color(0xFFF1F5F9)),
                        _buildStepItem(
                          stepNumber: '2',
                          title: 'Turn Off Developer Options',
                          subtitle: 'Toggle the switch at the top to Off.',
                        ),
                        const Divider(height: 24, color: Color(0xFFF1F5F9)),
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
                      label: const Text(
                        'Open Device Settings',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.red,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
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
                          : const Icon(Icons.refresh_rounded, color: Color(0xFF1E293B)),
                      label: Text(
                        securityService.isChecking ? 'Verifying...' : 'Re-check Security',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF1E293B),
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Color(0xFFCBD5E1), width: 1.5),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                    ),
                  ),
                ] else ...[
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF2F2),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFFECACA)),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.contact_support_outlined, color: Color(0xFFDC2626)),
                        SizedBox(width: 14),
                        Expanded(
                          child: Text(
                            'If you believe this is in error, please visit the canteen management counter or contact support with your Device ID.',
                            style: TextStyle(
                              fontSize: 14,
                              height: 1.4,
                              color: Color(0xFF991B1B),
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
            color: AppColors.red.withOpacity(0.12),
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              stepNumber,
              style: TextStyle(
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
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                  color: Color(0xFF1E293B),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(
                  fontSize: 13,
                  color: Color(0xFF64748B),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
