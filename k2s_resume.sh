#!/bin/bash
# Wait until 02:00 then resume K2S downloads
TARGET="02:00"
echo "Wachten tot $TARGET voor K2S resume..."
while true; do
  NOW=$(date +%H:%M)
  if [[ "$NOW" > "02:00" ]] || [[ "$NOW" == "02:00" ]]; then
    echo "$(date) - 02:00 bereikt, K2S hervatten..."
    
    # Test API first
    RESULT=$(curl -s -m 10 'https://keep2share.cc/api/v2/login' \
      -H 'Content-Type: application/json' \
      -d '{"username": "u194875777", "password": "Datisgeheim@01"}' | python3 -c "
import sys,json
d=json.loads(sys.stdin.read())
print(d.get('status','error'))
" 2>/dev/null)
    
    if [ "$RESULT" = "success" ]; then
      echo "✅ K2S API werkt! Downloads hervatten..."
      psql -d webdl -c "
      UPDATE downloads SET status = 'pending', error = NULL, progress = 0
      WHERE (url LIKE '%k2s.cc%' OR url LIKE '%keep2share%')
      AND status = 'cancelled'
      AND error LIKE '%Wacht op K2S reset%';"
      echo "✅ Done!"
    else
      echo "❌ K2S nog geblokkeerd: $RESULT"
      echo "Retry over 5 minuten..."
      sleep 300
      continue
    fi
    break
  fi
  sleep 30
done
