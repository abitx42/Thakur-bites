import 'package:cloud_firestore/cloud_firestore.dart';

/// User notification preferences
class NotificationSettings {
  final bool orderConfirmed;
  final bool orderPreparing;
  final bool orderReady;
  final bool orderCollected;
  final bool dailySpecials;
  final bool rushHourAlerts;

  const NotificationSettings({
    this.orderConfirmed = true,
    this.orderPreparing = true,
    this.orderReady = true,
    this.orderCollected = true,
    this.dailySpecials = true,
    this.rushHourAlerts = false,
  });

  factory NotificationSettings.fromMap(Map<String, dynamic>? data) {
    if (data == null) return const NotificationSettings();
    return NotificationSettings(
      orderConfirmed: data['orderConfirmed'] ?? true,
      orderPreparing: data['orderPreparing'] ?? true,
      orderReady: data['orderReady'] ?? true,
      orderCollected: data['orderCollected'] ?? true,
      dailySpecials: data['dailySpecials'] ?? true,
      rushHourAlerts: data['rushHourAlerts'] ?? false,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'orderConfirmed': orderConfirmed,
      'orderPreparing': orderPreparing,
      'orderReady': orderReady,
      'orderCollected': orderCollected,
      'dailySpecials': dailySpecials,
      'rushHourAlerts': rushHourAlerts,
    };
  }

  NotificationSettings copyWith({
    bool? orderConfirmed,
    bool? orderPreparing,
    bool? orderReady,
    bool? orderCollected,
    bool? dailySpecials,
    bool? rushHourAlerts,
  }) {
    return NotificationSettings(
      orderConfirmed: orderConfirmed ?? this.orderConfirmed,
      orderPreparing: orderPreparing ?? this.orderPreparing,
      orderReady: orderReady ?? this.orderReady,
      orderCollected: orderCollected ?? this.orderCollected,
      dailySpecials: dailySpecials ?? this.dailySpecials,
      rushHourAlerts: rushHourAlerts ?? this.rushHourAlerts,
    );
  }
}

/// User dietary and ordering preferences (Hints for kitchen prep)
class DietaryPreferences {
  final bool lessSpicy;
  final bool lessSugar;
  final bool noCutlery;
  final bool jainAvailableOnly;
  final String customNotes;

  const DietaryPreferences({
    this.lessSpicy = false,
    this.lessSugar = false,
    this.noCutlery = false,
    this.jainAvailableOnly = false,
    this.customNotes = '',
  });

  factory DietaryPreferences.fromMap(Map<String, dynamic>? data) {
    if (data == null) return const DietaryPreferences();
    return DietaryPreferences(
      lessSpicy: data['lessSpicy'] ?? false,
      lessSugar: data['lessSugar'] ?? false,
      noCutlery: data['noCutlery'] ?? false,
      jainAvailableOnly: data['jainAvailableOnly'] ?? false,
      customNotes: data['customNotes'] ?? '',
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'lessSpicy': lessSpicy,
      'lessSugar': lessSugar,
      'noCutlery': noCutlery,
      'jainAvailableOnly': jainAvailableOnly,
      'customNotes': customNotes,
    };
  }

  DietaryPreferences copyWith({
    bool? lessSpicy,
    bool? lessSugar,
    bool? noCutlery,
    bool? jainAvailableOnly,
    String? customNotes,
  }) {
    return DietaryPreferences(
      lessSpicy: lessSpicy ?? this.lessSpicy,
      lessSugar: lessSugar ?? this.lessSugar,
      noCutlery: noCutlery ?? this.noCutlery,
      jainAvailableOnly: jainAvailableOnly ?? this.jainAvailableOnly,
      customNotes: customNotes ?? this.customNotes,
    );
  }
}

/// Consolidated User Preferences Document
class UserPreferences {
  final String uid;
  final NotificationSettings notifications;
  final DietaryPreferences dietary;
  final DateTime updatedAt;

  UserPreferences({
    required this.uid,
    this.notifications = const NotificationSettings(),
    this.dietary = const DietaryPreferences(),
    DateTime? updatedAt,
  }) : updatedAt = updatedAt ?? DateTime.now();

  factory UserPreferences.fromFirestore(String uid, Map<String, dynamic> data) {
    return UserPreferences(
      uid: uid,
      notifications: NotificationSettings.fromMap(data['notifications']),
      dietary: DietaryPreferences.fromMap(data['dietary']),
      updatedAt: (data['updatedAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'notifications': notifications.toMap(),
      'dietary': dietary.toMap(),
      'updatedAt': Timestamp.fromDate(updatedAt),
    };
  }
}
