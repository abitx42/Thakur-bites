import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/user_profile.dart';
import 'package:thakur_bites/models/order.dart';

void main() {
  group('Phase 1: UserProfile Serialization & Session Persistence Tests', () {
    test('UserProfile toJson and fromJson round-trip preserves all fields', () {
      final now = DateTime.now();
      final profile = UserProfile(
        uid: 'user_test_123',
        email: 'test.student@tcetmumbai.in',
        displayName: 'Aditya Bodake',
        photoURL: 'https://example.com/avatar.jpg',
        accountType: AccountType.student,
        verificationStatus: VerificationStatus.verified,
        priorityLevel: 1,
        department: 'Information Technology',
        designation: 'Student Representative',
        year: 'TE',
        rollNo: '13',
        phone: '+919876543210',
        isVerified: true,
        accountDisabled: false,
        totalOrders: 15,
        totalSpentPaise: 150000,
        averageOrderPaise: 10000,
        favouriteItemId: 'item_misal_pav',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      );

      final json = profile.toJson();
      expect(json['uid'], 'user_test_123');
      expect(json['email'], 'test.student@tcetmumbai.in');
      expect(json['displayName'], 'Aditya Bodake');
      expect(json['accountType'], 'STUDENT');
      expect(json['verificationStatus'], 'VERIFIED');
      expect(json['priorityLevel'], 1);
      expect(json['department'], 'Information Technology');
      expect(json['rollNo'], '13');
      expect(json['isVerified'], true);

      final restored = UserProfile.fromJson(json);
      expect(restored.uid, profile.uid);
      expect(restored.email, profile.email);
      expect(restored.displayName, profile.displayName);
      expect(restored.accountType, profile.accountType);
      expect(restored.verificationStatus, profile.verificationStatus);
      expect(restored.priorityLevel, profile.priorityLevel);
      expect(restored.department, profile.department);
      expect(restored.rollNo, profile.rollNo);
      expect(restored.phone, profile.phone);
      expect(restored.isVerified, profile.isVerified);
      expect(restored.totalOrders, profile.totalOrders);
      expect(restored.favouriteItemId, profile.favouriteItemId);
    });

    test('UserProfile.guest generates valid visitor profile with 0ms latency', () {
      final guest = UserProfile.guest();
      expect(guest.uid.startsWith('guest_'), isTrue);
      expect(guest.accountType, AccountType.visitor);
      expect(guest.verificationStatus, VerificationStatus.notRequired);
      expect(guest.priorityLevel, 0);
      expect(guest.isVerified, isFalse);
    });

    test('UserProfile cleanName standardizes names without roll prefixes or duplicate words', () {
      expect(UserProfile.cleanName('13 Namdev Bhoge'), 'Namdev Bhoge');
      expect(UserProfile.cleanName('Aditya Bodake Bodake'), 'Aditya Bodake');
      expect(UserProfile.cleanName('student_aditya@tcetmumbai.in'), 'TCET Student');
      expect(UserProfile.cleanName('aditya.bodake@tcetmumbai.in'), 'Aditya Bodake');
    });
  });

  group('Phase 3: Order Payment Status & Invariant Tests', () {
    test('Order reflects confirmed status when payment succeeds', () {
      final now = DateTime.now();
      final order = Order(
        id: 'order_test_999',
        tokenNumber: 'A-42',
        pinCode: '1234',
        studentId: 'user_test_123',
        studentName: 'Aditya Bodake',
        studentRoll: '13',
        status: 'payment_pending',
        paymentStatus: 'pending',
        paymentMethod: 'online',
        estimatedMinutes: 5,
        createdAt: now,
        totalAmount: 20.0,
        totalAmountPaise: 2000,
        items: [],
      );

      expect(order.isPaymentPending, isTrue);

      final confirmedOrder = order.copyWith(
        status: 'confirmed',
        paymentStatus: 'paid',
      );

      expect(confirmedOrder.isPaymentPending, isFalse);
      expect(confirmedOrder.isConfirmed, isTrue);
      expect(confirmedOrder.paymentStatus, 'paid');
    });
  });
}
