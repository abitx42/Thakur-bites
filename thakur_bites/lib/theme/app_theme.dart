import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Thakur Bites design tokens — ported from the HTML prototype.
/// Warm, paper-like palette with mustard (cooked) and green (instant) accents.
class AppColors {
  AppColors._();

  static const bg = Color(0xFFEDEAE0);
  static const surface = Color(0xFFFBF8EF);
  static const surface2 = Color(0xFFF3EFE2);
  static const ink = Color(0xFF221C15);
  static const inkSoft = Color(0xFF7A7266);
  static const red = Color(0xFFD6402B);
  static const redDeep = Color(0xFFB7301E);
  static const mustard = Color(0xFFEFA727);
  static const mustardSoft = Color(0xFFFBE7BE);
  static const mustardInk = Color(0xFF6B4408);
  static const green = Color(0xFF4F7A3C);
  static const greenSoft = Color(0xFFDCEACB);
  static const greenInk = Color(0xFF2C4A1E);
  static const line = Color(0xFFDAD3C0);
}

/// Three-font split matching the HTML mockup:
///  - Bebas Neue  → brand/headings
///  - IBM Plex Mono → prices, tokens, mono data
///  - Inter → body text, buttons, labels
class AppFonts {
  AppFonts._();

  /// Brand / display headings
  static TextStyle display({
    double fontSize = 30,
    Color color = AppColors.ink,
    double letterSpacing = 0.6,
  }) =>
      GoogleFonts.bebasNeue(
        fontSize: fontSize,
        color: color,
        letterSpacing: letterSpacing,
      );

  /// Monospaced — prices, tokens, badges
  static TextStyle mono({
    double fontSize = 13,
    FontWeight fontWeight = FontWeight.w600,
    Color color = AppColors.ink,
  }) =>
      GoogleFonts.ibmPlexMono(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
      );

  /// Body — everything else
  static TextStyle body({
    double fontSize = 14,
    FontWeight fontWeight = FontWeight.w400,
    Color color = AppColors.ink,
  }) =>
      GoogleFonts.inter(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
      );
}

/// App-wide ThemeData using the design tokens
ThemeData buildAppTheme() {
  return ThemeData(
    scaffoldBackgroundColor: AppColors.bg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.red,
      brightness: Brightness.light,
      surface: AppColors.surface,
    ),
    useMaterial3: true,
    textTheme: TextTheme(
      displayLarge: AppFonts.display(fontSize: 30),
      titleLarge: AppFonts.display(fontSize: 22),
      bodyLarge: AppFonts.body(fontSize: 15),
      bodyMedium: AppFonts.body(fontSize: 14),
      bodySmall: AppFonts.body(fontSize: 12, color: AppColors.inkSoft),
      labelLarge: AppFonts.mono(fontSize: 14),
      labelSmall: AppFonts.mono(fontSize: 11),
    ),
  );
}
