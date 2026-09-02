#!/bin/bash
# ==============================================================================
# 🍛 Thakur Bites Platform 2.0 — Quick Demo Public Tunnel
# ==============================================================================
# Always builds a fresh production Flutter web bundle, starts a SPA-capable
# local HTTP server, and creates a secure temporary Cloudflare Quick Tunnel.
#
# Usage:
#   ./scripts/start_demo_tunnel.sh            # Always rebuilds (recommended)
#   PORT=9090 ./scripts/start_demo_tunnel.sh  # Custom port
# ==============================================================================

set -euo pipefail

PORT=${PORT:-8080}
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLUTTER_ROOT="${PROJECT_ROOT}/thakur_bites"
WEB_DIR="${FLUTTER_ROOT}/build/web"

echo "======================================================================"
echo "🚀 STARTING THAKUR BITES DEMO TUNNEL"
echo "======================================================================"

# ─── 1. Always build a fresh production release ────────────────────────────
# We do NOT skip this even if build/web already exists — stale builds served
# during demos are a silent security and UX bug.
echo "📦 Building production Flutter web bundle (release mode)..."
(cd "${FLUTTER_ROOT}" && flutter build web --release)
echo "✅ Build complete → ${WEB_DIR}"

# ─── 2. Ensure cloudflared is available ────────────────────────────────────
if ! command -v cloudflared &> /dev/null; then
  echo "❌ cloudflared not found. Install it with: brew install cloudflared"
  exit 1
fi

# ─── 3. Ensure npx / serve is available ────────────────────────────────────
# `npx serve -s` handles SPA routing (unknown paths → /index.html).
# python3 -m http.server does NOT handle SPA deep links — it returns 404.
if ! command -v npx &> /dev/null; then
  echo "❌ npx not found. Install Node.js from: https://nodejs.org"
  exit 1
fi

# ─── 4. Start SPA-capable local server ─────────────────────────────────────
echo "🌐 Starting SPA server on http://localhost:${PORT}..."
npx serve -s "${WEB_DIR}" -l "${PORT}" --no-clipboard &
SERVER_PID=$!

cleanup() {
  echo ""
  echo "🛑 Shutting down demo server and tunnel..."
  kill "${SERVER_PID}" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Give local server a moment to bind
sleep 2

# ─── 5. Create Cloudflare Quick Tunnel ─────────────────────────────────────
echo "🔒 Creating Cloudflare Quick Tunnel → http://localhost:${PORT}"
echo "   Your demo URL will appear below in a few seconds..."
echo "----------------------------------------------------------------------"
cloudflared tunnel --url "http://localhost:${PORT}"
