import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../models/daily_board.dart';
import '../models/menu_item.dart';
import '../providers/cart_provider.dart';
import '../theme/app_theme.dart';

/// Modal bottom sheet allowing students to customize their daily meal
/// (e.g. 4 Tawa Rotis vs 4 Fresh Puris, choice of daily gravies).
/// In accordance with canteen policy: Roti and Puri choices are the exact same price.
class MealCustomizerSheet extends StatefulWidget {
  final MenuItem item;
  final DailyBoard dailyBoard;

  const MealCustomizerSheet({
    super.key,
    required this.item,
    required this.dailyBoard,
  });

  static Future<void> show(
    BuildContext context, {
    required MenuItem item,
    required DailyBoard dailyBoard,
  }) {
    HapticFeedback.selectionClick();
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => MealCustomizerSheet(
        item: item,
        dailyBoard: dailyBoard,
      ),
    );
  }

  @override
  State<MealCustomizerSheet> createState() => _MealCustomizerSheetState();
}

class _MealCustomizerSheetState extends State<MealCustomizerSheet> {
  late String _selectedBread;
  late String _selectedGravy;
  final TextEditingController _noteController = TextEditingController();

  bool get _isThali =>
      widget.item.id.toLowerCase().contains('thali') ||
      widget.item.name.toLowerCase().contains('thali') ||
      widget.item.subCategory.toLowerCase().contains('thali');

  @override
  @override
  void initState() {
    super.initState();
    final board = widget.dailyBoard;
    // Auto-selection rule:
    // If both available: ask student, default selection is 4 Tawa Rotis
    // If only Puri available (Chapatis finished): automatically pre-select 4 Fresh Puris
    // If only Roti available (Puris finished): automatically pre-select 4 Tawa Rotis
    if (board.rotiAvailable && board.puriAvailable) {
      _selectedBread = '4 Tawa Rotis';
    } else if (board.puriAvailable) {
      _selectedBread = '4 Fresh Puris';
    } else if (board.rotiAvailable) {
      _selectedBread = '4 Tawa Rotis';
    } else {
      _selectedBread = 'No Breads Available';
    }

    // Default gravy
    if (widget.dailyBoard.sabji1.isNotEmpty && widget.dailyBoard.sabji2.isNotEmpty) {
      _selectedGravy = _isThali ? 'Both Sabjis (Standard)' : widget.dailyBoard.sabji1;
    } else if (widget.dailyBoard.sabji1.isNotEmpty) {
      _selectedGravy = widget.dailyBoard.sabji1;
    } else if (widget.dailyBoard.sabji2.isNotEmpty) {
      _selectedGravy = widget.dailyBoard.sabji2;
    } else {
      _selectedGravy = 'Daily Fresh Gravy';
    }
  }

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  String _buildCustomizationSummary() {
    final parts = <String>[];
    parts.add(_selectedBread);
    if (!_isThali && _selectedGravy.isNotEmpty) {
      parts.add(_selectedGravy);
    }
    final note = _noteController.text.trim();
    if (note.isNotEmpty) {
      parts.add(note);
    }
    return parts.join(' • ');
  }

