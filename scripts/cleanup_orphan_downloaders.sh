#!/usr/bin/env bash
# Detecteer en (optioneel) beëindig orphan download-processen.
#
# Achtergrond: wanneer webdl-hub crasht of geforceerd stopt, kunnen
# kind-processen (Python tdl/yt-dlp/gallery-dl etc.) blijven draaien
# als orphan (PPID=1, geadopteerd door launchd). Zij voltooien hun
# download wel, maar:
#   - hub kent ze niet meer en kan ze niet stoppen
#   - hub-job-status loopt uit de pas (markered 'done' terwijl child draait)
#   - bij re-queue van dezelfde URL worden dingen dubbel gedownload
#
# Gebruik:
#   bash cleanup_orphan_downloaders.sh              # toon orphans, kill NIETS
#   bash cleanup_orphan_downloaders.sh --kill       # SIGTERM aan elke orphan
#   bash cleanup_orphan_downloaders.sh --kill --force  # SIGKILL na 5s
#
# Geen-orphans-output is gewoon "0 orphan(s) gevonden" en exit 0.

set -u

KILL=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --kill) KILL=1 ;;
    --force) FORCE=1 ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

# Patroon waarop we orphan-processes herkennen.
# Voeg toe per nieuwe adapter.
PATTERNS=(
  'telegram-channel-download.py'
  'yt-dlp '
  'gallery-dl '
  'instaloader '
  'ofscraper '
  'bdfr '
)

found_pids=()
for pattern in "${PATTERNS[@]}"; do
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    pid=$(echo "$line" | awk '{print $2}')
    ppid=$(echo "$line" | awk '{print $3}')
    # Alleen orphans: PPID = 1 (launchd op macOS)
    if [ "$ppid" = "1" ]; then
      found_pids+=("$pid")
      echo "ORPHAN: pid=$pid ppid=$ppid pattern='$pattern'"
      echo "        command: $(ps -p "$pid" -o command= 2>/dev/null | head -c 200)"
    fi
  done < <(ps -ef | grep -F "$pattern" | grep -v grep | grep -v "$0")
done

count=${#found_pids[@]}
echo ""
echo "${count} orphan(s) gevonden."

if [ "$count" -eq 0 ]; then
  exit 0
fi

if [ "$KILL" -eq 0 ]; then
  echo ""
  echo "Voeg --kill toe om SIGTERM te sturen, of --kill --force voor SIGKILL na 5s."
  exit 0
fi

echo ""
echo "Sturen SIGTERM..."
for pid in "${found_pids[@]}"; do
  kill -TERM "$pid" 2>/dev/null && echo "  TERM $pid OK" || echo "  TERM $pid FAIL"
done

if [ "$FORCE" -eq 1 ]; then
  echo "Wachten 5s op vrijwillige exit..."
  sleep 5
  still_alive=()
  for pid in "${found_pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      still_alive+=("$pid")
    fi
  done
  if [ "${#still_alive[@]}" -gt 0 ]; then
    echo "Nog levend: ${still_alive[*]}. SIGKILL..."
    for pid in "${still_alive[@]}"; do
      kill -KILL "$pid" 2>/dev/null && echo "  KILL $pid OK" || echo "  KILL $pid FAIL"
    done
  else
    echo "Allemaal vrijwillig afgesloten."
  fi
fi
