import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/user_profile.dart';

void main() {
  group('UserProfile Name Cleaning & Sanitization', () {
    test('Cleans TCET college format with roll, branch, class and duplicate name', () {
      const raw = '17_CSE_CS_A_Aditya Bodake Bodake';
      expect(UserProfile.cleanName(raw), 'Aditya Bodake');
    });

    test('Cleans roll and trailing branch code', () {
      const raw = '13 Namdev Bhoge CSE cs';
      expect(UserProfile.cleanName(raw), 'Namdev Bhoge');
    });

    test('Leaves already clean names untouched and properly capitalized', () {
      const raw = 'Aditya Bodake';
      expect(UserProfile.cleanName(raw), 'Aditya Bodake');
    });

    test('Cleans lowercase names into Title Case', () {
      const raw = 'aditya bodake';
      expect(UserProfile.cleanName(raw), 'Aditya Bodake');
    });

    test('Deduplicates repeated consecutive words', () {
      const raw = 'Bodake Bodake';
      expect(UserProfile.cleanName(raw), 'Bodake');
    });

    test('Handles institutional email username nicely', () {
      const raw = 'student_1788638322842@tcetmumbai.in';
      expect(UserProfile.cleanName(raw), 'TCET Student');
    });

    test('Handles personal email username nicely', () {
      const raw = 'aditya.bodake@gmail.com';
      expect(UserProfile.cleanName(raw), 'Aditya Bodake');
    });

    test('Handles empty strings gracefully', () {
      expect(UserProfile.cleanName(''), 'Customer');
      expect(UserProfile.cleanName('   '), 'Customer');
    });
  });
}
