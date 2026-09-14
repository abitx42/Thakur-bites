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
      final clipper = PrintRevealClipper(revealFraction: 0.5, toothWidth: 10, toothHeight: 4);
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

  group('ReceiptPrintReveal Widget Tests', () {
    testWidgets('renders printer bar, receipt, and actions immediately when playIntro is false', (tester) async {
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
    });

    testWidgets('animates receipt unspooling when playIntro is true', (tester) async {
      bool completedCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReceiptPrintReveal(
              playIntro: true,
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

      // Initial frame: actions have 0 opacity initially
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Advance through the unspool animation (total 900ms)
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pump(const Duration(milliseconds: 600));

      expect(completedCalled, isTrue);
      expect(find.text('Receipt Content'), findsOneWidget);
      expect(find.text('Actions'), findsOneWidget);
    });
  });
}
