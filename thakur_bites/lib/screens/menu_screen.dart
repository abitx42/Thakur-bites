import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/menu_item.dart';
import '../models/order.dart' as app;
import '../models/student.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../screens/cart_screen.dart';
import '../screens/login_sheet.dart';
import '../screens/order_status_screen.dart';
import '../services/firestore_service.dart';
import '../theme/app_theme.dart';
import '../widgets/category_tabs.dart';
import '../widgets/menu_item_card.dart';
import '../widgets/menu_shimmer.dart';

/// Phase 7 — Live menu screen with Student Authentication & Orders History.
/// Features: brand header with student greeting, search bar, category tabs, 2-col grid,
/// pull-to-refresh, shimmer loading, 3-tab navigation with dynamic Profile & Orders tabs.
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
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        final student = auth.currentStudent;
        final firstName = student != null ? student.name.split(' ').first : '';

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
                    student != null
                        ? 'Hey, $firstName 👋 · TCET canteen'
                        : 'Pickup — TCET canteen',
                    style: AppFonts.body(fontSize: 12.5, color: AppColors.inkSoft),
                  ),
                ],
              ),

              // Right header actions: Student Avatar / Sign-In & Cart
              Row(
                children: [
                  if (student != null) ...[
                    GestureDetector(
                      onTap: () => setState(() => _currentNavIndex = 2),
                      child: Container(
                        margin: const EdgeInsets.only(right: 10),
                        width: 38,
                        height: 38,
                        decoration: BoxDecoration(
                          color: AppColors.mustardSoft,
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.mustardInk.withOpacity(0.3), width: 1.5),
                        ),
                        child: Center(
                          child: Text(
                            student.initials,
                            style: AppFonts.mono(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppColors.mustardInk,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ] else ...[
                    GestureDetector(
                      onTap: () => LoginSheet.show(context),
                      child: Container(
                        margin: const EdgeInsets.only(right: 10),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: AppColors.surface2,
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: AppColors.line, width: 1),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.person_outline_rounded, size: 16, color: AppColors.ink),
                            const SizedBox(width: 4),
                            Text(
                              'Sign in',
                              style: AppFonts.body(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: AppColors.ink,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],

                  // Cart button — live badge from CartProvider
                  Consumer<CartProvider>(
                    builder: (context, cart, _) {
                      return GestureDetector(
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const CartScreen()),
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
            ],
          ),
        );
      },
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
  //  ORDERS TAB (Live History & Quick Reorder)
  // ═══════════════════════════════════════════════════════════════════

  Widget _buildOrdersTab() {
    final student = context.watch<AuthProvider>().currentStudent;
    final stream = student != null
        ? _firestore.studentOrdersStream(student.uid)
        : _firestore.ordersStream();

    return Column(
      children: [
        // Tab Header
        Container(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: AppColors.line, width: 1)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Your orders', style: AppFonts.display(fontSize: 22)),
              if (student != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.surface2,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    student.rollNo,
                    style: AppFonts.mono(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.inkSoft),
                  ),
                ),
            ],
          ),
        ),

        // Orders list
        Expanded(
          child: StreamBuilder<List<app.Order>>(
            stream: stream,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(
                  child: CircularProgressIndicator(color: AppColors.red),
                );
              }

              final orders = snapshot.data ?? [];
              if (orders.isEmpty) {
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
                            style:
                                AppFonts.body(fontSize: 14, color: AppColors.inkSoft),
                            textAlign: TextAlign.center),
                        const SizedBox(height: 20),
                        ElevatedButton(
                          onPressed: () => setState(() => _currentNavIndex = 0),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.red,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
                          ),
                          child: const Text('Browse Menu'),
                        ),
                      ],
                    ),
                  ),
                );
              }

              return ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                itemCount: orders.length,
                itemBuilder: (context, index) {
                  final order = orders[index];
                  return _OrderCard(order: order);
                },
              );
            },
          ),
        ),
      ],
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PROFILE TAB (Student Dashboard & Sign In)
  // ═══════════════════════════════════════════════════════════════════

  Widget _buildProfileTab() {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        final student = auth.currentStudent;

        if (student == null) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      color: AppColors.surface2,
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.line, width: 1.5),
                    ),
                    child: const Center(
                      child: Icon(Icons.person_outline_rounded,
                          size: 38, color: AppColors.inkSoft),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text('Student Sign-In',
                      style: AppFonts.display(fontSize: 24)),
                  const SizedBox(height: 6),
                  Text(
                    'Sign in with your name & roll number to track past canteen orders and reorder in one tap.',
                    style: AppFonts.body(fontSize: 13.5, color: AppColors.inkSoft),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: () => LoginSheet.show(context),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.red,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 36, vertical: 14),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(999)),
                    ),
                    child: Text('Sign in with TCET ID →',
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

        // Authenticated Student Profile Dashboard
        return SingleChildScrollView(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Text('Student Profile', style: AppFonts.display(fontSize: 24)),
              const SizedBox(height: 16),

              // Profile Card
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.line, width: 1.5),
                ),
                child: Row(
                  children: [
                    // Avatar Initials
                    Container(
                      width: 58,
                      height: 58,
                      decoration: BoxDecoration(
                        color: AppColors.mustardSoft,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.mustardInk.withOpacity(0.3), width: 1.5),
                      ),
                      child: Center(
                        child: Text(
                          student.initials,
                          style: AppFonts.mono(
                            fontSize: 20,
                            fontWeight: FontWeight.w700,
                            color: AppColors.mustardInk,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 14),

                    // Info
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            student.name,
                            style: AppFonts.body(
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: AppColors.surface2,
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(color: AppColors.line, width: 1),
                                ),
                                child: Text(
                                  student.rollNo,
                                  style: AppFonts.mono(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.ink,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                student.phone,
                                style: AppFonts.mono(fontSize: 12, color: AppColors.inkSoft),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // 3-Column Stats
              Row(
                children: [
                  _buildStatCard(
                    title: 'Orders',
                    value: '${student.totalOrders}',
                    color: AppColors.red,
                  ),
                  const SizedBox(width: 10),
                  _buildStatCard(
                    title: 'College',
                    value: 'TCET',
                    color: AppColors.ink,
                  ),
                  const SizedBox(width: 10),
                  _buildStatCard(
                    title: 'Account',
                    value: 'Active ⚡️',
                    color: AppColors.green,
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Canteen Info
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.surface2,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.storefront_rounded, size: 18, color: AppColors.ink),
                        const SizedBox(width: 8),
                        Text(
                          'Canteen Counter Details',
                          style: AppFonts.body(fontSize: 13.5, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      '• Operating Hours: 8:00 AM – 5:30 PM\n• Pickup Location: Ground Floor Canteen Station\n• Show token number & PIN at the counter',
                      style: AppFonts.body(fontSize: 12.5, color: AppColors.inkSoft),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Sign Out Button
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => _confirmSignOut(context, auth),
                  icon: const Icon(Icons.logout_rounded, size: 18, color: AppColors.red),
                  label: Text('Sign out', style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.red)),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: AppColors.red, width: 1.5),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildStatCard({
    required String title,
    required String value,
    required Color color,
  }) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.line, width: 1),
        ),
        child: Column(
          children: [
            Text(
              value,
              style: AppFonts.mono(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              title,
              style: AppFonts.body(fontSize: 11, color: AppColors.inkSoft),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmSignOut(BuildContext context, AuthProvider auth) async {
    final shouldSignOut = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('Sign Out?', style: AppFonts.display(fontSize: 20)),
        content: Text(
          'Are you sure you want to sign out of your student account?',
          style: AppFonts.body(fontSize: 13.5, color: AppColors.inkSoft),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('Cancel', style: AppFonts.body(fontSize: 13.5, color: AppColors.ink)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.red,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
            ),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );

    if (shouldSignOut == true) {
      await auth.signOut();
    }
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
          height: 44,
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

// ─── Order Card (in Orders Tab with Quick Reorder) ─────────────────

class _OrderCard extends StatelessWidget {
  final app.Order order;

  const _OrderCard({required this.order});

  @override
  Widget build(BuildContext context) {
    final isReady = order.status == 'ready';
    final isCollected = order.status == 'collected';
    final isPreparing = order.status == 'preparing';

    Color statusColor;
    Color statusBg;
    if (isReady) {
      statusColor = AppColors.green;
      statusBg = AppColors.greenSoft;
    } else if (isPreparing) {
      statusColor = AppColors.mustardInk;
      statusBg = AppColors.mustardSoft;
    } else if (isCollected) {
      statusColor = AppColors.inkSoft;
      statusBg = AppColors.surface2;
    } else {
      statusColor = AppColors.red;
      statusBg = AppColors.red.withOpacity(0.12);
    }

    final itemsSummary =
        order.items.map((i) => '${i.quantity}x ${i.name}').join(', ');

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Top row: Token & Status Badge
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Text(
                    order.tokenNumber,
                    style: AppFonts.mono(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.surface2,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      'PIN: ${order.pinCode}',
                      style: AppFonts.mono(
                        fontSize: 11,
                        color: AppColors.inkSoft,
                      ),
                    ),
                  ),
                ],
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: statusBg,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  order.statusLabel,
                  style: AppFonts.body(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: statusColor,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // Items summary
          Text(
            itemsSummary,
            style: AppFonts.body(
              fontSize: 13.5,
              color: AppColors.ink,
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 12),

          // Divider
          Container(height: 1, color: AppColors.line),
          const SizedBox(height: 10),

          // Bottom row: Time, Price, Reorder & Track Actions
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _formatTime(order.createdAt),
                    style: AppFonts.body(
                      fontSize: 11.5,
                      color: AppColors.inkSoft,
                    ),
                  ),
                  Text(
                    '₹${order.totalAmount.toInt()}',
                    style: AppFonts.mono(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                ],
              ),

              // Action buttons
              Row(
                children: [
                  // Quick Reorder button
                  GestureDetector(
                    onTap: () => _handleReorder(context),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                      decoration: BoxDecoration(
                        color: AppColors.surface2,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: AppColors.line, width: 1),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.repeat_rounded, size: 14, color: AppColors.ink),
                          const SizedBox(width: 4),
                          Text(
                            'Reorder',
                            style: AppFonts.body(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: AppColors.ink,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),

                  // Track live button
                  GestureDetector(
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => OrderStatusScreen(orderId: order.id),
                        ),
                      );
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                      decoration: BoxDecoration(
                        color: AppColors.ink,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Row(
                        children: [
                          Text(
                            'Track',
                            style: AppFonts.body(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(width: 2),
                          const Icon(
                            Icons.chevron_right_rounded,
                            size: 14,
                            color: Colors.white,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _handleReorder(BuildContext context) {
    HapticFeedback.selectionClick();
    final cart = context.read<CartProvider>();

    for (final item in order.items) {
      final menuItem = MenuItem(
        id: item.menuItemId,
        name: item.name,
        price: item.price,
        category: 'dosa', // Fallback category
        type: 'cooked',
        prepMinutes: 6,
      );
      cart.setQty(menuItem, item.quantity);
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Reordered ${order.items.length} items to your cart! 🛒'),
        backgroundColor: AppColors.green,
        duration: const Duration(seconds: 2),
        action: SnackBarAction(
          label: 'View Cart',
          textColor: Colors.white,
          onPressed: () {
            Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const CartScreen()),
            );
          },
        ),
      ),
    );
  }

  String _formatTime(DateTime dt) {
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final m = dt.minute.toString().padLeft(2, '0');
    final ampm = dt.hour >= 12 ? 'PM' : 'AM';
    return '$h:$m $ampm';
  }
}
