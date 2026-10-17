#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
printf '%s\n' 'Thakur Bites local launcher (run make setup and npm run build:web first)' \
  '[A] Offline HTTP/backend regression suite' \
  '[B] Serve rebuilt public site: http://localhost:3000 (staff: /staff, TV: /tv)' \
  '[C] Flutter analysis and widget/unit tests' \
  '[D] Local Firestore + Storage emulator regression suite' \
  '[E] Full security runner (includes online dependency audits)' \
  '[F] Exit' \
  'Deployment and real data seeding are deliberately not implicit launcher actions; see README.md.'
read -r -p 'Choice [A/B/C/D/E/F]: ' choice
case "$choice" in
  [aA]) make test ;;
  [bB]) PORT=3000 node server.js ;;
  [cC]) npm run test:flutter ;;
  [dD]) npm run test:rules ;;
  [eE]) bash scripts/run_all_security_checks.sh ;;
  *) exit 0 ;;
esac
