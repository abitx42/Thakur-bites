#!/usr/bin/env bash
set -euo pipefail

# Thakur Bites - Automated Versioned APK Exporter
# Usage: ./scripts/export_updated_apk.sh [build]
# If 'build' is passed, runs flutter build apk --release first with auto-incremented build number.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLUTTER_DIR="$REPO_ROOT/thakur_bites"
APK_OUTPUT_DIR="$REPO_ROOT/apks"
mkdir -p "$APK_OUTPUT_DIR"

# Determine the next update index
LATEST_NUM=0
for f in "$APK_OUTPUT_DIR"/ThakurBites_updated_*.apk; do
  if [[ -f "$f" ]]; then
    fname="$(basename "$f")"
    num=$(echo "$fname" | sed -E 's/ThakurBites_updated_([0-9]+)\.apk/\1/')
    if [[ "$num" =~ ^[0-9]+$ ]] && (( num > LATEST_NUM )); then
      LATEST_NUM=$num
    fi
  fi
done

NEXT_NUM=$((LATEST_NUM + 1))

SHOULD_BUILD="${1:-}"

if [[ "$SHOULD_BUILD" == "build" ]]; then
  echo "==> Building Release APK for Update $NEXT_NUM (build number $NEXT_NUM)..."
  cd "$FLUTTER_DIR"
  flutter build apk --release --build-number="$NEXT_NUM"
else
  # Check that base release apk exists
  if [[ ! -f "$FLUTTER_DIR/build/app/outputs/flutter-apk/app-release.apk" ]]; then
    echo "==> No release APK found at $FLUTTER_DIR/build/app/outputs/flutter-apk/app-release.apk"
    echo "==> Running flutter build apk --release..."
    cd "$FLUTTER_DIR"
    flutter build apk --release --build-number="$NEXT_NUM"
  fi
fi

SRC_APK="$FLUTTER_DIR/build/app/outputs/flutter-apk/app-release.apk"
TARGET_NAME="ThakurBites_updated_${NEXT_NUM}.apk"
TARGET_PATH="$APK_OUTPUT_DIR/$TARGET_NAME"
FLUTTER_TARGET_PATH="$FLUTTER_DIR/build/app/outputs/flutter-apk/$TARGET_NAME"

cp "$SRC_APK" "$TARGET_PATH"
cp "$SRC_APK" "$FLUTTER_TARGET_PATH"

APK_SIZE=$(ls -lh "$TARGET_PATH" | awk '{print $5}')
APK_TIME=$(date "+%Y-%m-%d %H:%M:%S")

echo ""
echo "============================================================"
echo " SUCCESS: Exported $TARGET_NAME ($APK_SIZE)"
echo " Timestamp: $APK_TIME"
echo " Location:  $TARGET_PATH"
echo "============================================================"
echo ""
echo "To install on your connected phone run:"
echo "  adb install -r \"$TARGET_PATH\""
echo ""
