import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/services/in_app_notification_service.dart';

void main() {
  group('InAppNotificationService Widget & Lifecycle Tests', () {
    testWidgets('Renders and displays showOrderPlaced notification banner with Track Here CTA', (tester) async {
      bool tracked = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () {
                  InAppNotificationService().showOrderPlaced(
                    context: context,
                    tokenNumber: 'TB-108',
                    onTrack: () {
                      tracked = true;
                    },
                  );
                },
                child: const Text('Show Order Notification'),
              ),
            ),
          ),
        ),
      );

      // Tap button to show notification
      await tester.tap(find.text('Show Order Notification'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400)); // allow slide animation

      expect(find.text('🎉 Order Placed! Token TB-108'), findsOneWidget);
      expect(find.text('Your order is confirmed. Track live status here.'), findsOneWidget);
      expect(find.text('Track Here →'), findsOneWidget);

      // Tap action CTA
      await tester.tap(find.text('Track Here →'));
      await tester.pump();

      expect(tracked, isTrue);

      // Dismisses
      InAppNotificationService().dismiss();
      await tester.pump();
      expect(find.text('🎉 Order Placed! Token TB-108'), findsNothing);
    });

    testWidgets('Renders showPaymentFailed notification banner with Retry CTA', (tester) async {
      bool retried = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () {
                  InAppNotificationService().showPaymentFailed(
                    context: context,
                    tokenNumber: 'TB-202',
                    onRetry: () {
                      retried = true;
                    },
                  );
                },
                child: const Text('Trigger Failed'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Trigger Failed'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('💳 Payment Failed · Token TB-202'), findsOneWidget);
      expect(find.text('Your items are reserved for 15 minutes. Retry now.'), findsOneWidget);
      expect(find.text('Retry Payment'), findsOneWidget);

      await tester.tap(find.text('Retry Payment'));
      await tester.pump();
      expect(retried, isTrue);
    });

    testWidgets('Renders showReservationExpired notification banner and cleans up', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () {
                  InAppNotificationService().showReservationExpired(
                    context: context,
                    tokenNumber: 'TB-303',
                  );
                },
                child: const Text('Trigger Expired'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Trigger Expired'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('⏰ Reservation Expired · Token TB-303'), findsOneWidget);
      expect(find.text('Your held items have been released back to stock.'), findsOneWidget);

      InAppNotificationService().dismiss();
      await tester.pump();
      expect(find.text('⏰ Reservation Expired · Token TB-303'), findsNothing);
    });

    testWidgets('Renders showStatusChange notifications for preparing, ready, collected, cancelled', (tester) async {
      late BuildContext testContext;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                testContext = context;
                return const SizedBox();
              },
            ),
          ),
        ),
      );

      // 1. Preparing
      InAppNotificationService().showStatusChange(
        context: testContext,
        tokenNumber: 'TB-501',
        newStatus: 'preparing',
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('🔥 Now Cooking! Token TB-501'), findsOneWidget);

      // 2. Ready
      InAppNotificationService().showStatusChange(
        context: testContext,
        tokenNumber: 'TB-501',
        newStatus: 'ready',
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('⚡ Ready for Pickup! Token TB-501'), findsOneWidget);

      // 3. Cancelled
      InAppNotificationService().showStatusChange(
        context: testContext,
        tokenNumber: 'TB-501',
        newStatus: 'cancelled',
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('❌ Order Cancelled · Token TB-501'), findsOneWidget);

      InAppNotificationService().dismiss();
      await tester.pump();
    });
  });
}
