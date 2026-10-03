import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/menu_item.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../services/firestore_service.dart';
import '../services/preferences_service.dart';
import '../theme/app_theme.dart';
import '../widgets/bouncy_tap.dart';
import '../widgets/menu_item_card.dart';
import 'login_sheet.dart';

/// Platform 2.0 — Customer Favourite Dishes Screen with subtle entrance and idle animations
class FavouritesScreen extends StatelessWidget {
  const FavouritesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentProfile;
    final prefsService = PreferencesService();
    final firestore = FirestoreService();

    if (user == null || auth.isGuest) {
      return Scaffold(
        backgroundColor: AppColors.surface,
        appBar: AppBar(
          title: Text('Saved Favourites ❤️', style: AppFonts.display(fontSize: 20)),
          backgroundColor: AppColors.surface,
          elevation: 0,
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.favorite_border_rounded, size: 56, color: AppColors.inkSecondary),
                const SizedBox(height: 16),
                Text(
                  'Sign in to view your saved dishes',
                  style: AppFonts.display(fontSize: 18),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'Your favourite snacks and quick re-orders will appear here.',
                  style: AppFonts.body(fontSize: 14, color: AppColors.inkSecondary),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                BouncyTap(
                  onTap: () => LoginSheet.show(context),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                    decoration: BoxDecoration(
                      color: AppColors.red,
                      borderRadius: AppRadius.radiusMd,
                    ),
                    child: Text(
                      'Sign In to Thakur Bites',
                      style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        elevation: 0,
        leading: BouncyTap(
          scaleFactor: 0.92,
          onTap: () => Navigator.of(context).pop(),
          child: const Center(
            child: Icon(Icons.arrow_back_ios_new_rounded, size: 20, color: AppColors.ink),
          ),
        ),
        title: Text('Saved Favourites ❤️', style: AppFonts.display(fontSize: 20)),
        centerTitle: false,
      ),
      body: StreamBuilder<Set<String>>(
        stream: prefsService.favouritesStream(user.uid),
        builder: (context, favSnapshot) {
          final favIds = favSnapshot.data ?? prefsService.cachedFavourites;

          if (favIds.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const _FloatingHeartBadge(),
                    const SizedBox(height: 16),
                    Text('No Favourites Yet', style: AppFonts.display(fontSize: 22)),
                    const SizedBox(height: 6),
                    Text(
                      'Tap the heart icon on any dish in the canteen menu to save it here for fast 1-tap reordering!',
                      style: AppFonts.body(fontSize: 13, color: AppColors.inkSoft),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 20),
                    Semantics(
                      button: true,
                      label: 'Explore canteen menu',
                      child: BouncyTap(
                        scaleFactor: 0.96,
                        onTap: () => Navigator.of(context).pop(),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                          decoration: BoxDecoration(
                            color: AppColors.red,
                            borderRadius: AppRadius.radiusMd,
                          ),
                          child: Text(
                            'Explore Menu 🍱',
                            style: AppFonts.body(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
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

          return StreamBuilder<List<MenuItem>>(
            stream: firestore.allMenuItemsStream(),
            builder: (context, menuSnapshot) {
              if (menuSnapshot.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator(color: AppColors.red));
              }

              final allItems = menuSnapshot.data ?? [];
              final favItems = allItems.where((item) => favIds.contains(item.id)).toList();

              if (favItems.isEmpty) {
                return Center(
                  child: Text(
                    'Your favourited items are currently being updated.',
                    style: AppFonts.body(fontSize: 13, color: AppColors.inkSoft),
                  ),
                );
              }

              return Consumer<CartProvider>(
                builder: (context, cart, _) {
                  return LayoutBuilder(
                    builder: (context, constraints) {
                      final width = constraints.maxWidth;
                      final int crossAxisCount = width >= 1100
                          ? 5
                          : (width >= 820
                              ? 4
                              : (width >= 560 ? 3 : 2));
                      final double childAspectRatio = width >= 820 ? 0.74 : (width >= 560 ? 0.72 : 0.72);

                      return GridView.builder(
                        padding: EdgeInsets.symmetric(
                          horizontal: width >= 600 ? 24 : 18,
                          vertical: 18,
                        ),
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: crossAxisCount,
                          crossAxisSpacing: width >= 600 ? 14 : 12,
                          mainAxisSpacing: width >= 600 ? 14 : 12,
                          childAspectRatio: childAspectRatio,
                        ),
                        itemCount: favItems.length,
                        itemBuilder: (context, index) {
                          final item = favItems[index];
                          final staggeredDelay = (index * 35).clamp(0, 280);
                          return TweenAnimationBuilder<double>(
                            tween: Tween<double>(begin: 0.0, end: 1.0),
                            duration: Duration(milliseconds: 220 + staggeredDelay),
                            curve: Curves.easeOutCubic,
                            builder: (context, progress, child) {
                              return Opacity(
                                opacity: progress,
                                child: Transform.translate(
                                  offset: Offset(0, 14 * (1 - progress)),
                                  child: child,
                                ),
                              );
                            },
                            child: MenuItemCard(item: item),
                          );
                        },
                      );
                    },
                  );
                },
              );
            },
          );
        },
      ),
    );
  }
}

/// Floating, breathing heart badge for empty state
class _FloatingHeartBadge extends StatefulWidget {
  const _FloatingHeartBadge();

  @override
  State<_FloatingHeartBadge> createState() => _FloatingHeartBadgeState();
}

class _FloatingHeartBadgeState extends State<_FloatingHeartBadge>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _scaleAnimation;
  late final Animation<double> _yAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);

    _scaleAnimation = Tween<double>(begin: 1.0, end: 1.08).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
    _yAnimation = Tween<double>(begin: 0.0, end: -4.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Transform.translate(
          offset: Offset(0, _yAnimation.value),
          child: Transform.scale(
            scale: _scaleAnimation.value,
            child: child,
          ),
        );
      },
      child: Container(
        width: 72,
        height: 72,
        decoration: BoxDecoration(
          color: AppColors.surface2,
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.line),
        ),
        child: const Center(
          child: Text('❤️', style: TextStyle(fontSize: 32)),
        ),
      ),
    );
  }
}
