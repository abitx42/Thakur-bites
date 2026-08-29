/// Thakur Bites - Daily Board Model
/// Maps to the `dailyBoard/today` Firestore document.
/// Updated daily by staff to reflect today's sabjis, specials, and announcements.
class DailyBoard {
  final String sabji1;
  final String sabji2;
  final String canteenSpecial;
  final bool rotiAvailable;
  final bool puriAvailable;
  final String announcement;
  final bool isRushHour;
  final DateTime? updatedAt;

  DailyBoard({
    required this.sabji1,
    required this.sabji2,
    required this.canteenSpecial,
    this.rotiAvailable = true,
    this.puriAvailable = true,
    this.announcement = '',
    this.isRushHour = false,
    this.updatedAt,
  });

  factory DailyBoard.fromFirestore(Map<String, dynamic> data) {
    return DailyBoard(
      sabji1: data['sabji1'] ?? '',
      sabji2: data['sabji2'] ?? '',
      canteenSpecial: data['canteenSpecial'] ?? '',
      rotiAvailable: data['rotiAvailable'] ?? true,
      puriAvailable: data['puriAvailable'] ?? true,
      announcement: data['announcement'] ?? '',
      isRushHour: data['isRushHour'] ?? false,
      updatedAt: data['updatedAt']?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'sabji1': sabji1,
      'sabji2': sabji2,
      'canteenSpecial': canteenSpecial,
      'rotiAvailable': rotiAvailable,
      'puriAvailable': puriAvailable,
      'announcement': announcement,
      'isRushHour': isRushHour,
      'updatedAt': DateTime.now(),
    };
  }
}
