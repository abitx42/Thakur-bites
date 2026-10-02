#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

if [ ! -f ".antideploy.json" ]; then
  echo "❌ Missing .antideploy.json in root."
  exit 1
fi

CONFIG_FILE="$HOME/.antideploy/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Missing ~/.antideploy/config.json. Please connect your Antideploy token."
  exit 1
fi

APP_ID=$(python3 -c "import json; print(json.load(open('.antideploy.json'))['applicationId'])")
TOKEN=$(python3 -c "import json, os; print(json.load(open(os.path.expanduser('~/.antideploy/config.json')))['token'])")

echo "📦 Packaging Thakur Bites and pushing to Antideploy ($APP_ID)..."

RESP=$(tar czf - \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=apks \
  --exclude=thakur_bites \
  --exclude=functions \
  --exclude=canvaskit \
  --exclude='*.apk' \
  --exclude='*.log' \
  --exclude='*.symbols' \
  --exclude=.firebase \
  --exclude=.cursor \
  --exclude=.vscode \
  --exclude='.aider*' \
  --exclude=reports \
  --exclude=docs \
  . | curl -sS -X POST "https://antideploy.com/api/v1/deploy?applicationId=$APP_ID" \
      -H "Authorization: Bearer $TOKEN" \
      -F "archive=@-")

echo "$RESP"

TASK_ID=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('taskId', ''))" 2>/dev/null || true)

if [ -n "$TASK_ID" ]; then
  echo "🔍 Watching deploy task: $TASK_ID..."
  while true; do
    sleep 3
    POLL=$(curl -sS "https://antideploy.com/api/v1/deployments/$TASK_ID" -H "Authorization: Bearer $TOKEN")
    STATUS=$(echo "$POLL" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))")
    echo "   Status: $STATUS"
    if [ "$STATUS" = "succeeded" ]; then
      echo "✅ Live at https://thakur-bites.antideploy.com"
      break
    elif [ "$STATUS" = "failed" ]; then
      echo "❌ Deployment failed:"
      echo "$POLL"
      exit 1
    fi
  done
fi
