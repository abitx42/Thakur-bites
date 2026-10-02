import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:thakur_bites/models/menu_item.dart';
import 'package:thakur_bites/models/user_profile.dart';
import 'package:thakur_bites/providers/auth_provider.dart';
import 'package:thakur_bites/providers/cart_provider.dart';
import 'package:thakur_bites/services/preferences_service.dart';
import 'package:thakur_bites/widgets/menu_item_card.dart';

class FakeAuthProvider extends ChangeNotifier implements AuthProvider {
  @override
  UserProfile? get currentProfile => null;

  @override
  bool get isGuest => true;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakePreferencesService extends ChangeNotifier implements PreferencesService {
  final Set<String> _favs = {};

  @override
  bool isItemFavourited(String itemId) => _favs.contains(itemId);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late CartProvider cartProvider;
  late FakeAuthProvider authProvider;
  late FakePreferencesService prefsService;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    cartProvider = CartProvider();
    authProvider = FakeAuthProvider();
    prefsService = FakePreferencesService();
  });

  final testItem = MenuItem(
    id: 'tomato_onion_uttappa',
    name: 'Tomato Onion Uttappa',
    price: 60,
    parentCategory: 'FOOD',
    category: 'South Indian',
    subCategory: 'Uttappa',
    type: 'cooked',
    prepMinutes: 8,
    available: true,
    stockOnHand: 50,
  );

  Widget createWidgetUnderTest() {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<CartProvider>.value(value: cartProvider),
        ChangeNotifierProvider<AuthProvider>.value(value: authProvider),
        ChangeNotifierProvider<PreferencesService>.value(value: prefsService),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 172,
              height: 246, // ~0.70 childAspectRatio for width 172
              child: MenuItemCard(item: testItem),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('MenuItemCard renders Add button and item details with zero overflow at qty 0', (tester) async {
    await tester.pumpWidget(createWidgetUnderTest());
    await tester.pumpAndSettle();

    expect(find.text('Tomato Onion Uttappa'), findsOneWidget);
    expect(find.text('₹60'), findsOneWidget);
    expect(find.text('~8 min'), findsOneWidget);
    expect(find.byIcon(Icons.add), findsOneWidget);

    // Verify no RenderFlex overflow
    expect(tester.takeException(), isNull);
  });

  testWidgets('MenuItemCard switches seamlessly to stepper when qty > 0 without overflow', (tester) async {
    await tester.pumpWidget(createWidgetUnderTest());
    await tester.pumpAndSettle();

    // Add 1 to cart
    cartProvider.addItem(testItem);
    await tester.pumpAndSettle();

    expect(find.text('1'), findsOneWidget);
    expect(find.byIcon(Icons.remove), findsOneWidget);
    expect(find.byIcon(Icons.add), findsOneWidget);

    // Verify zero overflow with stepper present
    expect(tester.takeException(), isNull);
  });

  testWidgets('MenuItemCard displays stock limit message when stock is reached', (tester) async {
    final limitedItem = MenuItem(
      id: 'frooti_pack',
      name: 'Frooti 200ml',
      price: 15,
      parentCategory: 'BEVERAGES',
      category: 'drinks',
      type: 'instant',
      prepMinutes: 0,
      available: true,
      stockOnHand: 1, // Only 1 in stock
    );

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<CartProvider>.value(value: cartProvider),
          ChangeNotifierProvider<AuthProvider>.value(value: authProvider),
          ChangeNotifierProvider<PreferencesService>.value(value: prefsService),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 172,
              height: 246,
              child: MenuItemCard(item: limitedItem),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Tap Add button to add the 1 available unit
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    expect(cartProvider.getQty(limitedItem.id), 1);

    // Tap + button again when at max stock limit (1 / 1)
    await tester.tap(find.byIcon(Icons.add));
    await tester.pump();

    // Verify polite floating stock alert message appears
    expect(find.text('Only 1 Frooti 200ml available in stock right now.'), findsOneWidget);
    // Quantity should stay 1
    expect(cartProvider.getQty(limitedItem.id), 1);
  });
}
