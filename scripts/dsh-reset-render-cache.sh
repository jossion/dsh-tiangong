#!/usr/bin/env bash
# Clear the DSH desktop renderer caches (NOT cookies — those are needed for the
# launch URL). Run this while DSH is fully quit.
set -euo pipefail
APP="$HOME/Library/Application Support/@deepseek-ai/dsh-desktop"

if pgrep -f "DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" >/dev/null 2>&1; then
  echo "DSH is still running — quit it first (Cmd+Q)." >&2
  exit 1
fi

BACKUP="/tmp/dsh-render-cache-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
for dir in "Cache" "Code Cache" "GPUCache" "DawnGraphiteCache" "DawnWebGPUCache"; do
  if [ -d "$APP/$dir" ]; then
    cp -pR "$APP/$dir" "$BACKUP/$dir" 2>/dev/null || true
    rm -rf "$APP/$dir"
    echo "cleared: $dir"
  fi
done
echo "backup: $BACKUP (cookies untouched)"
