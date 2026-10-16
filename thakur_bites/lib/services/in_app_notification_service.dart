import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'web_push_adapter.dart';

/// In-app notification overlay service for order status updates.
/// Displays auto-dismissing banner notifications at the top of the screen.
class InAppNotificationService {
  static final InAppNotificationService _instance = InAppNotificationService._();
  factory InAppNotificationService() => _instance;
  InAppNotificationService._();

  OverlayEntry? _currentEntry;
  Timer? _autoDismissTimer;

  /// Show an in-app notification banner.
  /// [context] must have an Overlay ancestor (typically from MaterialApp).
  /// [title] is the bold headline.
  /// [subtitle] is the description text.
  /// [icon] is the leading icon.
  /// [color] determines the accent color.
  /// [actionLabel] optional CTA button text.
  /// [onAction] optional CTA callback.
  /// [duration] auto-dismiss duration (default 5 seconds).
  void show({
    required BuildContext context,
    required String title,
    required String subtitle,
    IconData icon = Icons.notifications_rounded,
    Color color = AppColors.green,
    String? actionLabel,
    VoidCallback? onAction,
    Duration duration = const Duration(seconds: 5),
  }) {
    dismiss(); // Remove any existing notification

    final overlay = Overlay.of(context, rootOverlay: true);

    _currentEntry = OverlayEntry(
      builder: (context) => _NotificationBanner(
        title: title,
        subtitle: subtitle,
        icon: icon,
        color: color,
        actionLabel: actionLabel,
        onAction: () {
          onAction?.call();
          dismiss();
        },
        onDismiss: dismiss,
      ),
    );

    overlay.insert(_currentEntry!);

    _autoDismissTimer?.cancel();
    _autoDismissTimer = Timer(duration, dismiss);
  }

  /// Show order placed notification with Track Here action.
  void showOrderPlaced({
    required BuildContext context,
    required String tokenNumber,
    required VoidCallback onTrack,
  }) {
    requestPushPermission();
    sendNativeSystemNotification(
      '🎉 Order Placed! Token $tokenNumber',
      'Your order is confirmed. Track live status here.',
      tag: 'tb-order-placed',
    );

    show(
      context: context,
      title: '🎉 Order Placed! Token $tokenNumber',
      subtitle: 'Your order is confirmed. Track live status here.',
      icon: Icons.check_circle_rounded,
      color: AppColors.green,
      actionLabel: 'Track Here →',
      onAction: onTrack,
      duration: const Duration(seconds: 8),
    );
  }

  /// Show order status change notification.
  void showStatusChange({
    required BuildContext context,
    required String tokenNumber,
    required String newStatus,
    VoidCallback? onTrack,
  }) {
    String title;
    String subtitle;
    IconData icon;
    Color color;

    switch (newStatus) {
      case 'preparing':
        title = '🔥 Now Cooking! Token $tokenNumber';
        subtitle = 'Your order is being prepared in the kitchen.';
        icon = Icons.restaurant_rounded;
        color = AppColors.warning;
      case 'ready':
        title = '⚡ Ready for Pickup! Token $tokenNumber';
        subtitle = 'Head to the counter with your PIN.';
        icon = Icons.check_circle_rounded;
        color = AppColors.green;
      case 'collected':
        title = '✅ Order Collected! Token $tokenNumber';
        subtitle = 'Enjoy your meal! 😋';
        icon = Icons.thumb_up_rounded;
        color = AppColors.green;
      case 'cancelled':
        title = '❌ Order Cancelled · Token $tokenNumber';
        subtitle = 'Your reservation has expired or was cancelled.';
        icon = Icons.cancel_rounded;
        color = AppColors.red;
      default:
        title = '📦 Order Updated · Token $tokenNumber';
        subtitle = 'Your order status has changed.';
        icon = Icons.info_rounded;
        color = AppColors.info;
    }

    sendNativeSystemNotification(
      title,
      subtitle,
      tag: newStatus == 'ready' ? 'tb-order-ready' : 'tb-order-$newStatus',
    );

    show(
      context: context,
      title: title,
      subtitle: subtitle,
      icon: icon,
      color: color,
      actionLabel: (newStatus != 'collected' && newStatus != 'cancelled') ? 'Track Here →' : null,
      onAction: onTrack,
      duration: newStatus == 'ready' ? const Duration(seconds: 10) : const Duration(seconds: 6),
    );
  }

  /// Show payment failed notification.
  void showPaymentFailed({
    required BuildContext context,
    required String tokenNumber,
    VoidCallback? onRetry,
  }) {
    show(
      context: context,
      title: '💳 Payment Failed · Token $tokenNumber',
      subtitle: 'Your items are reserved for 15 minutes. Retry now.',
      icon: Icons.error_outline_rounded,
      color: AppColors.red,
      actionLabel: 'Retry Payment',
      onAction: onRetry,
      duration: const Duration(seconds: 8),
    );
  }

  /// Show reservation expired notification (stock released).
  void showReservationExpired({
    required BuildContext context,
    required String tokenNumber,
  }) {
    show(
      context: context,
      title: '⏰ Reservation Expired · Token $tokenNumber',
      subtitle: 'Your held items have been released back to stock.',
      icon: Icons.timer_off_rounded,
      color: AppColors.red,
      duration: const Duration(seconds: 6),
    );
  }

  /// Dismiss the current notification.
  void dismiss() {
    _autoDismissTimer?.cancel();
    _autoDismissTimer = null;
    _currentEntry?.remove();
    _currentEntry = null;
  }
}

/// Animated notification banner widget.
class _NotificationBanner extends StatefulWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;
  final String? actionLabel;
  final VoidCallback? onAction;
  final VoidCallback onDismiss;

  const _NotificationBanner({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.color,
    this.actionLabel,
    this.onAction,
    required this.onDismiss,
  });

  @override
  State<_NotificationBanner> createState() => _NotificationBannerState();
}

class _NotificationBannerState extends State<_NotificationBanner>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<Offset> _slideAnimation;
  late final Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 350),
    );
    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, -1),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutCubic,
    ));
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOut),
    );
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final topPadding = MediaQuery.of(context).padding.top;
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: SlideTransition(
        position: _slideAnimation,
        child: FadeTransition(
          opacity: _fadeAnimation,
          child: GestureDetector(
            onVerticalDragEnd: (details) {
              if (details.primaryVelocity != null && details.primaryVelocity! < -100) {
                widget.onDismiss();
              }
            },
            child: Container(
              margin: EdgeInsets.fromLTRB(12, topPadding + 8, 12, 0),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: widget.color.withAlpha(100), width: 1.5),
                boxShadow: [
                  BoxShadow(
                    color: widget.color.withAlpha(30),
                    blurRadius: 20,
                    offset: const Offset(0, 4),
                  ),
                  BoxShadow(
                    color: Colors.black.withAlpha(15),
                    blurRadius: 10,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: widget.color.withAlpha(25),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(widget.icon, color: widget.color, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          widget.title,
                          style: AppFonts.body(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          widget.subtitle,
                          style: AppFonts.body(
                            fontSize: 12,
                            color: AppColors.inkSoft,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  if (widget.actionLabel != null) ...[
                    const SizedBox(width: 8),
                    GestureDetector(
                      onTap: widget.onAction,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                        decoration: BoxDecoration(
                          color: widget.color,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          widget.actionLabel!,
                          style: AppFonts.body(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ),
                  ] else ...[
                    const SizedBox(width: 4),
                    GestureDetector(
                      onTap: widget.onDismiss,
                      child: Icon(
                        Icons.close_rounded,
                        size: 18,
                        color: AppColors.inkSoft.withAlpha(150),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
