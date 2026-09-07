import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/menu_item.dart';
import '../services/firestore_service.dart';

/// A single item in the cart, pairing a MenuItem with its quantity.
class CartEntry {
  MenuItem item;
  int qty;

  CartEntry({required this.item, this.qty = 1});

  double get subtotal => item.price * qty;

  /// Only false if item was completely pulled from the menu (staff toggled off / sold out)
  bool get isAvailable => item.isInStock;
}

/// Central cart state using ChangeNotifier (Provider pattern).
///
/// ARCHITECTURE: Cart is a WISHLIST with local offline persistence.
/// Stock is checked ONLY at checkout time by the backend (Firestore).
/// First student to successfully place the order gets the stock.
class CartProvider extends ChangeNotifier {
  static const String _storageKey = 'offline_cart_v1';
  final FirestoreService? _firestore;
  StreamSubscription? _menuSub;

  /// Map of item ID → CartEntry for O(1) lookups
  final Map<String, CartEntry> _entries = {};
  final List<String> _priceChangeAlerts = [];

  List<String> get priceChangeAlerts => List.unmodifiable(_priceChangeAlerts);
  bool get hasPriceChangeAlerts => _priceChangeAlerts.isNotEmpty;

  void clearPriceChangeAlerts() {
    _priceChangeAlerts.clear();
    notifyListeners();
  }

  CartProvider({FirestoreService? firestoreService, bool listenToLiveStock = true})
      : _firestore = firestoreService {
    _loadPersistedCart();
    if (listenToLiveStock) {
      _initLiveStockListener();
    }
  }

