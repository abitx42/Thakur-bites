import 'package:cloud_firestore/cloud_firestore.dart';

/// Thakur Bites — Student Model
/// Maps to the `students` Firestore collection.
class Student {
  final String uid;
  final String name;
  final String phone;
  final String rollNo;
  final String? email;
  final String? department;
  final bool isVerified;
  final bool accountDisabled;
  final DateTime createdAt;
  final DateTime? lastLoginAt;
  final int totalOrders;

  Student({
    required this.uid,
    required this.name,
    required this.phone,
    required this.rollNo,
    this.email,
    this.department,
    this.isVerified = false,
    this.accountDisabled = false,
    required this.createdAt,
    this.lastLoginAt,
    this.totalOrders = 0,
  });

  /// Short initials for avatar badge (e.g. "AB" for "Aditya Bodake")
  String get initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return 'TB';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  factory Student.fromFirestore(String docId, Map<String, dynamic> data) {
    return Student(
      uid: docId,
      name: data['name'] ?? '',
      phone: data['phone'] ?? '',
      rollNo: data['rollNo'] ?? '',
      email: data['email'],
      department: data['department'],
      isVerified: data['isVerified'] ?? false,
      accountDisabled: data['accountDisabled'] ?? false,
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      lastLoginAt: (data['lastLoginAt'] as Timestamp?)?.toDate(),
      totalOrders: data['totalOrders'] ?? 0,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      'phone': phone,
      'rollNo': rollNo,
      'email': email,
      'department': department,
      'isVerified': isVerified,
      'accountDisabled': accountDisabled,
      'createdAt': Timestamp.fromDate(createdAt),
      'lastLoginAt': lastLoginAt != null ? Timestamp.fromDate(lastLoginAt!) : null,
      'totalOrders': totalOrders,
    };
  }

  Student copyWith({
    String? name,
    String? phone,
    String? rollNo,
    String? email,
    String? department,
    bool? isVerified,
    bool? accountDisabled,
    DateTime? createdAt,
    DateTime? lastLoginAt,
    int? totalOrders,
  }) {
    return Student(
      uid: uid,
      name: name ?? this.name,
      phone: phone ?? this.phone,
      rollNo: rollNo ?? this.rollNo,
      email: email ?? this.email,
      department: department ?? this.department,
      isVerified: isVerified ?? this.isVerified,
      accountDisabled: accountDisabled ?? this.accountDisabled,
      createdAt: createdAt ?? this.createdAt,
      lastLoginAt: lastLoginAt ?? this.lastLoginAt,
      totalOrders: totalOrders ?? this.totalOrders,
    );
  }
}
