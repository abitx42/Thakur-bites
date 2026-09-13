/// Thakur Bites - Daily Board Model
/// Maps to `/canteenConfig/dailyMenuBoard` and `/dailyBoard/today` Firestore documents.
/// Updated daily by staff to reflect today's sabjis, sweets, specials, and announcements.
/// Seamlessly falls back to pre-configured weekly defaults so the canteen runs on auto-pilot.
class DailyBoard {
  final String date; // 'YYYY-MM-DD'
  final String dayOfWeek; // 'MONDAY', 'TUESDAY', etc.
  final String sabji1;
  final String sabji2;
  final String dalOfTheDay;
  final String sweetOfTheDay;
  final String riceType;
  final String canteenSpecial;
  final String specialBadge;
  final bool rotiAvailable;
  final bool puriAvailable;
  final String announcement;
  final bool isRushHour;
  final DateTime? updatedAt;
  final String? updatedBy;

  DailyBoard({
    this.date = '',
    this.dayOfWeek = '',
    required this.sabji1,
    required this.sabji2,
    this.dalOfTheDay = 'Dal Tadka',
    this.sweetOfTheDay = 'Gulab Jamun',
    this.riceType = 'Steamed Jeera Rice',
    required this.canteenSpecial,
    this.specialBadge = '',
    this.rotiAvailable = true,
    this.puriAvailable = true,
    this.announcement = '',
    this.isRushHour = false,
    this.updatedAt,
    this.updatedBy,
  });

  /// Dynamic subtitle for Thali items
  String formatThaliSummary() {
    final parts = <String>[];
    if (sabji1.isNotEmpty) parts.add(sabji1);
    if (sabji2.isNotEmpty) parts.add(sabji2);
    if (sweetOfTheDay.isNotEmpty) parts.add(sweetOfTheDay);
    if (parts.isEmpty) {
      return '2 Fresh Sabjis, Dal Tadka, Rice & Today\'s Sweet';
    }
    return 'Today: ${parts.join(', ')}';
  }

  /// Dynamic subtitle for Roti Bhaji / Puri Bhaji items
  String formatRotiBhajiSummary() {
    if (sabji1.isNotEmpty && sabji2.isNotEmpty) {
      return 'Today\'s Sabjis: $sabji1 or $sabji2';
    } else if (sabji1.isNotEmpty) {
      return 'Today\'s Sabji: $sabji1';
    } else if (sabji2.isNotEmpty) {
      return 'Today\'s Sabji: $sabji2';
    }
    return 'Served with fresh daily sabji & salad';
  }

  /// True if both bread choices are in stock
  bool get bothBreadsAvailable => rotiAvailable && puriAvailable;

  /// True if any bread choice is in stock
  bool get hasAnyBread => rotiAvailable || puriAvailable;

  /// Friendly upfront notice if one of the bread options has run out
  String? get breadShortageNotice {
    if (!rotiAvailable && puriAvailable) {
      return 'Fresh Chapatis are finished for today! Your meal will be served with Fresh Hot Puris.';
    } else if (rotiAvailable && !puriAvailable) {
      return 'Fresh Puris are finished for today! Your meal will be served with Fresh Tawa Rotis.';
    } else if (!rotiAvailable && !puriAvailable) {
      return 'All breads are finished for today. Please check at counter or try Rice dishes.';
    }
    return null;
  }

  /// The default bread option based on current staff availability
  String get defaultBreadChoice {
    if (rotiAvailable) return '4 Tawa Rotis';
    if (puriAvailable) return '4 Fresh Puris';
    return 'Standard Serving';
  }

