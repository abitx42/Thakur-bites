#!/usr/bin/env bash

# 🚀 Thakur Bites Platform 2.0 — Cloud Functions Deployment Automator
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "══════════════════════════════════════════════════════════════════════"
echo "☁️  THAKUR BITES — CLOUD FUNCTIONS PRODUCTION DEPLOYMENT ENGINE"
echo "   Target Project: adi-thakur-bite"
echo "══════════════════════════════════════════════════════════════════════"
echo ""

echo "▶ Step 1: Compiling Cloud Functions TypeScript..."
npm run build --prefix functions

echo ""
echo "▶ Step 2: Running Backend Invariant Tests..."
npm test --prefix functions

echo ""
echo "▶ Step 3: Verifying Cloud Functions Deployment Pre-Flight..."
if ! npx firebase-tools deploy --only functions --dry-run --project adi-thakur-bite 2>/tmp/gcf_deploy_err.log; then
  echo ""
  echo "══════════════════════════════════════════════════════════════════════"
  echo "🚨 CLOUD FUNCTIONS PRE-FLIGHT BLOCKED"
  echo "══════════════════════════════════════════════════════════════════════"
  cat /tmp/gcf_deploy_err.log
  echo ""
  echo "💡 ACTION REQUIRED: Ensure project 'adi-thakur-bite' is upgraded to"
  echo "   the Blaze (Pay-As-You-Go) plan to enable Google Cloud Build &"
  echo "   Artifact Registry APIs required for Node 20 2nd Gen Cloud Functions:"
  echo "   👉 https://console.firebase.google.com/project/adi-thakur-bite/usage/details"
  echo "══════════════════════════════════════════════════════════════════════"
  exit 1
fi

echo ""
echo "▶ Step 4: Deploying Cloud Functions to Google Cloud..."
npx firebase-tools deploy --only functions --project adi-thakur-bite

echo ""
echo "══════════════════════════════════════════════════════════════════════"
echo "🏆 ALL 10 CLOUD FUNCTIONS SUCCESSFULLY DEPLOYED TO PRODUCTION!"
echo "══════════════════════════════════════════════════════════════════════"
