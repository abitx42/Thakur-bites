/// Platform 2.0 — Canteen Operational Status Model
/// Reflects real-time public system status from `publicSystemStatus/global`.
class CanteenOperationalStatus {
  final String mode; // 'NORMAL' | 'DEGRADED' | 'FINANCIAL_FROZEN' | 'EMERGENCY_HALT'
  final bool orderingAvailable;
  final String? reason;

  const CanteenOperationalStatus({
    required this.mode,
    required this.orderingAvailable,
    this.reason,
  });

  factory CanteenOperationalStatus.normal() {
    return const CanteenOperationalStatus(
      mode: 'NORMAL',
      orderingAvailable: true,
    );
  }

  factory CanteenOperationalStatus.fromMap(Map<String, dynamic> data) {
    final mode = (data['mode'] as String?)?.toUpperCase() ?? 'NORMAL';
    final orderingAvailable = data['orderingAvailable'] as bool? ?? (mode == 'NORMAL');
    return CanteenOperationalStatus(
      mode: mode,
      orderingAvailable: orderingAvailable,
      reason: data['reason'] as String?,
    );
  }

  bool get isNormal => mode == 'NORMAL' && orderingAvailable;
  bool get isDegraded => mode == 'DEGRADED';
  bool get isHalted => mode == 'EMERGENCY_HALT';
  bool get isFrozen => mode == 'FINANCIAL_FROZEN';

  String get bannerTitle {
    if (isDegraded) return 'Online Ordering Paused ⏸️';
    if (isHalted) return 'Canteen Temporarily Closed 🛑';
    if (isFrozen) return 'Checkout Temporarily Paused ⏸️';
    return 'Canteen Status Notice';
  }

  String get bannerMessage {
    if (isDegraded) {
      return 'Sorry for the inconvenience! Online ordering is temporarily paused. Please place your order directly at the counter.';
    }
    if (isHalted) {
      return 'Sorry for the inconvenience! The canteen has temporarily closed accepting orders. Please check back shortly.';
    }
    if (isFrozen) {
      return 'Sorry for the inconvenience! Checkout is temporarily paused for system maintenance. Counter orders are open.';
    }
    return 'Online ordering is currently paused. Please visit the counter or check back shortly.';
  }

  String get buttonText {
    if (isDegraded) return 'Online orders paused · Counter orders only';
    if (isHalted) return 'Canteen temporarily closed · Please check back';
    if (isFrozen) return 'Checkout paused for maintenance';
    return 'Online ordering paused';
  }

  String get modalTitle {
    if (isDegraded) return 'Online Ordering Paused';
    if (isHalted) return 'Canteen Temporarily Closed';
    if (isFrozen) return 'Checkout Temporarily Paused';
    return 'Notice to Students';
  }

  String get modalSubtitle {
    if (isDegraded) {
      return 'Canteen has temporarily paused accepting online app orders.';
    }
    if (isHalted) {
      return 'Canteen has temporarily closed accepting orders.';
    }
    return 'Online checkout is currently not accepting orders.';
  }

  String get modalDescription {
    if (isDegraded) {
      return 'Sorry for the inconvenience!\n\nDue to heavy rush at the kitchen counters, online app ordering is temporarily paused.\n\n👉 You can still place your order directly at the canteen counter in cash or UPI!';
    }
    if (isHalted) {
      return 'Sorry for the inconvenience!\n\nThe canteen has temporarily closed accepting orders to clear pending cooking tickets.\n\n👉 Normal service will resume shortly. Please check back soon!';
    }
    return 'Sorry for the inconvenience!\n\nCheckout is temporarily paused for routine system maintenance.\n\n👉 Please place your order directly at the canteen counter!';
  }
}
