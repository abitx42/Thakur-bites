import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart' show User;
import 'package:flutter/foundation.dart';
import '../models/user_profile.dart';
import '../services/auth_service.dart';
import '../services/preferences_service.dart';

/// Reactive authentication & identity provider using ChangeNotifier.
/// Backed by Platform 2.0 Universal Identity Model.
class AuthProvider extends ChangeNotifier {
  final AuthService _authService;
  final PreferencesService _preferences;
  StreamSubscription<User?>? _authSub;

  UserProfile? _currentUserProfile;
  bool _isLoading = true;
  bool _isGuestBrowsing = false;
  bool _signingOut = false;
  bool _disposed = false;
  int _stateVersion = 0;
  int _actionVersion = 0;
  String? _errorMessage;

  UserProfile? get currentProfile {
    if (_disposed) return null;
    if (_isGuestBrowsing) return _currentUserProfile;
    return _currentUserProfile?.uid == _authService.currentUser?.uid
        ? _currentUserProfile
        : null;
  }

  /// Backward-compatibility alias for currentProfile
  UserProfile? get currentStudent => currentProfile;

  bool get isLoggedIn => currentProfile != null && !isGuest;
  bool get isGuest =>
      currentProfile == null ||
      _isGuestBrowsing ||
      (_authService.currentUser?.isAnonymous ?? true);
  bool get isVerified => isLoggedIn && (currentProfile?.isVerified ?? false);
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  AccountType get accountType =>
      currentProfile?.accountType ?? AccountType.visitor;
  VerificationStatus get verificationStatus =>
      currentProfile?.verificationStatus ?? VerificationStatus.notRequired;
  bool get hasPriorityAccess =>
      isLoggedIn && (currentProfile?.hasPriorityAccess ?? false);

  AuthProvider({AuthService? authService, PreferencesService? preferencesService})
      : _authService = authService ?? AuthService(),
        _preferences = preferencesService ?? PreferencesService() {
    _init();
  }

  void _init() {
    // Subscribe before awaiting redirects or provisioning, so a null/switch
    // event invalidates every in-flight profile read immediately.
    _authSub = _authService.authStateChanges.listen(
      (user) => unawaited(_loadProfile(user)),
      onError: (Object error) {
        if (_disposed) return;
        ++_stateVersion;
        _failProfile(error);
      },
    );
    unawaited(_completeRedirect());
  }

  bool _isCurrent(int version, String uid) =>
      !_disposed &&
      !_signingOut &&
      version == _stateVersion &&
      _authService.currentUser?.uid == uid;

  void _notifyIfActive() {
    if (!_disposed) notifyListeners();
  }

  void _clearIdentity() {
    _currentUserProfile = null;
    _isGuestBrowsing = false;
    _preferences.clearCache();
    unawaited(_authService.clearCachedProfile().catchError((Object _) {}));
  }

  void _failProfile(Object error) {
    _clearIdentity();
    _errorMessage = error.toString().replaceFirst('Exception:', '').trim();
    _isLoading = false;
    _notifyIfActive();
  }

  void _publishProfile(UserProfile? profile, String uid) {
    if (_disposed || _signingOut || _authService.currentUser?.uid != uid || profile == null) {
      throw const ProfileProvisioningException('Your sign-in changed. Please retry profile setup.');
    }
    if (profile.uid != uid || profile.accountDisabled) {
      throw const ProfileProvisioningException('Your server profile is unavailable. Please sign in again.');
    }
    _currentUserProfile = profile;
    _isGuestBrowsing = false;
    _errorMessage = null;
    _preferences.initFavourites(uid);
  }

  Future<bool> _loadProfile(User? user) async {
    if (_disposed) return false;
    final version = ++_stateVersion;
    _clearIdentity();
    _errorMessage = null;
    _isLoading = user != null;
    _notifyIfActive();
    if (user == null || _signingOut) return false;
    try {
      final profile = await _authService.getUserProfile(user.uid);
      if (!_isCurrent(version, user.uid)) return false;
      _publishProfile(profile, user.uid);
      return true;
    } catch (e) {
      if (_isCurrent(version, user.uid)) _failProfile(e);
      return false;
    } finally {
      if (_isCurrent(version, user.uid)) {
        _isLoading = false;
        _notifyIfActive();
      }
    }
  }

  /// Complete a possible web redirect without letting an old result replace a
  /// newer auth event. Cached display profiles never establish a session.
  Future<void> _completeRedirect() async {
    final version = _stateVersion;
    try {
      await _authService.checkRedirectResult();
      if (_disposed || version != _stateVersion) return;
      await _loadProfile(_authService.currentUser);
    } catch (e) {
      if (!_disposed && version == _stateVersion) {
        ++_stateVersion;
        _failProfile(e);
      }
    }
  }