  /// Load cached wishlist from local device storage upon app startup/reconnect
  Future<void> _loadPersistedCart() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_storageKey);
      if (raw != null && raw.isNotEmpty) {
        final List<dynamic> list = jsonDecode(raw);
        for (final entry in list) {
          final m = Map<String, dynamic>.from(entry as Map);
          final itemId = m['itemId'] as String? ?? '';
          final qty = (m['qty'] as num?)?.toInt() ?? 1;
          if (itemId.isNotEmpty && qty > 0) {
            final item = MenuItem(
              id: itemId,
              name: m['cachedName'] as String? ?? 'Item',
              price: (m['cachedPrice'] as num?)?.toDouble() ?? 0.0,
              parentCategory: m['cachedParentCategory'] as String? ?? 'Food',
              category: m['cachedCategory'] as String? ?? 'general',
              available: true,
              stockCount: 50,
              prepMinutes: (m['cachedPrepMinutes'] as num?)?.toInt() ?? 0,
              type: m['cachedType'] as String? ?? 'instant',
              iconKey: m['cachedIconKey'] as String? ?? 'dosa',
            );
            _entries[itemId] = CartEntry(item: item, qty: qty);
          }
        }
        notifyListeners();
      }
    } catch (e) {
      // Safely ignore when run in headless test environments without platform channels
      if (!e.toString().contains('Binding') && !e.toString().contains('MissingPluginException')) {
        debugPrint('Error loading persisted cart: $e');
      }
    }
  }

  /// Authoritatively save wishlist locally (INV-001: offline cart ≠ offline order)
  Future<void> _persistCartLocally() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (_entries.isEmpty) {
        await prefs.remove(_storageKey);
        return;
      }
      final list = _entries.values.map((e) => {
        'itemId': e.item.id,
        'qty': e.qty,
        'cachedPrice': e.item.price,
        'cachedName': e.item.name,
        'cachedIconKey': e.item.iconKey,
        'cachedCategory': e.item.category,
        'cachedParentCategory': e.item.parentCategory,
        'cachedType': e.item.type,
        'cachedPrepMinutes': e.item.prepMinutes,
      }).toList();
      await prefs.setString(_storageKey, jsonEncode(list));
    } catch (e) {
      // Safely ignore when run in headless test environments without platform channels
      if (!e.toString().contains('Binding') && !e.toString().contains('MissingPluginException')) {
        debugPrint('Error persisting cart locally: $e');
      }
    }
  }

  /// Listen to live catalog changes so we know when items go completely unavailable
  void _initLiveStockListener() {
    try {
      final service = _firestore ?? FirestoreService();
      _menuSub = service.allMenuItemsStream().listen((catalogItems) {
        syncAvailability(catalogItems);
      }, onError: (e) {
        debugPrint('Error syncing cart stock: $e');
      });
    } catch (e) {
      debugPrint('Live stock listener skipped: $e');
    }
  }

  @override
  void dispose() {
    _menuSub?.cancel();
    super.dispose();
  }

  // ─── Read-only accessors ──────────────────────────────────────

  List<CartEntry> get entries => _entries.values.toList();

  int get totalItemCount =>
      _entries.values.fold(0, (sum, e) => sum + e.qty);

  static const int maxQuantityPerItem = 99;

  double get totalPrice {
    final raw = _entries.values.fold(0.0, (sum, e) => sum + e.subtotal);
    return double.parse(raw.toStringAsFixed(2));
  }

  double get availableTotalPrice {
    final raw = _entries.values
        .where((e) => e.isAvailable)
        .fold(0.0, (sum, e) => sum + e.subtotal);
    return double.parse(raw.toStringAsFixed(2));
  }

  bool get isEmpty => _entries.isEmpty;
  bool get isNotEmpty => _entries.isNotEmpty;

  /// Does the cart contain any item that went completely out of stock?
  bool get hasOutOfStockItems =>
      _entries.values.any((e) => !e.isAvailable);

  int get outOfStockCount =>
      _entries.values.where((e) => !e.isAvailable).length;

  List<CartEntry> get outOfStockEntries =>
      _entries.values.where((e) => !e.isAvailable).toList();

  List<CartEntry> get availableEntries =>
      _entries.values.where((e) => e.isAvailable).toList();

  int get maxPrepMinutes {
    final active = _entries.values.where((e) => e.isAvailable);
    if (active.isEmpty) return 0;
    return active
        .map((e) => e.item.prepMinutes)
        .reduce((a, b) => a > b ? a : b);
  }

  String get readyTimeText {
    final mins = maxPrepMinutes;
    return mins > 0 ? 'Ready in ~$mins min' : 'Ready now';
  }

  int getQty(String itemId) => _entries[itemId]?.qty ?? 0;

  bool isAvailable(String itemId) => _entries[itemId]?.isAvailable ?? true;

  /// True if ALL available items in the cart are ready-made (instant items like cold drinks, chips, snacks with 0 min cooking time).
  bool get isOnlyReadyMade =>
      availableEntries.isNotEmpty && availableEntries.every((e) => e.item.isInstant);

  /// True if any available item in the cart is a beverage (soda, water, juice, cold drinks).
  bool get hasBeverage => availableEntries.any((e) {
    final name = e.item.name.toLowerCase();
    final cat = e.item.category.toLowerCase();
    final parent = e.item.parentCategory.toLowerCase();
    return cat.contains('drink') ||
        cat.contains('beverage') ||
        parent.contains('beverage') ||
        name.contains('coke') ||
        name.contains('water') ||
        name.contains('sprite') ||
        name.contains('juice') ||
        name.contains('frooti') ||
        name.contains('coffee') ||
        name.contains('soda');
  });

  // ─── Ready-Made Preferences ──────────────────────────────────
  String _temperaturePreference = 'Chilled ❄️';
  String _packagingPreference = 'Direct Handover ✋';

  String get temperaturePreference => _temperaturePreference;
  String get packagingPreference => _packagingPreference;

  /// Consolidated summary of student's preferences for ready-made items.
  String get readyMadePreferenceSummary {
    if (!isOnlyReadyMade) return '';
    return '$_temperaturePreference · $_packagingPreference';
  }

  void setTemperaturePreference(String pref) {
    if (_temperaturePreference != pref) {
      _temperaturePreference = pref;
      notifyListeners();
    }
  }

  void setPackagingPreference(String pref) {
    if (_packagingPreference != pref) {
      _packagingPreference = pref;
      notifyListeners();
    }
  }

  // ─── Mutations ────────────────────────────────────────────────

  /// Add one of this item to cart. Cart is a wishlist — bounded to 99 items per entry.
  void addItem(MenuItem item) {
    if (!item.isInStock) return; // Only block completely unavailable items

    if (_entries.containsKey(item.id)) {
      if (_entries[item.id]!.qty < maxQuantityPerItem) {
        _entries[item.id]!.qty++;
      }
    } else {
      _entries[item.id] = CartEntry(item: item);
    }
    _persistCartLocally();
    notifyListeners();
  }

  /// Remove one of this item from cart (removes entry if qty reaches 0)
  void removeItem(String itemId) {
    if (!_entries.containsKey(itemId)) return;
    _entries[itemId]!.qty--;
    if (_entries[itemId]!.qty <= 0) {
      _entries.remove(itemId);
    }
    _persistCartLocally();
    notifyListeners();
  }

  /// Set exact quantity for an item (removes if qty <= 0, capped at maxQuantityPerItem)
  void setQty(MenuItem item, int qty) {
    if (qty <= 0) {
      _entries.remove(item.id);
    } else {
      final safeQty = qty.clamp(1, maxQuantityPerItem);
      if (_entries.containsKey(item.id)) {
        _entries[item.id]!.qty = safeQty;
      } else {
        _entries[item.id] = CartEntry(item: item, qty: safeQty);
      }
    }
    _persistCartLocally();
    notifyListeners();
  }

  /// Remove an item completely by ID
  void deleteItem(String itemId) {
    _entries.remove(itemId);
    _persistCartLocally();
    notifyListeners();
  }

  /// Cap item quantity to available stock (called at checkout when backend says stock is limited)
  void capItemQuantity(String itemId, int maxAvailable) {
    if (!_entries.containsKey(itemId)) return;

    if (maxAvailable <= 0) {
      _entries[itemId]!.item = _entries[itemId]!.item.copyWith(available: false, stockCount: 0);
    } else if (_entries[itemId]!.qty > maxAvailable) {
      _entries[itemId]!.qty = maxAvailable;
    }
    _persistCartLocally();
    notifyListeners();
  }

  /// Sync cart items with live catalog availability and stock (INV-001, INV-010).
  void syncAvailability(List<MenuItem> allCatalogItems) {
    bool hasChanged = false;
    final map = {for (var i in allCatalogItems) i.id: i};

    for (final entry in _entries.values) {
      final liveItem = map[entry.item.id];
      if (liveItem != null) {
        if (entry.item.price != liveItem.price) {
          final alert = '${liveItem.name}: Price updated from ₹${entry.item.price.toInt()} to ₹${liveItem.price.toInt()}';
          if (!_priceChangeAlerts.contains(alert)) {
            _priceChangeAlerts.add(alert);
          }
          hasChanged = true;
        }
        if (entry.item.available != liveItem.available ||
            entry.item.stockCount != liveItem.stockCount ||
            entry.item.price != liveItem.price ||
            entry.item.name != liveItem.name ||
            entry.item.type != liveItem.type) {
          entry.item = liveItem;
          hasChanged = true;
        }
      } else {
        if (entry.item.available) {
          entry.item = entry.item.copyWith(available: false, stockCount: 0);
          hasChanged = true;
        }
      }
    }

    if (hasChanged) {
      _persistCartLocally();
      notifyListeners();
    }
  }

  /// Mark specific item IDs as out of stock (from pre-checkout check)
  void markItemsOutOfStock(List<String> outOfStockIds) {
    bool hasChanged = false;
    for (final id in outOfStockIds) {
      if (_entries.containsKey(id) && _entries[id]!.item.available) {
        _entries[id]!.item = _entries[id]!.item.copyWith(available: false, stockCount: 0);
        hasChanged = true;
      }
    }
    if (hasChanged) {
      _persistCartLocally();
      notifyListeners();
    }
  }

  /// Remove all out-of-stock items in one tap
  void removeOutOfStockItems() {
    _entries.removeWhere((key, entry) => !entry.isAvailable);
    _persistCartLocally();
    notifyListeners();
  }

  /// Clear entire cart
  void clear() {
    _entries.clear();
    _temperaturePreference = 'Chilled ❄️';
    _packagingPreference = 'Direct Handover ✋';
    _priceChangeAlerts.clear();
    _persistCartLocally();
    notifyListeners();
  }
}
