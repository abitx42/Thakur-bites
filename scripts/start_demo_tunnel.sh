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

# ─── 1. Build production release if needed ─────────────────────────────────
if [ "${SKIP_BUILD:-0}" = "1" ] && [ -d "${WEB_DIR}" ]; then
  echo "⏩ Skipping Flutter build (SKIP_BUILD=1) → using existing ${WEB_DIR}"
else
  echo "📦 Building production Flutter web bundle (release mode)..."
  (cd "${FLUTTER_ROOT}" && flutter build web --release)
  echo "✅ Build complete → ${WEB_DIR}"
fi

# ─── 1.1 Integrate Operations Portals into Web Bundle ─────────────────────
echo "🔗 Syncing Operations Portals (Staff, Admin, Dev, TV, Gateway)..."
cp -f "${PROJECT_ROOT}"/admin.html "${WEB_DIR}/admin.html"
cp -f "${PROJECT_ROOT}"/staff.html "${WEB_DIR}/staff.html"
cp -f "${PROJECT_ROOT}"/developer.html "${WEB_DIR}/developer.html"
cp -f "${PROJECT_ROOT}"/tv.html "${WEB_DIR}/tv.html"
cp -f "${PROJECT_ROOT}"/index.html "${WEB_DIR}/portal.html"
rm -rf "${WEB_DIR}/js" "${WEB_DIR}/css"
cp -rf "${PROJECT_ROOT}"/js "${WEB_DIR}/js"
cp -rf "${PROJECT_ROOT}"/css "${WEB_DIR}/css"

# Generate serve.json for multi-application routing
cat << 'EOF' > "${WEB_DIR}/serve.json"
{
  "cleanUrls": false,
  "directoryListing": false,
  "rewrites": [
    { "source": "/admin", "destination": "/admin.html" },
    { "source": "/staff", "destination": "/staff.html" },
    { "source": "/developer", "destination": "/developer.html" },
    { "source": "/tv", "destination": "/tv.html" },
    { "source": "/portal", "destination": "/portal.html" },
    { "source": "/", "destination": "/index.html" },
    { "source": "/index", "destination": "/index.html" }
  ]
}
EOF

# ─── 2. Ensure cloudflared is available ────────────────────────────────────
if ! command -v cloudflared &> /dev/null; then
  echo "❌ cloudflared not found. Install it with: brew install cloudflared"
  exit 1
fi

# ─── 3. Ensure npx / serve is available ────────────────────────────────────
if ! command -v npx &> /dev/null; then
  echo "❌ npx not found. Install Node.js from: https://nodejs.org"
  exit 1
fi

# ─── 4. Start multi-app local server ───────────────────────────────────────
echo "🌐 Starting web server on http://localhost:${PORT}..."
npx serve "${WEB_DIR}" -l "${PORT}" --no-clipboard &
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
