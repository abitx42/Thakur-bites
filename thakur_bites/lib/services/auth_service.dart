import 'dart:convert';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/user_profile.dart';
import 'functions_service.dart';

/// Platform 2.0 Universal Authentication and Identity Service for Thakur Bites.
///
/// SECURITY ARCHITECTURE:
/// - Firebase Auth manages user authentication tokens.
/// - Authoritative user profile creation and role assignment is strictly performed
///   server-side via the `provisionUserProfile` Cloud Function.
/// - Clients cannot choose or write `accountType`, `priorityLevel`, `isVerified`,
///   `verificationStatus`, or `role` directly to Firestore.
/// - Anonymous guest sessions are strictly provisioned as `VISITOR` (Priority 0).
class AuthService {
  final FirebaseAuth _auth;
  final FirebaseFirestore _db;
  final FunctionsService _functions;
  final GoogleSignIn _googleSignIn;

  static const String serverClientId =
      '391012293021-5ak1k4a83ijbbgjjletl6vunmn1r6ung.apps.googleusercontent.com';

  AuthService({
    FirebaseAuth? auth,
    FirebaseFirestore? firestore,
    FunctionsService? functions,
    GoogleSignIn? googleSignIn,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _db = firestore ?? FirebaseFirestore.instance,
        _functions = functions ?? FunctionsService(),
        _googleSignIn = googleSignIn ??
            GoogleSignIn(
              serverClientId: serverClientId,
              scopes: ['email', 'profile'],
            );

  static const List<String> allowedInstitutionalDomains = [
    'tcetmumbai.in',
    'thakureducation.org',
  ];

  CollectionReference<Map<String, dynamic>> get _users =>
      _db.collection('users');

  /// Stream of Firebase Auth state changes
  Stream<User?> get authStateChanges => _auth.authStateChanges();

  /// Current Firebase user
  User? get currentUser => _auth.currentUser;

  /// Validates if an email belongs to an authorized institutional campus domain (TB-AUTH-005)
  static bool isAuthorizedCollegeDomain(String email) {
    final clean = email.trim().toLowerCase();
    if (!clean.contains('@')) return false;
    final domain = clean.split('@').last;
    return allowedInstitutionalDomains.contains(domain);
  }

  /// Informational UI hint for email domain (TB-AUTH-006: UI hint only — server enforces authoritative classification)
  static AccountType getIdentityHintFromEmail(String email) {
    final clean = email.trim().toLowerCase();
    if (clean.endsWith('@tcetmumbai.in')) {
      return AccountType.student;
    }
    if (clean.endsWith('@thakureducation.org')) {
      return AccountType.collegeStaff;
    }
    return AccountType.visitor;
  }

  static const String _cachedProfileKey = 'tb_cached_user_profile';

  /// Cache display data only. Cached verification/classification is not authority.
  Future<void> saveCachedProfile(UserProfile profile) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final displayProfile = _asUnverifiedDisplayProfile(profile);
      await prefs.setString(_cachedProfileKey, jsonEncode(displayProfile.toJson()));
    } catch (e) {
      debugPrint('[AuthService] Error saving cached profile: $e');
    }
  }

