import 'package:cloud_firestore/cloud_firestore.dart';

/// Thakur Bites — Student Model
/// Maps to the `students` Firestore collection.
class Student {
  final String uid;
  final String name;
  final String phone;
  final String rollNo;
  final String? email;
  final DateTime createdAt;
  final int totalOrders;

  Student({
    required this.uid,
    required this.name,
    required this.phone,
    required this.rollNo,
    this.email,
    required this.createdAt,
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
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      totalOrders: data['totalOrders'] ?? 0,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'name': name,
      'phone': phone,
      'rollNo': rollNo,
      'email': email,
      'createdAt': Timestamp.fromDate(createdAt),
      'totalOrders': totalOrders,
    };
  }

  Student copyWith({
    String? name,
    String? phone,
    String? rollNo,
    String? email,
    DateTime? createdAt,
    int? totalOrders,
  }) {
    return Student(
      uid: uid,
      name: name ?? this.name,
      phone: phone ?? this.phone,
      rollNo: rollNo ?? this.rollNo,
      email: email ?? this.email,
      createdAt: createdAt ?? this.createdAt,
      totalOrders: totalOrders ?? this.totalOrders,
    );
  }
}
