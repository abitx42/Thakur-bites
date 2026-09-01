import 'package:flutter/material.dart';
import '../models/app_version.dart';
import '../theme/app_theme.dart';

class ForceUpdateScreen extends StatelessWidget {
  final AppVersionPolicy policy;
  final VoidCallback? onUpdate;

  const ForceUpdateScreen({
    super.key,
    required this.policy,
    this.onUpdate,
  });

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false, // Strict Non-Dismissible Boundary
      child: Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28.0, vertical: 32.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Spacer(),

                // Security Shield / Update Icon
                Center(
                  child: Container(
                    width: 96,
                    height: 96,
                    decoration: BoxDecoration(
                      color: AppColors.red.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.security_update_good_rounded,
                      color: AppColors.red,
                      size: 48,
                    ),
                  ),
                ),
                const SizedBox(height: 24),

                // Title
                Text(
                  'Update Required',
                  textAlign: TextAlign.center,
                  style: AppFonts.display(
                    fontSize: 32,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 8),

                // Subtitle / Version requirement
                Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: AppColors.line),
                    ),
                    child: Text(
                      'Minimum Required: v${policy.minimumSupportedVersion}',
                      style: AppFonts.mono(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.redDeep,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 20),

                // Message
                Text(
                  policy.message.isNotEmpty
                      ? policy.message
                      : 'To continue using Thakur Bites securely, please update your application to the latest version.',
                  textAlign: TextAlign.center,
                  style: AppFonts.body(
                    fontSize: 15,
                    color: AppColors.inkSoft,
                  ),
                ),

                // Release Notes Card
                if (policy.releaseNotes.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppColors.line),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Key Improvements:',
                          style: AppFonts.body(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: AppColors.ink,
                          ),
                        ),
                        const SizedBox(height: 10),
                        ...policy.releaseNotes.map(
                          (note) => Padding(
                            padding: const EdgeInsets.only(bottom: 6.0),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('🛡️ ', style: TextStyle(fontSize: 12)),
                                Expanded(
                                  child: Text(
                                    note,
                                    style: AppFonts.body(
                                      fontSize: 13,
                                      color: AppColors.ink,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],

                const Spacer(),

                // Action Button
                ElevatedButton(
                  onPressed: onUpdate ?? () {},
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.red,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    elevation: 2,
                  ),
                  child: Text(
                    'Update Thakur Bites',
                    style: AppFonts.body(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
