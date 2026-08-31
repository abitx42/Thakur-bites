import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/student.dart';

/// Authentication and student profile service for Thakur Bites.
class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _students =>
      _db.collection('students');

  /// Stream of Firebase Auth state changes
  Stream<User?> get authStateChanges => _auth.authStateChanges();

  /// Current Firebase user
  User? get currentUser => _auth.currentUser;

  /// Fetch a student profile by UID
  Future<Student?> getStudentProfile(String uid) async {
    final doc = await _students.doc(uid).get();
    if (!doc.exists || doc.data() == null) return null;
    return Student.fromFirestore(doc.id, doc.data()!);
  }

  /// Sign up with college email and password
  Future<Student> signUpWithEmail({
    required String email,
    required String password,
    required String name,
    required String phone,
    required String rollNo,
    String? department,
  }) async {
    final cleanEmail = email.trim().toLowerCase();
    final userCredential = await _auth.createUserWithEmailAndPassword(
      email: cleanEmail,
      password: password,
    );

    final user = userCredential.user;
    if (user == null) {
      throw Exception('Failed to create student account.');
    }

    final isCollegeDomain = cleanEmail.endsWith('@thakureducation.org') ||
        cleanEmail.endsWith('@tcetmumbai.in') ||
        cleanEmail.endsWith('.edu.in');

    final student = Student(
      uid: user.uid,
      name: name.trim(),
      phone: phone.trim(),
      rollNo: rollNo.trim().toUpperCase(),
      email: cleanEmail,
      department: department?.trim(),
      isVerified: isCollegeDomain,
      accountDisabled: false,
      createdAt: DateTime.now(),
      lastLoginAt: DateTime.now(),
      totalOrders: 0,
    );

    await _students.doc(user.uid).set(student.toFirestore());
    return student;
  }

  /// Sign in with email and password
  Future<Student> signInWithEmail({
    required String email,
    required String password,
  }) async {
    final userCredential = await _auth.signInWithEmailAndPassword(
      email: email.trim().toLowerCase(),
      password: password,
    );

    final user = userCredential.user;
    if (user == null) {
      throw Exception('Failed to authenticate student.');
    }

    final profile = await getStudentProfile(user.uid);
    if (profile != null) {
      if (profile.accountDisabled) {
        await _auth.signOut();
        throw Exception('Account has been deactivated. Please contact campus canteen admin.');
      }
      // Update lastLoginAt
      await _students.doc(user.uid).update({
        'lastLoginAt': Timestamp.now(),
      });
      return profile;
    }

    // Fallback profile if record is missing
    final fallback = Student(
      uid: user.uid,
      name: user.displayName ?? 'TCET Student',
      phone: '',
      rollNo: 'TCET',
      email: user.email,
      createdAt: DateTime.now(),
      lastLoginAt: DateTime.now(),
    );
    await _students.doc(user.uid).set(fallback.toFirestore());
    return fallback;
  }

  /// Fast student sign-in with Roll Number & Phone
  Future<Student> signInStudent({
    required String name,
    required String phone,
    required String rollNo,
    String? email,
  }) async {
    User? user = _auth.currentUser;
    if (user == null) {
      final userCredential = await _auth.signInAnonymously();
      user = userCredential.user;
    }

    if (user == null) {
      throw Exception('Failed to initialize Firebase Auth session.');
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
        email: email?.trim().toLowerCase(),
        lastLoginAt: DateTime.now(),
      );
    } else {
      final cleanEmail = email?.trim().toLowerCase();
      final isCollegeDomain = cleanEmail != null &&
          (cleanEmail.endsWith('@thakureducation.org') ||
              cleanEmail.endsWith('@tcetmumbai.in') ||
              cleanEmail.endsWith('.edu.in'));

      student = Student(
        uid: uid,
        name: name.trim(),
        phone: phone.trim(),
        rollNo: rollNo.trim().toUpperCase(),
        email: cleanEmail,
        isVerified: isCollegeDomain,
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
    await _auth.sendPasswordResetEmail(email: email.trim().toLowerCase());
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
