import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../theme/app_theme.dart';

/// Modal bottom sheet for student sign in / profile registration.
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
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _rollController = TextEditingController();
  final _phoneController = TextEditingController();
  bool _isSubmitting = false;

  @override
  void dispose() {
    _nameController.dispose();
    _rollController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
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
                      Text('STUDENT SIGN-IN', style: AppFonts.display(fontSize: 22)),
                      const SizedBox(height: 2),
                      Text(
                        'TCET Canteen Express Account',
                        style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                      ),
                    ],
                  ),
                  GestureDetector(
                    onTap: () => Navigator.of(context).pop(),
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: AppColors.surface2,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.close_rounded, size: 18, color: AppColors.inkSoft),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Full Name field
              _buildFieldLabel('Full Name'),
              _buildInputField(
                controller: _nameController,
                hint: 'e.g. Aditya Bodake',
                icon: Icons.person_outline_rounded,
                validator: (val) =>
                    val == null || val.trim().isEmpty ? 'Please enter your name' : null,
              ),
              const SizedBox(height: 14),

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
              const SizedBox(height: 14),

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
              const SizedBox(height: 24),

              // Submit Button
              SizedBox(
                width: double.infinity,
                child: GestureDetector(
                  onTap: _isSubmitting ? null : _submit,
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
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text(
                            'Continue to Thakur Bites →',
                            style: AppFonts.body(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                  ),
                ),
              ),
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
        keyboardType: keyboardType,
        textCapitalization: capitalization,
        validator: validator,
        style: AppFonts.body(fontSize: 14, color: AppColors.ink),
        decoration: InputDecoration(
          prefixIcon: Icon(icon, size: 20, color: AppColors.inkSoft),
          hintText: hint,
          hintStyle: AppFonts.body(fontSize: 13.5, color: AppColors.inkSoft.withOpacity(0.7)),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        ),
      ),
    );
  }
}
