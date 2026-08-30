import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/menu_item.dart';
import '../providers/cart_provider.dart';
import '../screens/cart_screen.dart';
import '../services/firestore_service.dart';
import '../theme/app_theme.dart';
import '../widgets/category_tabs.dart';
import '../widgets/menu_item_card.dart';
import '../widgets/menu_shimmer.dart';

/// Phase 2 — Live menu screen with real-time Firestore stream.
/// Features: brand header, search bar, category tabs, 2-col grid,
/// pull-to-refresh, shimmer loading, empty/error states, 3-tab bottom nav.
class MenuScreen extends StatefulWidget {
  const MenuScreen({super.key});

  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends State<MenuScreen> {
  final FirestoreService _firestore = FirestoreService();
  String _activeCategory = 'all';
  String _searchQuery = '';
  int _currentNavIndex = 0; // 0=Menu, 1=Orders, 2=Profile

  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Column(
          children: [
            // Body — switches based on bottom nav
            Expanded(
              child: IndexedStack(
                index: _currentNavIndex,
                children: [
                  _buildMenuTab(),
                  _buildOrdersTab(),
                  _buildProfileTab(),
                ],
              ),
            ),

            // Bottom nav
            _buildBottomNav(),
          ],
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  MENU TAB
  // ═══════════════════════════════════════════════════════════════════

  Widget _buildMenuTab() {
    return Column(
      children: [
        _buildHeader(),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18),
            child: Column(
              children: [
                // Search bar
                _buildSearchBar(),
                const SizedBox(height: 2),

                // Category tabs
                CategoryTabs(
                  activeCategory: _activeCategory,
                  onCategorySelected: (cat) {
                    setState(() => _activeCategory = cat);
                  },
                ),
                const SizedBox(height: 6),

                // Menu grid with stream
                Expanded(
                  child: StreamBuilder<List<MenuItem>>(
                    stream: _firestore.menuItemsStream(),
                    builder: (context, snapshot) {
                      // Loading → shimmer
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return const MenuShimmer();
                      }

                      // Error → message + retry
                      if (snapshot.hasError) {
                        return _buildErrorState(snapshot.error.toString());
                      }

                      final allItems = snapshot.data ?? [];
                      if (allItems.isEmpty) {
                        return _buildEmptyMenuState();
                      }

                      // Client-side category + search filter
                      var filtered = _activeCategory == 'all'
                          ? allItems
                          : allItems
                              .where((i) => i.category == _activeCategory)
                              .toList();

                      if (_searchQuery.isNotEmpty) {
                        final q = _searchQuery.toLowerCase();
                        filtered = filtered
                            .where((i) => i.name.toLowerCase().contains(q))
                            .toList();
                      }

                      if (filtered.isEmpty) {
                        return _buildEmptyCategoryState();
                      }

                      return _buildGrid(filtered);
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ─── Header ─────────────────────────────────────────────────────

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              RichText(
                text: TextSpan(
                  style: AppFonts.display(fontSize: 28),
                  children: const [
                    TextSpan(text: 'THAKUR'),
                    TextSpan(
                      text: '·',
                      style: TextStyle(color: AppColors.red),
                    ),
                    TextSpan(text: 'BITES'),
                  ],
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Pickup — TCET canteen',
                style: AppFonts.body(fontSize: 12.5, color: AppColors.inkSoft),
              ),
            ],
          ),
          // Cart button — live badge from CartProvider
          Consumer<CartProvider>(
            builder: (context, cart, _) {
              return GestureDetector(
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                        builder: (_) => const CartScreen()),
                  );
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
                        child: Icon(Icons.shopping_cart_outlined,
                            color: AppColors.surface, size: 17),
                      ),
                      Positioned(
                        top: 0,
                        right: 0,
                        child: _CartBadge(count: cart.totalItemCount),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  // ─── Search Bar ─────────────────────────────────────────────────

  Widget _buildSearchBar() {
    return Container(
      height: 40,
      margin: const EdgeInsets.only(top: 10),
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: BorderRadius.circular(12),
      ),
      child: TextField(
        controller: _searchController,
        onChanged: (val) => setState(() => _searchQuery = val),
        style: AppFonts.body(fontSize: 13.5, color: AppColors.ink),
        decoration: InputDecoration(
          hintText: 'Search menu...',
          hintStyle: AppFonts.body(fontSize: 13.5, color: AppColors.inkSoft),
          prefixIcon:
              const Icon(Icons.search_rounded, size: 20, color: AppColors.inkSoft),
          suffixIcon: _searchQuery.isNotEmpty
              ? GestureDetector(
                  onTap: () {
                    _searchController.clear();
                    setState(() => _searchQuery = '');
                  },
                  child: const Icon(Icons.close_rounded,
                      size: 18, color: AppColors.inkSoft),
                )
              : null,
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 10),
        ),
      ),
    );
  }

  // ─── Grid ───────────────────────────────────────────────────────

  Widget _buildGrid(List<MenuItem> items) {
    return RefreshIndicator(
      color: AppColors.red,
      backgroundColor: AppColors.surface,
      onRefresh: () async {
        // StreamBuilder auto-refreshes, but this gives user feedback
        setState(() {});
        await Future.delayed(const Duration(milliseconds: 400));
      },
      child: GridView.builder(
        padding: const EdgeInsets.only(bottom: 16, top: 4),
        physics: const AlwaysScrollableScrollPhysics(),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 0.78,
        ),
        itemCount: items.length,
        itemBuilder: (context, index) {
          return MenuItemCard(item: items[index]);
        },
      ),
    );
  }

  // ─── Empty/Error States ─────────────────────────────────────────

  Widget _buildEmptyMenuState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.restaurant_menu_rounded,
              size: 48, color: AppColors.inkSoft.withOpacity(0.5)),
          const SizedBox(height: 12),
          Text('No items on the menu right now',
              style: AppFonts.body(fontSize: 14, color: AppColors.inkSoft)),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: () => _firestore.seedPhase2MenuItems(),
            icon: const Icon(Icons.add_circle_outline, size: 18),
            label: const Text('Seed demo items'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.red,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(999)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyCategoryState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.search_off_rounded,
              size: 40, color: AppColors.inkSoft.withOpacity(0.5)),
          const SizedBox(height: 8),
          Text('Nothing here',
              style: AppFonts.body(fontSize: 14, color: AppColors.inkSoft)),
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
            const Icon(Icons.wifi_off_rounded, size: 40, color: AppColors.red),
            const SizedBox(height: 12),
            Text('Couldn\'t load the menu',
                style: AppFonts.body(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink)),
            const SizedBox(height: 4),
            Text(error,
                style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: () => setState(() {}),
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: const Text('Retry'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.ink,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(999)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  ORDERS TAB (empty state)
  // ═══════════════════════════════════════════════════════════════════

  Widget _buildOrdersTab() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.receipt_long_rounded,
                size: 56, color: AppColors.inkSoft.withOpacity(0.4)),
            const SizedBox(height: 16),
            Text('No orders yet',
                style: AppFonts.body(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink)),
            const SizedBox(height: 6),
            Text('Place one from the Menu tab.',
                style: AppFonts.body(fontSize: 14, color: AppColors.inkSoft),
                textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PROFILE TAB (empty state)
  // ═══════════════════════════════════════════════════════════════════

  Widget _buildProfileTab() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.person_outline_rounded,
                size: 56, color: AppColors.inkSoft.withOpacity(0.4)),
            const SizedBox(height: 16),
            Text('Sign in to see your profile',
                style: AppFonts.body(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink)),
            const SizedBox(height: 6),
            Text('Your order history and details will appear here.',
                style: AppFonts.body(fontSize: 14, color: AppColors.inkSoft),
                textAlign: TextAlign.center),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () {
                // Phase 7: Firebase Auth phone OTP
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.red,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(999)),
              ),
              child: Text('Sign in',
                  style: AppFonts.body(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w700,
                      color: Colors.white)),
            ),
          ],
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  BOTTOM NAVIGATION (3 tabs)
  // ═══════════════════════════════════════════════════════════════════

  Widget _buildBottomNav() {
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.line, width: 1)),
        color: AppColors.surface,
      ),
      padding: const EdgeInsets.only(top: 8, bottom: 10),
      child: Row(
        children: [
          _NavItem(
            icon: Icons.home_rounded,
            label: 'Menu',
            isActive: _currentNavIndex == 0,
            onTap: () => setState(() => _currentNavIndex = 0),
          ),
          _NavItem(
            icon: Icons.receipt_long_rounded,
            label: 'Orders',
            isActive: _currentNavIndex == 1,
            onTap: () => setState(() => _currentNavIndex = 1),
          ),
          _NavItem(
            icon: Icons.person_outline_rounded,
            label: 'Profile',
            isActive: _currentNavIndex == 2,
            onTap: () => setState(() => _currentNavIndex = 2),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
//  HELPER WIDGETS
// ═══════════════════════════════════════════════════════════════════

class _CartBadge extends StatelessWidget {
  final int count;

  const _CartBadge({required this.count});

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return const SizedBox.shrink();
    return Container(
      width: 17,
      height: 17,
      decoration: const BoxDecoration(
        color: AppColors.red,
        shape: BoxShape.circle,
      ),
      child: Center(
        child: Text(
          '$count',
          style: AppFonts.mono(fontSize: 10, color: Colors.white),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _NavItem({
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
        child: SizedBox(
          height: 44, // minimum tap target
          child: Column(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
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
      ),
    );
  }
}
