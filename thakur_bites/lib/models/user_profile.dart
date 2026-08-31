import 'package:cloud_firestore/cloud_firestore.dart';

/// Account type classification
enum AccountType {
  visitor,
  student,
  teacher,
  collegeStaff;

  static AccountType fromString(String? val) {
    switch (val?.toUpperCase()) {
      case 'STUDENT':
        return AccountType.student;
      case 'TEACHER':
        return AccountType.teacher;
      case 'COLLEGE_STAFF':
        return AccountType.collegeStaff;
      case 'VISITOR':
      default:
        return AccountType.visitor;
    }
  }

  String toDbString() {
    switch (this) {
      case AccountType.student:
        return 'STUDENT';
      case AccountType.teacher:
        return 'TEACHER';
      case AccountType.collegeStaff:
        return 'COLLEGE_STAFF';
      case AccountType.visitor:
        return 'VISITOR';
    }
  }

  String get label {
    switch (this) {
      case AccountType.student:
        return 'Student';
      case AccountType.teacher:
        return 'Faculty / Teacher';
      case AccountType.collegeStaff:
        return 'College Staff';
      case AccountType.visitor:
        return 'Guest Visitor';
    }
  }
}

/// Verification lifecycle state
enum VerificationStatus {
  notRequired,
  pending,
  underReview,
  verified,
  rejected,
  expired;

  static VerificationStatus fromString(String? val) {
    switch (val?.toUpperCase()) {
      case 'PENDING':
        return VerificationStatus.pending;
      case 'UNDER_REVIEW':
        return VerificationStatus.underReview;
      case 'VERIFIED':
        return VerificationStatus.verified;
      case 'REJECTED':
        return VerificationStatus.rejected;
      case 'EXPIRED':
        return VerificationStatus.expired;
      case 'NOT_REQUIRED':
      default:
        return VerificationStatus.notRequired;
    }
  }

  String toDbString() {
    switch (this) {
      case VerificationStatus.pending:
        return 'PENDING';
      case VerificationStatus.underReview:
        return 'UNDER_REVIEW';
      case VerificationStatus.verified:
        return 'VERIFIED';
      case VerificationStatus.rejected:
        return 'REJECTED';
      case VerificationStatus.expired:
        return 'EXPIRED';
      case VerificationStatus.notRequired:
        return 'NOT_REQUIRED';
    }
  }

  String get label {
    switch (this) {
      case VerificationStatus.verified:
        return 'Verified';
      case VerificationStatus.underReview:
        return 'Under Review';
      case VerificationStatus.pending:
        return 'Pending Verification';
      case VerificationStatus.rejected:
        return 'Rejected';
      case VerificationStatus.expired:
        return 'Expired';
      case VerificationStatus.notRequired:
        return 'Guest (No Verification)';
    }
  }
}

/// Thakur Bites Platform 2.0 — Universal User Profile Model
/// Maps to the `users` Firestore collection (with backward-compatibility for `students`).
class UserProfile {
  final String uid;
  final String email;
  final String displayName;
  final String? photoURL;
  final AccountType accountType;
  final VerificationStatus verificationStatus;
  final int priorityLevel;
  final String? department;
  final String? designation;
  final String? year;
  final String? rollNo;
  final String? phone;
  final bool isVerified;
  final bool accountDisabled;
  final int totalOrders;
  final int totalSpentPaise;
  final int averageOrderPaise;
  final String? favouriteItemId;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final DateTime? lastLoginAt;

  UserProfile({
    required this.uid,
    required this.email,
    required this.displayName,
    this.photoURL,
    this.accountType = AccountType.student,
    this.verificationStatus = VerificationStatus.notRequired,
    this.priorityLevel = 1,
    this.department,
    this.designation,
    this.year,
    this.rollNo,
    this.phone,
    this.isVerified = false,
    this.accountDisabled = false,
    this.totalOrders = 0,
    this.totalSpentPaise = 0,
    this.averageOrderPaise = 0,
    this.favouriteItemId,
    required this.createdAt,
    this.updatedAt,
    this.lastLoginAt,
  });

