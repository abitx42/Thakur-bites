import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/models/canteen_operational_status.dart';
import 'package:thakur_bites/widgets/canteen_status_banner.dart';

void main() {
  group('CanteenStatusBanner & showCanteenStatusSheet Widget Tests', () {
    testWidgets('Renders nothing when status is NORMAL', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: CanteenStatusBanner(
              status: CanteenOperationalStatus.normal(),
            ),
          ),
        ),
      );

      expect(find.byType(CanteenStatusBanner), findsOneWidget);
      expect(find.text('Online Ordering Paused ⏸️'), findsNothing);
      expect(find.byType(InkWell), findsNothing);
    });

    testWidgets('Renders warm amber banner when status is DEGRADED', (WidgetTester tester) async {
      const degradedStatus = CanteenOperationalStatus(
        mode: 'DEGRADED',
        orderingAvailable: false,
      );

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: CanteenStatusBanner(
              status: degradedStatus,
            ),
          ),
        ),
      );

      expect(find.text('Online Ordering Paused ⏸️'), findsOneWidget);
      expect(
        find.textContaining('Sorry for the inconvenience! Online ordering is temporarily paused'),
        findsOneWidget,
      );
      expect(find.text('Info'), findsOneWidget);
    });

    testWidgets('Tapping DEGRADED banner opens polite bottom sheet modal', (WidgetTester tester) async {
      const degradedStatus = CanteenOperationalStatus(
        mode: 'DEGRADED',
        orderingAvailable: false,
      );

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: CanteenStatusBanner(
              status: degradedStatus,
            ),
          ),
        ),
      );

      // Tap banner
      await tester.tap(find.byType(InkWell));
      await tester.pumpAndSettle();

      // Verify modal content
      expect(find.text('Online Ordering Paused'), findsOneWidget);
      expect(find.text('Sorry for the Inconvenience!'), findsOneWidget);
      expect(
        find.textContaining('You can still place your order directly at the canteen counter in cash or UPI!'),
        findsOneWidget,
      );
      expect(find.text('Understood'), findsOneWidget);

      // Tap Understood button to close
      await tester.tap(find.text('Understood'));
      await tester.pumpAndSettle();

      // Modal closed
      expect(find.text('Understood'), findsNothing);
    });

    testWidgets('Renders EMERGENCY_HALT closed notice and opens modal', (WidgetTester tester) async {
      const haltStatus = CanteenOperationalStatus(
        mode: 'EMERGENCY_HALT',
        orderingAvailable: false,
      );

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: CanteenStatusBanner(
              status: haltStatus,
            ),
          ),
        ),
      );

      expect(find.text('Canteen Temporarily Closed 🛑'), findsOneWidget);
      expect(
        find.textContaining('The canteen has temporarily closed accepting orders'),
        findsOneWidget,
      );

      // Tap to open modal
      await tester.tap(find.byType(InkWell));
      await tester.pumpAndSettle();

      expect(find.text('Canteen Temporarily Closed'), findsOneWidget);
      expect(find.text('Sorry for the Inconvenience!'), findsOneWidget);
      expect(find.textContaining('Normal service will resume shortly'), findsOneWidget);
    });

    testWidgets('Custom message passed to showCanteenStatusSheet displays properly', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () {
                  showCanteenStatusSheet(
                    context,
                    const CanteenOperationalStatus(mode: 'DEGRADED', orderingAvailable: false),
                    customMessage: 'Custom staff announcement: Heavy rush at sandwich station.',
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('Sorry for the Inconvenience!'), findsOneWidget);
      expect(find.text('Custom staff announcement: Heavy rush at sandwich station.'), findsOneWidget);
    });
  });
}
