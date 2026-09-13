import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/daily_board.dart';
import '../theme/app_theme.dart';

/// Top Hero Banner displaying today's daily gravies, sweet, and canteen specials.
/// Tapping opens a clean modal with the full canteen board and bread availability.
class DailyBoardBanner extends StatelessWidget {
  final DailyBoard board;

  const DailyBoardBanner({super.key, required this.board});

  void _showDetailsModal(BuildContext context) {
    HapticFeedback.selectionClick();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _DailyBoardDetailModal(board: board),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasSpecial = board.canteenSpecial.isNotEmpty;
    final dayLabel = board.dayOfWeek.isNotEmpty ? board.dayOfWeek : 'TODAY';

    return Container(
      margin: const EdgeInsets.fromLTRB(18, 2, 18, 8),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBEB),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFDE68A), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withAlpha(8),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => _showDetailsModal(context),
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top row: Day badge + "Today's Board" header + Info icon
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0xFFB45309),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        dayLabel,
                        style: AppFonts.mono(
                          fontSize: 9.5,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'TODAY\'S CANTEEN SPREAD',
                        style: AppFonts.mono(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: const Color(0xFF92400E),
                          letterSpacing: 0.5,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'View Board',
                          style: AppFonts.body(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: const Color(0xFFB45309),
                          ),
                        ),
                        const SizedBox(width: 2),
                        const Icon(
                          Icons.chevron_right_rounded,
                          size: 16,
                          color: Color(0xFFB45309),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 7),

                // Middle: Sabjis & Sweet in a compact pill row
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (board.sabji1.isNotEmpty)
                      _buildPill('🥘 ${board.sabji1}', const Color(0xFFFEF3C7), const Color(0xFF92400E)),
                    if (board.sabji2.isNotEmpty)
                      _buildPill('🍛 ${board.sabji2}', const Color(0xFFFEF3C7), const Color(0xFF92400E)),
                    if (board.sweetOfTheDay.isNotEmpty)
                      _buildPill('🍯 ${board.sweetOfTheDay}', const Color(0xFFFEE2E2), const Color(0xFF991B1B)),
                  ],
                ),

                // Highlight banner for specials (e.g. Friday Special Pav Bhaji)
                if (hasSpecial) ...[
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF2F2),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFFCA5A5), width: 0.8),
                    ),
                    child: Row(
                      children: [
                        const Text('🔥', style: TextStyle(fontSize: 12)),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            board.specialBadge.isNotEmpty
                                ? '${board.specialBadge}: ${board.canteenSpecial}'
                                : 'Special Today: ${board.canteenSpecial}',
                            style: AppFonts.body(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFFB91C1C),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
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

  Widget _buildPill(String text, Color bg, Color textColor) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2.5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        text,
        style: AppFonts.body(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: textColor,
        ),
      ),
    );
  }
}

/// Detailed Modal showing the complete board info
class _DailyBoardDetailModal extends StatelessWidget {
  final DailyBoard board;

  const _DailyBoardDetailModal({required this.board});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
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
              margin: const EdgeInsets.only(bottom: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.line,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Modal Title
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Text('🍱', style: TextStyle(fontSize: 22)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Today\'s Canteen Board',
                      style: AppFonts.display(fontSize: 20),
                    ),
                    Text(
                      'Freshly prepared daily specials & meal inclusions',
                      style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Daily Gravies Section
          _buildSection(
            title: 'DAILY GRAVIES (FOR ROTI BHAJI & THALI)',
            icon: '🥘',
            content: [
              '• Gravy 1: ${board.sabji1.isNotEmpty ? board.sabji1 : "Chef Special"}',
              '• Gravy 2: ${board.sabji2.isNotEmpty ? board.sabji2 : "Seasonal Veg"}',
            ],
          ),
          const SizedBox(height: 10),

          // Thali Inclusions
          _buildSection(
            title: 'THALI INCLUSIONS',
            icon: '🍛',
            content: [
              '• Dal of the day: ${board.dalOfTheDay}',
              '• Rice: ${board.riceType}',
              '• Sweet of the day: ${board.sweetOfTheDay}',
              '• Bread: 4 Tawa Rotis or 4 Fresh Puris (Free choice)',
            ],
          ),
          const SizedBox(height: 10),

          // Canteen Special
          if (board.canteenSpecial.isNotEmpty) ...[
            _buildSection(
              title: board.specialBadge.isNotEmpty ? board.specialBadge : 'TODAY\'S SPECIAL HIGHLIGHT',
              icon: '🔥',
              content: [board.canteenSpecial],
              isHighlight: true,
            ),
            const SizedBox(height: 10),
          ],

          // Announcement
          if (board.announcement.isNotEmpty) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFF93C5FD)),
              ),
              child: Row(
                children: [
                  const Text('📢', style: TextStyle(fontSize: 16)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      board.announcement,
                      style: AppFonts.body(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFF1E40AF),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
          ],

          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.ink,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: const Text('Back to Menu'),
          ),
        ],
      ),
    );
  }

  Widget _buildSection({
    required String title,
    required String icon,
    required List<String> content,
    bool isHighlight = false,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isHighlight ? const Color(0xFFFEF2F2) : AppColors.surface2,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isHighlight ? const Color(0xFFFCA5A5) : AppColors.line,
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(icon, style: const TextStyle(fontSize: 16)),
              const SizedBox(width: 8),
              Text(
                title,
                style: AppFonts.mono(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: isHighlight ? const Color(0xFFB91C1C) : AppColors.ink,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          for (final line in content)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(
                line,
                style: AppFonts.body(
                  fontSize: 12.5,
                  fontWeight: isHighlight ? FontWeight.w600 : FontWeight.w500,
                  color: isHighlight ? const Color(0xFF991B1B) : AppColors.ink,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
