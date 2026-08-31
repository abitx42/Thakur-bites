#!/bin/bash
set -e

echo "════════════════════════════════════════════════════════════════"
echo "🚀 THAKUR BITES ENTERPRISE PRODUCTION DEPLOYMENT AUTOMATION"
echo "════════════════════════════════════════════════════════════════"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "1. Validating Git Repository Cleanliness..."
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️ Warning: Working directory has uncommitted changes."
fi
echo "✓ Git branch: $(git rev-parse --abbrev-ref HEAD) ($(git rev-parse --short HEAD))"

echo -e "\n2. Running Dart Strict Analyzer & Flutter Unit Test Suite..."
cd "$PROJECT_ROOT/thakur_bites"
dart analyze --fatal-infos
flutter test

echo -e "\n3. Building Flutter Web Production Release Bundle..."
flutter build web --release

echo -e "\n4. Running Cloud Functions TypeScript Compilation & Strict Invariants Test Suite..."
cd "$PROJECT_ROOT/functions"
npm run build
npm test

echo -e "\n5. Running End-to-End Lifecycle Smoke Test..."
node "$PROJECT_ROOT/scripts/e2e_smoke_test.js"

echo -e "\n6. Running High-Concurrency Peak Rush Simulator..."
node "$PROJECT_ROOT/scripts/simulate_lunch_rush.js"

echo -e "\n════════════════════════════════════════════════════════════════"
echo "🏆 ALL PRODUCTION GATES PASSED 100% GREEN!"
echo "Ready for: firebase deploy --only functions,firestore,hosting"
echo "════════════════════════════════════════════════════════════════"
