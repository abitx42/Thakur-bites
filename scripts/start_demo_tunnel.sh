#!/bin/bash
# ==============================================================================
# 🍛 Thakur Bites Platform 2.0 — Quick Demo Public Tunnel
# ==============================================================================
# Builds production Flutter web bundle, starts a local HTTP server, and creates
# a secure, temporary Cloudflare Quick Tunnel (https://*.trycloudflare.com).
# ==============================================================================

set -euo pipefail

PORT=${PORT:-8080}
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="${PROJECT_ROOT}/thakur_bites/build/web"

echo "======================================================================"
echo "🚀 STARTING THAKUR BITES DEMO TUNNEL"
echo "======================================================================"

# 1. Ensure build/web exists
if [ ! -d "${WEB_DIR}" ]; then
  echo "📦 Building production web bundle..."
  (cd "${PROJECT_ROOT}/thakur_bites" && flutter build web)
fi

# 2. Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
  echo "❌ cloudflared is not installed. Please install it using: brew install cloudflared"
  exit 1
fi

# 3. Start local Python HTTP Server in background
echo "🌐 Serving static web assets on http://localhost:${PORT}..."
python3 -m http.server "${PORT}" --directory "${WEB_DIR}" &
SERVER_PID=$!

cleanup() {
  echo ""
  echo "🛑 Shutting down demo server and tunnel..."
  kill "${SERVER_PID}" 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Give local server a moment to bind
sleep 1

echo "🔒 Creating Cloudflare Quick Tunnel to http://localhost:${PORT}..."
echo "----------------------------------------------------------------------"
cloudflared tunnel --url "http://localhost:${PORT}"
