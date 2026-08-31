import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../models/user_profile.dart';
import '../models/student.dart';

/// Platform 2.0 Universal Authentication and Identity Service for Thakur Bites.
/// Seamlessly manages Google Sign-In, Email/Password, and Anonymous Guest sessions.
class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final GoogleSignIn _googleSignIn = GoogleSignIn(
    scopes: ['email', 'profile'],
  );

  static const List<String> allowedDomains = [
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
    return allowedDomains.any((d) => domain == d || domain.endsWith('.$d'));
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

  /// Sign In with Google (Web and Mobile compatible)
  Future<UserProfile> signInWithGoogle() async {
    UserCredential userCredential;

    if (kIsWeb) {
      // Use Firebase Auth popup on Web for optimal reliability
      final googleProvider = GoogleAuthProvider();
      googleProvider.addScope('email');
      googleProvider.addScope('profile');
      googleProvider.setCustomParameters({'prompt': 'select_account'});
      userCredential = await _auth.signInWithPopup(googleProvider);
    } else {
      // Native Google Sign-In on iOS / Android
      final GoogleSignInAccount? googleUser = await _googleSignIn.signIn();
      if (googleUser == null) {
        throw Exception('Google sign-in was cancelled by the user.');
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
      throw Exception('Failed to obtain user from Google Sign-In.');
    }

    return await _ensureUserProfile(user);
  }

  /// Sign in anonymously as Guest for browsing
  Future<User> signInAsGuest() async {
    final userCredential = await _auth.signInAnonymously();
    final user = userCredential.user;
    if (user == null) {
      throw Exception('Failed to create guest session.');
    }
    return user;
  }

  /// Sign up with College Email and Password
  Future<UserProfile> signUpWithEmail({
    required String email,
    required String password,
    required String name,
    required String phone,
    required String rollNo,
    String? department,
  }) async {
    final cleanEmail = email.trim().toLowerCase();

    if (!isAuthorizedCollegeDomain(cleanEmail)) {
      throw Exception(
          'Institutional sign-up is restricted to official college email addresses (@tcetmumbai.in or @thakureducation.org).');
    }

    final userCredential = await _auth.createUserWithEmailAndPassword(
      email: cleanEmail,
      password: password,
    );

    final user = userCredential.user;
    if (user == null) {
      throw Exception('Failed to create user account.');
    }

    // Send email verification link
    await user.sendEmailVerification();

    final accountType = classifyEmailDomain(cleanEmail);
    final userProfile = UserProfile(
      uid: user.uid,
      email: cleanEmail,
      displayName: name.trim(),
      accountType: accountType,
      verificationStatus: user.emailVerified ? VerificationStatus.verified : VerificationStatus.pending,
      priorityLevel: 1,
      department: department?.trim(),
      rollNo: rollNo.trim().toUpperCase(),
      phone: phone.trim(),
      isVerified: user.emailVerified,
      accountDisabled: false,
      totalOrders: 0,
      createdAt: DateTime.now(),
      lastLoginAt: DateTime.now(),
    );

    await _users.doc(user.uid).set(userProfile.toFirestore());
    return userProfile;
  }

  /// Sign in with Email and Password
  Future<UserProfile> signInWithEmail({
    required String email,
    required String password,
  }) async {
    final cleanEmail = email.trim().toLowerCase();

    final userCredential = await _auth.signInWithEmailAndPassword(
      email: cleanEmail,
      password: password,
    );

    final user = userCredential.user;
    if (user == null) {
      throw Exception('Failed to authenticate user.');
    }

    await user.reload();
    final refreshedUser = _auth.currentUser ?? user;

    return await _ensureUserProfile(refreshedUser);
  }

  /// Instant Sign-In with Roll Number & Phone
  Future<UserProfile> signInStudent({
    required String name,
    required String phone,
    required String rollNo,
    String? email,
  }) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw Exception('No active session. Please sign in with Google or College Email.');
    }

    final uid = user.uid;
    final existing = await getUserProfile(uid);
    UserProfile profile;

    if (existing != null) {
      profile = existing.copyWith(
        displayName: name.trim(),
        phone: phone.trim(),
        rollNo: rollNo.trim().toUpperCase(),
        email: email?.trim().toLowerCase() ?? user.email,
        isVerified: user.emailVerified,
        lastLoginAt: DateTime.now(),
      );
    } else {
      final cleanEmail = email?.trim().toLowerCase() ?? user.email ?? '';
      final accountType = classifyEmailDomain(cleanEmail);
      profile = UserProfile(
        uid: uid,
        email: cleanEmail,
        displayName: name.trim(),
        accountType: accountType,
        verificationStatus: user.emailVerified ? VerificationStatus.verified : VerificationStatus.pending,
        priorityLevel: 1,
        rollNo: rollNo.trim().toUpperCase(),
        phone: phone.trim(),
        isVerified: user.emailVerified,
        createdAt: DateTime.now(),
        lastLoginAt: DateTime.now(),
      );
    }

    await _users.doc(uid).set(profile.toFirestore(), SetOptions(merge: true));
    return profile;
  }

  /// Internal helper to ensure a UserProfile document exists and is up to date
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

  /// Send password reset link to user email
  Future<void> sendPasswordReset(String email) async {
    final cleanEmail = email.trim().toLowerCase();
    await _auth.sendPasswordResetEmail(email: cleanEmail);
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
