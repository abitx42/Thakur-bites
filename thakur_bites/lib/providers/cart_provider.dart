import 'package:flutter/foundation.dart';
import '../models/menu_item.dart';

/// A single item in the cart, pairing a MenuItem with its quantity.
class CartEntry {
  MenuItem item;
  int qty;

  CartEntry({required this.item, this.qty = 1});

  double get subtotal => item.price * qty;
  bool get isAvailable => item.available;
}

/// Central cart state using ChangeNotifier (Provider pattern).
/// Supports live stock synchronization (Zepto/Instamart style).
class CartProvider extends ChangeNotifier {
  /// Map of item ID → CartEntry for O(1) lookups
  final Map<String, CartEntry> _entries = {};

  // ─── Read-only accessors ──────────────────────────────────────

  /// All cart entries as a list
  List<CartEntry> get entries => _entries.values.toList();

  /// Total number of individual items (sum of all quantities)
  int get totalItemCount =>
      _entries.values.fold(0, (sum, e) => sum + e.qty);

  /// Total price across all items
  double get totalPrice =>
      _entries.values.fold(0.0, (sum, e) => sum + e.subtotal);

  /// Available-only total price
  double get availableTotalPrice => _entries.values
      .where((e) => e.isAvailable)
      .fold(0.0, (sum, e) => sum + e.subtotal);

  /// Is the cart empty?
  bool get isEmpty => _entries.isEmpty;

  /// Is the cart not empty?
  bool get isNotEmpty => _entries.isNotEmpty;

  /// Does the cart contain any item that went out of stock?
  bool get hasOutOfStockItems =>
      _entries.values.any((e) => !e.isAvailable);

  /// Number of out-of-stock items in cart
  int get outOfStockCount =>
      _entries.values.where((e) => !e.isAvailable).length;

  /// List of out of stock entries
  List<CartEntry> get outOfStockEntries =>
      _entries.values.where((e) => !e.isAvailable).toList();

  /// List of available entries
  List<CartEntry> get availableEntries =>
      _entries.values.where((e) => e.isAvailable).toList();

  /// Maximum prep time across available items in cart
  int get maxPrepMinutes {
    final active = _entries.values.where((e) => e.isAvailable);
    if (active.isEmpty) return 0;
    return active
        .map((e) => e.item.prepMinutes)
        .reduce((a, b) => a > b ? a : b);
  }

  /// Human-friendly ready time text
  String get readyTimeText {
    final mins = maxPrepMinutes;
    return mins > 0 ? 'Ready in ~$mins min' : 'Ready now';
  }

  /// Get qty for a specific item (0 if not in cart)
  int getQty(String itemId) => _entries[itemId]?.qty ?? 0;

  /// Check if a specific cart item is available
  bool isAvailable(String itemId) => _entries[itemId]?.isAvailable ?? true;

  // ─── Mutations ────────────────────────────────────────────────

  /// Add one of this item to cart (or increment if already present)
  void addItem(MenuItem item) {
    if (!item.available) return; // Prevent adding if out of stock

    if (_entries.containsKey(item.id)) {
      _entries[item.id]!.qty++;
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

  /// Set exact quantity for an item (removes if qty <= 0)
  void setQty(MenuItem item, int qty) {
    if (qty <= 0) {
      _entries.remove(item.id);
    } else {
      if (_entries.containsKey(item.id)) {
        _entries[item.id]!.qty = qty;
      } else {
        _entries[item.id] = CartEntry(item: item, qty: qty);
      }
    }
    notifyListeners();
  }

  /// Remove an item completely by ID
  void deleteItem(String itemId) {
    _entries.remove(itemId);
    notifyListeners();
  }

  /// Sync cart items with live catalog availability from Firestore
  void syncAvailability(List<MenuItem> allCatalogItems) {
    bool hasChanged = false;
    final map = {for (var i in allCatalogItems) i.id: i};

    for (final entry in _entries.values) {
      final liveItem = map[entry.item.id];
      final isNowAvailable = liveItem != null ? liveItem.available : false;

      if (entry.item.available != isNowAvailable) {
        entry.item = entry.item.copyWith(available: isNowAvailable);
        hasChanged = true;
      }
    }

    if (hasChanged) {
      notifyListeners();
    }
  }

  /// Mark specific item IDs as out of stock (e.g. from pre-checkout check)
  void markItemsOutOfStock(List<String> outOfStockIds) {
    bool hasChanged = false;
    for (final id in outOfStockIds) {
      if (_entries.containsKey(id) && _entries[id]!.item.available) {
        _entries[id]!.item = _entries[id]!.item.copyWith(available: false);
        hasChanged = true;
      }
    }
    if (hasChanged) {
      notifyListeners();
    }
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
