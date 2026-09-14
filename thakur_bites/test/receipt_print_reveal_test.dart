import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:thakur_bites/widgets/receipt_print_reveal.dart';

void main() {
  group('PrintRevealClipper Unit Tests', () {
    test('revealFraction <= 0 returns empty path', () {
      final clipper = PrintRevealClipper(revealFraction: 0.0);
      final path = clipper.getClip(const Size(300, 500));
      expect(path.computeMetrics().isEmpty, isTrue);
    });

    test('revealFraction >= 1.0 returns full rectangle path', () {
      final clipper = PrintRevealClipper(revealFraction: 1.0);
      final path = clipper.getClip(const Size(300, 500));
      final bounds = path.getBounds();
      expect(bounds, const Rect.fromLTWH(0, 0, 300, 500));
    });

    test('revealFraction at 0.5 creates traveling jagged bottom edge', () {
      final clipper = PrintRevealClipper(
        revealFraction: 0.5,
        toothWidth: 10,
        toothHeight: 4,
      );
      final path = clipper.getClip(const Size(300, 500));
      final bounds = path.getBounds();
      // Revealed height should be 250 with teeth reaching up to 246
      expect(bounds.top, 0.0);
      expect(bounds.bottom, closeTo(250.0, 0.1));
      expect(bounds.width, closeTo(300.0, 0.1));
    });

    test('shouldReclip triggers when revealFraction changes', () {
      final clipper1 = PrintRevealClipper(revealFraction: 0.3);
      final clipper2 = PrintRevealClipper(revealFraction: 0.7);
      expect(clipper2.shouldReclip(clipper1), isTrue);
    });
  });

  group('evaluateReceiptFeed Physics Tests', () {
    test('starts at 0.0 and ends at 1.0', () {
      expect(ReceiptPrintReveal.evaluateReceiptFeed(0.0), 0.0);
      expect(ReceiptPrintReveal.evaluateReceiptFeed(0.817), 1.0);
      expect(ReceiptPrintReveal.evaluateReceiptFeed(1.0), 1.0);
    });

    test('Pause 1 (heating pause) holds at 8%', () {
      expect(ReceiptPrintReveal.evaluateReceiptFeed(0.08), 0.08);
      expect(ReceiptPrintReveal.evaluateReceiptFeed(0.11), 0.08);
      expect(ReceiptPrintReveal.evaluateReceiptFeed(0.139), 0.08);
    });

    test('Pause 2 (mid-ticket rasterization) holds at 42%', () {
      expect(ReceiptPrintReveal.evaluateReceiptFeed(0.35), closeTo(0.42, 0.001));
      expect(ReceiptPrintReveal.evaluateReceiptFeed(0.39), 0.42);
      expect(ReceiptPrintReveal.evaluateReceiptFeed(0.419), 0.42);
    });

    test('Pause 3 (stamp/QR computation) holds at 82%', () {
      expect(ReceiptPrintReveal.evaluateReceiptFeed(0.65), closeTo(0.82, 0.001));
      expect(ReceiptPrintReveal.evaluateReceiptFeed(0.68), 0.82);
      expect(ReceiptPrintReveal.evaluateReceiptFeed(0.709), 0.82);
    });

    test('feed increases monotonically across bursts', () {
      double prev = 0.0;
      for (int i = 0; i <= 100; i++) {
        final t = i / 100.0;
        final feed = ReceiptPrintReveal.evaluateReceiptFeed(t);
        expect(feed, greaterThanOrEqualTo(prev - 0.001));
        prev = feed;
      }
    });
  });

  group('ReceiptPrintReveal Widget Tests', () {
    testWidgets(
        'renders printer bar, ready indicator, receipt, and actions immediately when playIntro is false',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ReceiptPrintReveal(
              playIntro: false,
              receipt: Text('Sample Ticket Receipt'),
              actions: Text('Sample Action Buttons'),
            ),
          ),
        ),
      );

      expect(find.text('Sample Ticket Receipt'), findsOneWidget);
      expect(find.text('Sample Action Buttons'), findsOneWidget);
      expect(find.text('TCET SPEED-DISPATCH'), findsOneWidget);
      expect(find.text('READY'), findsOneWidget);
    });

    testWidgets(
        'animates multi-phase 5.2s thermal print sequence when playIntro is true',
        (tester) async {
      bool completedCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReceiptPrintReveal(
              playIntro: true,
              duration: const Duration(milliseconds: 5200),
              onCompleted: () => completedCalled = true,
              receipt: const SizedBox(
                width: 300,
                height: 400,
                child: Text('Receipt Content'),
              ),
              actions: const Text('Actions'),
            ),
          ),
        ),
      );

      // Initial frame (t=0ms): Intro hasn't started forwarding yet (100ms delay)
      expect(find.text('TCET SPEED-DISPATCH'), findsOneWidget);
      expect(completedCalled, isFalse);

      // Advance past initial delay into feeding phase (t = 100ms + 200ms = 300ms)
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.text('FEEDING'), findsOneWidget);
      expect(completedCalled, isFalse);

      // Advance into Pause 1: HEATING (t = ~650ms, 550ms after start)
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text('HEATING'), findsOneWidget);
      expect(completedCalled, isFalse);

      // Advance into Burst 1: PRINTING (t = ~1300ms, 1200ms after start)
      await tester.pump(const Duration(milliseconds: 650));
      expect(find.text('PRINTING'), findsOneWidget);
      expect(completedCalled, isFalse);

      // Advance into Pause 2: BUFFERING (t = ~2100ms, 2000ms after start)
      await tester.pump(const Duration(milliseconds: 800));
      expect(find.text('BUFFERING'), findsOneWidget);
      expect(completedCalled, isFalse);

      // Advance into Pause 3: PROCESSING (t = ~3600ms, 3500ms after start)
      await tester.pump(const Duration(milliseconds: 1500));
      expect(find.text('PROCESSING'), findsOneWidget);
      expect(completedCalled, isFalse);

      // Advance into CUTTING (t = ~4450ms, 4350ms after start)
      await tester.pump(const Duration(milliseconds: 850));
      expect(find.text('CUTTING'), findsOneWidget);
      expect(completedCalled, isFalse);

      // Advance to full completion (t = 5300ms total)
      await tester.pump(const Duration(milliseconds: 850));
      await tester.pump(const Duration(milliseconds: 200));

      expect(completedCalled, isTrue);
      expect(find.text('READY'), findsOneWidget);
      expect(find.text('Receipt Content'), findsOneWidget);
      expect(find.text('Actions'), findsOneWidget);
    });

    testWidgets(
        'didUpdateWidget snaps to 1.0 if playIntro changes to false during playback',
        (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ReceiptPrintReveal(
              playIntro: true,
              receipt: Text('Receipt Content'),
              actions: Text('Actions'),
            ),
          ),
        ),
      );

      // Advance slightly
      await tester.pump(const Duration(milliseconds: 100));

      // Update widget with playIntro: false
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ReceiptPrintReveal(
              playIntro: false,
              receipt: Text('Receipt Content'),
              actions: Text('Actions'),
            ),
          ),
        ),
      );

      await tester.pump();
      expect(find.text('READY'), findsOneWidget);
    });
  });
}
