import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Thakur Bites design tokens — ported from the HTML prototype.
/// Warm, paper-like palette with mustard (cooked) and green (instant) accents.
class AppColors {
  AppColors._();

  // Neutral & Paper Surfaces
  static const bg = Color(0xFFF5F1E9);
  static const surface = Color(0xFFFBF8EF);
  static const surface2 = Color(0xFFF3EFE2);
  static const ink = Color(0xFF18181B);
  static const inkSecondary = Color(0xFF52525B);
  static const inkSoft = Color(0xFF71717A);
  static const line = Color(0xFFE4DCD0);
  static const lineDark = Color(0xFF18181B);

  // Brand Spice Accents
  static const red = Color(0xFFDC2626);
  static const redDeep = Color(0xFFB91C1C);
  static const redSoft = Color(0xFFFEE2E2);
  static const mustard = Color(0xFFD97706);
  static const mustardSoft = Color(0xFFFEF3C7);
  static const mustardInk = Color(0xFFB45309);
  static const green = Color(0xFF16A34A);
  static const greenSoft = Color(0xFFDCFCE7);
  static const greenInk = Color(0xFF15803D);
  static const chai = Color(0xFF78350F);
  static const chaiSoft = Color(0xFFF5EBE1);

  // Semantic Status Tokens
  static const success = Color(0xFF16A34A);
  static const successBg = Color(0xFFDCFCE7);
  static const warning = Color(0xFFD97706);
  static const warningBg = Color(0xFFFEF3C7);
  static const amberBg = Color(0xFFFFFBEB);
  static const amberBorder = Color(0xFFFDE68A);
  static const danger = Color(0xFFDC2626);
  static const dangerBg = Color(0xFFFEE2E2);
  static const info = Color(0xFF2563EB);
  static const infoBg = Color(0xFFEFF6FF);
  static const infoBorder = Color(0xFF93C5FD);
  static const infoDeep = Color(0xFF1E40AF);
  static const muted = Color(0xFF94A3B8);
  static const mutedBg = Color(0xFFF1F5F9);
  static const mutedBorder = Color(0xFFCBD5E1);
}

/// Harmonic 4-point spacing scale (4, 8, 12, 16, 24, 32px)
class AppSpacing {
  AppSpacing._();

  static const double xs = 4.0;
  static const double sm = 8.0;
  static const double md = 12.0;
  static const double lg = 16.0;
  static const double xl = 24.0;
  static const double xxl = 32.0;
}

/// 4-tier border radius system (6, 10, 16, 999px)
class AppRadius {
  AppRadius._();

  static const double sm = 6.0;
  static const double md = 10.0;
  static const double lg = 16.0;
  static const double pill = 999.0;

  static final radiusSm = BorderRadius.circular(sm);
  static final radiusMd = BorderRadius.circular(md);
  static final radiusLg = BorderRadius.circular(lg);
  static final radiusPill = BorderRadius.circular(pill);
}

/// Motion duration and curve tokens
class AppMotion {
  AppMotion._();

  static const Duration fast = Duration(milliseconds: 120);
  static const Duration normal = Duration(milliseconds: 200);
  static const Duration slow = Duration(milliseconds: 320);
  static const Curve curve = Curves.easeOutCubic;
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
    double? letterSpacing,
  }) =>
      GoogleFonts.ibmPlexMono(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        letterSpacing: letterSpacing,
      );

  /// Body — everything else
  static TextStyle body({
    double fontSize = 14,
    FontWeight fontWeight = FontWeight.w400,
    Color color = AppColors.ink,
    double? height,
  }) =>
      GoogleFonts.inter(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        height: height,
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
