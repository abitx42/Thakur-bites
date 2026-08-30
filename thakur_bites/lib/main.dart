import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';
import 'theme/app_theme.dart';
import 'screens/menu_screen.dart';

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
    return MaterialApp(
      title: 'Thakur Bites',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: const MenuScreen(),
    );
  }
}
