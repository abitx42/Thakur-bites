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

  /// Validates if an email belongs to an authorized institutional campus domain
  static bool isAuthorizedCollegeDomain(String email) {
    final clean = email.trim().toLowerCase();
    if (!clean.contains('@')) return false;
    final domain = clean.split('@').last;
    return allowedInstitutionalDomains.any((d) => domain == d || domain.endsWith('.$d'));
  }

  /// Classifies email domain to default account type (Hint only — server enforces authoritative classification)
  static AccountType classifyEmailDomain(String email) {
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

      // Authoritative server-side profile provisioning as VISITOR
      await _functions.provisionUserProfile(
        displayName: 'Guest Visitor',
      );

      final profile = await getUserProfile(user.uid);
      if (profile != null) {
        return profile;
      }

      // Safe client-side fallback representation
      return UserProfile(
        uid: user.uid,
        email: '',
        displayName: 'Guest Visitor',
        accountType: AccountType.visitor,
        verificationStatus: VerificationStatus.notRequired,
        priorityLevel: 0,
        isVerified: true,
        accountDisabled: false,
        totalOrders: 0,
        createdAt: DateTime.now(),
        lastLoginAt: DateTime.now(),
      );
    } on FirebaseAuthException catch (e) {
      throw Exception(_mapFirebaseAuthError(e));
    } catch (e) {
      throw Exception('Guest sign-in failed: ${e.toString().replaceAll('Exception:', '').trim()}');
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
    if (password.length < 6) {
      throw Exception('Password must be at least 6 characters long.');
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

      // Authoritative server-side profile provisioning
      await _functions.provisionUserProfile(
        displayName: name.trim(),
        phone: phone.trim(),
        rollNo: rollNo?.trim().toUpperCase(),
        department: department?.trim(),
      );

      final profile = await getUserProfile(user.uid);
      if (profile != null) {
        return profile;
      }

      final accountType = classifyEmailDomain(cleanEmail);
      final isVisitor = accountType == AccountType.visitor;

      return UserProfile(
        uid: user.uid,
        email: cleanEmail,
        displayName: name.trim(),
        accountType: accountType,
        verificationStatus: isVisitor
            ? VerificationStatus.notRequired
            : (user.emailVerified ? VerificationStatus.verified : VerificationStatus.pending),
        priorityLevel: accountType == AccountType.teacher ? 2 : (isVisitor ? 0 : 1),
        department: department?.trim(),
        rollNo: rollNo?.trim().toUpperCase() ?? (isVisitor ? 'GUEST' : 'TCET'),
        phone: phone.trim(),
        isVerified: isVisitor || user.emailVerified,
        accountDisabled: false,
        totalOrders: 0,
        createdAt: DateTime.now(),
        lastLoginAt: DateTime.now(),
      );
    } on FirebaseAuthException catch (e) {
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

  /// Provisional quick student session (routed authoritatively through provisionUserProfile)
  Future<UserProfile> signInStudent({
    required String name,
    required String phone,
    required String rollNo,
    String? email,
  }) async {
    User? user = _auth.currentUser;
    if (user == null) {
      final anonCredential = await _auth.signInAnonymously();
      user = anonCredential.user;
      if (user == null) {
        throw Exception('Failed to initialize session.');
      }
    }

    // Authoritatively provision on the backend
    await _functions.provisionUserProfile(
      displayName: name.trim(),
      phone: phone.trim(),
      rollNo: rollNo.trim().toUpperCase(),
    );

    final profile = await getUserProfile(user.uid);
    if (profile != null) {
      return profile;
    }

    return UserProfile(
      uid: user.uid,
      email: email?.trim().toLowerCase() ?? user.email ?? '',
      displayName: name.trim(),
      accountType: AccountType.visitor,
      verificationStatus: VerificationStatus.notRequired,
      priorityLevel: 0,
      rollNo: rollNo.trim().toUpperCase(),
      phone: phone.trim(),
      isVerified: true,
      createdAt: DateTime.now(),
      lastLoginAt: DateTime.now(),
    );
  }

  /// Helper to ensure a UserProfile document exists in Firestore and is updated
  Future<UserProfile> _ensureUserProfile(User user) async {
    // 1. Call server-authoritative provisioner to guarantee valid record & claims
    try {
      await _functions.provisionUserProfile(
        displayName: user.displayName,
      );
    } catch (e) {
      debugPrint('[AuthService] Server provisioning notice: $e');
    }

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

    // Fallback baseline
    final email = user.email ?? '';
    final accountType = classifyEmailDomain(email);
    final isVisitor = accountType == AccountType.visitor;

    return UserProfile(
      uid: user.uid,
      email: email,
      displayName: user.displayName ?? (isVisitor ? 'Guest Customer' : 'TCET Student'),
      photoURL: user.photoURL,
      accountType: accountType,
      verificationStatus: isVisitor
          ? VerificationStatus.notRequired
          : (user.emailVerified ? VerificationStatus.verified : VerificationStatus.pending),
      priorityLevel: accountType == AccountType.teacher ? 2 : (isVisitor ? 0 : 1),
      isVerified: isVisitor || user.emailVerified,
      createdAt: DateTime.now(),
      lastLoginAt: DateTime.now(),
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
        return 'The password is too weak. Please use at least 6 characters.';
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

  /// Update user profile (Updates only client-mutable fields in accordance with Firestore security rules)
  Future<void> updateUserProfile(UserProfile profile) async {
    await _users.doc(profile.uid).update({
      'displayName': profile.displayName,
      if (profile.phone != null) 'phone': profile.phone,
      if (profile.department != null) 'department': profile.department,
      if (profile.photoURL != null) 'photoURL': profile.photoURL,
      'updatedAt': Timestamp.now(),
    });
  }

  /// Sign out current user
  Future<void> signOut() async {
    try {
      await _googleSignIn.signOut();
    } catch (_) {}
    await _auth.signOut();
  }
}
