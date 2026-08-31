import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/user_profile.dart';

void main() {
  group('UserProfile Model & Identity Invariants Tests', () {
    test('Student profile parses from Firestore correctly', () {
      final data = {
        'email': '1032251174@tcetmumbai.in',
        'displayName': 'Aditya Bodake',
        'accountType': 'STUDENT',
        'verificationStatus': 'VERIFIED',
        'priorityLevel': 1,
        'department': 'IT',
        'year': 'SE',
        'rollNo': '1032251174',
        'phone': '9876543210',
        'isVerified': true,
        'totalOrders': 12,
        'totalSpentPaise': 145000,
        'averageOrderPaise': 12083,
      };

      final profile = UserProfile.fromFirestore('test_uid_1', data);

      expect(profile.uid, equals('test_uid_1'));
      expect(profile.displayName, equals('Aditya Bodake'));
      expect(profile.name, equals('Aditya Bodake'));
      expect(profile.initials, equals('AB'));
      expect(profile.accountType, equals(AccountType.student));
      expect(profile.verificationStatus, equals(VerificationStatus.verified));
      expect(profile.isVerified, isTrue);
      expect(profile.totalOrders, equals(12));
      expect(profile.totalSpentRupees, equals(1450.0));
      expect(profile.hasPriorityAccess, isFalse);
    });

    test('Teacher profile with elevated priority parses correctly', () {
      final data = {
        'email': 'prof.sharma@thakureducation.org',
        'displayName': 'Dr. Sharma',
        'accountType': 'TEACHER',
        'verificationStatus': 'VERIFIED',
        'priorityLevel': 2,
        'department': 'Computer Engineering',
        'designation': 'Associate Professor',
        'isVerified': true,
        'totalOrders': 5,
        'totalSpentPaise': 75000,
      };

      final profile = UserProfile.fromFirestore('teacher_uid_1', data);

      expect(profile.accountType, equals(AccountType.teacher));
      expect(profile.hasPriorityAccess, isTrue);
      expect(profile.priorityLevel, equals(2));
      expect(profile.accountType.label, equals('Faculty / Teacher'));
      expect(profile.safeRollNo, equals('Faculty / Teacher'));
    });

    test('Visitor profile defaults are safe and unverified', () {
      final data = {
        'email': 'visitor@gmail.com',
        'displayName': 'Guest Customer',
        'accountType': 'VISITOR',
        'verificationStatus': 'NOT_REQUIRED',
        'priorityLevel': 0,
        'isVerified': true,
      };

      final profile = UserProfile.fromFirestore('visitor_uid_1', data);

      expect(profile.accountType, equals(AccountType.visitor));
      expect(profile.priorityLevel, equals(0));
      expect(profile.hasPriorityAccess, isFalse);
      expect(profile.initials, equals('GC'));
    });
  });
}
