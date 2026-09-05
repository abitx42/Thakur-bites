import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../theme/app_theme.dart';

/// Platform 2.0 — Universal Login & Identity Sheet
/// Features: Google Sign-In, TCET Institutional Email Auth, Instant Fast Login, and Guest Browsing.
class LoginSheet extends StatefulWidget {
  const LoginSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const LoginSheet(),
    );
  }

  @override
  State<LoginSheet> createState() => _LoginSheetState();
}

class _LoginSheetState extends State<LoginSheet> {
  int _selectedTab = 0; // 0 = Google / Quick, 1 = Institutional Email, 2 = Fast Roll No
  final _emailFormKey = GlobalKey<FormState>();
  final _rollFormKey = GlobalKey<FormState>();

  // Email Account controllers
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _nameEmailController = TextEditingController();
  final _phoneEmailController = TextEditingController();
  final _rollEmailController = TextEditingController();
  bool _isSignUpMode = false;

  // Instant Fast Login controllers
  final _nameController = TextEditingController();
  final _rollController = TextEditingController();
  final _phoneController = TextEditingController();

  bool _isSubmitting = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _nameEmailController.dispose();
    _phoneEmailController.dispose();
    _rollEmailController.dispose();
    _nameController.dispose();
    _rollController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Google Sign-In: ${e.toString().replaceAll('Exception:', '').trim()}'),
            backgroundColor: AppColors.red,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
      }
    }
  }

  Future<void> _handleGuestBrowse() async {
    if (_isSubmitting) return;
    setState(() => _isSubmitting = true);
    HapticFeedback.lightImpact();

    try {
      final auth = context.read<AuthProvider>();
      await auth.signInAsGuest();

      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Browsing as Guest 🍽️ — Sign in anytime to order!'),
            backgroundColor: AppColors.inkSoft,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  Future<void> _submitEmailAuth() async {
    if (!_emailFormKey.currentState!.validate()) return;
    if (_isSubmitting) return;

    setState(() => _isSubmitting = true);
    HapticFeedback.mediumImpact();

    try {
      final auth = context.read<AuthProvider>();
      if (_isSignUpMode) {
        await auth.signUpWithEmail(
          email: _emailController.text.trim(),
          password: _passwordController.text,
          name: _nameEmailController.text.trim(),
          phone: _phoneEmailController.text.trim(),
          rollNo: _rollEmailController.text.trim().toUpperCase(),
        );
      } else {
        await auth.signInWithEmail(
          email: _emailController.text.trim(),
          password: _passwordController.text,
        );
      }

      if (mounted) {
        Navigator.of(context).pop();
        final name = auth.currentProfile?.displayName ?? 'Student';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Welcome, $name! 👋'),
            backgroundColor: AppColors.green,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSubmitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString().replaceAll('Exception:', '').trim()),
            backgroundColor: AppColors.red,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
      }
    }
  }

  Future<void> _submitFastLogin() async {
    if (!_rollFormKey.currentState!.validate()) return;
    if (_isSubmitting) return;

    setState(() => _isSubmitting = true);
    HapticFeedback.mediumImpact();

    try {
      final auth = context.read<AuthProvider>();
      await auth.signInStudent(
        name: _nameController.text.trim(),
        rollNo: _rollController.text.trim(),
        phone: _phoneController.text.trim(),
      );

      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Welcome, ${_nameController.text.trim()}! 👋'),
            backgroundColor: AppColors.green,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSubmitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Sign in failed: ${e.toString().replaceAll('Exception:', '').trim()}'),
            backgroundColor: AppColors.red,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
      }
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
        top: 12,
        bottom: 24 + bottomInset,
      ),
      child: SingleChildScrollView(
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
            const SizedBox(height: 16),

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
                      'Universal Campus Dining Identity',
                      style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Mode Selector Chips
            Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: AppColors.surface2,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.line, width: 1),
              ),
              child: Row(
                children: [
                  _buildTabChip(0, '⚡️ Google & Fast'),
                  _buildTabChip(1, '🎓 College Email'),
                  _buildTabChip(2, '📋 Quick Roll No'),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Active Tab View
            if (_selectedTab == 0) _buildGoogleAndQuickTab(),
            if (_selectedTab == 1) _buildEmailTab(),
            if (_selectedTab == 2) _buildFastRollTab(),
          ],
        ),
      ),
    );
  }

  Widget _buildTabChip(int index, String label) {
    final isSelected = _selectedTab == index;
    return Expanded(
      child: GestureDetector(
        onTap: () {
          HapticFeedback.selectionClick();
          setState(() => _selectedTab = index);
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? AppColors.surface : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: Colors.black.withAlpha(15),
                      blurRadius: 4,
                      offset: const Offset(0, 2),
                    ),
                  ]
                : null,
          ),
          child: Center(
            child: Text(
              label,
              style: AppFonts.body(
                fontSize: 12,
                fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                color: isSelected ? AppColors.red : AppColors.inkSoft,
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  TAB 0: GOOGLE & ONE-TAP SIGN IN
  // ═══════════════════════════════════════════════════════════════════
  Widget _buildGoogleAndQuickTab() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Sign in with your TCET or Personal Google Account. The backend automatically classifies your student, faculty, or visitor privileges.',
          style: AppFonts.body(fontSize: 13, color: AppColors.inkSoft),
        ),
        const SizedBox(height: 18),

        // Google Sign-In Button
        ElevatedButton(
          onPressed: _isSubmitting ? null : _handleGoogleSignIn,
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.white,
            foregroundColor: AppColors.ink,
            elevation: 1,
            side: const BorderSide(color: AppColors.line, width: 1.5),
            padding: const EdgeInsets.symmetric(vertical: 14),
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
                      width: 20,
                      height: 20,
                      errorBuilder: (context, error, stackTrace) => const Icon(Icons.account_circle, color: Colors.blue, size: 20),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      'Continue with Google',
                      style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.ink),
                    ),
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
          onPressed: _isSubmitting ? null : _handleGuestBrowse,
          icon: const Icon(Icons.remove_red_eye_outlined, size: 18, color: AppColors.ink),
          label: Text('Browse Menu as Guest', style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.ink)),
          style: OutlinedButton.styleFrom(
            side: const BorderSide(color: AppColors.line, width: 1.5),
            padding: const EdgeInsets.symmetric(vertical: 13),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
        const SizedBox(height: 16),

        // Role Info Banner
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.surface2,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('✨ Account Types Supported:', style: AppFonts.body(fontSize: 12, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text('• @tcetmumbai.in → Verified Student Profile\n• @thakureducation.org → College Faculty / Staff\n• Gmail / Other → Guest Visitor', style: AppFonts.body(fontSize: 11.5, color: AppColors.inkSoft)),
            ],
          ),
        ),
      ],
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  TAB 1: COLLEGE EMAIL & PASSWORD
  // ═══════════════════════════════════════════════════════════════════
  Widget _buildEmailTab() {
    return Form(
      key: _emailFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_isSignUpMode) ...[
            TextFormField(
              controller: _nameEmailController,
              decoration: _inputDecoration('Full Name', Icons.person_outline),
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter your name' : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _rollEmailController,
              decoration: _inputDecoration('Roll No / Division (e.g. 1032251174)', Icons.badge_outlined),
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter your roll number' : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _phoneEmailController,
              keyboardType: TextInputType.phone,
              decoration: _inputDecoration('Phone Number', Icons.phone_outlined),
              validator: (v) => (v == null || v.trim().length < 10) ? 'Enter a valid 10-digit phone' : null,
            ),
            const SizedBox(height: 10),
          ],
          TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            decoration: _inputDecoration('College Email (@tcetmumbai.in)', Icons.email_outlined),
            validator: (v) {
              if (v == null || v.trim().isEmpty) return 'Please enter your email';
              if (!v.contains('@')) return 'Enter a valid email address';
              return null;
            },
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _passwordController,
            obscureText: true,
            decoration: _inputDecoration('Password', Icons.lock_outline),
            validator: (v) => (v == null || v.length < 6) ? 'Password must be at least 6 characters' : null,
          ),
          const SizedBox(height: 16),

          ElevatedButton(
            onPressed: _isSubmitting ? null : _submitEmailAuth,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.red,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            child: _isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : Text(
                    _isSignUpMode ? 'Create Student Account' : 'Sign In with Email',
                    style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white),
                  ),
          ),
          const SizedBox(height: 10),

          TextButton(
            onPressed: () {
              setState(() => _isSignUpMode = !_isSignUpMode);
            },
            child: Text(
              _isSignUpMode ? 'Already have an account? Sign In' : 'New student? Register with TCET ID',
              style: AppFonts.body(fontSize: 13, color: AppColors.red, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  TAB 2: FAST ROLL NO LOGIN
  // ═══════════════════════════════════════════════════════════════════
  Widget _buildFastRollTab() {
    return Form(
      key: _rollFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            controller: _nameController,
            decoration: _inputDecoration('Full Name', Icons.person_outline),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter your name' : null,
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _rollController,
            decoration: _inputDecoration('Roll No / Division', Icons.badge_outlined),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter your roll number' : null,
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _phoneController,
            keyboardType: TextInputType.phone,
            decoration: _inputDecoration('Phone Number', Icons.phone_outlined),
            validator: (v) => (v == null || v.trim().length < 10) ? 'Enter a valid phone number' : null,
          ),
          const SizedBox(height: 16),

          ElevatedButton(
            onPressed: _isSubmitting ? null : _submitFastLogin,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.red,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            child: _isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : Text(
                    'Instant Canteen Sign-In',
                    style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white),
                  ),
          ),
        ],
      ),
    );
  }

  InputDecoration _inputDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      labelStyle: AppFonts.body(fontSize: 13, color: AppColors.inkSoft),
      prefixIcon: Icon(icon, size: 20, color: AppColors.inkSoft),
      filled: true,
      fillColor: AppColors.surface2,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.red, width: 1.5),
      ),
    );
  }
}
