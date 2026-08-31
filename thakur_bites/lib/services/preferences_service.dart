import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import '../models/user_preferences.dart';

/// Service managing User Preferences and Favourite Menu Items in Firestore.
class PreferencesService extends ChangeNotifier {
  final FirebaseFirestore _db;
  static final PreferencesService _instance = PreferencesService._internal();

  factory PreferencesService({FirebaseFirestore? firestore}) {
    return _instance;
  }

  PreferencesService._internal({FirebaseFirestore? firestore})
      : _db = firestore ?? FirebaseFirestore.instance;

  Set<String> _cachedFavourites = {};
  Set<String> get cachedFavourites => _cachedFavourites;

  /// Stream user favourites from `userFavourites/{uid}`
  Stream<Set<String>> favouritesStream(String uid) {
    return _db.collection('userFavourites').doc(uid).snapshots().map((snap) {
      if (!snap.exists || snap.data() == null) {
        _cachedFavourites = {};
        notifyListeners();
        return {};
      }
      final items = (snap.data()?['items'] as List<dynamic>?)?.map((e) => e.toString()).toSet() ?? {};
      _cachedFavourites = items;
      notifyListeners();
      return items;
    });
  }

  /// Check if an item is favorited
  bool isItemFavourited(String itemId) {
    return _cachedFavourites.contains(itemId);
  }

  /// Toggle favourite item state in Firestore
  Future<bool> toggleFavourite(String uid, String itemId) async {
    final docRef = _db.collection('userFavourites').doc(uid);

    // Optimistic local update
    final wasFavourited = _cachedFavourites.contains(itemId);
    if (wasFavourited) {
      _cachedFavourites.remove(itemId);
    } else {
      _cachedFavourites.add(itemId);
    }
    notifyListeners();

    try {
      if (wasFavourited) {
        await docRef.set({
          'items': FieldValue.arrayRemove([itemId]),
          'updatedAt': Timestamp.now(),
        }, SetOptions(merge: true));
        return false;
      } else {
        await docRef.set({
          'items': FieldValue.arrayUnion([itemId]),
          'updatedAt': Timestamp.now(),
        }, SetOptions(merge: true));
        return true;
      }
    } catch (e) {
      debugPrint('Error toggling favourite: $e');
      // Rollback on failure
      if (wasFavourited) {
        _cachedFavourites.add(itemId);
      } else {
        _cachedFavourites.remove(itemId);
      }
      notifyListeners();
      rethrow;
    }
  }

  /// Stream user preferences
  Stream<UserPreferences> preferencesStream(String uid) {
    return _db.collection('userPreferences').doc(uid).snapshots().map((snap) {
      if (!snap.exists || snap.data() == null) {
        return UserPreferences(uid: uid);
      }
      return UserPreferences.fromFirestore(uid, snap.data()!);
    });
  }

  /// Save preferences to Firestore
  Future<void> savePreferences(UserPreferences prefs) async {
    await _db
        .collection('userPreferences')
        .doc(prefs.uid)
        .set(prefs.toFirestore(), SetOptions(merge: true));
  }
}
