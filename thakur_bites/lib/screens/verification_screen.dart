import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/user_profile.dart';
import '../providers/auth_provider.dart';
import '../theme/app_theme.dart';

/// Platform 2.0 — Faculty & Staff Verification Application Screen
class VerificationScreen extends StatefulWidget {
  const VerificationScreen({super.key});

  @override
  State<VerificationScreen> createState() => _VerificationScreenState();
}

class _VerificationScreenState extends State<VerificationScreen> {
  final _formKey = GlobalKey<FormState>();
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  AccountType _selectedType = AccountType.teacher;
  final _employeeIdController = TextEditingController();
  final _departmentController = TextEditingController();
  final _designationController = TextEditingController();
  final _officialEmailController = TextEditingController();

  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthProvider>();
    final user = auth.currentProfile;
    if (user != null) {
      if (user.department != null) _departmentController.text = user.department!;
      if (user.designation != null) _designationController.text = user.designation!;
      if (user.rollNo != null) _employeeIdController.text = user.rollNo!;
      _officialEmailController.text = user.email;
    }
  }

  @override
  void dispose() {
    _employeeIdController.dispose();
    _departmentController.dispose();
    _designationController.dispose();
    _officialEmailController.dispose();
    super.dispose();
  }

  Future<void> _submitApplication() async {
    if (!_formKey.currentState!.validate()) return;
    if (_isSubmitting) return;

    setState(() => _isSubmitting = true);
    HapticFeedback.mediumImpact();

    try {
      final auth = context.read<AuthProvider>();
      final user = auth.currentProfile;
      if (user == null) throw Exception('Please sign in first.');

      final hexSuffix = DateTime.now().millisecondsSinceEpoch.toRadixString(16).substring(6).toUpperCase();
      final appId = '${_selectedType == AccountType.teacher ? 'FAC' : 'STF'}-$hexSuffix';

      final appDoc = {
        'applicationId': appId,
        'userId': user.uid,
        'applicationType': _selectedType.toDbString(),
        'employeeId': _employeeIdController.text.trim().toUpperCase(),
        'department': _departmentController.text.trim(),
        'designation': _designationController.text.trim(),
        'officialEmail': _officialEmailController.text.trim().toLowerCase(),
        'status': 'SUBMITTED',
        'submittedAt': Timestamp.now(),
      };

      // Create application record
      await _db.collection('verificationApplications').doc(appId).set(appDoc);

      // Update local profile status
      final updated = user.copyWith(
        verificationStatus: VerificationStatus.underReview,
        department: _departmentController.text.trim(),
        designation: _designationController.text.trim(),
      );
      await auth.updateProfile(updated);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Application $appId submitted for campus review! 📋'),
            backgroundColor: AppColors.green,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Submission failed: $e'),
            backgroundColor: AppColors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentProfile;

    if (user == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Faculty Verification')),
        body: const Center(child: Text('Please sign in to apply for verification.')),
      );
    }

    final isVerifiedFaculty = (user.accountType == AccountType.teacher || user.accountType == AccountType.collegeStaff) &&
        user.verificationStatus == VerificationStatus.verified;
    final isUnderReview = user.verificationStatus == VerificationStatus.underReview;

    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20, color: AppColors.ink),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text('Faculty & Staff Verification', style: AppFonts.display(fontSize: 20)),
        centerTitle: false,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Status Card
            _buildStatusCard(user, isVerifiedFaculty, isUnderReview),
            const SizedBox(height: 20),

            if (isVerifiedFaculty) ...[
              _buildVerifiedPrivilegesCard(user),
            ] else if (isUnderReview) ...[
              _buildUnderReviewCard(user),
            ] else ...[
              _buildApplicationForm(),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildStatusCard(UserProfile user, bool isVerified, bool isUnderReview) {
    Color bg;
    Color border;
    String title;
    String desc;
    IconData icon;

    if (isVerified) {
      bg = AppColors.greenSoft;
      border = AppColors.green;
      title = 'Verified ${user.accountType.label} ⭐️';
      desc = 'Your account has priority queue scheduling enabled.';
      icon = Icons.verified_rounded;
    } else if (isUnderReview) {
      bg = AppColors.mustardSoft;
      border = AppColors.mustardInk;
      title = 'Application Under Review ⏳';
      desc = 'Campus administration is reviewing your credentials.';
      icon = Icons.hourglass_top_rounded;
    } else {
      bg = AppColors.surface2;
      border = AppColors.line;
      title = 'Standard Student / Visitor Profile';
      desc = 'Apply below to verify your TCET faculty credentials.';
      icon = Icons.badge_outlined;
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: border, width: 1.5),
      ),
      child: Row(
        children: [
          Icon(icon, size: 32, color: border),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.ink)),
                const SizedBox(height: 3),
                Text(desc, style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVerifiedPrivilegesCard(UserProfile user) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('🎓 Faculty Profile Details', style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          _buildDetailRow('Employee / Faculty ID', user.rollNo ?? 'Verified'),
          _buildDetailRow('Department', user.department ?? 'TCET Engineering'),
          _buildDetailRow('Designation', user.designation ?? 'Faculty Member'),
          _buildDetailRow('Priority Tier', 'Level ${user.priorityLevel} (Fast Kitchen Queue)'),
          const Divider(height: 20, color: AppColors.line),
          Text(
            '⭐️ Priority Queueing Notice:\nYour orders are scheduled at high priority for rapid canteen fulfillment during rush hours.',
            style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
          ),
        ],
      ),
    );
  }

  Widget _buildUnderReviewCard(UserProfile user) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('📋 Application Details', style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          _buildDetailRow('Department', user.department ?? 'Submitted'),
          _buildDetailRow('Designation', user.designation ?? 'Submitted'),
          _buildDetailRow('Review Status', 'Pending Admin Verification (12-24h)'),
          const SizedBox(height: 12),
          Text(
            'Once approved, your account will be upgraded immediately with zero loss of order history or settings.',
            style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: AppFonts.body(fontSize: 12.5, color: AppColors.inkSoft)),
          Text(value, style: AppFonts.mono(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.ink)),
        ],
      ),
    );
  }

  Widget _buildApplicationForm() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Apply for Faculty / Staff Verification', style: AppFonts.body(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(
            'Verified professors and college staff receive priority kitchen preparation scheduling.',
            style: AppFonts.body(fontSize: 12.5, color: AppColors.inkSoft),
          ),
          const SizedBox(height: 16),

          // Role selection tabs
          Row(
            children: [
              Expanded(
                child: _buildRoleSelector(
                  AccountType.teacher,
                  '👨‍🏫 Faculty / Professor',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildRoleSelector(
                  AccountType.collegeStaff,
                  '🏢 College Staff',
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          TextFormField(
            controller: _employeeIdController,
            decoration: _inputDecoration('Employee / Faculty ID', Icons.badge_outlined),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter your Employee/Faculty ID' : null,
          ),
          const SizedBox(height: 12),

          TextFormField(
            controller: _departmentController,
            decoration: _inputDecoration('Department (e.g. Information Technology)', Icons.apartment_outlined),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter your Department' : null,
          ),
          const SizedBox(height: 12),

          TextFormField(
            controller: _designationController,
            decoration: _inputDecoration('Designation (e.g. Assistant Professor)', Icons.work_outline),
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Please enter your Designation' : null,
          ),
          const SizedBox(height: 12),

          TextFormField(
            controller: _officialEmailController,
            keyboardType: TextInputType.emailAddress,
            decoration: _inputDecoration('Official Email (@tcetmumbai.in or @thakureducation.org)', Icons.email_outlined),
            validator: (v) => (v == null || !v.contains('@')) ? 'Please enter a valid official email' : null,
          ),
          const SizedBox(height: 24),

          ElevatedButton(
            onPressed: _isSubmitting ? null : _submitApplication,
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
                : Text('Submit Verification Application', style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white)),
          ),
        ],
      ),
    );
  }

  Widget _buildRoleSelector(AccountType type, String label) {
    final isSelected = _selectedType == type;
    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        setState(() => _selectedType = type);
      },
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.red.withAlpha(20) : AppColors.surface2,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? AppColors.red : AppColors.line,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Center(
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 12.5,
              fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
              color: isSelected ? AppColors.red : AppColors.ink,
            ),
            textAlign: TextAlign.center,
          ),
        ),
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
