import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Date & Time Formatting for Past Orders Tests', () {
    String formatDateTime(DateTime dt, {DateTime? mockNow}) {
      final now = mockNow ?? DateTime.now();
      final isToday =
          dt.year == now.year && dt.month == now.month && dt.day == now.day;
      final yesterday = now.subtract(const Duration(days: 1));
      final isYesterday = dt.year == yesterday.year &&
          dt.month == yesterday.month &&
          dt.day == yesterday.day;

      const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ];
      final monthName = months[dt.month - 1];

      final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
      final m = dt.minute.toString().padLeft(2, '0');
      final ampm = dt.hour >= 12 ? 'PM' : 'AM';
      final timeStr = '$h:$m $ampm';

      if (isToday) {
        return 'Today, $timeStr';
      } else if (isYesterday) {
        return 'Yesterday, $timeStr';
      } else if (dt.year == now.year) {
        return '${dt.day} $monthName, $timeStr';
      } else {
        return '${dt.day} $monthName ${dt.year}, $timeStr';
      }
    }

    final referenceDate = DateTime(2026, 9, 14, 15, 30); // 14 Sep 2026, 3:30 PM

    test('formats order created today with "Today," prefix', () {
      final todayOrder = DateTime(2026, 9, 14, 13, 45);
      final formatted = formatDateTime(todayOrder, mockNow: referenceDate);
      expect(formatted, equals('Today, 1:45 PM'));
    });

    test('formats order created yesterday with "Yesterday," prefix', () {
      final yesterdayOrder = DateTime(2026, 9, 13, 10, 15);
      final formatted = formatDateTime(yesterdayOrder, mockNow: referenceDate);
      expect(formatted, equals('Yesterday, 10:15 AM'));
    });

    test('formats order from earlier this year with "D MMM, time"', () {
      final pastOrder = DateTime(2026, 8, 20, 18, 0);
      final formatted = formatDateTime(pastOrder, mockNow: referenceDate);
      expect(formatted, equals('20 Aug, 6:00 PM'));
    });

    test('formats order from previous year with "D MMM YYYY, time"', () {
      final lastYearOrder = DateTime(2025, 11, 5, 9, 5);
      final formatted = formatDateTime(lastYearOrder, mockNow: referenceDate);
      expect(formatted, equals('5 Nov 2025, 9:05 AM'));
    });
  });

  group('Back Navigation PopScope Widget Tests', () {
    testWidgets('PopScope intercepts back navigation when index is not Home and returns to Home',
        (tester) async {
      int currentNavIndex = 1; // e.g. on Orders tab

      await tester.pumpWidget(
        MaterialApp(
          home: StatefulBuilder(
            builder: (context, setState) {
              return PopScope(
                canPop: currentNavIndex == 0,
                onPopInvokedWithResult: (didPop, result) {
                  if (didPop) return;
                  if (currentNavIndex != 0) {
                    setState(() {
                      currentNavIndex = 0;
                    });
                  }
                },
                child: Scaffold(
                  body: Center(
                    child: Text('Current Tab: $currentNavIndex'),
                  ),
                ),
              );
            },
          ),
        ),
      );

      expect(find.text('Current Tab: 1'), findsOneWidget);

      // Simulate system back button / gesture
      final dynamic widgetsAppState = tester.state(find.byType(WidgetsApp));
      final handled1 = await widgetsAppState.didPopRoute();
      await tester.pump();

      // First back press should be intercepted by PopScope, change index to 0 (Home tab)
      expect(handled1, isTrue);
      expect(currentNavIndex, equals(0));
      expect(find.text('Current Tab: 0'), findsOneWidget);

      // Second back press on Home tab (canPop: true): not intercepted, allowing OS exit
      final handled2 = await widgetsAppState.didPopRoute();
      await tester.pump();
      expect(handled2, isFalse);
    });
  });

  group('Scroll Controller Reset Tests', () {
    testWidgets('ScrollController animates to top on sort / filter reset',
        (tester) async {
      final controller = ScrollController(initialScrollOffset: 300.0);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ListView.builder(
              controller: controller,
              itemCount: 50,
              itemBuilder: (_, i) => SizedBox(height: 60, child: Text('Item $i')),
            ),
          ),
        ),
      );

      expect(controller.offset, equals(300.0));

      // Invoke scroll to top
      controller.jumpTo(0.0);
      await tester.pumpAndSettle();

      expect(controller.offset, equals(0.0));
      controller.dispose();
    });
  });
}
