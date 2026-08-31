import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Category definition used for the tab filter
class MenuCategory {
  final String id;
  final String label;

  const MenuCategory(this.id, this.label);
}

/// The fixed list of categories — matches Firestore category field values
const List<MenuCategory> menuCategories = [
  MenuCategory('all', 'All'),
  MenuCategory('dosa', 'Dosa'),
  MenuCategory('rotibhaji', 'Roti-Bhaji'),
  MenuCategory('drinks', 'Drinks'),
  MenuCategory('snacks', 'Snacks'),
];

/// Horizontal scrolling chip row for category filtering.
/// Styled to match the HTML prototype: pill-shaped, ink border,
/// active state fills with red.
class CategoryTabs extends StatelessWidget {
  final String activeCategory;
  final ValueChanged<String> onCategorySelected;

  const CategoryTabs({
    super.key,
    required this.activeCategory,
    required this.onCategorySelected,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(vertical: 6),
        itemCount: menuCategories.length,
        separatorBuilder: (context, index) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final cat = menuCategories[index];
          final isActive = cat.id == activeCategory;
          return _CategoryChip(
            label: cat.label,
            isActive: isActive,
            onTap: () => onCategorySelected(cat.id),
          );
        },
      ),
    );
  }
}

class _CategoryChip extends StatelessWidget {
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _CategoryChip({
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
        decoration: BoxDecoration(
          color: isActive ? AppColors.red : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: isActive ? AppColors.red : AppColors.ink,
            width: 1.5,
          ),
        ),
        child: Text(
          label,
          style: AppFonts.body(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: isActive ? Colors.white : AppColors.ink,
          ),
        ),
      ),
    );
  }
}
