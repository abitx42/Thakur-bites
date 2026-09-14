import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:thakur_bites/services/device_security_service.dart';
import 'package:thakur_bites/screens/security_enforcement_screen.dart';

void main() {
  group('DeviceSecurityService & SecurityEnforcementScreen Tests', () {
    test('DeviceSecurityService initializes with default safe state', () {
      final service = DeviceSecurityService();
      expect(service.isChecking, false);
      expect(service.isDeveloperModeBlocked, false);
      expect(service.isCriticalTamperDetected, false);
    });

    testWidgets('SecurityEnforcementScreen renders instructional steps and buttons', (tester) async {
      final service = DeviceSecurityService();

      await tester.pumpWidget(
        MaterialApp(
          home: ChangeNotifierProvider<DeviceSecurityService>.value(
            value: service,
            child: const SecurityEnforcementScreen(),
          ),
        ),
      );

      expect(find.text('Security Mode Required'), findsOneWidget);
      expect(find.text('Open Settings'), findsOneWidget);
      expect(find.text('Turn Off Developer Options'), findsOneWidget);
      expect(find.text('Open Device Settings'), findsOneWidget);
      expect(find.text('Re-check Security'), findsOneWidget);
    });
  });
}
