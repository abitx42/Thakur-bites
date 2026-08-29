import 'package:flutter/material.dart';
import '../models/menu_item.dart';
import '../services/firestore_service.dart';

/// Phase 1 Smoke Test Screen
/// Proves the full pipeline: Flutter → Firebase SDK → Firestore → back to Flutter
/// This screen will be removed after Phase 2 when real screens are built.
class SmokeTestScreen extends StatefulWidget {
  const SmokeTestScreen({super.key});

  @override
  State<SmokeTestScreen> createState() => _SmokeTestScreenState();
}

class _SmokeTestScreenState extends State<SmokeTestScreen> {
  final FirestoreService _firestore = FirestoreService();

  String _status = 'Ready to test Firebase connection';
  bool _isLoading = false;
  MenuItem? _readBackItem;
  List<MenuItem> _allItems = [];

  // ─── Test 1: Write a single document ──────────────────────────────
  Future<void> _testWriteDocument() async {
    setState(() {
      _isLoading = true;
      _status = '⏳ Writing test document to Firestore...';
    });

    try {
      final testItem = MenuItem(
        id: 'smoke_test_item',
        name: '🧪 Smoke Test Samosa',
        category: 'chaat_snacks',
        tier: 'tier2_batch',
        station: 'snack_counter',
        basePrice: 15,
        prepTime: 1,
        rating: 5.0,
        isVeg: true,
        isPopular: false,
        description: 'This is a smoke test item — if you see this in Firestore, the pipeline works!',
      );

      await _firestore.writeMenuItem(testItem);

      setState(() {
        _status = '✅ Write SUCCESS! Document "smoke_test_item" written to menuItems collection.';
      });
    } catch (e) {
      setState(() {
        _status = '❌ Write FAILED: $e';
      });
    } finally {
      setState(() => _isLoading = false);
    }
  }

  // ─── Test 2: Read it back ─────────────────────────────────────────
  Future<void> _testReadDocument() async {
    setState(() {
      _isLoading = true;
      _status = '⏳ Reading test document from Firestore...';
    });

    try {
      final item = await _firestore.readMenuItem('smoke_test_item');

      setState(() {
        _readBackItem = item;
        if (item != null) {
          _status = '✅ Read SUCCESS! Got "${item.name}" — ₹${item.basePrice.toInt()}';
        } else {
          _status = '⚠️ Document not found. Did you write it first?';
        }
      });
    } catch (e) {
      setState(() {
        _status = '❌ Read FAILED: $e';
      });
    } finally {
      setState(() => _isLoading = false);
    }
  }

  // ─── Test 3: Seed 6 demo items ────────────────────────────────────
  Future<void> _testSeedDemoData() async {
    setState(() {
      _isLoading = true;
      _status = '⏳ Seeding 6 demo menu items...';
    });

    try {
      await _firestore.seedDemoMenuItems();

      setState(() {
        _status = '✅ Seed SUCCESS! 6 demo items written to menuItems collection.';
      });
    } catch (e) {
      setState(() {
        _status = '❌ Seed FAILED: $e';
      });
    } finally {
      setState(() => _isLoading = false);
    }
  }

  // ─── Test 4: Read all items ───────────────────────────────────────
  Future<void> _testReadAllItems() async {
    setState(() {
      _isLoading = true;
      _status = '⏳ Reading all menu items...';
    });

    try {
      final items = await _firestore.readAllMenuItems();

      setState(() {
        _allItems = items;
        _status = '✅ Found ${items.length} items in menuItems collection.';
      });
    } catch (e) {
      setState(() {
        _status = '❌ Read All FAILED: $e';
      });
    } finally {
      setState(() => _isLoading = false);
    }
  }

