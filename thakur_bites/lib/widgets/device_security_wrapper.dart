import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/device_security_service.dart';
import '../screens/security_enforcement_screen.dart';

class DeviceSecurityWrapper extends StatefulWidget {
  final Widget child;

  const DeviceSecurityWrapper({super.key, required this.child});

  @override
  State<DeviceSecurityWrapper> createState() => _DeviceSecurityWrapperState();
}

class _DeviceSecurityWrapperState extends State<DeviceSecurityWrapper> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final sec = Provider.of<DeviceSecurityService>(context, listen: false);
      sec.checkSecurityPosture();
      sec.startContinuousMonitoring();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    try {
      Provider.of<DeviceSecurityService>(context, listen: false).stopContinuousMonitoring();
    } catch (_) {}
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final sec = Provider.of<DeviceSecurityService>(context, listen: false);
    if (state == AppLifecycleState.resumed) {
      sec.checkSecurityPosture();
      sec.startContinuousMonitoring();
    } else if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      sec.stopContinuousMonitoring();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<DeviceSecurityService>(
      builder: (context, securityService, _) {
        if (securityService.isDeveloperModeBlocked || securityService.isCriticalTamperDetected) {
          return const SecurityEnforcementScreen();
        }
        return widget.child;
      },
    );
  }
}
