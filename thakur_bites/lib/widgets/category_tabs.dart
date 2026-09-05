import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Primary Category definition
class PrimaryCategory {
  final String id;
  final String label;
  final String iconEmoji;

  const PrimaryCategory(this.id, this.label, this.iconEmoji);
}

/// Subcategory definition
class SubCategory {
  final String id;
  final String label;

  const SubCategory(this.id, this.label);
}

/// The top-level categories
const List<PrimaryCategory> primaryCategories = [
  PrimaryCategory('all', 'All Items', '✨'),
  PrimaryCategory('FOOD', 'Food', '🍛'),
  PrimaryCategory('SNACKS', 'Snacks', '🍟'),
  PrimaryCategory('BEVERAGES', 'Drinks', '🥤'),
];

/// Subcategories by parent category
const Map<String, List<SubCategory>> subcategoriesByParent = {
  'FOOD': [
    SubCategory('all', 'All Food'),
    SubCategory('South Indian', '🍛 South Indian'),
    SubCategory('Sandwiches', '🥪 Sandwiches'),
    SubCategory('Chinese', '🍜 Chinese'),
    SubCategory('Lunch & Meals', '🍱 Lunch & Meals'),
  ],
  'SNACKS': [
    SubCategory('all', 'All Snacks'),
    SubCategory('Pav Items', '🥖 Pav & Samosa'),
    SubCategory('Fries', '🍟 French Fries'),
    SubCategory('Quick', '🥪 Quick Bites'),
    SubCategory('Packaged', '🍫 Packaged'),
  ],
  'BEVERAGES': [
    SubCategory('all', 'All Drinks'),
    SubCategory('Tea & Coffee', '☕ Tea & Coffee'),
    SubCategory('Cold Drinks', '🥤 Cold Drinks'),
    SubCategory('Milkshakes', '🥛 Milkshakes'),
    SubCategory('Juices', '🧃 Fresh Juices'),
  ],
};

/// Legacy compatibility list
class MenuCategory {
  final String id;
  final String label;
  const MenuCategory(this.id, this.label);
}

const List<MenuCategory> menuCategories = [
  MenuCategory('all', 'All'),
  MenuCategory('dosa', 'Dosa'),
  MenuCategory('rotibhaji', 'Roti-Bhaji'),
  MenuCategory('drinks', 'Drinks'),
  MenuCategory('snacks', 'Snacks'),
];

/// Two-level hierarchical navigation widget for Thakur Bites catalog.
/// Level 1: Primary category pills (Food, Snacks, Drinks).
/// Level 2: Subcategory chips (South Indian, Chinese, etc.) when parent selected.
class CategoryTabs extends StatelessWidget {
  final String activeParentCategory;
  final ValueChanged<String> onParentCategorySelected;
  final String activeSubCategory;
  final ValueChanged<String> onSubCategorySelected;

  // Legacy constructor compatibility
  final String? activeCategory;
  final ValueChanged<String>? onCategorySelected;

  const CategoryTabs({
    super.key,
    this.activeParentCategory = 'all',
    required this.onParentCategorySelected,
    this.activeSubCategory = 'all',
    required this.onSubCategorySelected,
    this.activeCategory,
    this.onCategorySelected,
  });

  @override
  Widget build(BuildContext context) {
    final effectiveParent = activeCategory != null && activeCategory != 'all'
        ? (activeCategory == 'drinks' ? 'BEVERAGES' : (activeCategory == 'snacks' ? 'SNACKS' : 'FOOD'))
        : activeParentCategory;

    final subcats = subcategoriesByParent[effectiveParent];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Level 1: Primary Category Pills
        SizedBox(
          height: 42,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(vertical: 2),
            itemCount: primaryCategories.length,
            separatorBuilder: (context, index) => const SizedBox(width: 8),
            itemBuilder: (context, index) {
              final cat = primaryCategories[index];
              final isActive = cat.id == effectiveParent;
              return _PrimaryPill(
                label: '${cat.iconEmoji} ${cat.label}',
                isActive: isActive,
                onTap: () {
                  onParentCategorySelected(cat.id);
                  onSubCategorySelected('all');
                  if (onCategorySelected != null) {
                    onCategorySelected!(cat.id);
                  }
                },
              );
            },
          ),
        ),

        // Level 2: Subcategory Chips (Only visible when a specific parent category is chosen)
        if (subcats != null && subcats.isNotEmpty) ...[
          const SizedBox(height: 6),
          SizedBox(
            height: 34,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(vertical: 2),
              itemCount: subcats.length,
              separatorBuilder: (context, index) => const SizedBox(width: 6),
              itemBuilder: (context, index) {
                final sub = subcats[index];
                final isActive = sub.id == activeSubCategory;
                return _SubCategoryChip(
                  label: sub.label,
                  isActive: isActive,
                  onTap: () => onSubCategorySelected(sub.id),
                );
              },
            ),
          ),
        ],
      ],
    );
  }
}

class _PrimaryPill extends StatelessWidget {
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _PrimaryPill({
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isActive ? AppColors.red : AppColors.surface,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: isActive ? AppColors.red : AppColors.line,
            width: 1.5,
          ),
          boxShadow: isActive
              ? [
                  BoxShadow(
                    color: AppColors.red.withAlpha(50),
                    blurRadius: 8,
                    offset: const Offset(0, 3),
                  ),
                ]
              : null,
        ),
        child: Text(
          label,
          style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: isActive ? Colors.white : AppColors.ink,
          ),
        ),
      ),
    );
  }
}

class _SubCategoryChip extends StatelessWidget {
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _SubCategoryChip({
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        decoration: BoxDecoration(
          color: isActive ? AppColors.ink : AppColors.surface,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isActive ? AppColors.ink : AppColors.line,
            width: 1,
          ),
        ),
        child: Center(
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 11.5,
              fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
              color: isActive ? Colors.white : AppColors.inkSoft,
            ),
          ),
        ),
      ),
    );
  }
}