  /// Short initials for avatar badge (e.g. "AB" for "Aditya Bodake")
  String get initials {
    final clean = displayName.trim();
    if (clean.isEmpty) return 'TB';
    final parts = clean.split(RegExp(r'\s+'));
    if (parts.length == 1) {
      return parts.first.substring(0, parts.first.length >= 2 ? 2 : 1).toUpperCase();
    }
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  /// Backward-compatibility getter for displayName
  String get name => displayName;

  /// Safe display roll number / identifier
  String get safeRollNo => (rollNo != null && rollNo!.isNotEmpty) ? rollNo! : accountType.label;

  /// Safe phone number string
  String get safePhone => phone ?? '';

  /// Total spent in rupees formatted
  double get totalSpentRupees => totalSpentPaise / 100.0;

  /// Average order in rupees formatted
  double get averageOrderRupees => averageOrderPaise / 100.0;

  /// Whether user has elevated priority
  bool get hasPriorityAccess => priorityLevel > 1;

  factory UserProfile.fromFirestore(String docId, Map<String, dynamic> data) {
    return UserProfile(
      uid: docId,
      email: data['email'] ?? '',
      displayName: data['displayName'] ?? data['name'] ?? 'Thakur Bites User',
      photoURL: data['photoURL'],
      accountType: AccountType.fromString(data['accountType']),
      verificationStatus: VerificationStatus.fromString(data['verificationStatus']),
      priorityLevel: (data['priorityLevel'] as num?)?.toInt() ?? 1,
      department: data['department'],
      designation: data['designation'],
      year: data['year'],
      rollNo: data['rollNo'],
      phone: data['phone'],
      isVerified: data['isVerified'] ?? false,
      accountDisabled: data['accountDisabled'] ?? false,
      totalOrders: (data['totalOrders'] as num?)?.toInt() ?? 0,
      totalSpentPaise: (data['totalSpentPaise'] as num?)?.toInt() ?? 0,
      averageOrderPaise: (data['averageOrderPaise'] as num?)?.toInt() ?? 0,
      favouriteItemId: data['favouriteItemId'],
      createdAt: (data['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      updatedAt: (data['updatedAt'] as Timestamp?)?.toDate(),
      lastLoginAt: (data['lastLoginAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'uid': uid,
      'email': email,
      'displayName': displayName,
      if (photoURL != null) 'photoURL': photoURL,
      'accountType': accountType.toDbString(),
      'verificationStatus': verificationStatus.toDbString(),
      'priorityLevel': priorityLevel,
      if (department != null) 'department': department,
      if (designation != null) 'designation': designation,
      if (year != null) 'year': year,
      if (rollNo != null) 'rollNo': rollNo,
      if (phone != null) 'phone': phone,
      'isVerified': isVerified,
      'accountDisabled': accountDisabled,
      'totalOrders': totalOrders,
      'totalSpentPaise': totalSpentPaise,
      'averageOrderPaise': averageOrderPaise,
      if (favouriteItemId != null) 'favouriteItemId': favouriteItemId,
      'createdAt': Timestamp.fromDate(createdAt),
      'updatedAt': Timestamp.now(),
      if (lastLoginAt != null) 'lastLoginAt': Timestamp.fromDate(lastLoginAt!),
    };
  }

  UserProfile copyWith({
    String? email,
    String? displayName,
    String? photoURL,
    AccountType? accountType,
    VerificationStatus? verificationStatus,
    int? priorityLevel,
    String? department,
    String? designation,
    String? year,
    String? rollNo,
    String? phone,
    bool? isVerified,
    bool? accountDisabled,
    int? totalOrders,
    int? totalSpentPaise,
    int? averageOrderPaise,
    String? favouriteItemId,
    DateTime? createdAt,
    DateTime? updatedAt,
    DateTime? lastLoginAt,
  }) {
    return UserProfile(
      uid: uid,
      email: email ?? this.email,
      displayName: displayName ?? this.displayName,
      photoURL: photoURL ?? this.photoURL,
      accountType: accountType ?? this.accountType,
      verificationStatus: verificationStatus ?? this.verificationStatus,
      priorityLevel: priorityLevel ?? this.priorityLevel,
      department: department ?? this.department,
      designation: designation ?? this.designation,
      year: year ?? this.year,
      rollNo: rollNo ?? this.rollNo,
      phone: phone ?? this.phone,
      isVerified: isVerified ?? this.isVerified,
      accountDisabled: accountDisabled ?? this.accountDisabled,
      totalOrders: totalOrders ?? this.totalOrders,
      totalSpentPaise: totalSpentPaise ?? this.totalSpentPaise,
      averageOrderPaise: averageOrderPaise ?? this.averageOrderPaise,
      favouriteItemId: favouriteItemId ?? this.favouriteItemId,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      lastLoginAt: lastLoginAt ?? this.lastLoginAt,
    );
  }
}
