#!/usr/bin/env bash

# Thakur Bites Platform 2.0 — Production Deployment Automator
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "══════════════════════════════════════════════════════════════════════"
echo "🚀 THAKUR BITES PLATFORM 2.0 — PRODUCTION DEPLOYMENT ENGINE"
echo "══════════════════════════════════════════════════════════════════════"
echo ""

echo "▶ Phase 1: Running All 8 Security, SAST & Invariant Gates..."
bash "$DIR/scripts/run_all_security_checks.sh"

echo ""
echo "▶ Phase 2: Compiling Flutter Web Production Release Bundle..."
cd "$DIR/thakur_bites"
flutter build web --release
cd "$DIR"

echo ""
echo "▶ Phase 3: Ready for Firebase Deployment."
echo "Deploying Cloud Functions, Firestore Rules, and Hosting..."

if command -v firebase &> /dev/null; then
  firebase deploy --project adi-thakur-bite
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "🏆 PLATFORM 2.0 SUCCESSFULLY DEPLOYED TO PRODUCTION!"
  echo "══════════════════════════════════════════════════════════════════════"
else
  echo ""
  echo "⚠️ Firebase CLI is not installed or authenticated in this environment."
  echo "To deploy manually, run:"
  echo "  npm install -g firebase-tools"
  echo "  firebase login"
  echo "  firebase deploy --project adi-thakur-bite"
fi
