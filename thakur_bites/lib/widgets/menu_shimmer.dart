import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';
import '../theme/app_theme.dart';

/// Skeleton shimmer placeholder for the menu grid while Firestore loads.
/// Shows 6 ghost cards matching the 2-column grid layout.
class MenuShimmer extends StatelessWidget {
  const MenuShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final int crossAxisCount = width >= 1100
            ? 5
            : (width >= 820
                ? 4
                : (width >= 560 ? 3 : 2));
        final double childAspectRatio = width >= 820 ? 0.74 : (width >= 560 ? 0.72 : 0.82);
        final int itemCount = crossAxisCount * 2;

        return Shimmer.fromColors(
          baseColor: AppColors.surface2,
          highlightColor: AppColors.surface,
          child: GridView.builder(
            padding: const EdgeInsets.only(bottom: 16, top: 4),
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: crossAxisCount,
              crossAxisSpacing: width >= 600 ? 14 : 12,
              mainAxisSpacing: width >= 600 ? 14 : 12,
              childAspectRatio: childAspectRatio,
            ),
            itemCount: itemCount,
            itemBuilder: (context, index) {
              return Container(
                decoration: BoxDecoration(
                  color: AppColors.surface2,
                  borderRadius: BorderRadius.circular(16),
                ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  // Badge placeholder
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      width: 56,
                      height: 16,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  // Icon circle placeholder
                  Container(
                    width: 58,
                    height: 58,
                    decoration: const BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(height: 14),
                  // Name placeholder
                  Container(
                    width: 80,
                    height: 14,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 8),
                  // Price placeholder
                  Container(
                    width: 36,
                    height: 12,
                    decoration: BoxDecoration(
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  },
);
  }
}
