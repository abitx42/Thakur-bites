import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
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

  AuthService({
    FirebaseAuth? auth,
    FirebaseFirestore? firestore,
    FunctionsService? functions,
    GoogleSignIn? googleSignIn,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _db = firestore ?? FirebaseFirestore.instance,
        _functions = functions ?? FunctionsService(),
        _googleSignIn = googleSignIn ?? GoogleSignIn(scopes: ['email', 'profile']);

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

  /// Fetch a user profile by UID from authoritative `users` collection.
  Future<UserProfile?> getUserProfile(String uid) async {
    try {
      final userDoc = await _users.doc(uid).get();
      if (userDoc.exists && userDoc.data() != null) {
        return UserProfile.fromFirestore(userDoc.id, userDoc.data()!);
      }

      // If user profile document does not exist in Firestore yet, trigger server-side provisioning
      if (_auth.currentUser != null && _auth.currentUser!.uid == uid) {
        return await _ensureUserProfile(_auth.currentUser!);
      }
    } catch (e) {
      debugPrint('[AuthService] Error fetching user profile for $uid: $e');
    }
    return null;
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
        debugPrint('[AuthService] Web redirect result check: $e');
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
      if (e.toString().contains('Redirecting')) rethrow;
      throw Exception(e.toString().replaceAll('Exception:', '').trim());
    }
  }

  /// Sign in as Guest (Anonymous Firebase Auth session + server-provisioned VISITOR Profile)
  Future<UserProfile> signInAsGuest() async {
    try {
      final userCredential = await _auth.signInAnonymously();
      final user = userCredential.user;
      if (user == null) {
        throw Exception('Failed to create guest session.');
      }

      return await _ensureUserProfile(
        user,
        initialDisplayName: 'Guest Visitor',
      );
    } on FirebaseAuthException catch (e) {
      throw Exception(_mapFirebaseAuthError(e));
    } catch (e) {
      throw Exception('Guest sign-in failed: ${e.toString().replaceAll('Exception:', '').trim()}');
    }
  }

  /// Link an anonymous Guest account with Google credentials to preserve order history (TB-NEW-004)
  Future<UserProfile> linkGuestWithGoogle() async {
    final currentUser = _auth.currentUser;
    if (currentUser == null || !currentUser.isAnonymous) {
      return await signInWithGoogle();
    }

    try {
      if (kIsWeb) {
        final googleProvider = GoogleAuthProvider();
        googleProvider.addScope('email');
        googleProvider.addScope('profile');
        googleProvider.setCustomParameters({'prompt': 'select_account'});

        try {
          final userCredential = await currentUser.linkWithPopup(googleProvider);
          final user = userCredential.user ?? currentUser;
          return await _ensureUserProfile(user);
        } on FirebaseAuthException catch (e) {
          if (e.code == 'credential-already-in-use') {
            return await signInWithGoogle();
          }
          rethrow;
        }
      } else {
        final GoogleSignInAccount? googleUser = await _googleSignIn.signIn();
        if (googleUser == null) {
          throw Exception('Google sign-in was cancelled.');
        }
        final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
        final OAuthCredential credential = GoogleAuthProvider.credential(
          accessToken: googleAuth.accessToken,
          idToken: googleAuth.idToken,
        );
        try {
          final userCredential = await currentUser.linkWithCredential(credential);
          final user = userCredential.user ?? currentUser;
          return await _ensureUserProfile(user);
        } on FirebaseAuthException catch (e) {
          if (e.code == 'credential-already-in-use') {
            return await signInWithGoogle();
          }
          rethrow;
        }
      }
    } on FirebaseAuthException catch (e) {
      throw Exception(_mapFirebaseAuthError(e));
    } catch (e) {
      throw Exception('Account linking failed: ${e.toString().replaceAll('Exception:', '').trim()}');
    }
  }

  /// Sign up with Email and Password (Institutional or Visitor)
  Future<UserProfile> signUpWithEmail({
    required String email,
    required String password,
    required String name,
    required String phone,
    String? rollNo,
    String? department,
  }) async {
    final cleanEmail = email.trim().toLowerCase();

    if (cleanEmail.isEmpty || !cleanEmail.contains('@')) {
      throw Exception('Please enter a valid email address.');
    }
    if (password.length < 8) {
      throw Exception('Password must be at least 8 characters long.');
    }

    final isCollegeDomain = isAuthorizedCollegeDomain(cleanEmail);

    try {
      final userCredential = await _auth.createUserWithEmailAndPassword(
        email: cleanEmail,
        password: password,
      );

      final user = userCredential.user;
      if (user == null) {
        throw Exception('Failed to create account.');
      }

      // Update user display name in Firebase Auth
      await user.updateDisplayName(name.trim());

      // Send verification link for institutional accounts
      if (isCollegeDomain) {
        try {
          await user.sendEmailVerification();
        } catch (_) {}
      }

      // Authoritatively provision and load user profile (single fail-closed path)
      final profile = await _ensureUserProfile(
        user,
        initialDisplayName: name.trim(),
        initialPhone: phone.trim(),
        initialRollNo: rollNo?.trim().toUpperCase(),
        initialDepartment: department?.trim(),
      );
      return profile;
    } on FirebaseAuthException catch (e) {
      if (e.code == 'email-already-in-use') {
        try {
          final cred = await _auth.signInWithEmailAndPassword(
            email: cleanEmail,
            password: password,
          );
          final user = cred.user;
          if (user != null) {
            return await _ensureUserProfile(user);
          }
        } catch (_) {
          throw Exception('An account with this email already exists. Please click "Already have an account? Sign In" below.');
        }
      }
      throw Exception(_mapFirebaseAuthError(e));
    } catch (e) {
      throw Exception(e.toString().replaceAll('Exception:', '').trim());
    }
  }

  /// Sign In with Email and Password
  Future<UserProfile> signInWithEmail({
    required String email,
    required String password,
  }) async {
    final cleanEmail = email.trim().toLowerCase();
    if (cleanEmail.isEmpty || !cleanEmail.contains('@')) {
      throw Exception('Please enter a valid email address.');
    }
    if (password.isEmpty) {
      throw Exception('Please enter your password.');
    }

    try {
      final userCredential = await _auth.signInWithEmailAndPassword(
        email: cleanEmail,
        password: password,
      );

      final user = userCredential.user;
      if (user == null) {
        throw Exception('Sign-in failed.');
      }

      // Reload user to get latest emailVerified state
      await user.reload();
      final freshUser = _auth.currentUser ?? user;

      return await _ensureUserProfile(freshUser);
    } on FirebaseAuthException catch (e) {
      throw Exception(_mapFirebaseAuthError(e));
    } catch (e) {
      throw Exception(e.toString().replaceAll('Exception:', '').trim());
    }
  }

  /// Helper to ensure an authoritative UserProfile document exists in Firestore and is loaded.
  /// Strictly fail-closed: If backend provisioning fails and the profile doc does not exist,
  /// the client NEVER fabricates a profile document (TB-NEW-001/002).
  Future<UserProfile> _ensureUserProfile(
    User user, {
    String? initialDisplayName,
    String? initialPhone,
    String? initialRollNo,
    String? initialDepartment,
  }) async {
    // 1. Call server-authoritative provisioner to guarantee valid record & claims
    try {
      await _functions.provisionUserProfile(
        displayName: initialDisplayName ?? user.displayName,
        phone: initialPhone,
        rollNo: initialRollNo,
        department: initialDepartment,
      );
    } catch (e) {
      debugPrint('[AuthService] Server provisioning notice: $e');
    }

    // Force refresh ID token to get latest custom claims from the server (TB-AUTH-007)
    try {
      await user.getIdToken(true);
    } catch (_) {}

    // 2. Fetch authoritative profile from Firestore
    final userDoc = await _users.doc(user.uid).get();
    if (userDoc.exists && userDoc.data() != null) {
      final profile = UserProfile.fromFirestore(userDoc.id, userDoc.data()!);
      if (profile.accountDisabled) {
        await _auth.signOut();
        throw Exception('Account has been deactivated. Please contact canteen management.');
      }
      return profile;
    }

    // 3. Document does not exist in Firestore and server provisioning failed.
    // FAIL CLOSED: Do not allow client-fabricated profile (TB-NEW-002).
    await _auth.signOut();
    throw Exception(
      'Account setup is temporarily unavailable. Please verify your connection or contact canteen management.',
    );
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
    try {
      await _googleSignIn.signOut();
    } catch (_) {}
    await _auth.signOut();
  }
}
