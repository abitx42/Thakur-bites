import 'package:flutter/foundation.dart';
import '../models/user_profile.dart';
import '../services/auth_service.dart';

/// Reactive authentication & identity provider using ChangeNotifier.
/// Backed by Platform 2.0 Universal Identity Model.
class AuthProvider extends ChangeNotifier {
  final AuthService _authService;

  UserProfile? _currentUserProfile;
  bool _isLoading = true;
  String? _errorMessage;

  UserProfile? get currentProfile => _currentUserProfile;
  /// Backward-compatibility alias for currentProfile
  UserProfile? get currentStudent => _currentUserProfile;

  bool get isLoggedIn => _currentUserProfile != null && !isGuest;
  bool get isGuest => _authService.currentUser?.isAnonymous ?? false;
  bool get isVerified => _currentUserProfile?.isVerified ?? false;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  AccountType get accountType =>
      _currentUserProfile?.accountType ?? AccountType.visitor;
  VerificationStatus get verificationStatus =>
      _currentUserProfile?.verificationStatus ?? VerificationStatus.notRequired;
  bool get hasPriorityAccess =>
      _currentUserProfile?.hasPriorityAccess ?? false;

  AuthProvider({AuthService? authService})
      : _authService = authService ?? AuthService() {
    _init();
  }

  Future<void> _init() async {
    _isLoading = true;
    notifyListeners();

    try {
      final user = _authService.currentUser;
      if (user != null && !user.isAnonymous) {
        _currentUserProfile = await _authService.getUserProfile(user.uid);
      }
    } catch (e) {
      debugPrint('Error initializing auth state: $e');
    } finally {
      _isLoading = false;
      notifyListeners();
    }

    _authService.authStateChanges.listen((user) async {
      if (user == null || user.isAnonymous) {
        _currentUserProfile = null;
        notifyListeners();
      } else {
        _currentUserProfile = await _authService.getUserProfile(user.uid);
        notifyListeners();
      }
    });
  }

  /// Sign In with Google
  Future<void> signInWithGoogle() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      _currentUserProfile = await _authService.signInWithGoogle();
    } catch (e) {
      _errorMessage = e.toString().replaceAll('Exception:', '').trim();
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Sign in as Guest for casual browsing
  Future<void> signInAsGuest() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _authService.signInAsGuest();
      _currentUserProfile = null; // Guest is unauthenticated
    } catch (e) {
      _errorMessage = e.toString().replaceAll('Exception:', '').trim();
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Sign up with College Email and Password
  Future<void> signUpWithEmail({
    required String email,
    required String password,
    required String name,
    required String phone,
    required String rollNo,
    String? department,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      _currentUserProfile = await _authService.signUpWithEmail(
        email: email,
        password: password,
        name: name,
        phone: phone,
        rollNo: rollNo,
        department: department,
      );
    } catch (e) {
      _errorMessage = e.toString().replaceAll('Exception:', '').trim();
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Sign in with Email and Password
  Future<void> signInWithEmail({
    required String email,
    required String password,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      _currentUserProfile = await _authService.signInWithEmail(
        email: email,
        password: password,
      );
    } catch (e) {
      _errorMessage = e.toString().replaceAll('Exception:', '').trim();
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Sign in student with Roll Number & Phone
  Future<void> signInStudent({
    required String name,
    required String phone,
    required String rollNo,
    String? email,
  }) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      _currentUserProfile = await _authService.signInStudent(
        name: name,
        phone: phone,
        rollNo: rollNo,
        email: email,
      );
    } catch (e) {
      _errorMessage = e.toString().replaceAll('Exception:', '').trim();
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Send password reset email
  Future<void> sendPasswordReset(String email) async {
    await _authService.sendPasswordReset(email);
  }

  /// Sign out current user
  Future<void> signOut() async {
    _isLoading = true;
    notifyListeners();

    try {
      await _authService.signOut();
      _currentUserProfile = null;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Increment order count in local state
  void incrementOrderCount() {
    if (_currentUserProfile != null) {
      _currentUserProfile = _currentUserProfile!.copyWith(
        totalOrders: _currentUserProfile!.totalOrders + 1,
      );
      notifyListeners();
    }
  }

  /// Update user profile details
  Future<void> updateProfile(UserProfile updated) async {
    await _authService.updateUserProfile(updated);
    _currentUserProfile = updated;
    notifyListeners();
  }
}
