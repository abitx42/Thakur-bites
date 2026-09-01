import 'package:flutter/material.dart';
import '../models/app_version.dart';
import '../theme/app_theme.dart';

class UpdateDialog extends StatelessWidget {
  final AppVersionPolicy policy;
  final VoidCallback? onUpdate;
  final VoidCallback? onLater;

  const UpdateDialog({
    super.key,
    required this.policy,
    this.onUpdate,
    this.onLater,
  });

  static Future<void> show(
    BuildContext context, {
    required AppVersionPolicy policy,
    VoidCallback? onUpdate,
    VoidCallback? onLater,
  }) {
    return showDialog(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => UpdateDialog(
        policy: policy,
        onUpdate: onUpdate,
        onLater: onLater,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      backgroundColor: AppColors.surface,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header Icon with Badge
            Center(
              child: Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: AppColors.mustardSoft,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.system_update_rounded,
                  color: AppColors.mustardInk,
                  size: 32,
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Title
            Text(
              'Update Available!',
              textAlign: TextAlign.center,
              style: AppFonts.display(
                fontSize: 26,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 6),

            // Version Tag
            Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.surface2,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.line),
                ),
                child: Text(
                  'Version ${policy.latestVersion}',
                  style: AppFonts.mono(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.mustardInk,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 14),

            // Message
            Text(
              policy.message,
              textAlign: TextAlign.center,
              style: AppFonts.body(
                fontSize: 14,
                color: AppColors.inkSoft,
              ),
            ),

            // Release Notes
            if (policy.releaseNotes.isNotEmpty) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.surface2,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.line),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "What's New:",
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ...policy.releaseNotes.map(
                      (note) => Padding(
                        padding: const EdgeInsets.only(bottom: 4.0),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('• ', style: TextStyle(color: AppColors.mustardInk, fontWeight: FontWeight.bold)),
                            Expanded(
                              child: Text(
                                note,
                                style: AppFonts.body(
                                  fontSize: 12,
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

            const SizedBox(height: 24),

            // Buttons
            ElevatedButton(
              onPressed: () {
                Navigator.of(context).pop();
                if (onUpdate != null) {
                  onUpdate!();
                }
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.red,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                elevation: 0,
              ),
              child: Text(
                'Update Now',
                style: AppFonts.body(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () {
                Navigator.of(context).pop();
                if (onLater != null) {
                  onLater!();
                }
              },
              child: Text(
                'Maybe Later',
                style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.inkSoft,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