  factory DailyBoard.fromFirestore(Map<String, dynamic> data) {
    return DailyBoard(
      date: data['date'] as String? ?? '',
      dayOfWeek: (data['dayOfWeek'] as String? ?? '').toUpperCase(),
      sabji1: data['sabji1'] as String? ?? '',
      sabji2: data['sabji2'] as String? ?? '',
      dalOfTheDay: data['dalOfTheDay'] as String? ?? 'Dal Tadka',
      sweetOfTheDay: data['sweetOfTheDay'] as String? ?? 'Gulab Jamun',
      riceType: data['riceType'] as String? ?? 'Steamed Jeera Rice',
      canteenSpecial: data['canteenSpecial'] as String? ?? '',
      specialBadge: data['specialBadge'] as String? ?? '',
      rotiAvailable: data['rotiAvailable'] as bool? ?? true,
      puriAvailable: data['puriAvailable'] as bool? ?? true,
      announcement: data['announcement'] as String? ?? '',
      isRushHour: data['isRushHour'] as bool? ?? false,
      updatedAt: data['updatedAt'] != null
          ? (data['updatedAt'] is DateTime
              ? data['updatedAt'] as DateTime
              : (data['updatedAt'].toDate != null
                  ? data['updatedAt'].toDate() as DateTime
                  : null))
          : null,
      updatedBy: data['updatedBy'] as String?,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'date': date.isNotEmpty ? date : _formatDate(DateTime.now()),
      'dayOfWeek': dayOfWeek.isNotEmpty ? dayOfWeek : _getDayName(DateTime.now().weekday),
      'sabji1': sabji1,
      'sabji2': sabji2,
      'dalOfTheDay': dalOfTheDay,
      'sweetOfTheDay': sweetOfTheDay,
      'riceType': riceType,
      'canteenSpecial': canteenSpecial,
      'specialBadge': specialBadge,
      'rotiAvailable': rotiAvailable,
      'puriAvailable': puriAvailable,
      'announcement': announcement,
      'isRushHour': isRushHour,
      'updatedAt': DateTime.now(),
      if (updatedBy != null) 'updatedBy': updatedBy,
    };
  }

  DailyBoard copyWith({
    String? date,
    String? dayOfWeek,
    String? sabji1,
    String? sabji2,
    String? dalOfTheDay,
    String? sweetOfTheDay,
    String? riceType,
    String? canteenSpecial,
    String? specialBadge,
    bool? rotiAvailable,
    bool? puriAvailable,
    String? announcement,
    bool? isRushHour,
    DateTime? updatedAt,
    String? updatedBy,
  }) {
    return DailyBoard(
      date: date ?? this.date,
      dayOfWeek: dayOfWeek ?? this.dayOfWeek,
      sabji1: sabji1 ?? this.sabji1,
      sabji2: sabji2 ?? this.sabji2,
      dalOfTheDay: dalOfTheDay ?? this.dalOfTheDay,
      sweetOfTheDay: sweetOfTheDay ?? this.sweetOfTheDay,
      riceType: riceType ?? this.riceType,
      canteenSpecial: canteenSpecial ?? this.canteenSpecial,
      specialBadge: specialBadge ?? this.specialBadge,
      rotiAvailable: rotiAvailable ?? this.rotiAvailable,
      puriAvailable: puriAvailable ?? this.puriAvailable,
      announcement: announcement ?? this.announcement,
      isRushHour: isRushHour ?? this.isRushHour,
      updatedAt: updatedAt ?? this.updatedAt,
      updatedBy: updatedBy ?? this.updatedBy,
    );
  }

