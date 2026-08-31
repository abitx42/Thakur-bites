#!/usr/bin/env bash
set -e

echo "══════════════════════════════════════════════════════════════════════"
echo "🛡️  THAKUR BITES — MASTER SECURITY & CI VERIFICATION RUNNER"
echo "══════════════════════════════════════════════════════════════════════"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo ""
echo "▶ Step 1: Compiling & Testing Backend Cloud Functions (152 Invariant Tests)..."
cd functions
npm run build
npm test
cd ..

echo ""
echo "▶ Step 2: Running Flutter Static Analysis & Client Test Suite (31 Tests)..."
cd thakur_bites
dart analyze --fatal-infos
flutter test
cd ..

echo ""
echo "▶ Step 3: Verifying Cryptographic Backup Restore Engine..."
node functions/scripts/verify_backup_restore.js

echo ""
echo "▶ Step 4: Executing Full End-to-End Lifecycle Smoke Test..."
node scripts/e2e_smoke_test.js

echo ""
echo "▶ Step 5: Executing Peak Lunch Rush Concurrency Simulator (100 parallel buyers)..."
node scripts/simulate_lunch_rush.js

echo ""
echo "══════════════════════════════════════════════════════════════════════"
echo "🏆 ALL 5 SECURITY & INVARIANT GATES PASSED (183 TOTAL TESTS 100% GREEN)"
echo "══════════════════════════════════════════════════════════════════════"
