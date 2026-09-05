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
      // 1. Process any pending OAuth web redirect results
      final redirectProfile = await _authService.checkRedirectResult();
      if (redirectProfile != null) {
        _currentUserProfile = redirectProfile;
      } else {
        final user = _authService.currentUser;
        if (user != null) {
          _currentUserProfile = await _authService.getUserProfile(user.uid);
        }
      }
    } catch (e) {
      debugPrint('[AuthProvider] Error initializing auth state: $e');
    } finally {
      _isLoading = false;
      notifyListeners();
    }

    _authService.authStateChanges.listen((user) async {
      if (user == null) {
        _currentUserProfile = null;
      } else {
        try {
          _currentUserProfile = await _authService.getUserProfile(user.uid);
        } catch (e) {
          debugPrint('[AuthProvider] Error fetching profile on auth change: $e');
        }
      }
      notifyListeners();
    });
  }

  /// Sign In with Google (Google Identity Platform)
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
      _currentUserProfile = await _authService.signInAsGuest();
    } catch (e) {
      _errorMessage = e.toString().replaceAll('Exception:', '').trim();
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Sign up with College Email or Visitor Email and Password
  Future<void> signUpWithEmail({
    required String email,
    required String password,
    required String name,
    required String phone,
    String? rollNo,
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

  /// Reset Password
  Future<void> sendPasswordReset(String email) async {
    _errorMessage = null;
    try {
      await _authService.sendPasswordReset(email);
    } catch (e) {
      _errorMessage = e.toString().replaceAll('Exception:', '').trim();
      rethrow;
    }
  }

  /// Update Profile Details
  Future<void> updateProfile([UserProfile? profile]) async {
    if (profile != null) {
      _currentUserProfile = profile;
      await _authService.updateUserProfile(profile);
      notifyListeners();
      return;
    }
  }

  /// Update Profile fields
  Future<void> updateProfileFields({
    String? displayName,
    String? phone,
    String? department,
    String? rollNo,
    String? photoURL,
  }) async {
    if (_currentUserProfile == null) return;

    _isLoading = true;
    notifyListeners();

    try {
      final updated = _currentUserProfile!.copyWith(
        displayName: displayName ?? _currentUserProfile!.displayName,
        phone: phone ?? _currentUserProfile!.phone,
        department: department ?? _currentUserProfile!.department,
        rollNo: rollNo ?? _currentUserProfile!.rollNo,
        photoURL: photoURL ?? _currentUserProfile!.photoURL,
        lastLoginAt: DateTime.now(),
      );

      await _authService.updateUserProfile(updated);
      _currentUserProfile = updated;
    } catch (e) {
      _errorMessage = e.toString().replaceAll('Exception:', '').trim();
      rethrow;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Increment Order Count (Local state notification — server updates authoritative totalOrders on checkout)
  void incrementOrderCount() {
    if (_currentUserProfile != null) {
      _currentUserProfile = _currentUserProfile!.copyWith(
        totalOrders: _currentUserProfile!.totalOrders + 1,
      );
      notifyListeners();
    }
  }

  /// Sign Out
  Future<void> signOut() async {
    _isLoading = true;
    notifyListeners();

    try {
      await _authService.signOut();
      _currentUserProfile = null;
      _errorMessage = null;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}