  /// Sign In with Google (Google Identity Platform)
  Future<void> signInWithGoogle() async {
    if (_disposed) throw StateError('Authentication provider has been disposed.');
    final action = ++_actionVersion;
    final version = ++_stateVersion;
    _signingOut = false;
    _clearIdentity();
    _isLoading = true;
    _errorMessage = null;
    _notifyIfActive();
    try {
      final profile = await _authService.signInWithGoogle();
      if (_disposed || action != _actionVersion || _authService.currentUser?.uid != profile.uid) {
        throw const ProfileProvisioningException('Your sign-in changed. Please sign in again.');
      }
      // The auth listener may already have published a server-verified profile.
      // Otherwise do a guarded server read, never publish this async result directly.
      if (currentProfile?.uid != profile.uid || _isLoading) {
        await retryProfile();
      }
      if (_disposed || action != _actionVersion || currentProfile?.uid != profile.uid || !isLoggedIn) {
        throw const ProfileProvisioningException('Profile setup was not confirmed. Please retry.');
      }
    } catch (e) {
      if (!_disposed && action == _actionVersion && version == _stateVersion) {
        _failProfile(e);
      }
      rethrow;
    } finally {
      if (!_disposed && action == _actionVersion && version == _stateVersion) {
        _isLoading = false;
        _notifyIfActive();
      }
    }
  }

  /// Retry server profile provisioning after a recoverable loading failure.
  Future<void> retryProfile() async {
    if (_disposed) throw StateError('Authentication provider has been disposed.');
    final user = _authService.currentUser;
    final loaded = await _loadProfile(user);
    if (!loaded) {
      throw ProfileProvisioningException(
        _errorMessage ?? 'Your profile is not verified with the server. Please sign in or retry.',
      );
    }
  }

  /// Enable instant guest browsing mode (synchronous, 0ms latency, pure client-side visitor profile)
  void enableGuestBrowsing() {
    if (_disposed) return;
    ++_actionVersion;
    ++_stateVersion;
    _signingOut = false;
    _clearIdentity();
    _isGuestBrowsing = true;
    _currentUserProfile = UserProfile.guest();
    _errorMessage = null;
    _isLoading = false;
    _notifyIfActive();
  }

  /// Sign in as Guest for casual browsing
  Future<void> signInAsGuest() async {
    enableGuestBrowsing();
  }

  /// Update Profile Details
  Future<void> updateProfile([UserProfile? profile]) async {
    if (profile == null) return;
    final user = _authService.currentUser;
    if (_disposed || user == null || !isLoggedIn || profile.uid != user.uid) {
      throw const ProfileProvisioningException('Please verify your current sign-in before updating your profile.');
    }
    final version = ++_stateVersion;
    _clearIdentity();
    _isLoading = true;
    _errorMessage = null;
    _notifyIfActive();
    try {
      await _authService.updateUserProfile(profile);
      if (!_isCurrent(version, user.uid)) {
        throw const ProfileProvisioningException('Your sign-in changed while updating your profile.');
      }
      final saved = await _authService.getUserProfile(user.uid);
      if (!_isCurrent(version, user.uid)) {
        throw const ProfileProvisioningException('Your sign-in changed while updating your profile.');
      }
      // Input may contain obsolete or caller-supplied classification fields.
      // Only the post-write server profile is eligible for publication.
      _publishProfile(saved, user.uid);
    } catch (e) {
      if (_isCurrent(version, user.uid)) _failProfile(e);
      rethrow;
    } finally {
      if (_isCurrent(version, user.uid)) {
        _isLoading = false;
        _notifyIfActive();
      }
    }
  }

  /// Update Profile fields
  Future<void> updateProfileFields({
    String? displayName,
    String? phone,
    String? department,
    String? year,
    String? rollNo,
    String? photoURL,
  }) async {
    final profile = currentProfile;
    if (profile == null || !isLoggedIn) {
      throw const ProfileProvisioningException('Please verify your current sign-in before updating your profile.');
    }
    await updateProfile(profile.copyWith(
      displayName: displayName ?? profile.displayName,
      phone: phone ?? profile.phone,
      department: department ?? profile.department,
      year: year ?? profile.year,
      rollNo: rollNo ?? profile.rollNo,
      photoURL: photoURL ?? profile.photoURL,
    ));
  }

  /// Compatibility hook: counts are refreshed from the server, never incremented
  /// locally (a replayed checkout is not a second order).
  void incrementOrderCount() {
    if (_disposed) return;
    unawaited(retryProfile().catchError((Object _) {}));
  }

  /// Sign Out
  Future<void> signOut() async {
    if (_disposed) return;
    final action = ++_actionVersion;
    ++_stateVersion;
    _signingOut = true;
    _clearIdentity();
    _isLoading = true;
    _errorMessage = null;
    _notifyIfActive();
    try {
      await _authService.signOut();
    } catch (e) {
      if (!_disposed && action == _actionVersion) _failProfile(e);
      rethrow;
    } finally {
      if (!_disposed && action == _actionVersion) {
        ++_stateVersion;
        _signingOut = false;
        _clearIdentity();
        _isLoading = false;
        _notifyIfActive();
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    ++_stateVersion;
    ++_actionVersion;
    _authSub?.cancel();
    super.dispose();
  }
}
