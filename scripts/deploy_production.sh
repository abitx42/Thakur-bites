#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "══════════════════════════════════════════════════════════════════════"
echo "🚀 THAKUR BITES PLATFORM 2.0 — MASTER PRODUCTION DEPLOYMENT PIPELINE"
echo "══════════════════════════════════════════════════════════════════════"
echo ""

echo "▶ Step 1: Executing 303-Test Security & Invariant CI Gate..."
bash "$DIR/scripts/run_all_security_checks.sh"

echo ""
echo "▶ Step 2: Compiling Backend Cloud Functions 2.0..."
cd "$DIR/functions"
npm run build
cd "$DIR"

echo ""
echo "▶ Step 3: Compiling Production Flutter Web Release Bundle..."
cd "$DIR/thakur_bites"
flutter build web --release
cd "$DIR"

echo ""
echo "▶ Step 4: Ready to Deploy to Firebase..."
echo "To execute deployment, run:"
echo "  firebase deploy --only firestore:rules,functions,hosting"
echo ""
echo "══════════════════════════════════════════════════════════════════════"
echo "🏆 DEPLOYMENT ARTIFACTS VERIFIED & READY FOR PRODUCTION"
echo "══════════════════════════════════════════════════════════════════════"
