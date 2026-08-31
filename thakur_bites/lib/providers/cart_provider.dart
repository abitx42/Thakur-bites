import 'dart:async';
import 'package:flutter/foundation.dart';
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
/// ARCHITECTURE: Cart is a WISHLIST. Adding items never checks or reserves stock.
/// Stock is checked ONLY at checkout time by the backend (Firestore).
/// First student to successfully place the order gets the stock.
class CartProvider extends ChangeNotifier {
  final FirestoreService? _firestore;
  StreamSubscription? _menuSub;

  /// Map of item ID → CartEntry for O(1) lookups
  final Map<String, CartEntry> _entries = {};

  CartProvider({FirestoreService? firestoreService, bool listenToLiveStock = true})
      : _firestore = firestoreService {
    if (listenToLiveStock) {
      _initLiveStockListener();
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
    notifyListeners();
  }

  /// Remove one of this item from cart (removes entry if qty reaches 0)
  void removeItem(String itemId) {
    if (!_entries.containsKey(itemId)) return;
    _entries[itemId]!.qty--;
    if (_entries[itemId]!.qty <= 0) {
      _entries.remove(itemId);
    }
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
    notifyListeners();
  }

  /// Remove an item completely by ID
  void deleteItem(String itemId) {
    _entries.remove(itemId);
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
    notifyListeners();
  }

  /// Sync cart items with live catalog availability and stock.
  void syncAvailability(List<MenuItem> allCatalogItems) {
    bool hasChanged = false;
    final map = {for (var i in allCatalogItems) i.id: i};

    for (final entry in _entries.values) {
      final liveItem = map[entry.item.id];
      if (liveItem != null) {
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

    if (hasChanged) notifyListeners();
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
    if (hasChanged) notifyListeners();
  }

  /// Remove all out-of-stock items in one tap
  void removeOutOfStockItems() {
    _entries.removeWhere((key, entry) => !entry.isAvailable);
    notifyListeners();
  }

  /// Clear entire cart
  void clear() {
    _entries.clear();
    notifyListeners();
  }
}
