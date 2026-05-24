#!/bin/bash
# Scrape all K2S links from Beachsome thread (24 pages)
THREAD_URL="https://vipergirls.to/threads/15428279-Beachsome-Voyeur-Topless-Nude-Beach-Nudism"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0"
OUT="/tmp/beachsome-k2s-links.txt"
> "$OUT"

for page in $(seq 1 24); do
  URL="${THREAD_URL}/page-${page}"
  echo "Scraping page $page/24..."
  curl -sL -A "$UA" "$URL" | grep -oE 'https?://k2s\.cc/file/[a-zA-Z0-9]+' >> "$OUT"
  sleep 1
done

sort -u "$OUT" -o "$OUT"
echo ""
echo "Done! Total unique K2S links: $(wc -l < "$OUT")"
echo "Saved to: $OUT"
