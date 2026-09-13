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

    test('toInitialCreateMap produces safe unprivileged payload conforming to firestore.rules', () {
      final profile = UserProfile(
        uid: 'user_123',
        email: 'user@tcetmumbai.in',
        displayName: '17_CSE_CS_A_Aditya Bodake',
        accountType: AccountType.student,
        verificationStatus: VerificationStatus.pending,
        priorityLevel: 0,
        department: 'IT',
        rollNo: '1032251174',
        createdAt: DateTime(2026, 9, 14),
      );

      final map = profile.toInitialCreateMap();

      expect(map['uid'], equals('user_123'));
      expect(map['email'], equals('user@tcetmumbai.in'));
      expect(map['displayName'], equals('Aditya Bodake'));
      expect(map['priorityLevel'], equals(0));
      expect(map['isVerified'], isFalse);
      expect(map['accountDisabled'], isFalse);
      expect(map['totalOrders'], equals(0));
      expect(map['totalSpentPaise'], equals(0));
      expect(map['averageOrderPaise'], equals(0));
      expect(map['accountType'], equals('STUDENT'));
      expect(map['verificationStatus'], equals('PENDING'));
      expect(map['rollNo'], equals('1032251174'));
      expect(map['department'], equals('IT'));
      expect(map['createdAt'], isNotNull);
      expect(map['updatedAt'], isNotNull);
    });
  });
}
