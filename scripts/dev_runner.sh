#!/usr/bin/env bash

# Thakur Bites Platform 2.0 — Local Development Launcher
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "══════════════════════════════════════════════════════════════════════"
echo "🚀 THAKUR BITES PLATFORM 2.0 — MULTI-SERVICE LOCAL LAUNCHER"
echo "══════════════════════════════════════════════════════════════════════"
echo ""
echo "Services available in Platform 2.0:"
echo "  1. Staff Operations Hub & TV Board  -> http://localhost:3000"
echo "  2. Standalone TV Dispatch Display  -> http://localhost:3000/web_tv"
echo "  3. Flutter Customer Web App        -> http://localhost:8080"
echo "  4. Master Security CI Test Suite   -> bash scripts/run_all_security_checks.sh"
echo ""
echo "Select an option to launch:"
echo "  [A] Run Master Security CI Verification Suite (263 Tests / 9 Gates)"
echo "  [B] Start Staff Hub & TV Display HTTP Server (Port 3000)"
echo "  [C] Launch Flutter Web Client (Port 8080)"
echo "  [D] Seed Realistic Demo Data into Firestore (Menu, Orders, Shift PIN 123456)"
echo "  [E] Automated Production Deploy to Firebase (with 9-Gate Security Check)"
echo "  [F] Exit"
echo ""

read -p "Enter choice [A/B/C/D/E/F]: " choice

case "$choice" in
  [aA])
    bash "$DIR/scripts/run_all_security_checks.sh"
    ;;
  [bB])
    echo "Starting static server on port 3000..."
    npx serve -l 3000 "$DIR"
    ;;
  [cC])
    echo "Launching Flutter web app on port 8080..."
    cd "$DIR/thakur_bites"
    flutter run -d chrome --web-port 8080
    ;;
  [dD])
    echo "Seeding demo campus data into Firestore..."
    node "$DIR/scripts/seed_demo_data.js"
    ;;
  [eE])
    bash "$DIR/scripts/deploy_platform.sh"
    ;;
  *)
    echo "Exiting launcher."
    exit 0
    ;;
esac