  /// Load profile from local disk cache
  Future<UserProfile?> getCachedProfile() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_cachedProfileKey);
      if (raw != null && raw.isNotEmpty) {
        final data = jsonDecode(raw) as Map<String, dynamic>;
        final cached = UserProfile.fromJson(data);
        if (_auth.currentUser?.uid != cached.uid) return null;
        return _asUnverifiedDisplayProfile(cached);
      }
    } catch (e) {
      debugPrint('[AuthService] Error loading cached profile: $e');
    }
    return null;
  }

  /// Clear local disk profile cache
  Future<void> clearCachedProfile() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_cachedProfileKey);
    } catch (_) {}
  }

  UserProfile _asUnverifiedDisplayProfile(UserProfile profile) {
    return profile.copyWith(
      accountType: AccountType.visitor,
      verificationStatus: VerificationStatus.pending,
      isVerified: false,
      priorityLevel: 0,
    );
  }

  /// Provision and load the current user's authoritative server profile.
  /// Offline display is available separately through getCachedProfile().
  Future<UserProfile?> getUserProfile(String uid) async {
    final user = _auth.currentUser;
    if (user == null || user.uid != uid) return null;
    try {
      return await _ensureUserProfile(user);
    } on ProfileProvisioningException {
      rethrow;
    } catch (_) {
      throw const ProfileProvisioningException('Unable to verify your profile with the server. Check your connection and retry.');
    }
  }

  /// Checks for any pending web OAuth redirect result on startup
  Future<UserProfile?> checkRedirectResult() async {
    if (kIsWeb) {
      try {
        final userCredential = await _auth.getRedirectResult();
        final user = userCredential.user;
        if (user != null) {
          return await _ensureUserProfile(user);
        }
      } catch (e) {
        if (e is ProfileProvisioningException) rethrow;
        throw const ProfileProvisioningException('Unable to finish Google sign-in. Check your connection and retry.');
      }
    }
    return null;
  }

  /// Sign In with Google (Google Identity Platform Web Popup / Redirect & Mobile Native SDK)
  Future<UserProfile> signInWithGoogle() async {
    UserCredential userCredential;

    try {
      if (kIsWeb) {
        final googleProvider = GoogleAuthProvider();
        googleProvider.addScope('email');
        googleProvider.addScope('profile');
        googleProvider.setCustomParameters({'prompt': 'select_account'});

        try {
          userCredential = await _auth.signInWithPopup(googleProvider);
        } on FirebaseAuthException catch (e) {
          if (e.code == 'popup-blocked' || e.code == 'popup-closed-by-user') {
            await _auth.signInWithRedirect(googleProvider);
            throw Exception('Redirecting to Google authentication...');
          }
          rethrow;
        }
      } else {
        // Disconnect previous Google session so the account chooser dialog is always shown
        try {
          await _googleSignIn.signOut();
        } catch (_) {}

        final GoogleSignInAccount? googleUser = await _googleSignIn.signIn();
        if (googleUser == null) {
          throw Exception('Google sign-in was cancelled.');
        }
        final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
        final OAuthCredential credential = GoogleAuthProvider.credential(
          accessToken: googleAuth.accessToken,
          idToken: googleAuth.idToken,
        );
        userCredential = await _auth.signInWithCredential(credential);
      }

      final user = userCredential.user;
      if (user == null) {
        throw Exception('Failed to obtain user identity from Google.');
      }

      return await _ensureUserProfile(user);
    } on FirebaseAuthException catch (e) {
      throw Exception(_mapFirebaseAuthError(e));
    } catch (e) {
      if (e is ProfileProvisioningException) rethrow;
      if (e.toString().contains('Redirecting')) rethrow;
      throw Exception(e.toString().replaceAll('Exception:', '').trim());
    }
  }

  /// Guest browsing identity helper
  Future<UserProfile> signInAsGuest() async {
    return UserProfile.guest();
  }



  /// Helper to ensure an authoritative UserProfile document exists in Firestore and is loaded.
  Future<UserProfile> _ensureUserProfile(
    User user, {
    String? initialDisplayName,
    String? initialPhone,
    String? initialRollNo,
    String? initialDepartment,
  }) async {
    // The callable, refreshed token and server-source profile must all succeed.
    try {
      final result = await _functions.provisionUserProfile(
        displayName: initialDisplayName ?? user.displayName,
        phone: initialPhone,
        rollNo: initialRollNo,
        department: initialDepartment,
      );
      if (result['success'] != true || result['userId'] != user.uid) {
        throw const ProfileProvisioningException('The server did not confirm profile setup. Please retry.');
      }
      final refreshedToken = await user.getIdToken(true);
      if (refreshedToken == null || refreshedToken.isEmpty) {
        throw const ProfileProvisioningException('Your sign-in token could not be refreshed. Please sign in again.');
      }
      if (_auth.currentUser?.uid != user.uid) {
        throw const ProfileProvisioningException('Your sign-in changed during profile setup. Please sign in again.');
      }
      final userDoc = await _users.doc(user.uid).get(const GetOptions(source: Source.server));
      final data = userDoc.data();
      if (_auth.currentUser?.uid != user.uid || !userDoc.exists || data == null
          || userDoc.id != user.uid
          || !const ['VISITOR', 'STUDENT', 'TEACHER', 'COLLEGE_STAFF'].contains(data['accountType'])
          || !const ['NOT_REQUIRED', 'PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED'].contains(data['verificationStatus'])
          || data['priorityLevel'] is! int || (data['priorityLevel'] as int) < 0 || (data['priorityLevel'] as int) > 3
          || data['isVerified'] is! bool || data['accountDisabled'] is! bool) {
        throw const ProfileProvisioningException('Your server profile is not ready. Please retry profile setup.');
      }
      final profile = UserProfile.fromFirestore(userDoc.id, data);
      if (profile.accountDisabled) {
        await clearCachedProfile();
        if (_auth.currentUser?.uid == user.uid) await _auth.signOut();
        throw const ProfileProvisioningException('Account has been deactivated. Please contact canteen management.');
      }
      await saveCachedProfile(profile);
      return profile;
    } on ProfileProvisioningException {
      rethrow;
    } catch (_) {
      throw const ProfileProvisioningException('Unable to complete server profile setup. Check your connection and retry.');
    }
  }

  /// Translates Firebase Auth error codes into human-readable messages
  static String _mapFirebaseAuthError(FirebaseAuthException e) {
    switch (e.code) {
      case 'user-not-found':
        return 'No account found with this email. Please sign up first.';
      case 'wrong-password':
      case 'invalid-credential':
        return 'Incorrect password or email. Please check your credentials.';
      case 'email-already-in-use':
        return 'An account already exists with this email address.';
      case 'invalid-email':
        return 'The email address is invalid.';
      case 'weak-password':
        return 'The password is too weak. Please use at least 8 characters.';
      case 'user-disabled':
        return 'This account has been disabled. Please contact support.';
      case 'too-many-requests':
        return 'Too many unsuccessful attempts. Please wait a few moments before trying again.';
      case 'operation-not-allowed':
        return 'This sign-in provider is currently not enabled in Firebase Console.';
      case 'network-request-failed':
        return 'Network error. Please check your internet connection.';
      default:
        return e.message ?? 'Authentication failed. Please try again.';
    }
  }

  /// Send password reset link to user email
  Future<void> sendPasswordReset(String email) async {
    final cleanEmail = email.trim().toLowerCase();
    try {
      await _auth.sendPasswordResetEmail(email: cleanEmail);
    } on FirebaseAuthException catch (e) {
      throw Exception(_mapFirebaseAuthError(e));
    }
  }

  /// Update user profile (Updates ONLY client-mutable fields in accordance with Firestore security rules)
  Future<void> updateUserProfile(UserProfile profile) async {
    final updateData = <String, dynamic>{
      'displayName': profile.displayName.trim(),
      if (profile.phone != null) 'phone': profile.phone!.trim(),
      if (profile.rollNo != null) 'rollNo': profile.rollNo!.trim().toUpperCase(),
      if (profile.department != null) 'department': profile.department!.trim(),
      if (profile.year != null) 'year': profile.year!.trim(),
      if (profile.photoURL != null) 'photoURL': profile.photoURL!,
      'updatedAt': Timestamp.now(),
    };
    try {
      await _users.doc(profile.uid).update(updateData);
    } catch (e) {
      debugPrint('[AuthService] updateUserProfile failed: $e');
      throw Exception('Failed to update profile. Please try again.');
    }
  }

  /// Sign out current user
  Future<void> signOut() async {
    await clearCachedProfile();
    try {
      await _googleSignIn.signOut();
    } catch (_) {}
    await _auth.signOut();
  }
}

/// A failed server provisioning/read is not a successful local identity profile.
class ProfileProvisioningException implements Exception {
  final String message;
  const ProfileProvisioningException(this.message);

  @override
  String toString() => message;
}
