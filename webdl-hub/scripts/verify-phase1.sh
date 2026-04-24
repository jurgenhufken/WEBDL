#!/usr/bin/env bash
# scripts/verify-phase1.sh — draait alle Fase-1 checks achter elkaar.
# Afsluiten op eerste fout zodat je meteen ziet waar het stukloopt.
set -e

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo '⇒ .env ontbreekt — kopiëren vanuit .env.example'
  cp .env.example .env
fi

echo
echo '════════ 1/4  dependencies ════════'
npm install --silent

echo
echo '════════ 2/4  migrate (schema webdl) ════════'
npm run migrate

echo
echo '════════ 3/4  alle tests (incl. DB) ════════'
npm test

echo
echo '════════ 4/4  yt-dlp aanwezig? ════════'
if command -v yt-dlp >/dev/null; then
  echo "yt-dlp: $(yt-dlp --version)"
else
  echo 'let op: yt-dlp niet in PATH — `brew install yt-dlp` voordat je een echte download doet'
fi

echo
echo '✓ Fase 1 verificatie klaar. Start nu:  npm run dev'
echo '  smoke-test:'
echo '  curl -sXPOST http://localhost:35730/api/jobs -H "content-type: application/json" \\'
echo '       -d '"'"'{"url":"https://www.youtube.com/watch?v=aqz-KE-bpKQ"}'"'"
