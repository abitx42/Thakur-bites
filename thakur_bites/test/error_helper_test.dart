import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/services/error_helper.dart';

void main() {
  group('ErrorHelper Tests', () {
    test('Identifies SocketException as network error', () {
      const error = SocketException('Failed host lookup: firestore.googleapis.com');
      expect(ErrorHelper.isNetworkError(error), isTrue);
      expect(
        ErrorHelper.getFriendlyErrorMessage(error),
        contains('No internet connection'),
      );
    });

    test('Identifies TimeoutException as network error', () {
      final error = TimeoutException('Connection timed out');
      expect(ErrorHelper.isNetworkError(error), isTrue);
      expect(
        ErrorHelper.getFriendlyErrorMessage(error),
        contains('No internet connection'),
      );
    });

    test('Silently ignores user cancellations', () {
      expect(ErrorHelper.getFriendlyErrorMessage(Exception('Google sign-in was cancelled.')), isNull);
      expect(ErrorHelper.getFriendlyErrorMessage('sign_in_canceled'), isNull);
      expect(ErrorHelper.getFriendlyErrorMessage('popup-closed-by-user'), isNull);
    });

    test('Translates common auth errors', () {
      expect(
        ErrorHelper.getFriendlyErrorMessage('auth/invalid-credential'),
        contains('Incorrect credentials'),
      );
      expect(
        ErrorHelper.getFriendlyErrorMessage('auth/user-disabled'),
        contains('account has been disabled'),
      );
      expect(
        ErrorHelper.getFriendlyErrorMessage('auth/too-many-requests'),
        contains('Too many failed attempts'),
      );
    });

    test('Translates domain business logic exceptions', () {
      expect(
        ErrorHelper.getFriendlyErrorMessage('Order already collected! Do not hand over.'),
        contains('already been picked up'),
      );
      expect(
        ErrorHelper.getFriendlyErrorMessage('Item out of stock'),
        contains('sold out'),
      );
      expect(
        ErrorHelper.getFriendlyErrorMessage('Canteen is closed / halted'),
        contains('ordering is currently paused'),
      );
    });
  });
}
