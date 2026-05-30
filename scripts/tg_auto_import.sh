#!/bin/bash
# tg_auto_import.sh — auto-import alle tg-channel-dirs naar DB
# Runt elke 3 min via launchd. Voor elke channel-dir met >0 sidecar JSON's:
#   tg_import_folder.py <dir> <chat_id> <channel_name> --apply
# Dedup via WHERE NOT EXISTS in script zelf, dus veilig herhaaldelijk.

set -u

# PID-lock: voorkomt dat parallelle starts stapelen. Reden: simple-server
# doet setInterval(spawn, 3min) zonder check of vorige run nog draait. Als
# één cyclus >3 min duurt → pile-up van honderden procs + postgres-storm.
# macOS heeft geen flock; daarom DIY met kill -0 op PID-file.
LOCK="/tmp/tg_auto_import.pid"
if [ -f "$LOCK" ]; then
  old_pid=$(cat "$LOCK" 2>/dev/null)
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    exit 0  # vorige run draait nog; stilletjes weggaan
  fi
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

HUB_DIR="/Volumes/WEBDL Extra/WEBDL/_4KDownloader/hub"
PY="/usr/bin/python3"
SCRIPT="/Users/jurgen/WEBDL/scripts/tg_import_folder.py"
LOG="/tmp/tg_auto_import.log"

[ -d "$HUB_DIR" ] || { echo "$(date) HUB_DIR niet beschikbaar: $HUB_DIR" >> "$LOG"; exit 0; }

# Helper: parse channel-id uit dirnaam (verwacht "*_<digits>" of "<digits>")
for d in "$HUB_DIR"/*/; do
  d="${d%/}"
  base=$(basename "$d")

  # Skip non-telegram dirs (alleen die met .json sidecars hebben tg-content)
  json_count=$(find "$d" -maxdepth 2 -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')
  [ "$json_count" -lt 1 ] && continue

  # Extract chat-id uit dirnaam: laatste numerieke component, of pure digits
  chat_id=""
  if [[ "$base" =~ _([0-9]+)$ ]]; then
    chat_id="${BASH_REMATCH[1]}"
  elif [[ "$base" =~ ^([0-9]+)$ ]]; then
    chat_id="$base"
  fi
  [ -z "$chat_id" ] && continue

  # Channel-naam: alles vóór laatste _<digits>
  channel_name="${base%_*}"
  [ "$channel_name" = "$base" ] && channel_name="$base"

  "$PY" "$SCRIPT" "$d" "$chat_id" "$channel_name" --apply >> "$LOG" 2>&1 || \
    echo "$(date) FAIL: $base" >> "$LOG"
done

echo "$(date) auto-import cycle done" >> "$LOG"
