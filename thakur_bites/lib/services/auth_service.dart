import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../models/user_profile.dart';
import '../models/student.dart';

/// Platform 2.0 Universal Authentication and Identity Service for Thakur Bites.
/// Seamlessly manages Google Identity Platform (Web & Native), Email/Password, and Guest Sessions.
class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final GoogleSignIn _googleSignIn = GoogleSignIn(
    scopes: ['email', 'profile'],
  );

  static const List<String> allowedInstitutionalDomains = [
    'tcetmumbai.in',
    'thakureducation.org',
  ];

  CollectionReference<Map<String, dynamic>> get _users =>
      _db.collection('users');

  CollectionReference<Map<String, dynamic>> get _students =>
      _db.collection('students');

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

  /// Classifies email domain to default account type
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

  /// Fetch a user profile by UID (Checking `users` collection first with fallback migration from `students`)
  Future<UserProfile?> getUserProfile(String uid) async {
    try {
      final userDoc = await _users.doc(uid).get();
      if (userDoc.exists && userDoc.data() != null) {
        return UserProfile.fromFirestore(userDoc.id, userDoc.data()!);
      }

      // Legacy fallback: check `students` collection
      final studentDoc = await _students.doc(uid).get();
      if (studentDoc.exists && studentDoc.data() != null) {
        final legacyStudent = Student.fromFirestore(studentDoc.id, studentDoc.data()!);
        
        // Auto-migrate legacy student to users collection
        final migratedProfile = UserProfile(
          uid: legacyStudent.uid,
          email: legacyStudent.email ?? '',
          displayName: legacyStudent.name.isNotEmpty ? legacyStudent.name : 'TCET Student',
          accountType: AccountType.student,
          verificationStatus: legacyStudent.isVerified ? VerificationStatus.verified : VerificationStatus.pending,
          priorityLevel: 1,
          department: legacyStudent.department,
          rollNo: legacyStudent.rollNo,
          phone: legacyStudent.phone,
          isVerified: legacyStudent.isVerified,
          accountDisabled: legacyStudent.accountDisabled,
          totalOrders: legacyStudent.totalOrders,
          createdAt: legacyStudent.createdAt,
          lastLoginAt: legacyStudent.lastLoginAt ?? DateTime.now(),
        );

        await _users.doc(uid).set(migratedProfile.toFirestore(), SetOptions(merge: true));
        return migratedProfile;
      }
    } catch (e) {
      debugPrint('Error fetching user profile for $uid: $e');
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
        // Official Firebase Web GoogleAuthProvider
        final googleProvider = GoogleAuthProvider();
        googleProvider.addScope('email');
        googleProvider.addScope('profile');
        googleProvider.setCustomParameters({'prompt': 'select_account'});

        try {
          userCredential = await _auth.signInWithPopup(googleProvider);
        } on FirebaseAuthException catch (e) {
          if (e.code == 'popup-blocked' || e.code == 'popup-closed-by-user') {
            // Graceful fallback to redirect
            await _auth.signInWithRedirect(googleProvider);
            throw Exception('Redirecting to Google authentication...');
          }
          rethrow;
        }
      } else {
        // Native Google Sign-In on iOS / Android
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

  /// Sign in as Guest (Anonymous Firebase Auth session + provisioned Visitor Profile)
  Future<UserProfile> signInAsGuest() async {
    try {
      final userCredential = await _auth.signInAnonymously();
      final user = userCredential.user;
      if (user == null) {
        throw Exception('Failed to create guest session.');
      }

      final guestProfile = UserProfile(
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

      await _users.doc(user.uid).set(guestProfile.toFirestore(), SetOptions(merge: true));
      return guestProfile;
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
    final accountType = classifyEmailDomain(cleanEmail);
    final isVisitor = accountType == AccountType.visitor;

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

      final userProfile = UserProfile(
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

      await _users.doc(user.uid).set(userProfile.toFirestore());
      return userProfile;
    } on FirebaseAuthException catch (e) {
      throw Exception(_mapFirebaseAuthError(e));
    } catch (e) {
      throw Exception('Sign up failed: ${e.toString().replaceAll('Exception:', '').trim()}');
    }
  }

  /// Sign in with Email and Password
  Future<UserProfile> signInWithEmail({
    required String email,
    required String password,
  }) async {
    final cleanEmail = email.trim().toLowerCase();

    if (cleanEmail.isEmpty) {
      throw Exception('Email address cannot be empty.');
    }
    if (password.isEmpty) {
      throw Exception('Password cannot be empty.');
    }

    try {
      final userCredential = await _auth.signInWithEmailAndPassword(
        email: cleanEmail,
        password: password,
      );

      final user = userCredential.user;
      if (user == null) {
        throw Exception('Failed to authenticate.');
      }

      await user.reload();
      final refreshedUser = _auth.currentUser ?? user;

      return await _ensureUserProfile(refreshedUser);
    } on FirebaseAuthException catch (e) {
      throw Exception(_mapFirebaseAuthError(e));
    } catch (e) {
      throw Exception('Sign in failed: ${e.toString().replaceAll('Exception:', '').trim()}');
    }
  }

  /// Instant Student Login with Name, Roll No & Phone (Creates or attaches to session)
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
        throw Exception('Failed to initialize student session.');
      }
    }

    final uid = user.uid;
    final cleanEmail = email?.trim().toLowerCase() ?? user.email ?? '';
    final accountType = classifyEmailDomain(cleanEmail);

    final profile = UserProfile(
      uid: uid,
      email: cleanEmail,
      displayName: name.trim(),
      accountType: accountType == AccountType.visitor ? AccountType.student : accountType,
      verificationStatus: VerificationStatus.pending,
      priorityLevel: 1,
      rollNo: rollNo.trim().toUpperCase(),
      phone: phone.trim(),
      isVerified: user.emailVerified,
      createdAt: DateTime.now(),
      lastLoginAt: DateTime.now(),
    );

    await _users.doc(uid).set(profile.toFirestore(), SetOptions(merge: true));
    return profile;
  }

  /// Helper to ensure a UserProfile document exists in Firestore and is updated
  Future<UserProfile> _ensureUserProfile(User user) async {
    final existing = await getUserProfile(user.uid);
    if (existing != null) {
      if (existing.accountDisabled) {
        await _auth.signOut();
        throw Exception('Account has been deactivated. Please contact canteen management.');
      }

      final isVerified = user.emailVerified || existing.isVerified || existing.accountType == AccountType.visitor;
      final updated = existing.copyWith(
        isVerified: isVerified,
        lastLoginAt: DateTime.now(),
        photoURL: user.photoURL ?? existing.photoURL,
        displayName: (existing.displayName.isEmpty || existing.displayName == 'Thakur Bites User')
            ? (user.displayName ?? existing.displayName)
            : existing.displayName,
      );

      await _users.doc(user.uid).update({
        'isVerified': isVerified,
        'lastLoginAt': Timestamp.now(),
        if (user.photoURL != null) 'photoURL': user.photoURL,
      });

      return updated;
    }

    // Provision new profile based on email classification
    final email = user.email ?? '';
    final accountType = classifyEmailDomain(email);
    final isVisitor = accountType == AccountType.visitor;
    final isVerified = isVisitor || user.emailVerified;

    final newProfile = UserProfile(
      uid: user.uid,
      email: email,
      displayName: user.displayName ?? (isVisitor ? 'Guest Customer' : 'TCET Student'),
      photoURL: user.photoURL,
      accountType: accountType,
      verificationStatus: isVisitor ? VerificationStatus.notRequired : (user.emailVerified ? VerificationStatus.verified : VerificationStatus.pending),
      priorityLevel: accountType == AccountType.teacher ? 2 : (isVisitor ? 0 : 1),
      isVerified: isVerified,
      createdAt: DateTime.now(),
      lastLoginAt: DateTime.now(),
    );

    await _users.doc(user.uid).set(newProfile.toFirestore());
    return newProfile;
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

  /// Update user profile
  Future<void> updateUserProfile(UserProfile profile) async {
    await _users.doc(profile.uid).set(profile.toFirestore(), SetOptions(merge: true));
  }

  /// Increment user total orders count
  Future<void> incrementUserOrders(String uid) async {
    await _users.doc(uid).update({
      'totalOrders': FieldValue.increment(1),
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
