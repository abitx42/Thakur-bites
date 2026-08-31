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

  /// Sign in student with Name, Phone, and College Roll Number.
  /// Uses Firebase Auth to establish a session, then saves the student profile in Firestore.
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

    // Check if student profile already exists
    final existingDoc = await _students.doc(uid).get();
    Student student;

    if (existingDoc.exists && existingDoc.data() != null) {
      final existing = Student.fromFirestore(uid, existingDoc.data()!);
      student = existing.copyWith(
        name: name.trim(),
        phone: phone.trim(),
        rollNo: rollNo.trim().toUpperCase(),
        email: email?.trim(),
      );
    } else {
      student = Student(
        uid: uid,
        name: name.trim(),
        phone: phone.trim(),
        rollNo: rollNo.trim().toUpperCase(),
        email: email?.trim(),
        createdAt: DateTime.now(),
        totalOrders: 0,
      );
    }

    // Persist profile in Firestore
    await _students.doc(uid).set(student.toFirestore(), SetOptions(merge: true));
    return student;
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
