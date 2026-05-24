#!/bin/bash
# Phase 1: Scrape all K2S links from viper threads (fast, no downloads)
# Phase 2: Submit all links to download server
COOKIES=$(cat /tmp/viper_cookies.txt)
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0"
LINKS_FILE="/tmp/viper_all_k2s_links.txt"
> "$LINKS_FILE"

echo "=== PHASE 1: Collecting K2S links ==="

scrape_thread() {
  local BASE_URL="$1"
  local PAGES="$2"
  local TITLE="$3"
  local BEFORE=$(wc -l < "$LINKS_FILE" | tr -d ' ')
  
  echo "📄 $TITLE ($PAGES pages)"
  
  for page in $(seq 1 $PAGES); do
    local URL="${BASE_URL}/page${page}"
    if [ "$page" -eq 1 ]; then URL="$BASE_URL"; fi
    
    curl -sL -b "$COOKIES" -A "$UA" --max-time 10 "$URL" 2>/dev/null \
      | grep -oiE 'https?://(k2s\.cc|keep2share\.cc|keep2share\.com|filefox\.cc|fboom\.me)/file/[a-zA-Z0-9]+' \
      | tr 'A-Z' 'a-z' >> "$LINKS_FILE"
    
    if [ $((page % 10)) -eq 0 ] || [ "$page" -eq "$PAGES" ]; then
      local NOW=$(sort -u "$LINKS_FILE" | wc -l | tr -d ' ')
      echo "   p$page/$PAGES links=$NOW"
    fi
    sleep 0.2
  done
  
  local AFTER=$(sort -u "$LINKS_FILE" | wc -l | tr -d ' ')
  echo "   Thread total: $((AFTER - BEFORE)) unique links"
}

scrape_thread "https://vipergirls.to/threads/7410887-nude-beach-collection-natural-Voyeur-txt" 330 "nude beach collection natural Voyeur"
scrape_thread "https://vipergirls.to/threads/7824441-Beautiful-Girls-on-the-Beach-Hidden-video-Nudists" 547 "Beautiful Girls on the Beach Hidden video Nudists"

# Dedup
sort -u "$LINKS_FILE" -o "$LINKS_FILE"
TOTAL=$(wc -l < "$LINKS_FILE" | tr -d ' ')
echo ""
echo "=== PHASE 2: Submitting $TOTAL unique K2S links ==="

NEW=0; DUP=0; N=0
while IFS= read -r link; do
  N=$((N + 1))
  RESULT=$(curl -s --max-time 30 -X POST "http://localhost:35729/download" -H "Content-Type: application/json" \
    -d "{\"url\":\"$link\",\"metadata\":{\"source\":\"viper-scrape\"}}")
  IS_DUP=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('duplicate',False))" 2>/dev/null)
  if [ "$IS_DUP" = "True" ]; then DUP=$((DUP + 1)); else NEW=$((NEW + 1)); fi
  if [ $((N % 10)) -eq 0 ]; then echo "   $N/$TOTAL | New: $NEW | Dup: $DUP"; fi
done < "$LINKS_FILE"

echo ""
echo "✅ Done! Total: $TOTAL | New: $NEW | Dup: $DUP"
