import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/menu_item.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../services/firestore_service.dart';
import '../services/preferences_service.dart';
import '../theme/app_theme.dart';
import '../widgets/menu_item_card.dart';

/// Platform 2.0 — Customer Favourite Dishes Screen
class FavouritesScreen extends StatelessWidget {
  const FavouritesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.currentProfile;
    final prefsService = PreferencesService();
    final firestore = FirestoreService();

    if (user == null) {
      return Scaffold(
        backgroundColor: AppColors.surface,
        appBar: AppBar(title: const Text('Saved Favourites')),
        body: const Center(child: Text('Please sign in to view your saved dishes.')),
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
                    Container(
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
                    const SizedBox(height: 16),
                    Text('No Favourites Yet', style: AppFonts.display(fontSize: 22)),
                    const SizedBox(height: 6),
                    Text(
                      'Tap the heart icon on any dish in the canteen menu to save it here for fast 1-tap reordering!',
                      style: AppFonts.body(fontSize: 13, color: AppColors.inkSoft),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 20),
                    ElevatedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.red,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: Text('Explore Menu 🍱', style: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white)),
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
                  child: Text('Your favourited items are currently being updated.', style: AppFonts.body(fontSize: 13, color: AppColors.inkSoft)),
                );
              }

              return Consumer<CartProvider>(
                builder: (context, cart, _) {
                  return GridView.builder(
                    padding: const EdgeInsets.all(18),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      childAspectRatio: 0.72,
                    ),
                    itemCount: favItems.length,
                    itemBuilder: (context, index) {
                      final item = favItems[index];
                      return MenuItemCard(item: item);
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
