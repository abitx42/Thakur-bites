import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../theme/app_theme.dart';

/// Modal bottom sheet for verified student sign in / profile registration.
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
  int _selectedTab = 0; // 0 = Instant Canteen Login, 1 = College Email Login
  final _formKey = GlobalKey<FormState>();

  // Instant Login controllers
  final _nameController = TextEditingController();
  final _rollController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailOptionalController = TextEditingController();

  // Email Account controllers
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isSignUpMode = false;
  bool _isSubmitting = false;

  @override
  void dispose() {
    _nameController.dispose();
    _rollController.dispose();
    _phoneController.dispose();
    _emailOptionalController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submitInstant() async {
    if (!_formKey.currentState!.validate()) return;
    if (_isSubmitting) return;

    setState(() => _isSubmitting = true);
    HapticFeedback.mediumImpact();

    try {
      final auth = context.read<AuthProvider>();
      await auth.signInStudent(
        name: _nameController.text,
        rollNo: _rollController.text,
        phone: _phoneController.text,
        email: _emailOptionalController.text.trim().isEmpty ? null : _emailOptionalController.text.trim(),
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
            content: Text('Sign in failed: $e'),
            backgroundColor: AppColors.red,
          ),
        );
      }
    }
  }

  Future<void> _submitEmailAuth() async {
    if (!_formKey.currentState!.validate()) return;
    if (_isSubmitting) return;

    setState(() => _isSubmitting = true);
    HapticFeedback.mediumImpact();

    try {
      final auth = context.read<AuthProvider>();
      if (_isSignUpMode) {
        await auth.signUpWithEmail(
          email: _emailController.text,
          password: _passwordController.text,
          name: _nameController.text.trim().isEmpty ? 'Student' : _nameController.text.trim(),
          phone: _phoneController.text.trim().isEmpty ? '0000000000' : _phoneController.text.trim(),
          rollNo: _rollController.text.trim().isEmpty ? 'TCET' : _rollController.text.trim(),
        );
      } else {
        await auth.signInWithEmail(
          email: _emailController.text,
          password: _passwordController.text,
        );
      }

      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isSignUpMode ? 'Account created successfully! 🎓' : 'Welcome back! 🎓'),
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
            content: Text('Authentication failed: $e'),
            backgroundColor: AppColors.red,
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
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + bottomInset),
      child: SingleChildScrollView(
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Handle bar
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

              // Title
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('STUDENT ACCESS', style: AppFonts.display(fontSize: 22)),
                      const SizedBox(height: 2),
                      Text(
                        'TCET Canteen Identity & Orders',
                        style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                      ),
                    ],
                  ),
                  GestureDetector(
                    onTap: () => Navigator.of(context).pop(),
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: const BoxDecoration(
                        color: AppColors.surface2,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.close_rounded, size: 18, color: AppColors.inkSoft),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Mode Tabs (Instant vs College Email)
              Container(
                decoration: BoxDecoration(
                  color: AppColors.surface2,
                  borderRadius: BorderRadius.circular(10),
                ),
                padding: const EdgeInsets.all(4),
                child: Row(
                  children: [
                    Expanded(
                      child: GestureDetector(
                        onTap: () => setState(() => _selectedTab = 0),
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          decoration: BoxDecoration(
                            color: _selectedTab == 0 ? AppColors.surface : Colors.transparent,
                            borderRadius: BorderRadius.circular(8),
                            boxShadow: _selectedTab == 0
                                ? [const BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 1))]
                                : null,
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            '⚡️ Instant Student',
                            style: AppFonts.body(
                              fontSize: 12.5,
                              fontWeight: _selectedTab == 0 ? FontWeight.w700 : FontWeight.w500,
                              color: _selectedTab == 0 ? AppColors.ink : AppColors.inkSoft,
                            ),
                          ),
                        ),
                      ),
                    ),
                    Expanded(
                      child: GestureDetector(
                        onTap: () => setState(() => _selectedTab = 1),
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          decoration: BoxDecoration(
                            color: _selectedTab == 1 ? AppColors.surface : Colors.transparent,
                            borderRadius: BorderRadius.circular(8),
                            boxShadow: _selectedTab == 1
                                ? [const BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 1))]
                                : null,
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            '🎓 College Email',
                            style: AppFonts.body(
                              fontSize: 12.5,
                              fontWeight: _selectedTab == 1 ? FontWeight.w700 : FontWeight.w500,
                              color: _selectedTab == 1 ? AppColors.ink : AppColors.inkSoft,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),

              if (_selectedTab == 0) ...[
                // Full Name field
                _buildFieldLabel('Full Name'),
                _buildInputField(
                  controller: _nameController,
                  hint: 'e.g. Aditya Bodake',
                  icon: Icons.person_outline_rounded,
                  validator: (val) =>
                      val == null || val.trim().isEmpty ? 'Please enter your name' : null,
                ),
                const SizedBox(height: 12),

                // Roll Number field
                _buildFieldLabel('College Roll No / Division'),
                _buildInputField(
                  controller: _rollController,
                  hint: 'e.g. TE-IT-42',
                  icon: Icons.badge_outlined,
                  capitalization: TextCapitalization.characters,
                  validator: (val) =>
                      val == null || val.trim().isEmpty ? 'Please enter your roll number' : null,
                ),
                const SizedBox(height: 12),

                // Phone field
                _buildFieldLabel('Mobile Number (for pickup SMS/token)'),
                _buildInputField(
                  controller: _phoneController,
                  hint: 'e.g. 9876543210',
                  icon: Icons.phone_outlined,
                  keyboardType: TextInputType.phone,
                  validator: (val) =>
                      val == null || val.trim().length < 10 ? 'Please enter a valid 10-digit number' : null,
                ),
                const SizedBox(height: 12),

                _buildFieldLabel('College Email (Optional)'),
                _buildInputField(
                  controller: _emailOptionalController,
                  hint: 'e.g. student@thakureducation.org',
                  icon: Icons.alternate_email_rounded,
                  keyboardType: TextInputType.emailAddress,
                  capitalization: TextCapitalization.none,
                ),
                const SizedBox(height: 22),

                // Submit Instant
                SizedBox(
                  width: double.infinity,
                  child: GestureDetector(
                    onTap: _isSubmitting ? null : _submitInstant,
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      decoration: BoxDecoration(
                        color: _isSubmitting ? AppColors.line : AppColors.red,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      alignment: Alignment.center,
                      child: _isSubmitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : Text(
                              'Continue to Menu →',
                              style: AppFonts.body(fontSize: 14.5, fontWeight: FontWeight.w700, color: Colors.white),
                            ),
                    ),
                  ),
                ),
              ] else ...[
                // College Email Form
                _buildFieldLabel('College Email ID'),
                _buildInputField(
                  controller: _emailController,
                  hint: 'e.g. aditya.bodake@thakureducation.org',
                  icon: Icons.school_outlined,
                  keyboardType: TextInputType.emailAddress,
                  capitalization: TextCapitalization.none,
                  validator: (val) =>
                      val == null || !val.contains('@') ? 'Enter a valid college email' : null,
                ),
                const SizedBox(height: 12),

                _buildFieldLabel('Password'),
                _buildInputField(
                  controller: _passwordController,
                  hint: '••••••••',
                  icon: Icons.lock_outline_rounded,
                  obscureText: true,
                  validator: (val) =>
                      val == null || val.length < 6 ? 'Password must be at least 6 characters' : null,
                ),

                if (_isSignUpMode) ...[
                  const SizedBox(height: 12),
                  _buildFieldLabel('Full Name'),
                  _buildInputField(
                    controller: _nameController,
                    hint: 'e.g. Aditya Bodake',
                    icon: Icons.person_outline_rounded,
                    validator: (val) =>
                        val == null || val.trim().isEmpty ? 'Enter your full name' : null,
                  ),
                  const SizedBox(height: 12),
                  _buildFieldLabel('Roll Number'),
                  _buildInputField(
                    controller: _rollController,
                    hint: 'e.g. TE-IT-42',
                    icon: Icons.badge_outlined,
                    capitalization: TextCapitalization.characters,
                  ),
                ],

                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    GestureDetector(
                      onTap: () => setState(() => _isSignUpMode = !_isSignUpMode),
                      child: Text(
                        _isSignUpMode ? 'Already have an account? Sign In' : 'New student? Register account',
                        style: AppFonts.body(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.red),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),

                // Submit Email Auth
                SizedBox(
                  width: double.infinity,
                  child: GestureDetector(
                    onTap: _isSubmitting ? null : _submitEmailAuth,
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      decoration: BoxDecoration(
                        color: _isSubmitting ? AppColors.line : AppColors.red,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      alignment: Alignment.center,
                      child: _isSubmitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : Text(
                              _isSignUpMode ? 'Register College Account →' : 'Sign In to Thakur Bites →',
                              style: AppFonts.body(fontSize: 14.5, fontWeight: FontWeight.w700, color: Colors.white),
                            ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFieldLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        text,
        style: AppFonts.body(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.ink),
      ),
    );
  }

  Widget _buildInputField({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    bool obscureText = false,
    TextInputType keyboardType = TextInputType.text,
    TextCapitalization capitalization = TextCapitalization.words,
    String? Function(String?)? validator,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line, width: 1),
      ),
      child: TextFormField(
        controller: controller,
        obscureText: obscureText,
        keyboardType: keyboardType,
        textCapitalization: capitalization,
        validator: validator,
        style: AppFonts.body(fontSize: 14, color: AppColors.ink),
        decoration: InputDecoration(
          prefixIcon: Icon(icon, size: 20, color: AppColors.inkSoft),
          hintText: hint,
          hintStyle: AppFonts.body(fontSize: 13.5, color: AppColors.inkSoft),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        ),
      ),
    );
  }
}
