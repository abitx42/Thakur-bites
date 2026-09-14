import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// A culinary status card displayed underneath the thermal receipt on the ticket screen.
/// Features the animated chef GIF with warm mustard/amber styling and live kitchen status typography.
class ChefCookingCard extends StatefulWidget {
  const ChefCookingCard({super.key});

  @override
  State<ChefCookingCard> createState() => _ChefCookingCardState();
}

class _ChefCookingCardState extends State<ChefCookingCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;
  late final Animation<double> _pulseAnim;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);

    _pulseAnim = Tween<double>(begin: 0.85, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFDF9),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: AppColors.mustard.withAlpha(70),
          width: 1.5,
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1278350F),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          // Live Dispatch Header Badge
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              AnimatedBuilder(
                animation: _pulseAnim,
                builder: (context, _) => Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.green,
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.green.withAlpha((180 * _pulseAnim.value).toInt()),
                        blurRadius: 6 * _pulseAnim.value,
                        spreadRadius: 1 * _pulseAnim.value,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 7),
              Text(
                'LIVE KITCHEN DISPATCH',
                style: AppFonts.mono(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.greenInk,
                  letterSpacing: 1.0,
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // Animated Chef GIF with Warm Rounded Border
          Container(
            height: 160,
            width: double.infinity,
            decoration: BoxDecoration(
              color: const Color(0xFFFFFBEB),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: AppColors.mustardSoft,
                width: 1,
              ),
            ),
            clipBehavior: Clip.antiAlias,
            child: Image.asset(
              'assets/animations/chef_cooking.gif',
              fit: BoxFit.contain,
              errorBuilder: (context, error, stackTrace) {
                // Graceful fallback if GIF is decoding or unavailable
                return Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.restaurant_rounded, size: 48, color: AppColors.mustard),
                      const SizedBox(height: 8),
                      Text(
                        'Masterchefs in Action',
                        style: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),

          const SizedBox(height: 14),

          // Dynamic Chef Announcement Typography
          Text(
            'Your order will be cooked soon by our masterchefs!',
            textAlign: TextAlign.center,
            style: AppFonts.display(
              fontSize: 18,
              color: AppColors.chai,
              letterSpacing: 0.4,
            ),
          ),

          const SizedBox(height: 4),

          Text(
            'Freshly prepared on order at TCET Central Counter. Live status will update automatically.',
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 11.5,
              color: AppColors.inkSoft,
            ),
          ),
        ],
      ),
    );
  }
}
