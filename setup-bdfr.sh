#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${PYTHON_BIN:-python3}"

echo "BDFR installeren/updaten voor WEBDL..."
"$PYTHON_BIN" -m pip install --user --upgrade 'bdfr==2.6.2' 'praw<7.8'

BDfr_PATH="$("$PYTHON_BIN" - <<'PY'
import os
import sys
major_minor = f"{sys.version_info.major}.{sys.version_info.minor}"
candidates = [
    os.path.expanduser(f"~/Library/Python/{major_minor}/bin/bdfr"),
    os.path.expanduser("~/Library/Python/3.9/bin/bdfr"),
    os.path.expanduser("~/.local/bin/bdfr"),
]
for path in candidates:
    if os.path.exists(path):
        print(path)
        break
PY
)"

if [ -n "${BDfr_PATH:-}" ]; then
  echo "BDFR gevonden: $BDfr_PATH"
  "$BDfr_PATH" --version || true
else
  echo "BDFR is geïnstalleerd, maar het executable-pad is niet gevonden."
fi
