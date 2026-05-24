#!/usr/bin/env bash
# ============================================================
# Antigravity Chat & Workspace Export
# ------------------------------------------------------------
# Doel: kopieer de chat-/workspace-/log-data van Antigravity
#       naar /Users/jurgen/WEBDL/.antigravity-export/ zodat
#       Claude (Cowork) er bij kan voor project-context.
#
# Veilig: leest alleen, schrijft alleen naar WEBDL. Geen
#         wijzigingen aan Antigravity zelf.
# ============================================================

set -euo pipefail

SRC="$HOME/Library/Application Support/Antigravity"
DST="$HOME/WEBDL/.antigravity-export"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$DST/$STAMP"

if [[ ! -d "$SRC" ]]; then
  echo "ERROR: Antigravity-folder niet gevonden op: $SRC"
  exit 1
fi

mkdir -p "$OUT"/{workspaceStorage,globalStorage,logs,summary}

echo "==> Workspace-storage (state.vscdb's) kopiëren..."
if [[ -d "$SRC/User/workspaceStorage" ]]; then
  # alleen de kleine state-bestanden, geen caches
  rsync -a --include='*/' \
           --include='workspace.json' \
           --include='state.vscdb' \
           --include='state.vscdb.backup' \
           --exclude='*' \
           "$SRC/User/workspaceStorage/" "$OUT/workspaceStorage/"
fi

echo "==> Global-storage (chat-extension data) kopiëren..."
if [[ -d "$SRC/User/globalStorage" ]]; then
  # We kopiëren GEEN raw state.vscdb's meer — die bevatten OAuth-tokens in binary.
  # Alleen de gefilterde TSV-dumps onderaan blijven over, en die strippen we hierna.
  TMPDB="$(mktemp -d)"
  rsync -a \
    --include='state.vscdb' \
    --exclude='*' \
    "$SRC/User/globalStorage/" "$TMPDB/" 2>/dev/null || true
  # Plaats de tijdelijke DB op een veilige plek voor het sqlite3-stuk later
  mkdir -p "$OUT/globalStorage"
  if [[ -f "$TMPDB/state.vscdb" ]]; then
    cp "$TMPDB/state.vscdb" "$OUT/globalStorage/state.vscdb.tmp"
  fi
  rm -rf "$TMPDB"
fi

echo "==> Interactive editor logs kopiëren (laatste 20 sessies)..."
if [[ -d "$SRC/logs" ]]; then
  # neem de 20 nieuwste log-sessies mee
  ls -1t "$SRC/logs" | head -20 | while read -r session; do
    mkdir -p "$OUT/logs/$session"
    cp -R "$SRC/logs/$session/." "$OUT/logs/$session/" 2>/dev/null || true
  done
fi

# === Brain-folder (de echte chat trajectories) ===
BRAIN="$HOME/.gemini/antigravity/brain"
if [[ -d "$BRAIN" ]]; then
  echo "==> Brain-folder kopiëren (alle .md/.json/.txt/.log, geen binaries/media)..."
  mkdir -p "$OUT/brain"
  # álles wat tekst is meenemen, alleen binaries en tempmedia overslaan
  rsync -a \
    --include='*/' \
    --include='*.md' \
    --include='*.json' \
    --include='*.txt' \
    --include='*.log' \
    --include='*.jsonl' \
    --include='*.yaml' \
    --include='*.yml' \
    --exclude='.tempmediaStorage/**' \
    --exclude='tempmediaStorage/**' \
    --exclude='*.png' \
    --exclude='*.jpg' \
    --exclude='*.jpeg' \
    --exclude='*.gif' \
    --exclude='*.webp' \
    --exclude='*.mp4' \
    --exclude='*.mov' \
    --exclude='*.webm' \
    --exclude='*.bin' \
    --exclude='*.zip' \
    --exclude='*' \
    "$BRAIN/" "$OUT/brain/" 2>/dev/null || true

  # WEBDL-filter: maak een symlink-overzicht naar de WEBDL-relevante trajectories
  mkdir -p "$OUT/summary/webdl-trajectories"
  for d in "$OUT"/brain/*/; do
    uuid="$(basename "$d")"
    # check of er een WEBDL-pad in voorkomt
    if grep -r -l -F "Users/jurgen/WEBDL" "$d" >/dev/null 2>&1; then
      ln -sf "../../brain/$uuid" "$OUT/summary/webdl-trajectories/$uuid"
    fi
  done
fi

echo "==> Inventarisatie maken..."
{
  echo "# Antigravity Export — $STAMP"
  echo ""
  echo "## Bron: $SRC"
  echo ""
  echo "## Workspaces"
  for ws in "$OUT"/workspaceStorage/*/workspace.json; do
    [[ -f "$ws" ]] || continue
    echo "- $(dirname "$ws" | xargs basename): $(cat "$ws" | tr -d '\n' | cut -c1-300)"
  done
  echo ""
  echo "## State databases gevonden"
  find "$OUT/workspaceStorage" -name 'state.vscdb' -print 2>/dev/null
  echo ""
  echo "## Global-storage entries"
  ls -1 "$OUT/globalStorage" 2>/dev/null || echo "(leeg)"
  echo ""
  echo "## Log-sessies"
  ls -1 "$OUT/logs" 2>/dev/null | head -50
} > "$OUT/summary/INVENTORY.md"

