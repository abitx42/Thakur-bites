import 'dart:async';
import 'dart:io';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';

/// Centralized human-readable error translator for Thakur Bites mobile app.
/// Maps technical network, authentication, and Cloud Function exceptions
/// into clear, friendly, and actionable user messages.
class ErrorHelper {
  /// Translates an exception into a human-readable message.
  /// Returns null if the exception represents a silent cancellation (e.g. user closed Google picker).
  static String? getFriendlyErrorMessage(
    dynamic error, {
    String defaultFallback = 'An unexpected error occurred. Please try again.',
  }) {
    if (error == null) return defaultFallback;

    // 1. Silent User Cancellations
    final rawStr = error.toString();
    final lower = rawStr.toLowerCase();

    if (lower.contains('cancelled') ||
        lower.contains('canceled') ||
        lower.contains('popup-closed-by-user') ||
        lower.contains('user cancelled') ||
        lower.contains('sign_in_canceled') ||
        lower.contains('google sign-in was cancelled')) {
      return null; // Silently ignore without disturbing the user
    }

    // 2. Network & Connectivity Failures
    if (error is SocketException ||
        error is TimeoutException ||
        lower.contains('network-request-failed') ||
        lower.contains('network_error') ||
        lower.contains('failed host lookup') ||
        lower.contains('connection refused') ||
        lower.contains('client is offline') ||
        lower.contains('unavailable') ||
        lower.contains('no address associated with hostname') ||
        lower.contains('apiexception: 7') || // Google Sign-In Network Error
        lower.contains('network error')) {
      return 'No internet connection. Please check your Wi-Fi or mobile data and try again.';
    }

    // 3. Firebase Auth Exceptions (Object or String error codes)
    final authCode = error is FirebaseAuthException ? error.code : '';
    if (authCode == 'user-not-found' || lower.contains('user-not-found')) {
      return 'No account found with this email. Please sign in with Google.';
    }
    if (authCode == 'wrong-password' ||
        authCode == 'invalid-credential' ||
        lower.contains('invalid-credential') ||
        lower.contains('wrong-password')) {
      return 'Incorrect credentials. Please check and try again.';
    }
    if (authCode == 'user-disabled' || lower.contains('user-disabled')) {
      return 'This student account has been disabled. Please contact the canteen office.';
    }
    if (authCode == 'too-many-requests' || lower.contains('too-many-requests')) {
      return 'Too many failed attempts. Please wait a moment before trying again.';
    }
    if (authCode == 'network-request-failed') {
      return 'Network error. Please check your internet connection and try again.';
    }
    if (error is FirebaseAuthException && error.message != null && error.message!.isNotEmpty) {
      return error.message!;
    }

    // 4. Cloud Functions Exceptions
    if (error is FirebaseFunctionsException) {
      switch (error.code) {
        case 'unavailable':
          return 'Server is temporarily unreachable. Please check your network connection.';
        case 'deadline-exceeded':
          return 'Request timed out. Please check your internet connection and try again.';
        case 'not-found':
          return 'The requested menu item or order was not found.';
        case 'permission-denied':
        case 'unauthenticated':
          return 'Access denied. Please sign in again to continue.';
        case 'resource-exhausted':
          return 'Too many requests. Please wait a moment before trying again.';
        default:
          if (error.message != null && error.message!.isNotEmpty) {
            return error.message!;
          }
      }
    }

    // 5. Common Domain & Business Exceptions
    if (lower.contains('order already collected') || lower.contains('replay')) {
      return 'This order has already been picked up and collected.';
    }

    if (lower.contains('out of stock') || lower.contains('insufficient stock')) {
      return 'Sorry, one or more items in your order just sold out!';
    }

    if (lower.contains('paused') || lower.contains('closed') || lower.contains('halt')) {
      return 'Canteen ordering is currently paused. Please check back shortly.';
    }

    // 6. Clean up raw technical markers
    final cleaned = rawStr
        .replaceAll('Exception:', '')
        .replaceAll(RegExp(r'\[[a-zA-Z0-9_\/-]+\]'), '')
        .trim();

    return cleaned.isNotEmpty ? cleaned : defaultFallback;
  }

  /// Determines if an error is specifically caused by network disconnection.
  static bool isNetworkError(dynamic error) {
    if (error == null) return false;
    final lower = error.toString().toLowerCase();
    return error is SocketException ||
        error is TimeoutException ||
        lower.contains('network-request-failed') ||
        lower.contains('network_error') ||
        lower.contains('failed host lookup') ||
        lower.contains('connection refused') ||
        lower.contains('client is offline') ||
        lower.contains('unavailable') ||
        lower.contains('apiexception: 7') ||
        lower.contains('socket');
  }
}