  Widget _buildBreadNoticeBanner(DailyBoard board) {
    final notice = board.breadShortageNotice;
    if (notice == null) return const SizedBox.shrink();

    final isChapatiOver = !board.rotiAvailable && board.puriAvailable;
    final isPuriOver = board.rotiAvailable && !board.puriAvailable;

    return Container(
      margin: const EdgeInsets.fromLTRB(20, 4, 20, 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBEB),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFFDE68A), width: 1.5),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(5),
            decoration: const BoxDecoration(
              color: Color(0xFFFEF3C7),
              shape: BoxShape.circle,
            ),
            child: Text(
              isChapatiOver ? '🫓' : (isPuriOver ? '🟡' : '⚠️'),
              style: const TextStyle(fontSize: 16),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      isChapatiOver
                          ? 'CHAPATIS FINISHED'
                          : (isPuriOver ? 'PURIS FINISHED' : 'BREADS SOLD OUT'),
                      style: AppFonts.mono(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        color: const Color(0xFF92400E),
                        letterSpacing: 0.4,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEE2E2),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        'STOCK UPDATE',
                        style: AppFonts.mono(
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                          color: const Color(0xFF991B1B),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  notice,
                  style: AppFonts.body(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFF78350F),
                    height: 1.25,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Order will be prepared with the available bread so there is no delay at pickup.',
                  style: AppFonts.body(
                    fontSize: 11,
                    color: const Color(0xFFB45309),
                    height: 1.2,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final board = widget.dailyBoard;

    return Container(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Drag handle
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 12, bottom: 8),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.line,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Header: Item name + Price + Close
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: AppColors.mustardSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(
                    child: Text(
                      _isThali ? '🍱' : '🫓',
                      style: const TextStyle(fontSize: 24),
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.item.name,
                        style: AppFonts.body(
                          fontSize: 16.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '₹${widget.item.price.toInt()} • Free Roti / Puri choice',
                        style: AppFonts.mono(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.greenInk,
                        ),
                      ),
                    ],
                  ),
                ),
                GestureDetector(
                  onTap: () => Navigator.of(context).pop(),
                  child: Container(
                    padding: const EdgeInsets.all(6),
                    decoration: const BoxDecoration(
                      color: AppColors.surface2,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.close_rounded, size: 18, color: AppColors.inkSoft),
                  ),
                ),
              ],
            ),
          ),

          // Upfront Bread Stock Notice Banner
          _buildBreadNoticeBanner(board),

          const Divider(color: AppColors.line, height: 12),

          // Customization Options List
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.symmetric(horizontal: 20),
              children: [
                // 1. Bread Selection
                Text(
                  board.bothBreadsAvailable
                      ? 'CHOOSE YOUR BREAD'
                      : (!board.rotiAvailable && board.puriAvailable)
                          ? 'BREAD SELECTION (Chapatis Finished · Puris Auto-Selected)'
                          : (board.rotiAvailable && !board.puriAvailable)
                              ? 'BREAD SELECTION (Puris Finished · Rotis Auto-Selected)'
                              : 'BREAD SELECTION (All Breads Sold Out)',
                  style: AppFonts.mono(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: !board.hasAnyBread
                        ? AppColors.red
                        : (!board.bothBreadsAvailable ? const Color(0xFFB45309) : AppColors.inkSoft),
                    letterSpacing: 0.5,
                  ),
                ),
                const SizedBox(height: 8),

                _buildOptionTile(
                  title: '4 Tawa Rotis',
                  subtitle: board.rotiAvailable
                      ? 'Fresh hot whole-wheat tawa rotis'
                      : 'Finished for today · Stock exhausted',
                  badge: board.rotiAvailable ? 'Same Price' : 'OVER / SOLD OUT ❌',
                  icon: '🫓',
                  isEnabled: board.rotiAvailable,
                  isSelected: _selectedBread == '4 Tawa Rotis',
                  onTap: () {
                    if (board.rotiAvailable) {
                      setState(() => _selectedBread = '4 Tawa Rotis');
                    } else {
                      ScaffoldMessenger.of(context).hideCurrentSnackBar();
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            'Chapatis are finished for today! Your meal will be served with fresh puris.',
                            style: AppFonts.body(fontSize: 13, fontWeight: FontWeight.w600),
                          ),
                          backgroundColor: const Color(0xFFB45309),
                          duration: const Duration(seconds: 3),
                          behavior: SnackBarBehavior.floating,
                        ),
                      );
                    }
                  },
                ),

                const SizedBox(height: 6),
                _buildOptionTile(
                  title: '4 Fresh Puris',
                  subtitle: board.puriAvailable
                      ? 'Golden, freshly fried hot puris'
                      : 'Finished for today · Stock exhausted',
                  badge: board.puriAvailable ? 'Same Price' : 'OVER / SOLD OUT ❌',
                  icon: '🟡',
                  isEnabled: board.puriAvailable,
                  isSelected: _selectedBread == '4 Fresh Puris',
                  onTap: () {
                    if (board.puriAvailable) {
                      setState(() => _selectedBread = '4 Fresh Puris');
                    } else {
                      ScaffoldMessenger.of(context).hideCurrentSnackBar();
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            'Puris are finished for today! Your meal will be served with fresh tawa rotis.',
                            style: AppFonts.body(fontSize: 13, fontWeight: FontWeight.w600),
                          ),
                          backgroundColor: const Color(0xFFB45309),
                          duration: const Duration(seconds: 3),
                          behavior: SnackBarBehavior.floating,
                        ),
                      );
                    }
                  },
                ),

                const SizedBox(height: 16),

                // 2. Gravy Selection (Especially for Roti-Bhaji)
                if (!_isThali && (board.sabji1.isNotEmpty || board.sabji2.isNotEmpty)) ...[
                  Text(
                    'TODAY\'S FRESH GRAVY CHOICE',
                    style: AppFonts.mono(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.inkSoft,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 8),

                  if (board.sabji1.isNotEmpty)
                    _buildOptionTile(
                      title: board.sabji1,
                      subtitle: 'Fresh daily special gravy',
                      icon: '🥘',
                      isSelected: _selectedGravy == board.sabji1,
                      onTap: () => setState(() => _selectedGravy = board.sabji1),
                    ),

                  if (board.sabji2.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    _buildOptionTile(
                      title: board.sabji2,
                      subtitle: 'Chef seasonal vegetable gravy',
                      icon: '🍛',
                      isSelected: _selectedGravy == board.sabji2,
                      onTap: () => setState(() => _selectedGravy = board.sabji2),
                    ),
                  ],

                  if (board.sabji1.isNotEmpty && board.sabji2.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    _buildOptionTile(
                      title: 'Both (Half & Half)',
                      subtitle: 'Taste of both daily gravies',
                      icon: '✨',
                      isSelected: _selectedGravy == 'Both (Half & Half)',
                      onTap: () => setState(() => _selectedGravy = 'Both (Half & Half)'),
                    ),
                  ],
                  const SizedBox(height: 16),
                ],

                // 3. Thali Inclusions Display
                if (_isThali) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.mustardSoft,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.mustardInk.withAlpha(40)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Text('🍱', style: TextStyle(fontSize: 18)),
                            const SizedBox(width: 8),
                            Text(
                              'TODAY\'S THALI SPREAD',
                              style: AppFonts.mono(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                                color: AppColors.mustardInk,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          '• Gravy 1: ${board.sabji1.isNotEmpty ? board.sabji1 : "Chef Special Paneer"}\n'
                          '• Gravy 2: ${board.sabji2.isNotEmpty ? board.sabji2 : "Mix Vegetable"}\n'
                          '• Dal: ${board.dalOfTheDay} • Rice: ${board.riceType}\n'
                          '• Sweet: ${board.sweetOfTheDay} • Salad & Pickle',
                          style: AppFonts.body(
                            fontSize: 12,
                            color: AppColors.ink,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],

                // Optional kitchen note
                TextField(
                  controller: _noteController,
                  maxLength: 50,
                  style: AppFonts.body(fontSize: 13, color: AppColors.ink),
                  decoration: InputDecoration(
                    hintText: 'Special kitchen note (e.g. Less spicy, no pickle)',
                    hintStyle: AppFonts.body(fontSize: 12.5, color: AppColors.inkSoft),
                    counterText: '',
                    filled: true,
                    fillColor: AppColors.surface2,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: AppColors.line),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: AppColors.line),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: const BorderSide(color: AppColors.ink),
                    ),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                ),
                const SizedBox(height: 12),
              ],
            ),
          ),

          // Bottom Action Button
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
            child: ElevatedButton(
              onPressed: !board.hasAnyBread
                  ? null
                  : () {
                      final customization = _buildCustomizationSummary();
                      context.read<CartProvider>().addItem(
                        widget.item,
                        customization: customization,
                      );
                      Navigator.of(context).pop();

                      ScaffoldMessenger.of(context).hideCurrentSnackBar();
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            'Added ${widget.item.name} ($customization) to cart',
                            style: AppFonts.body(fontSize: 13, color: Colors.white),
                          ),
                          duration: const Duration(seconds: 2),
                          backgroundColor: AppColors.ink,
                          behavior: SnackBarBehavior.floating,
                        ),
                      );
                    },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.ink,
                foregroundColor: Colors.white,
                disabledBackgroundColor: AppColors.line,
                disabledForegroundColor: AppColors.inkSoft,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                elevation: 0,
              ),
              child: Text(
                !board.hasAnyBread
                    ? 'All Breads Sold Out for Today'
                    : 'Add to Cart • ₹${widget.item.price.toInt()}',
                style: AppFonts.body(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w700,
                  color: !board.hasAnyBread ? AppColors.inkSoft : Colors.white,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOptionTile({
    required String title,
    required String subtitle,
    required String icon,
    String? badge,
    bool isEnabled = true,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    final effectiveSelected = isEnabled && isSelected;

    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(
          color: !isEnabled
              ? const Color(0xFFF8FAFC)
              : (effectiveSelected ? AppColors.surface2 : AppColors.surface),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: !isEnabled
                ? const Color(0xFFE2E8F0)
                : (effectiveSelected ? AppColors.ink : AppColors.line),
            width: effectiveSelected ? 1.8 : 1.0,
          ),
        ),
        child: Row(
          children: [
            Opacity(
              opacity: isEnabled ? 1.0 : 0.45,
              child: Text(icon, style: const TextStyle(fontSize: 20)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        title,
                        style: AppFonts.body(
                          fontSize: 13.5,
                          fontWeight: effectiveSelected ? FontWeight.w700 : FontWeight.w500,
                          color: isEnabled ? AppColors.ink : AppColors.inkSoft,
                        ),
                      ),
                      if (badge != null) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                          decoration: BoxDecoration(
                            color: !isEnabled
                                ? const Color(0xFFFEE2E2)
                                : const Color(0xFFDCFCE7),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            badge,
                            style: AppFonts.mono(
                              fontSize: 9.5,
                              fontWeight: FontWeight.w700,
                              color: !isEnabled
                                  ? const Color(0xFFDC2626)
                                  : const Color(0xFF166534),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: AppFonts.body(
                      fontSize: 11.5,
                      color: isEnabled ? AppColors.inkSoft : const Color(0xFF94A3B8),
                    ),
                  ),
                ],
              ),
            ),
            Container(
              width: 20,
              height: 20,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: !isEnabled
                      ? const Color(0xFFCBD5E1)
                      : (effectiveSelected ? AppColors.ink : AppColors.line),
                  width: 2,
                ),
                color: !isEnabled
                    ? const Color(0xFFF1F5F9)
                    : (effectiveSelected ? AppColors.ink : Colors.transparent),
              ),
              child: !isEnabled
                  ? const Center(child: Icon(Icons.block, size: 11, color: Color(0xFF94A3B8)))
                  : (effectiveSelected
                      ? const Icon(Icons.check, size: 13, color: Colors.white)
                      : null),
            ),
          ],
        ),
      ),
    );
  }
}