echo ""
echo "==> Probeer chat-tabellen uit state.vscdb te dumpen..."
if command -v sqlite3 >/dev/null 2>&1; then
  # Pak ook de tijdelijke global-DB mee (.tmp suffix)
  DBLIST=$(find "$OUT/workspaceStorage" -name 'state.vscdb' 2>/dev/null)
  if [[ -f "$OUT/globalStorage/state.vscdb.tmp" ]]; then
    DBLIST="$DBLIST $OUT/globalStorage/state.vscdb.tmp"
  fi

  for db in $DBLIST; do
    name="$(echo "$db" | sed "s|$OUT/||; s|/|__|g; s|\.tmp$||")"
    out_dir="$OUT/summary/dumps"
    mkdir -p "$out_dir"

    sqlite3 "$db" ".tables" > "$out_dir/${name}.tables.txt" 2>/dev/null || true
    sqlite3 "$db" "SELECT key FROM ItemTable;" 2>/dev/null \
        > "$out_dir/${name}.keys.txt" || true
    sqlite3 "$db" "SELECT key, value FROM ItemTable WHERE \
        key LIKE '%chat%' OR key LIKE '%gemini%' OR \
        key LIKE '%cascade%' OR key LIKE '%conversation%' OR \
        key LIKE '%antigravity%' OR key LIKE '%interactive%';" \
        2>/dev/null > "$out_dir/${name}.chat-like.tsv" || true
  done

  # Tijdelijke global-DB direct weggooien — token zit hier in binary
  rm -f "$OUT/globalStorage/state.vscdb.tmp"
fi

echo ""
echo "==> Auth/token-strings strippen uit alle dumps..."
find "$OUT" -type f \( -name '*.tsv' -o -name '*.txt' -o -name '*.json' -o -name '*.md' \) -print0 | \
while IFS= read -r -d '' f; do
  python3 - "$f" <<'PY'
import sys, re
p = sys.argv[1]
try:
    with open(p, 'r', errors='replace') as fh: content = fh.read()
except Exception: sys.exit(0)
orig = content
content = re.sub(r'("(?:apiKey|access_token|refresh_token|oauthToken|id_token|bearer)"\s*:\s*")([^"]+)(")',
                 r'\1[REDACTED]\3', content, flags=re.IGNORECASE)
content = re.sub(r'ya29\.[A-Za-z0-9_\-]+', '[REDACTED-GOOGLE-TOKEN]', content)
content = re.sub(r'1//0[A-Za-z0-9_\-]{20,}', '[REDACTED-REFRESH-TOKEN]', content)
if content != orig:
    with open(p, 'w') as fh: fh.write(content)
PY
done

# zet ook permissions goed zodat Claude/Cowork ze kan lezen
chmod -R u+rwX "$DST" 2>/dev/null || true

echo ""
echo "==================================================="
echo "  KLAAR"
echo "  Export staat in: $OUT"
echo "  Inventaris:      $OUT/summary/INVENTORY.md"
echo "==================================================="
