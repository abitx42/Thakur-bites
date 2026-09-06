import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../theme/app_theme.dart';

/// Platform 2.0 — Google-Only Universal Login Sheet
/// Streamlined: Instant Google Sign-In + Automatic Backend Role Classification
class LoginSheet extends StatefulWidget {
  final VoidCallback? onGuestBrowse;

  const LoginSheet({super.key, this.onGuestBrowse});

  static Future<void> show(BuildContext context, {VoidCallback? onGuestBrowse}) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => LoginSheet(onGuestBrowse: onGuestBrowse),
    );
  }

  @override
  State<LoginSheet> createState() => _LoginSheetState();
}

class _LoginSheetState extends State<LoginSheet> {
  bool _isSubmitting = false;

  Future<void> _handleGoogleSignIn() async {
    if (_isSubmitting) return;
    setState(() => _isSubmitting = true);
    HapticFeedback.mediumImpact();

    try {
      final auth = context.read<AuthProvider>();
      await auth.signInWithGoogle();

      if (mounted) {
        Navigator.of(context).pop();
        final name = auth.currentProfile?.displayName ?? 'Customer';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Welcome back, $name! 👋'),
            backgroundColor: AppColors.green,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSubmitting = false);
        final errMsg = e.toString().replaceAll('Exception:', '').trim();
        // If web redirected, do not show error banner
        if (!errMsg.toLowerCase().contains('redirect')) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Google Sign-In: $errMsg'),
              backgroundColor: AppColors.red,
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
          );
        }
      }
    }
  }

  void _handleGuestBrowse() {
    HapticFeedback.lightImpact();
    final auth = context.read<AuthProvider>();
    auth.enableGuestBrowsing();

    if (mounted) {
      Navigator.of(context).pop();
      widget.onGuestBrowse?.call();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Browsing as Guest 🍽️ — Sign in anytime to order!'),
          backgroundColor: AppColors.inkSoft,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 14,
        bottom: 24 + bottomInset,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Drag Handle
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.line,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 18),

          // Header Title & Tagline
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.red.withAlpha(25),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text('🍱', style: TextStyle(fontSize: 24)),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('THAKUR BITES', style: AppFonts.display(fontSize: 22)),
                  Text(
                    'Campus Dining & Quick Pickup',
                    style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 18),

          Text(
            'Sign in with your Google account to place orders, access student priority queuing, and view past order tickets.',
            style: AppFonts.body(fontSize: 13, color: AppColors.inkSoft),
          ),
          const SizedBox(height: 20),

          // Google Sign-In Button
          ElevatedButton(
            onPressed: _isSubmitting ? null : _handleGoogleSignIn,
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: AppColors.ink,
              elevation: 1.5,
              side: const BorderSide(color: AppColors.line, width: 1.5),
              padding: const EdgeInsets.symmetric(vertical: 15),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            child: _isSubmitting
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.red),
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Image.network(
                        'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg',
                        width: 22,
                        height: 22,
                        errorBuilder: (context, error, stackTrace) =>
                            const Icon(Icons.account_circle, color: Colors.blue, size: 22),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        'Continue with Google',
                        style: AppFonts.body(fontSize: 15.5, fontWeight: FontWeight.w700, color: AppColors.ink),
                      ),
                    ],
                  ),
          ),
          const SizedBox(height: 16),

          // Account Type Guidance Card
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.surface2,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.line, width: 1),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '✨ How accounts are handled:',
                  style: AppFonts.body(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.ink),
                ),
                const SizedBox(height: 6),
                _buildDomainRow('🎓', '@tcetmumbai.in', 'Student Priority Queue & Verified Profile'),
                const SizedBox(height: 4),
                _buildDomainRow('👨‍🏫', '@thakureducation.org', 'Faculty / Staff Verification Workflow'),
                const SizedBox(height: 4),
                _buildDomainRow('👤', 'Gmail / Other', 'Guest Visitor Ordering (no password needed)'),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Divider
          Row(
            children: [
              const Expanded(child: Divider(color: AppColors.line)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text('OR', style: AppFonts.mono(fontSize: 11, color: AppColors.inkSoft)),
              ),
              const Expanded(child: Divider(color: AppColors.line)),
            ],
          ),
          const SizedBox(height: 14),

          // Guest Browse Action
          OutlinedButton.icon(
            onPressed: _handleGuestBrowse,
            icon: const Icon(Icons.remove_red_eye_outlined, size: 18, color: AppColors.ink),
            label: Text(
              'Browse Menu as Guest',
              style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.ink),
            ),
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: AppColors.line, width: 1.5),
              padding: const EdgeInsets.symmetric(vertical: 13),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDomainRow(String emoji, String domain, String description) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(emoji, style: const TextStyle(fontSize: 12)),
        const SizedBox(width: 8),
        Expanded(
          child: RichText(
            text: TextSpan(
              style: AppFonts.body(fontSize: 11.5, color: AppColors.inkSoft, height: 1.3),
              children: [
                TextSpan(
                  text: '$domain → ',
                  style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink),
                ),
                TextSpan(text: description),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
