import 'package:flutter/foundation.dart';
import '../models/student.dart';
import '../services/auth_service.dart';

/// Reactive authentication & student profile provider using ChangeNotifier.
class AuthProvider extends ChangeNotifier {
  final AuthService _authService = AuthService();

  Student? _currentStudent;
  bool _isLoading = true;

  Student? get currentStudent => _currentStudent;
  bool get isLoggedIn => _currentStudent != null;
  bool get isLoading => _isLoading;

  AuthProvider() {
    _init();
  }

  Future<void> _init() async {
    _isLoading = true;
    notifyListeners();

    try {
      final user = _authService.currentUser;
      if (user != null) {
        _currentStudent = await _authService.getStudentProfile(user.uid);
      }
    } catch (e) {
      debugPrint('Error initializing auth state: $e');
    } finally {
      _isLoading = false;
      notifyListeners();
    }

    _authService.authStateChanges.listen((user) async {
      if (user == null) {
        _currentStudent = null;
        notifyListeners();
      } else {
        _currentStudent = await _authService.getStudentProfile(user.uid);
        notifyListeners();
      }
    });
  }

  /// Sign in student with credentials
  Future<void> signInStudent({
    required String name,
    required String phone,
    required String rollNo,
    String? email,
  }) async {
    _isLoading = true;
    notifyListeners();

    try {
      _currentStudent = await _authService.signInStudent(
        name: name,
        phone: phone,
        rollNo: rollNo,
        email: email,
      );
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Sign out current student
  Future<void> signOut() async {
    _isLoading = true;
    notifyListeners();

    try {
      await _authService.signOut();
      _currentStudent = null;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Increment order count in local state
  void incrementOrderCount() {
    if (_currentStudent != null) {
      _currentStudent = _currentStudent!.copyWith(
        totalOrders: _currentStudent!.totalOrders + 1,
      );
      notifyListeners();
    }
  }
}
