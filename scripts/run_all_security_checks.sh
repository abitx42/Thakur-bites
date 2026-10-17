#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# These commands report their observed counts; no fallback counts or fabricated certificates.
npm run security-check
make test
npm run test:flutter
npm run test:rules
npm audit --audit-level=low
npm --prefix functions audit --audit-level=low
printf '%s\n' 'Local security gates passed. Live Firebase, attestation, gateway and device smoke tests are separate deployment checks.'
