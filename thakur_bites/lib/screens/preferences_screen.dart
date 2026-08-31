import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/user_preferences.dart';
import '../providers/auth_provider.dart';
import '../services/preferences_service.dart';
import '../theme/app_theme.dart';

/// Platform 2.0 — Customer Dietary & Notification Preferences Screen
class PreferencesScreen extends StatefulWidget {
  const PreferencesScreen({super.key});

  @override
  State<PreferencesScreen> createState() => _PreferencesScreenState();
}

class _PreferencesScreenState extends State<PreferencesScreen> {
  final PreferencesService _prefsService = PreferencesService();

  bool _isSaving = false;
  late NotificationSettings _notifications;
  late DietaryPreferences _dietary;
  final TextEditingController _notesController = TextEditingController();
  bool _initialized = false;

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  void _initFromPreferences(UserPreferences prefs) {
    if (_initialized) return;
    _notifications = prefs.notifications;
    _dietary = prefs.dietary;
    _notesController.text = prefs.dietary.customNotes;
    _initialized = true;
  }

  Future<void> _save() async {
    final auth = context.read<AuthProvider>();
    final user = auth.currentProfile;
    if (user == null) return;

    setState(() => _isSaving = true);
    HapticFeedback.mediumImpact();

    try {
      final updatedPrefs = UserPreferences(
        uid: user.uid,
        notifications: _notifications,
        dietary: _dietary.copyWith(customNotes: _notesController.text.trim()),
      );

      await _prefsService.savePreferences(updatedPrefs);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Preferences updated successfully! ✨'),
            backgroundColor: AppColors.green,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSaving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error saving preferences: $e'),
            backgroundColor: AppColors.red,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentProfile;

    if (user == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Preferences')),
        body: const Center(child: Text('Please sign in to manage preferences.')),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20, color: AppColors.ink),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text('Preferences & Dietary', style: AppFonts.display(fontSize: 20)),
        centerTitle: false,
      ),
      body: StreamBuilder<UserPreferences>(
        stream: _prefsService.preferencesStream(user.uid),
        builder: (context, snapshot) {
          if (snapshot.hasData && !_initialized) {
            _initFromPreferences(snapshot.data!);
          } else if (!_initialized) {
            _notifications = const NotificationSettings();
            _dietary = const DietaryPreferences();
            _initialized = true;
          }

          return SingleChildScrollView(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Dietary Hints Card
                _buildSectionHeader('🥗 Dietary & Kitchen Hints', 'Applied automatically to your canteen tickets as kitchen notes.'),
                const SizedBox(height: 12),
                Container(
                  decoration: BoxDecoration(
                    color: AppColors.surface2,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.line),
                  ),
                  child: Column(
                    children: [
                      _buildSwitchTile(
                        title: 'Less Spicy / Mild Preparation',
                        subtitle: 'Kitchen cooks with reduced green chillies & garam masala',
                        value: _dietary.lessSpicy,
                        onChanged: (v) => setState(() => _dietary = _dietary.copyWith(lessSpicy: v)),
                      ),
                      const Divider(height: 1, color: AppColors.line),
                      _buildSwitchTile(
                        title: 'Less Sugar / Diabetic Friendly',
                        subtitle: 'Half sugar in Chai, Coffee, juices & beverages',
                        value: _dietary.lessSugar,
                        onChanged: (v) => setState(() => _dietary = _dietary.copyWith(lessSugar: v)),
                      ),
                      const Divider(height: 1, color: AppColors.line),
                      _buildSwitchTile(
                        title: 'Eco-Friendly (No Plastic Cutlery)',
                        subtitle: 'Skip plastic spoon & straw to reduce canteen waste',
                        value: _dietary.noCutlery,
                        onChanged: (v) => setState(() => _dietary = _dietary.copyWith(noCutlery: v)),
                      ),
                      const Divider(height: 1, color: AppColors.line),
                      _buildSwitchTile(
                        title: 'Jain Food Only',
                        subtitle: 'No onion, garlic, or root vegetables',
                        value: _dietary.jainAvailableOnly,
                        onChanged: (v) => setState(() => _dietary = _dietary.copyWith(jainAvailableOnly: v)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),

                // Custom Instructions Field
                Text('Permanent Kitchen Instructions (Optional)', style: AppFonts.body(fontSize: 13, fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                TextField(
                  controller: _notesController,
                  maxLines: 2,
                  maxLength: 120,
                  decoration: InputDecoration(
                    hintText: 'e.g. Extra crispy dosa, separate sambar & chutney',
                    hintStyle: AppFonts.body(fontSize: 12.5, color: AppColors.inkSoft),
                    filled: true,
                    fillColor: AppColors.surface2,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: const BorderSide(color: AppColors.line),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: const BorderSide(color: AppColors.line),
                    ),
                  ),
                ),
                const SizedBox(height: 20),

                // Notifications Section
                _buildSectionHeader('🔔 Notification Channels', 'Receive real-time push and audible chimes for order progress.'),
                const SizedBox(height: 12),
                Container(
                  decoration: BoxDecoration(
                    color: AppColors.surface2,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.line),
                  ),
                  child: Column(
                    children: [
                      _buildSwitchTile(
                        title: 'Order Confirmed Alerts',
                        subtitle: 'Push alert when payment clears and ticket is generated',
                        value: _notifications.orderConfirmed,
                        onChanged: (v) => setState(() => _notifications = _notifications.copyWith(orderConfirmed: v)),
                      ),
                      const Divider(height: 1, color: AppColors.line),
                      _buildSwitchTile(
                        title: 'Kitchen Cooking Updates',
                        subtitle: 'Alert when chef puts your ticket on the grill/pan',
                        value: _notifications.orderPreparing,
                        onChanged: (v) => setState(() => _notifications = _notifications.copyWith(orderPreparing: v)),
                      ),
                      const Divider(height: 1, color: AppColors.line),
                      _buildSwitchTile(
                        title: 'Ready for Pickup Chimes 🟢',
                        subtitle: 'High-priority chime when your token is ready at counter',
                        value: _notifications.orderReady,
                        onChanged: (v) => setState(() => _notifications = _notifications.copyWith(orderReady: v)),
                      ),
                      const Divider(height: 1, color: AppColors.line),
                      _buildSwitchTile(
                        title: 'Daily Canteen Special Board',
                        subtitle: 'Morning notification of today\'s rotating sabji & specials',
                        value: _notifications.dailySpecials,
                        onChanged: (v) => setState(() => _notifications = _notifications.copyWith(dailySpecials: v)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 32),

                // Save Button
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _isSaving ? null : _save,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.red,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: _isSaving
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : Text('Save Preferences', style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white)),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildSectionHeader(String title, String subtitle) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.ink)),
        const SizedBox(height: 2),
        Text(subtitle, style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft)),
      ],
    );
  }

  Widget _buildSwitchTile({
    required String title,
    required String subtitle,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppFonts.body(fontSize: 13.5, fontWeight: FontWeight.w600, color: AppColors.ink)),
                const SizedBox(height: 2),
                Text(subtitle, style: AppFonts.body(fontSize: 11.5, color: AppColors.inkSoft)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Switch.adaptive(
            value: value,
            activeTrackColor: AppColors.red.withAlpha(180),
            activeThumbColor: AppColors.red,
            onChanged: (v) {
              HapticFeedback.selectionClick();
              onChanged(v);
            },
          ),
        ],
      ),
    );
  }
}
