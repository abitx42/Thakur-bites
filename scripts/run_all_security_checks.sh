#!/usr/bin/env bash
set -e

echo "══════════════════════════════════════════════════════════════════════"
echo "🛡️  THAKUR BITES — MASTER SECURITY & CI VERIFICATION RUNNER"
echo "══════════════════════════════════════════════════════════════════════"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo ""
echo "▶ Step 1: Scanning Codebase for Leaked Secrets & Credentials..."
node scripts/scan_secrets.js

echo ""
echo "▶ Step 2: Running SAST Static Application Security Code Analysis..."
node scripts/sast_analyzer.js

echo ""
echo "▶ Step 3: Auditing Backend Node Dependencies for Vulnerabilities..."
cd functions
npm audit --audit-level=high
cd ..

echo ""
echo "▶ Step 4: Compiling & Testing Backend Cloud Functions (159 Invariant Tests)..."
cd functions
npm run build
npm test
cd ..

echo ""
echo "▶ Step 5: Running Flutter Static Analysis & Client Test Suite (31 Tests)..."
cd thakur_bites
dart analyze --fatal-infos
flutter test
cd ..

echo ""
echo "▶ Step 6: Verifying Cryptographic Backup Restore Engine..."
node functions/scripts/verify_backup_restore.js

echo ""
echo "▶ Step 7: Executing Platform 2.0 Full End-to-End Lifecycle Smoke Test..."
node scripts/e2e_smoke_test.js

echo ""
echo "▶ Step 8: Executing Peak Lunch Rush Concurrency Simulator (100 parallel buyers)..."
node scripts/simulate_lunch_rush.js

echo ""
echo "══════════════════════════════════════════════════════════════════════"
echo "🏆 ALL 8 SECURITY, SAST & INVARIANT GATES PASSED (190 TOTAL TESTS 100% GREEN)"
echo "══════════════════════════════════════════════════════════════════════"
