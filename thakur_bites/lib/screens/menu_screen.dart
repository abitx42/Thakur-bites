import 'package:flutter/material.dart';
import '../models/menu_item.dart';
import '../services/firestore_service.dart';
import '../theme/app_theme.dart';
import '../widgets/category_tabs.dart';
import '../widgets/menu_item_card.dart';

/// Phase 2 — Live menu screen.
/// Pulls items from Firestore via StreamBuilder, filters by category,
/// renders a 2-column grid of mustard/green cards.
class MenuScreen extends StatefulWidget {
  const MenuScreen({super.key});

  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends State<MenuScreen> {
  final FirestoreService _firestore = FirestoreService();
  String _activeCategory = 'all';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Column(
          children: [
            // ─── Top Brand Header ───────────────────────────────────
            _buildHeader(),

            // ─── Body (scrollable) ──────────────────────────────────
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 18),
                child: Column(
                  children: [
                    // Category tabs
                    CategoryTabs(
                      activeCategory: _activeCategory,
                      onCategorySelected: (cat) {
                        setState(() => _activeCategory = cat);
                      },
                    ),

                    const SizedBox(height: 6),

                    // Menu grid (StreamBuilder)
                    Expanded(
                      child: StreamBuilder<List<MenuItem>>(
                        stream: _firestore.menuItemsStream(),
                        builder: (context, snapshot) {
                          if (snapshot.connectionState ==
                              ConnectionState.waiting) {
                            return const Center(
                              child: CircularProgressIndicator(
                                color: AppColors.red,
                              ),
                            );
                          }

                          if (snapshot.hasError) {
                            return _buildErrorState(snapshot.error.toString());
                          }

                          final allItems = snapshot.data ?? [];
                          if (allItems.isEmpty) {
                            return _buildEmptyState();
                          }

                          // Client-side category filter
                          final filtered = _activeCategory == 'all'
                              ? allItems
                              : allItems
                                  .where(
                                      (item) => item.category == _activeCategory)
                                  .toList();

                          if (filtered.isEmpty) {
                            return _buildEmptyCategory();
                          }

                          return _buildGrid(filtered);
                        },
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // ─── Bottom Navigation ──────────────────────────────────
            _buildBottomNav(),
          ],
        ),
      ),
    );
  }

  // ─── Top Brand Header ───────────────────────────────────────────

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Brand wordmark
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              RichText(
                text: TextSpan(
                  style: AppFonts.display(fontSize: 30),
                  children: const [
                    TextSpan(text: 'THAKUR'),
                    TextSpan(
                      text: '.',
                      style: TextStyle(color: AppColors.red),
                    ),
                    TextSpan(text: 'BITES'),
                  ],
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Pickup — TCET canteen',
                style: AppFonts.body(
                  fontSize: 12.5,
                  color: AppColors.inkSoft,
                ),
              ),
            ],
          ),

          // Cart icon button (Phase 3 will wire this)
          _CartIconButton(itemCount: 0),
        ],
      ),
    );
  }

  // ─── Menu Grid ──────────────────────────────────────────────────

  Widget _buildGrid(List<MenuItem> items) {
    return GridView.builder(
      padding: const EdgeInsets.only(bottom: 16, top: 4),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        childAspectRatio: 0.82,
      ),
      itemCount: items.length,
      itemBuilder: (context, index) {
        return MenuItemCard(item: items[index]);
      },
    );
  }

  // ─── Empty/Error States ─────────────────────────────────────────

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.restaurant_menu_rounded,
              size: 48, color: AppColors.inkSoft),
          const SizedBox(height: 12),
          Text(
            'No items on the menu right now',
            style: AppFonts.body(fontSize: 14, color: AppColors.inkSoft),
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _seedDemoData,
            icon: const Icon(Icons.add_circle_outline, size: 18),
            label: const Text('Seed demo items'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.red,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyCategory() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.search_off_rounded,
              size: 40, color: AppColors.inkSoft),
          const SizedBox(height: 8),
          Text(
            'Nothing in this category',
            style: AppFonts.body(fontSize: 14, color: AppColors.inkSoft),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState(String error) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 40, color: AppColors.red),
            const SizedBox(height: 12),
            Text(
              'Failed to load menu',
              style: AppFonts.body(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink),
            ),
            const SizedBox(height: 4),
            Text(
              error,
              style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  // ─── Bottom Navigation ──────────────────────────────────────────

  Widget _buildBottomNav() {
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.line, width: 1)),
        color: AppColors.surface,
      ),
      padding: const EdgeInsets.only(top: 10, bottom: 12),
      child: Row(
        children: [
          _BottomNavItem(
            icon: Icons.home_rounded,
            label: 'Menu',
            isActive: true,
            onTap: () {},
          ),
          _BottomNavItem(
            icon: Icons.receipt_long_rounded,
            label: 'Orders',
            isActive: false,
            onTap: () {
              // Phase 6: navigate to order status screen
            },
          ),
        ],
      ),
    );
  }

  // ─── Seed helper (for empty state) ──────────────────────────────

  Future<void> _seedDemoData() async {
    try {
      await _firestore.seedPhase2MenuItems();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to seed: $e')),
        );
      }
    }
  }
}

// ─── Cart Icon Button ─────────────────────────────────────────────

class _CartIconButton extends StatelessWidget {
  final int itemCount;

  const _CartIconButton({required this.itemCount});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        // Phase 3: navigate to cart screen
      },
      child: Container(
        width: 38,
        height: 38,
        decoration: const BoxDecoration(
          color: AppColors.ink,
          shape: BoxShape.circle,
        ),
        child: Stack(
          children: [
            const Center(
              child: Icon(
                Icons.shopping_cart_outlined,
                color: AppColors.surface,
                size: 17,
              ),
            ),
            if (itemCount > 0)
              Positioned(
                top: 0,
                right: 0,
                child: Container(
                  width: 17,
                  height: 17,
                  decoration: const BoxDecoration(
                    color: AppColors.red,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(
                      '$itemCount',
                      style: AppFonts.mono(
                        fontSize: 10,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ─── Bottom Nav Item ──────────────────────────────────────────────

class _BottomNavItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _BottomNavItem({
    required this.icon,
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = isActive ? AppColors.red : AppColors.inkSoft;
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 20, color: color),
            const SizedBox(height: 3),
            Text(
              label,
              style: AppFonts.body(
                fontSize: 10.5,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
