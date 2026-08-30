import 'package:flutter/foundation.dart';
import '../models/menu_item.dart';

/// A single item in the cart, pairing a MenuItem with its quantity.
class CartEntry {
  final MenuItem item;
  int qty;

  CartEntry({required this.item, this.qty = 1});

  double get subtotal => item.price * qty;
}

/// Central cart state using ChangeNotifier (Provider pattern).
/// Entirely client-side — no Firestore writes until Phase 4 (order placement).
class CartProvider extends ChangeNotifier {
  /// Map of item ID → CartEntry for O(1) lookups
  final Map<String, CartEntry> _entries = {};

  // ─── Read-only accessors ──────────────────────────────────────

  /// All cart entries as a list
  List<CartEntry> get entries => _entries.values.toList();

  /// Total number of individual items (sum of all quantities)
  int get totalItemCount =>
      _entries.values.fold(0, (sum, e) => sum + e.qty);

  /// Total price
  double get totalPrice =>
      _entries.values.fold(0.0, (sum, e) => sum + e.subtotal);

  /// Is the cart empty?
  bool get isEmpty => _entries.isEmpty;

  /// Is the cart not empty?
  bool get isNotEmpty => _entries.isNotEmpty;

  /// Maximum prep time across all items in cart (for "Ready in ~X min")
  int get maxPrepMinutes {
    if (_entries.isEmpty) return 0;
    return _entries.values
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

  // ─── Mutations ────────────────────────────────────────────────

  /// Add one of this item to cart (or increment if already present)
  void addItem(MenuItem item) {
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

  /// Clear entire cart
  void clear() {
    _entries.clear();
    notifyListeners();
  }
}
