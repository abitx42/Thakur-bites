import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';
import 'screens/smoke_test_screen.dart';

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
      theme: ThemeData(
        // Thakur Bites brand colors — ported from HTML mockup
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFF6B35), // Brand orange
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xFF1A1A2E),
        useMaterial3: true,
      ),
      home: const SmokeTestScreen(), // Phase 1: Smoke test — will be replaced by MenuScreen in Phase 2
    );
  }
}
