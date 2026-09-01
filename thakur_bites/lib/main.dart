import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:provider/provider.dart';
import 'firebase_options.dart';
import 'theme/app_theme.dart';
import 'providers/auth_provider.dart';
import 'providers/cart_provider.dart';
import 'services/update_service.dart';
import 'models/app_version.dart';
import 'screens/menu_screen.dart';
import 'screens/force_update_screen.dart';
import 'widgets/update_dialog.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  runApp(const ThakurBitesApp());
}

class ThakurBitesApp extends StatelessWidget {
  const ThakurBitesApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => CartProvider()),
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => UpdateService()),
      ],
      child: MaterialApp(
        title: 'Thakur Bites',
        debugShowCheckedModeBanner: false,
        theme: buildAppTheme(),
        home: const AppUpdateWrapper(child: MenuScreen()),
      ),
    );
  }
}

class AppUpdateWrapper extends StatefulWidget {
  final Widget child;

  const AppUpdateWrapper({super.key, required this.child});

  @override
  State<AppUpdateWrapper> createState() => _AppUpdateWrapperState();
}

class _AppUpdateWrapperState extends State<AppUpdateWrapper> {
  bool _dialogShown = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkUpdates();
    });
  }

  Future<void> _checkUpdates() async {
    final updateService = Provider.of<UpdateService>(context, listen: false);
    final status = await updateService.checkForUpdates();
    if (!mounted) return;

    if (status == UpdateStatus.updateAvailable && !_dialogShown && updateService.currentPolicy != null) {
      _dialogShown = true;
      UpdateDialog.show(
        context,
        policy: updateService.currentPolicy!,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<UpdateService>(
      builder: (context, updateService, _) {
        if (updateService.status == UpdateStatus.forceUpdateRequired &&
            updateService.currentPolicy != null) {
          return ForceUpdateScreen(policy: updateService.currentPolicy!);
        }
        return widget.child;
      },
    );
  }
}
