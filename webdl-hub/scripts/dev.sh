#!/usr/bin/env bash
# scripts/dev.sh — start de hub in watch-mode.
set -euo pipefail
cd "$(dirname "$0")/.."
node --watch src/server.js