  // ─── Test 5: Clean up test document ───────────────────────────────
  Future<void> _testDeleteDocument() async {
    setState(() {
      _isLoading = true;
      _status = '⏳ Deleting test document...';
    });

    try {
      await _firestore.deleteMenuItem('smoke_test_item');

      setState(() {
        _readBackItem = null;
        _status = '✅ Delete SUCCESS! "smoke_test_item" removed.';
      });
    } catch (e) {
      setState(() {
        _status = '❌ Delete FAILED: $e';
      });
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      appBar: AppBar(
        title: const Text('🧪 Phase 1 — Firebase Smoke Test'),
        backgroundColor: const Color(0xFFFF6B35),
        foregroundColor: Colors.white,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Status Card
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF16213E),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFFF6B35).withOpacity(0.3)),
              ),
              child: Column(
                children: [
                  const Text(
                    'THAKUR BITES',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFFFF6B35),
                      letterSpacing: 2,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Firebase Connection Test',
                    style: TextStyle(color: Colors.white60, fontSize: 14),
                  ),
                  const Divider(color: Colors.white24, height: 24),
                  if (_isLoading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: CircularProgressIndicator(color: Color(0xFFFF6B35)),
                    ),
                  Text(
                    _status,
                    style: TextStyle(
                      color: _status.startsWith('✅')
                          ? Colors.greenAccent
                          : _status.startsWith('❌')
                              ? Colors.redAccent
                              : _status.startsWith('⚠️')
                                  ? Colors.amber
                                  : Colors.white70,
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Test Buttons
            _buildTestButton(
              icon: '📝',
              label: 'Write Test Document',
              subtitle: 'Creates a "smoke_test_item" in Firestore',
              onPressed: _isLoading ? null : _testWriteDocument,
            ),
            _buildTestButton(
              icon: '📖',
              label: 'Read Test Document',
              subtitle: 'Reads back the smoke test item',
              onPressed: _isLoading ? null : _testReadDocument,
            ),
            _buildTestButton(
              icon: '🌱',
              label: 'Seed 6 Demo Menu Items',
              subtitle: 'Thali, Dosa, Fried Rice, Sandwich, Chai, Cold Coffee',
              onPressed: _isLoading ? null : _testSeedDemoData,
            ),
            _buildTestButton(
              icon: '📋',
              label: 'Read All Menu Items',
              subtitle: 'List everything in the menuItems collection',
              onPressed: _isLoading ? null : _testReadAllItems,
            ),
            _buildTestButton(
              icon: '🗑️',
              label: 'Delete Test Document',
              subtitle: 'Clean up the smoke_test_item',
              onPressed: _isLoading ? null : _testDeleteDocument,
            ),

            // Read-back detail card
            if (_readBackItem != null) ...[
              const SizedBox(height: 24),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F3460),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '📄 Read-Back Data:',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 8),
                    _infoRow('ID', _readBackItem!.id),
                    _infoRow('Name', _readBackItem!.name),
                    _infoRow('Category', _readBackItem!.category),
                    _infoRow('Price', '₹${_readBackItem!.basePrice.toInt()}'),
                    _infoRow('Tier', _readBackItem!.tier),
                    _infoRow('Station', _readBackItem!.station),
                    _infoRow('Veg', _readBackItem!.isVeg ? '🟢 Yes' : '🔴 No'),
                  ],
                ),
              ),
            ],

            // All items list
            if (_allItems.isNotEmpty) ...[
              const SizedBox(height: 24),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF0F3460),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '📋 All Items (${_allItems.length}):',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ..._allItems.map(
                      (item) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            Text(
                              item.isVeg ? '🟢' : '🔴',
                              style: const TextStyle(fontSize: 12),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                item.name,
                                style: const TextStyle(
                                    color: Colors.white, fontSize: 14),
                              ),
                            ),
                            Text(
                              '₹${item.basePrice.toInt()}',
                              style: const TextStyle(
                                color: Color(0xFFFF6B35),
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _buildTestButton({
    required String icon,
    required String label,
    required String subtitle,
    VoidCallback? onPressed,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: ElevatedButton(
        onPressed: onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF16213E),
          foregroundColor: Colors.white,
          padding: const EdgeInsets.all(16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: Colors.white12),
          ),
        ),
        child: Row(
          children: [
            Text(icon, style: const TextStyle(fontSize: 24)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                  Text(
                    subtitle,
                    style:
                        const TextStyle(fontSize: 12, color: Colors.white54),
                  ),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_ios, size: 16, color: Colors.white38),
          ],
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(
            width: 80,
            child: Text(
              label,
              style: const TextStyle(color: Colors.white54, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(color: Colors.white, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}
