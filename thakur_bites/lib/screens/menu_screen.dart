import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/menu_item.dart';
import '../models/order.dart' as app;
import '../models/user_profile.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../screens/cart_screen.dart';
import '../screens/favourites_screen.dart';
import '../screens/login_sheet.dart';
import '../screens/order_status_screen.dart';
import '../screens/preferences_screen.dart';
import '../screens/verification_screen.dart';
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

                // Menu grid with live all items stream & stock sync
                Expanded(
                  child: StreamBuilder<List<MenuItem>>(
                    stream: _firestore.allMenuItemsStream(),
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

                      // Sync cart items with live catalog stock availability
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        context.read<CartProvider>().syncAvailability(allItems);
                      });

                      // Filter available items for menu display
                      final availableItems = allItems.where((i) => i.available).toList();

                      // Client-side category + search filter
                      var filtered = _activeCategory == 'all'
                          ? availableItems
                          : availableItems
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
                          border: Border.all(color: AppColors.mustardInk.withAlpha(76), width: 1.5),
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
              size: 48, color: AppColors.inkSoft.withAlpha(128)),
          const SizedBox(height: 12),
          Text('No items on the menu right now',
              style: AppFonts.body(fontSize: 14, color: AppColors.inkSoft)),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: () => setState(() {}),
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('Refresh Menu'),
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
              size: 40, color: AppColors.inkSoft.withAlpha(128)),
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
                    student.safeRollNo,
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
                            size: 56, color: AppColors.inkSoft.withAlpha(102)),
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

        // Authenticated Multi-Role Profile Dashboard (Platform 2.0)
        return SingleChildScrollView(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Campus Profile', style: AppFonts.display(fontSize: 24)),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: student.isVerified ? AppColors.green.withAlpha(25) : AppColors.mustardSoft,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: student.isVerified ? AppColors.green : AppColors.mustardInk,
                        width: 1,
                      ),
                    ),
                    child: Text(
                      student.isVerified ? 'VERIFIED 🟢' : 'PENDING 🟡',
                      style: AppFonts.mono(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: student.isVerified ? AppColors.green : AppColors.mustardInk,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Profile Card
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.line, width: 1.5),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        // Avatar Image or Initials
                        if (student.photoURL != null && student.photoURL!.isNotEmpty)
                          ClipOval(
                            child: Image.network(
                              student.photoURL!,
                              width: 58,
                              height: 58,
                              fit: BoxFit.cover,
                              errorBuilder: (context, error, stackTrace) => _buildAvatarFallback(student),
                            ),
                          )
                        else
                          _buildAvatarFallback(student),
                        const SizedBox(width: 14),

                        // Info
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                student.displayName,
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
                                      student.accountType.label,
                                      style: AppFonts.mono(
                                        fontSize: 11.5,
                                        fontWeight: FontWeight.w600,
                                        color: AppColors.red,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      student.email.isNotEmpty ? student.email : student.safePhone,
                                      style: AppFonts.mono(fontSize: 11.5, color: AppColors.inkSoft),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),

                        // Edit Button
                        IconButton(
                          icon: const Icon(Icons.edit_outlined, size: 20, color: AppColors.inkSoft),
                          tooltip: 'Edit Profile',
                          onPressed: () => _openEditProfileSheet(context, auth),
                        ),
                      ],
                    ),

                    const SizedBox(height: 14),
                    const Divider(height: 1, color: AppColors.line),
                    const SizedBox(height: 12),

                    // Metadata Row: Roll No, Department, Phone
                    Row(
                      children: [
                        Expanded(
                          child: _buildProfileMetaItem(
                            label: 'ROLL NO',
                            value: (student.rollNo != null && student.rollNo!.isNotEmpty) ? student.rollNo! : 'Not set',
                            icon: Icons.badge_outlined,
                          ),
                        ),
                        Container(width: 1, height: 28, color: AppColors.line),
                        Expanded(
                          child: _buildProfileMetaItem(
                            label: 'DEPT',
                            value: (student.department != null && student.department!.isNotEmpty) ? student.department! : 'Not set',
                            icon: Icons.school_outlined,
                          ),
                        ),
                        Container(width: 1, height: 28, color: AppColors.line),
                        Expanded(
                          child: _buildProfileMetaItem(
                            label: 'PHONE',
                            value: (student.phone != null && student.phone!.isNotEmpty) ? student.phone! : 'Not set',
                            icon: Icons.phone_outlined,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // 3-Column Stats (Orders, Total Spent, Priority Tier)
              Row(
                children: [
                  _buildStatCard(
                    title: 'Orders',
                    value: '${student.totalOrders}',
                    color: AppColors.red,
                  ),
                  const SizedBox(width: 10),
                  _buildStatCard(
                    title: 'Total Spent',
                    value: '₹${student.totalSpentRupees.toStringAsFixed(0)}',
                    color: AppColors.ink,
                  ),
                  const SizedBox(width: 10),
                  _buildStatCard(
                    title: 'Priority',
                    value: student.hasPriorityAccess ? 'Priority ⭐️' : 'Standard ⚡️',
                    color: student.hasPriorityAccess ? AppColors.mustardInk : AppColors.green,
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Faculty & Staff Notice
              if (student.accountType == AccountType.student || student.accountType == AccountType.visitor)
                GestureDetector(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const VerificationScreen()),
                    );
                  },
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 20),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: AppColors.mustardSoft.withAlpha(128),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: AppColors.mustardInk.withAlpha(80)),
                    ),
                    child: Row(
                      children: [
                        const Text('👨‍🏫', style: TextStyle(fontSize: 24)),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Are you TCET Faculty or Staff?',
                                style: AppFonts.body(fontSize: 13.5, fontWeight: FontWeight.w700, color: AppColors.mustardInk),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                student.verificationStatus == VerificationStatus.underReview
                                    ? 'Application submitted — Tap to view status ⏳'
                                    : 'Apply with faculty ID for priority kitchen queue access →',
                                style: AppFonts.body(fontSize: 11.5, color: AppColors.inkSoft),
                              ),
                            ],
                          ),
                        ),
                        const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: AppColors.mustardInk),
                      ],
                    ),
                  ),
                ),

              // Quick Actions List
              Text('Account & Shortcuts', style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.ink)),
              const SizedBox(height: 10),
              Container(
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.line, width: 1.5),
                ),
                child: Column(
                  children: [
                    _buildProfileMenuTile(
                      icon: Icons.badge_outlined,
                      iconColor: AppColors.red,
                      title: 'Edit Profile & Student Info',
                      subtitle: 'Update roll number, department, name & phone number',
                      onTap: () => _openEditProfileSheet(context, auth),
                    ),
                    const Divider(height: 1, color: AppColors.line),
                    _buildProfileMenuTile(
                      icon: Icons.favorite_rounded,
                      iconColor: AppColors.red,
                      title: 'Saved Favourites ❤️',
                      subtitle: 'Quick 1-tap reordering for favourite canteen dishes',
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const FavouritesScreen()),
                      ),
                    ),
                    const Divider(height: 1, color: AppColors.line),
                    _buildProfileMenuTile(
                      icon: Icons.tune_rounded,
                      iconColor: AppColors.mustardInk,
                      title: 'Dietary & Notification Preferences',
                      subtitle: 'Mild spices, less sugar, eco-friendly cutlery & push alerts',
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const PreferencesScreen()),
                      ),
                    ),
                    const Divider(height: 1, color: AppColors.line),
                    _buildProfileMenuTile(
                      icon: Icons.receipt_long_rounded,
                      iconColor: AppColors.ink,
                      title: 'Order History & Receipts',
                      subtitle: 'Review past tickets, itemized receipts & repeat orders',
                      onTap: () => setState(() => _currentNavIndex = 1),
                    ),
                  ],
                ),
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

  Widget _buildProfileMetaItem({
    required String label,
    required String value,
    required IconData icon,
  }) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 12, color: AppColors.inkSoft),
            const SizedBox(width: 4),
            Text(label, style: AppFonts.mono(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.inkSoft)),
          ],
        ),
        const SizedBox(height: 3),
        Text(
          value,
          style: AppFonts.body(fontSize: 12.5, fontWeight: FontWeight.w700, color: AppColors.ink),
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  void _openEditProfileSheet(BuildContext context, AuthProvider auth) {
    final student = auth.currentProfile;
    if (student == null) return;

    final nameController = TextEditingController(text: student.displayName);
    final rollController = TextEditingController(text: student.rollNo ?? '');
    final phoneController = TextEditingController(text: student.phone ?? '');
    String selectedDept = (student.department != null && student.department!.isNotEmpty)
        ? student.department!
        : 'CMPN';

    final departments = [
      'CMPN',
      'INFT',
      'EXTC',
      'ETRX',
      'AIDS',
      'AIML',
      'IOT',
      'CIVIL',
      'MECH',
      'MCA',
      'OTHER',
    ];
    if (!departments.contains(selectedDept)) {
      departments.insert(0, selectedDept);
    }

    final formKey = GlobalKey<FormState>();
    bool isSaving = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => StatefulBuilder(
        builder: (ctx, setSheetState) {
          final bottomInset = MediaQuery.of(ctx).viewInsets.bottom;

          return Container(
            decoration: const BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            ),
            padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 12,
              bottom: 24 + bottomInset,
            ),
            child: SingleChildScrollView(
              child: Form(
                key: formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
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
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: AppColors.red.withAlpha(25),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Icon(Icons.badge_outlined, color: AppColors.red, size: 22),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Edit Student Profile', style: AppFonts.display(fontSize: 20)),
                              Text(
                                'Keep your TCET canteen credentials up to date',
                                style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),

                    // Full Name
                    TextFormField(
                      controller: nameController,
                      decoration: InputDecoration(
                        labelText: 'Full Name',
                        labelStyle: AppFonts.body(fontSize: 13, color: AppColors.inkSoft),
                        prefixIcon: const Icon(Icons.person_outline, size: 20, color: AppColors.inkSoft),
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
                      ),
                      validator: (v) => (v == null || v.trim().length < 2) ? 'Name must be at least 2 characters' : null,
                    ),
                    const SizedBox(height: 12),

                    // Roll Number
                    TextFormField(
                      controller: rollController,
                      decoration: InputDecoration(
                        labelText: 'Roll Number (e.g. 1032251174)',
                        labelStyle: AppFonts.body(fontSize: 13, color: AppColors.inkSoft),
                        prefixIcon: const Icon(Icons.pin_outlined, size: 20, color: AppColors.inkSoft),
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
                      ),
                    ),
                    const SizedBox(height: 12),

                    // Department Dropdown
                    DropdownButtonFormField<String>(
                      initialValue: selectedDept,
                      decoration: InputDecoration(
                        labelText: 'Department',
                        labelStyle: AppFonts.body(fontSize: 13, color: AppColors.inkSoft),
                        prefixIcon: const Icon(Icons.school_outlined, size: 20, color: AppColors.inkSoft),
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
                      ),
                      items: departments
                          .map((dept) => DropdownMenuItem(
                                value: dept,
                                child: Text(dept, style: AppFonts.body(fontSize: 14)),
                              ))
                          .toList(),
                      onChanged: (val) {
                        if (val != null) {
                          setSheetState(() => selectedDept = val);
                        }
                      },
                    ),
                    const SizedBox(height: 12),

                    // Phone Number
                    TextFormField(
                      controller: phoneController,
                      keyboardType: TextInputType.phone,
                      decoration: InputDecoration(
                        labelText: 'Phone Number (10 digits)',
                        labelStyle: AppFonts.body(fontSize: 13, color: AppColors.inkSoft),
                        prefixIcon: const Icon(Icons.phone_outlined, size: 20, color: AppColors.inkSoft),
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
                      ),
                    ),
                    const SizedBox(height: 20),

                    // Save Button
                    ElevatedButton(
                      onPressed: isSaving
                          ? null
                          : () async {
                              if (!formKey.currentState!.validate()) return;
                              setSheetState(() => isSaving = true);
                              HapticFeedback.mediumImpact();

                              try {
                                await auth.updateProfileFields(
                                  displayName: nameController.text.trim(),
                                  rollNo: rollController.text.trim().toUpperCase(),
                                  department: selectedDept,
                                  phone: phoneController.text.trim(),
                                );

                                if (sheetContext.mounted) {
                                  Navigator.of(sheetContext).pop();
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: const Text('Profile updated successfully! ✨'),
                                      backgroundColor: AppColors.green,
                                      behavior: SnackBarBehavior.floating,
                                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                    ),
                                  );
                                }
                              } catch (e) {
                                if (sheetContext.mounted) {
                                  setSheetState(() => isSaving = false);
                                  ScaffoldMessenger.of(sheetContext).showSnackBar(
                                    SnackBar(
                                      content: Text('Failed to update profile: $e'),
                                      backgroundColor: AppColors.red,
                                      behavior: SnackBarBehavior.floating,
                                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                    ),
                                  );
                                }
                              }
                            },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.red,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      child: isSaving
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : Text(
                              'Save Profile Changes',
                              style: AppFonts.body(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white),
                            ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildAvatarFallback(UserProfile student) {
    return Container(
      width: 58,
      height: 58,
      decoration: BoxDecoration(
        color: AppColors.mustardSoft,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.mustardInk.withAlpha(76), width: 1.5),
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
    );
  }

  Widget _buildProfileMenuTile({
    required IconData icon,
    required Color iconColor,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return ListTile(
      onTap: () {
        HapticFeedback.selectionClick();
        onTap();
      },
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: iconColor.withAlpha(25),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, size: 20, color: iconColor),
      ),
      title: Text(title, style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle, style: AppFonts.body(fontSize: 11.5, color: AppColors.inkSoft)),
      trailing: const Icon(Icons.chevron_right_rounded, size: 20, color: AppColors.inkSoft),
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
      statusBg = AppColors.red.withAlpha(30);
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

  Future<void> _handleReorder(BuildContext context) async {
    HapticFeedback.selectionClick();
    final cart = context.read<CartProvider>();
    final firestore = FirestoreService();

    int addedCount = 0;
    int unavailableCount = 0;

    for (final item in order.items) {
      final liveItem = await firestore.getMenuItem(item.menuItemId);
      if (liveItem != null && liveItem.isInStock) {
        cart.setQty(liveItem, item.quantity);
        addedCount++;
      } else if (liveItem != null) {
        unavailableCount++;
      } else {
        // Fallback item definition if Firestore lookup fails
        final isInstant = ['cold_drink', 'chocolate', 'chips'].contains(item.menuItemId);
        final fallback = MenuItem(
          id: item.menuItemId,
          name: item.name,
          price: item.price,
          category: isInstant ? 'snacks' : 'dosa',
          type: isInstant ? 'instant' : 'cooked',
          prepMinutes: isInstant ? 0 : 6,
        );
        cart.setQty(fallback, item.quantity);
        addedCount++;
      }
    }

    if (!context.mounted) return;

    if (addedCount > 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            unavailableCount > 0
                ? 'Added $addedCount items ($unavailableCount out of stock today).'
                : 'Reordered $addedCount items with today\'s live prices! 🛒',
          ),
          backgroundColor: unavailableCount > 0 ? const Color(0xFFD97706) : AppColors.green,
          duration: const Duration(seconds: 3),
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
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Items from this order are currently out of stock on today\'s menu.'),
          backgroundColor: AppColors.red,
        ),
      );
    }
  }

  String _formatTime(DateTime dt) {
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final m = dt.minute.toString().padLeft(2, '0');
    final ampm = dt.hour >= 12 ? 'PM' : 'AM';
    return '$h:$m $ampm';
  }
}