  /// Default weekly cycle for auto-pilot operation without requiring daily manual input
  static DailyBoard defaultForDay([DateTime? date]) {
    final targetDate = date ?? DateTime.now();
    final weekday = targetDate.weekday; // 1 = Mon, 7 = Sun
    final dayStr = _getDayName(weekday);
    final dateStr = _formatDate(targetDate);

    switch (weekday) {
      case 1: // Monday
        return DailyBoard(
          date: dateStr,
          dayOfWeek: dayStr,
          sabji1: 'Paneer Kadhai',
          sabji2: 'Aloo Gobi Mutter',
          dalOfTheDay: 'Dal Tadka',
          sweetOfTheDay: 'Suji Halwa',
          riceType: 'Steamed Jeera Rice',
          canteenSpecial: 'Fresh Hot Samosa Chole',
          specialBadge: 'CHEF SPECIAL',
          rotiAvailable: true,
          puriAvailable: true,
        );
      case 2: // Tuesday
        return DailyBoard(
          date: dateStr,
          dayOfWeek: dayStr,
          sabji1: 'Chole Masala',
          sabji2: 'Bhindi Masala Fry',
          dalOfTheDay: 'Dal Fry',
          sweetOfTheDay: 'Kheer',
          riceType: 'Steamed Basmati Rice',
          canteenSpecial: 'Chole Bhature Platter',
          specialBadge: 'CAMPUS HIT',
          rotiAvailable: true,
          puriAvailable: true,
        );
      case 3: // Wednesday
        return DailyBoard(
          date: dateStr,
          dayOfWeek: dayStr,
          sabji1: 'Rajma Masala',
          sabji2: 'Jeera Aloo Fry',
          dalOfTheDay: 'Dal Makhani',
          sweetOfTheDay: 'Elaichi Shrikhand',
          riceType: 'Jeera Basmati Rice',
          canteenSpecial: 'Veg Dum Biryani with Raita',
          specialBadge: 'WEDNESDAY SPECIAL 🔥',
          rotiAvailable: true,
          puriAvailable: true,
        );
      case 4: // Thursday
        return DailyBoard(
          date: dateStr,
          dayOfWeek: dayStr,
          sabji1: 'Dum Aloo Kashmiri',
          sabji2: 'Mix Veg Kolhapuri',
          dalOfTheDay: 'Panchmel Dal',
          sweetOfTheDay: 'Moong Dal Halwa',
          riceType: 'Veg Pulao',
          canteenSpecial: 'Paneer Bhurji & Pav',
          specialBadge: 'HOT PICK',
          rotiAvailable: true,
          puriAvailable: true,
        );
      case 5: // Friday
        return DailyBoard(
          date: dateStr,
          dayOfWeek: dayStr,
          sabji1: 'Paneer Butter Masala',
          sabji2: 'Chana Masala',
          dalOfTheDay: 'Dal Tadka',
          sweetOfTheDay: 'Hot Gulab Jamun',
          riceType: 'Jeera Rice',
          canteenSpecial: 'Butter Pav Bhaji & Extra Pav',
          specialBadge: 'FRIDAY SPECIAL 🔥',
          rotiAvailable: true,
          puriAvailable: true,
          announcement: 'Special Pav Bhaji counter open today!',
        );
      case 6: // Saturday
        return DailyBoard(
          date: dateStr,
          dayOfWeek: dayStr,
          sabji1: 'Veg Handi Special',
          sabji2: 'Baingan Bharta',
          dalOfTheDay: 'Dal Fry',
          sweetOfTheDay: 'Crispy Jalebi',
          riceType: 'Steamed Jeera Rice',
          canteenSpecial: 'Triple Schezwan Rice Combo',
          specialBadge: 'WEEKEND SPECIAL 🌶️',
          rotiAvailable: true,
          puriAvailable: true,
        );
      default: // Sunday
        return DailyBoard(
          date: dateStr,
          dayOfWeek: dayStr,
          sabji1: 'Paneer Tikka Masala',
          sabji2: 'Mix Seasonal Veg',
          dalOfTheDay: 'Dal Tadka',
          sweetOfTheDay: 'Gulab Jamun',
          riceType: 'Jeera Rice',
          canteenSpecial: 'Chef Weekend Special Thali',
          specialBadge: 'SPECIAL',
          rotiAvailable: true,
          puriAvailable: true,
        );
    }
  }

  static String _getDayName(int weekday) {
    const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    return days[(weekday - 1).clamp(0, 6)];
  }

  static String _formatDate(DateTime dt) {
    return '${dt.year.toString().padLeft(4, '0')}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
  }
}
