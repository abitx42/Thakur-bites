import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/student.dart';

/// Trusted Authentication and Student Profile Service for Thakur Bites.
/// Strictly enforces verified institutional email domains (@tcetmumbai.in, @thakureducation.org).
class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  static const List<String> allowedDomains = [
    'tcetmumbai.in',
    'thakureducation.org',
  ];

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

  /// Fetch a student profile by UID
  Future<Student?> getStudentProfile(String uid) async {
    final doc = await _students.doc(uid).get();
    if (!doc.exists || doc.data() == null) return null;
    return Student.fromFirestore(doc.id, doc.data()!);
  }

  /// Sign up with authentic college email and password
  Future<Student> signUpWithEmail({
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
          'Registration is restricted to official college email addresses (@tcetmumbai.in or @thakureducation.org).');
    }

    final userCredential = await _auth.createUserWithEmailAndPassword(
      email: cleanEmail,
      password: password,
    );

    final user = userCredential.user;
    if (user == null) {
      throw Exception('Failed to create student account.');
    }

    // Send email verification link
    await user.sendEmailVerification();

    final student = Student(
      uid: user.uid,
      name: name.trim(),
      phone: phone.trim(),
      rollNo: rollNo.trim().toUpperCase(),
      email: cleanEmail,
      department: department?.trim(),
      isVerified: user.emailVerified,
      accountDisabled: false,
      createdAt: DateTime.now(),
      lastLoginAt: DateTime.now(),
      totalOrders: 0,
    );

    await _students.doc(user.uid).set(student.toFirestore());
    return student;
  }

  /// Sign in with authentic college email and password
  Future<Student> signInWithEmail({
    required String email,
    required String password,
  }) async {
    final cleanEmail = email.trim().toLowerCase();

    if (!isAuthorizedCollegeDomain(cleanEmail)) {
      throw Exception(
          'Sign in is restricted to official college email addresses (@tcetmumbai.in or @thakureducation.org).');
    }

    final userCredential = await _auth.signInWithEmailAndPassword(
      email: cleanEmail,
      password: password,
    );

    final user = userCredential.user;
    if (user == null) {
      throw Exception('Failed to authenticate student.');
    }

    // Reload user to get latest emailVerified state
    await user.reload();
    final refreshedUser = _auth.currentUser ?? user;

    final profile = await getStudentProfile(refreshedUser.uid);
    if (profile != null) {
      if (profile.accountDisabled) {
        await _auth.signOut();
        throw Exception(
            'Account has been deactivated. Please contact campus canteen admin.');
      }

      final updatedProfile = profile.copyWith(
        isVerified: refreshedUser.emailVerified,
        lastLoginAt: DateTime.now(),
      );

      await _students.doc(refreshedUser.uid).update({
        'isVerified': refreshedUser.emailVerified,
        'lastLoginAt': Timestamp.now(),
      });

      return updatedProfile;
    }

    // Fallback provisioning if profile doc is missing
    final fallback = Student(
      uid: refreshedUser.uid,
      name: refreshedUser.displayName ?? 'TCET Student',
      phone: '',
      rollNo: 'TCET',
      email: refreshedUser.email,
      isVerified: refreshedUser.emailVerified,
      createdAt: DateTime.now(),
      lastLoginAt: DateTime.now(),
    );

    await _students.doc(refreshedUser.uid).set(fallback.toFirestore());
    return fallback;
  }

  /// Sign in student with roll number and password
  Future<Student> signInStudent({
    required String name,
    required String phone,
    required String rollNo,
    String? email,
  }) async {
    final user = _auth.currentUser;
    if (user == null) {
      throw Exception(
          'Please sign in or register with your college email (@tcetmumbai.in).');
    }

    final uid = user.uid;
    final existingDoc = await _students.doc(uid).get();
    Student student;

    if (existingDoc.exists && existingDoc.data() != null) {
      final existing = Student.fromFirestore(uid, existingDoc.data()!);
      student = existing.copyWith(
        name: name.trim(),
        phone: phone.trim(),
        rollNo: rollNo.trim().toUpperCase(),
        email: email?.trim().toLowerCase() ?? user.email,
        isVerified: user.emailVerified,
        lastLoginAt: DateTime.now(),
      );
    } else {
      final cleanEmail = email?.trim().toLowerCase() ?? user.email;
      student = Student(
        uid: uid,
        name: name.trim(),
        phone: phone.trim(),
        rollNo: rollNo.trim().toUpperCase(),
        email: cleanEmail,
        isVerified: user.emailVerified,
        createdAt: DateTime.now(),
        lastLoginAt: DateTime.now(),
        totalOrders: 0,
      );
    }

    await _students.doc(uid).set(student.toFirestore(), SetOptions(merge: true));
    return student;
  }

  /// Send password reset link to student email
  Future<void> sendPasswordReset(String email) async {
    final cleanEmail = email.trim().toLowerCase();
    if (!isAuthorizedCollegeDomain(cleanEmail)) {
      throw Exception(
          'Password reset is only available for institutional emails (@tcetmumbai.in).');
    }
    await _auth.sendPasswordResetEmail(email: cleanEmail);
  }

  /// Increment student total orders count
  Future<void> incrementStudentOrders(String uid) async {
    await _students.doc(uid).update({
      'totalOrders': FieldValue.increment(1),
    });
  }

  /// Sign out current user
  Future<void> signOut() async {
    await _auth.signOut();
  }
}
