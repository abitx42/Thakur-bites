/// Dynamic Canteen Preparation ETA & Rush Mode Service
class EtaService {
  /// Base multiplier: each order in the cook queue adds ~1.5 - 2 minutes of buffer
  static const double minutesPerQueueOrder = 1.5;

  /// Calculates dynamic ETA in minutes based on active kitchen load and campus rush mode
  static int calculateDynamicEta({
    required int baseEstimatedMinutes,
    required int activeKitchenOrders,
    bool isRushMode = false,
  }) {
    // If order contains only ready-made shelf items and cook queue is empty, pickup is ready immediately (BUG-15)
    if (baseEstimatedMinutes <= 0 && activeKitchenOrders == 0) {
      return 0;
    }

    double estimated = baseEstimatedMinutes.toDouble();

    // Add queue lag
    estimated += (activeKitchenOrders * minutesPerQueueOrder);

    // Apply rush hour multiplier (e.g., 1.25x during peak lunch)
    if (isRushMode) {
      estimated *= 1.25;
    }

    // Minimum 3 minutes for cooked/kitchen items, maximum 45 minutes
    final rounded = estimated.round();
    if (rounded < 3) return 3;
    if (rounded > 45) return 45;
    return rounded;
  }

  /// Returns user-facing status label for the estimated wait
  static String getWaitTimeLabel(int minutes, {bool isRushMode = false}) {
    if (minutes <= 0) {
      return '⏱️ Ready Any Moment';
    }
    if (isRushMode) {
      return '🔥 Rush Hour (~$minutes min)';
    }
    if (minutes <= 5) {
      return '⚡️ Fast Pickup (~$minutes min)';
    }
    if (minutes <= 15) {
      return '⏱️ Normal Queue (~$minutes min)';
    }
    return '⏳ High Demand (~$minutes min)';
  }
}
