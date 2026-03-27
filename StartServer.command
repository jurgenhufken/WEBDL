#!/bin/bash
 
 # Navigeer naar de directory waar dit script staat
 cd "$(dirname "$0")"
 
 # Toon een bericht
 echo "WEBDL Screen Recorder Server wordt gestart..."
 echo "Dit venster niet sluiten zolang de server draait!"
 echo "---------------------------------------------"
 echo ""
 
 echo "Controleren of poort 35729 al in gebruik is..."
 PORTPROC=$(lsof -ti:35729)
 if [ ! -z "$PORTPROC" ]; then
     echo "Proces(sen) gevonden op poort 35729: $PORTPROC"
     echo "Beëindigen van bestaande processen..."
     kill -TERM $PORTPROC 2>/dev/null || true
     for i in {1..40}; do
         sleep 0.3
         STILL=$(lsof -ti:35729)
         if [ -z "$STILL" ]; then
             break
         fi
     done
     STILL=$(lsof -ti:35729)
     if [ ! -z "$STILL" ]; then
         echo "Proces(sen) reageren niet, force kill..."
         kill -KILL $STILL 2>/dev/null || true
         sleep 1
     fi
     echo "Oude proces(sen) beëindigd"
 else
     echo "Poort 35729 is vrij"
 fi
 echo ""
 
 # Navigeer naar de applicatie directory
 cd screen-recorder-native
 
 # Controleer of npm beschikbaar is
 if ! command -v npm &> /dev/null; then
     echo "Error: npm kon niet worden gevonden. Controleer of Node.js is geïnstalleerd."
     echo "Druk op een toets om dit venster te sluiten"
     read -n 1
     exit 1
 fi
 
 # Installeer dependencies als dat nog niet is gebeurd
 if [ ! -d "node_modules" ]; then
     echo "Dependencies installeren..."
     npm install
     echo ""
 fi
 
 echo "Server starten..."
 : "${WEBDL_VIDEO_DEVICE:=auto}"
 : "${WEBDL_AUDIO_DEVICE:=auto}"
 : "${WEBDL_RECORDING_INPUT_PIXEL_FORMAT:=auto}"
 : "${WEBDL_YOUTUBE_DOWNLOAD_CONCURRENCY:=1}"
 : "${WEBDL_YOUTUBE_START_SPACING_MS:=3500}"
 : "${WEBDL_YOUTUBE_START_JITTER_MS:=1500}"
 : "${WEBDL_YTDLP_YOUTUBE_SLEEP_INTERVAL:=2}"
 : "${WEBDL_YTDLP_YOUTUBE_MAX_SLEEP_INTERVAL:=8}"
 : "${WEBDL_YTDLP_YOUTUBE_SLEEP_REQUESTS:=1.2}"
 : "${WEBDL_YTDLP_YOUTUBE_LIMIT_RATE:=2500K}"
 : "${WEBDL_YTDLP_CONCURRENT_FRAGMENTS:=1}"
 : "${WEBDL_YTDLP_FORMAT:=bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best}"
 : "${WEBDL_YTDLP_MERGE_OUTPUT_FORMAT:=mp4}"
 : "${WEBDL_YTDLP_USE_COOKIES_FOR_METADATA:=1}"
 export WEBDL_YTDLP_USE_COOKIES_FOR_METADATA
 : "${WEBDL_REDDIT_INDEX_MAX_ITEMS:=5000}"
 : "${WEBDL_REDDIT_INDEX_MAX_PAGES:=120}"
 : "${WEBDL_TDL_NAMESPACE:=webdl}"
 : "${WEBDL_TDL_THREADS:=4}"
 : "${WEBDL_TDL_CONCURRENCY:=2}"
 : "${WEBDL_STARTUP_REHYDRATE_MODE:=all}"
 : "${WEBDL_STARTUP_REHYDRATE_MAX_ROWS:=80}"
 : "${WEBDL_AUTO_IMPORT_ON_START:=1}"
 : "${WEBDL_AUTO_IMPORT_ROOT_DIR:=$HOME/Downloads/WEBDL/_Downloads}"
 : "${WEBDL_AUTO_IMPORT_MAX_DEPTH:=6}"
 : "${WEBDL_AUTO_IMPORT_POLL_MS:=0}"
 : "${WEBDL_AUTO_IMPORT_MIN_FILE_AGE_MS:=30000}"
 : "${WEBDL_AUTO_IMPORT_FLATTEN_TO_WEBDL:=0}"
 : "${WEBDL_AUTO_IMPORT_MOVE_SOURCE:=0}"
 : "${WEBDL_EXTRA_MEDIA_ROOTS:=$HOME/Downloads/WEBDL}"
 : "${WEBDL_DB_ENGINE:=postgres}"
 : "${DATABASE_URL:=postgresql://jurgen@localhost:5432/webdl}"
 : "${WEBDL_ADDON_AUTO_BUILD_ON_START:=0}"
 : "${WEBDL_ADDON_FORCE_REBUILD_ON_START:=1}"
 : "${WEBDL_STARTUP_REHYDRATE_DELAY_MS:=2500}"
 : "${WEBDL_VERBOSE_LOG:=1}"
 : "${WEBDL_ADDON_SOURCE_DIR:=$(cd ..; pwd)/firefox-native-controller}"
 : "${WEBDL_ADDON_PACKAGE_PATH:=$(cd ..; pwd)/firefox-debug-controller.xpi}"
 export WEBDL_ADDON_PACKAGE_PATH

 for v in /Volumes/*; do
     root="$v/WEBDL"
     if [ -d "$root" ]; then
         if [[ ";$WEBDL_EXTRA_MEDIA_ROOTS;" != *";$root;"* ]]; then
             WEBDL_EXTRA_MEDIA_ROOTS="$WEBDL_EXTRA_MEDIA_ROOTS;$root"
         fi
     fi
 done

 if [ ! -d "$WEBDL_AUTO_IMPORT_ROOT_DIR" ]; then
     for v in /Volumes/*; do
         root="$v/WEBDL"
         for cand in "$root"/_Downloads* "$root"/Downloads* "$root"/_downloads* "$root"/downloads*; do
             if [ -d "$cand" ]; then WEBDL_AUTO_IMPORT_ROOT_DIR="$cand"; break 2; fi
         done
     done
 fi
 if [ -z "$WEBDL_REDDIT_DL" ]; then
    if [ -x "$HOME/.local/bin/reddit-dl" ]; then
        WEBDL_REDDIT_DL="$HOME/.local/bin/reddit-dl"
    elif command -v reddit-dl >/dev/null 2>&1; then
        WEBDL_REDDIT_DL="$(command -v reddit-dl)"
    fi
 fi
 if [ -z "$WEBDL_REDDIT_AUTH_FILE" ]; then
   if [ -f "$HOME/.config/reddit-dl/auth.conf" ]; then
       WEBDL_REDDIT_AUTH_FILE="$HOME/.config/reddit-dl/auth.conf"
   elif [ -f "$HOME/reddit-dl/auth.conf" ]; then
       WEBDL_REDDIT_AUTH_FILE="$HOME/reddit-dl/auth.conf"
   fi
 fi
 WEBDL_REDDIT_AUTH_FILE="${WEBDL_REDDIT_AUTH_FILE:-}"
 if [ -z "$WEBDL_FFMPEG" ]; then
    if command -v ffmpeg >/dev/null 2>&1; then
        WEBDL_FFMPEG="$(command -v ffmpeg)"
        if command -v realpath >/dev/null 2>&1; then
            WEBDL_FFMPEG="$(realpath "$WEBDL_FFMPEG")"
        fi
    fi
 fi
 if [ -z "$WEBDL_OFSCRAPER" ] && [ -x "$HOME/.local/share/uv/tools/ofscraper/bin/ofscraper" ]; then
     WEBDL_OFSCRAPER="$HOME/.local/share/uv/tools/ofscraper/bin/ofscraper"
 fi
 if [ -z "$WEBDL_TDL" ]; then
   if [ -x "$HOME/go/bin/tdl" ]; then
       WEBDL_TDL="$HOME/go/bin/tdl"
   elif [ -x "$HOME/.local/bin/tdl" ]; then
       WEBDL_TDL="$HOME/.local/bin/tdl"
   elif command -v tdl >/dev/null 2>&1; then
       WEBDL_TDL="$(command -v tdl)"
   fi
 fi
 WEBDL_FINALCUT_OUTPUT=0
 export WEBDL_VIDEO_DEVICE
 export WEBDL_AUDIO_DEVICE
 export WEBDL_RECORDING_INPUT_PIXEL_FORMAT
 export WEBDL_YOUTUBE_DOWNLOAD_CONCURRENCY
 export WEBDL_YOUTUBE_START_SPACING_MS
 export WEBDL_YOUTUBE_START_JITTER_MS
 export WEBDL_YTDLP_YOUTUBE_SLEEP_INTERVAL
 export WEBDL_YTDLP_YOUTUBE_MAX_SLEEP_INTERVAL
 export WEBDL_YTDLP_YOUTUBE_SLEEP_REQUESTS
 export WEBDL_YTDLP_YOUTUBE_LIMIT_RATE
 export WEBDL_YTDLP_CONCURRENT_FRAGMENTS
 export WEBDL_YTDLP_FORMAT
 export WEBDL_YTDLP_MERGE_OUTPUT_FORMAT
 export WEBDL_YTDLP_USE_COOKIES_FOR_METADATA
 export WEBDL_REDDIT_INDEX_MAX_ITEMS
 export WEBDL_REDDIT_INDEX_MAX_PAGES
 export WEBDL_TDL_NAMESPACE
 export WEBDL_TDL_THREADS
 export WEBDL_TDL_CONCURRENCY
 export WEBDL_STARTUP_REHYDRATE_MODE
 export WEBDL_STARTUP_REHYDRATE_MAX_ROWS
 export WEBDL_AUTO_IMPORT_ON_START
 export WEBDL_AUTO_IMPORT_ROOT_DIR
 export WEBDL_AUTO_IMPORT_MAX_DEPTH
 export WEBDL_AUTO_IMPORT_POLL_MS
 export WEBDL_AUTO_IMPORT_MIN_FILE_AGE_MS
 export WEBDL_AUTO_IMPORT_FLATTEN_TO_WEBDL
 export WEBDL_AUTO_IMPORT_MOVE_SOURCE
 export WEBDL_EXTRA_MEDIA_ROOTS
 export WEBDL_DB_ENGINE
 export DATABASE_URL
 export WEBDL_ADDON_AUTO_BUILD_ON_START
 export WEBDL_ADDON_FORCE_REBUILD_ON_START
 export WEBDL_STARTUP_REHYDRATE_DELAY_MS
 export WEBDL_ADDON_SOURCE_DIR
 export WEBDL_REDDIT_DL
 export WEBDL_REDDIT_AUTH_FILE
 export WEBDL_FFMPEG
 export WEBDL_OFSCRAPER
 export WEBDL_TDL
 export WEBDL_FINALCUT_OUTPUT
 export WEBDL_VERBOSE_LOG
 export WEBDL_SCAN_EXISTING_TAGS=0
 
 (sleep 1; open "$HOME/Downloads/WEBDL") >/dev/null 2>&1 &
 (sleep 4; open "http://localhost:35729/addon/firefox-debug-controller.xpi?t=$(date +%s)") >/dev/null 2>&1 &
 SRC="src/simple-server.js.pg.refactored"
 DST="src/simple-server.pg.refactored.js"
 echo "Kopiëren van serverbron: $SRC -> $DST"
 if [ ! -f "$SRC" ]; then
     echo "FOUT: bronbestand ontbreekt: $SRC"
     echo "Druk op een toets om dit venster te sluiten"
     read -n 1
     exit 1
 fi
 for i in {1..12}; do
     SZ1=$(stat -f '%z' "$SRC" 2>/dev/null || echo '')
     sleep 0.05
     SZ2=$(stat -f '%z' "$SRC" 2>/dev/null || echo '')
     if [ ! -z "$SZ1" ] && [ "$SZ1" = "$SZ2" ]; then
         break
     fi
 done
 TMP="$DST.tmp.$$"
 cp -f "$SRC" "$TMP"
 SRC_SZ=$(stat -f '%z' "$SRC" 2>/dev/null || echo '')
 TMP_SZ=$(stat -f '%z' "$TMP" 2>/dev/null || echo '')
 if [ ! -z "$SRC_SZ" ] && [ "$SRC_SZ" = "$TMP_SZ" ]; then
     mv -f "$TMP" "$DST"
 else
     rm -f "$TMP" 2>/dev/null || true
     cp -f "$SRC" "$DST"
 fi
 if command -v shasum >/dev/null 2>&1; then
  SRC_MTIME=$(stat -f '%Sm' "$SRC" 2>/dev/null || echo '-')
  DST_MTIME=$(stat -f '%Sm' "$DST" 2>/dev/null || echo '-')
 DST_HASH=$(shasum -a 1 "$DST" 2>/dev/null | awk '{print $1}')
 echo "Bron mtime : $SRC_MTIME"
 echo "Runtime mtime: $DST_MTIME"
 echo "Runtime hash : $DST_HASH"
 fi
 echo "Server starten: node $DST"
 : "${WEBDL_DEV_AUTO_RESTART:=1}"
 if [ "${WEBDL_DEV_AUTO_RESTART}" = "1" ]; then
   echo "Dev auto-restart: aan (zet WEBDL_DEV_AUTO_RESTART=0 om uit te zetten)"
   PID=""
   trap 'echo "Stoppen..."; if [ ! -z "${PID}" ]; then kill -TERM "${PID}" 2>/dev/null || true; for i in {1..25}; do sleep 0.1; kill -0 "${PID}" 2>/dev/null || break; done; kill -KILL "${PID}" 2>/dev/null || true; wait "${PID}" 2>/dev/null || true; fi; exit 0' INT TERM
   LAST_SRC_MTIME=$(stat -f '%m' "$SRC" 2>/dev/null || echo '')
   while true; do
     RESTART_REQUESTED=0
     for i in {1..12}; do
       SZ1=$(stat -f '%z' "$SRC" 2>/dev/null || echo '')
       sleep 0.05
       SZ2=$(stat -f '%z' "$SRC" 2>/dev/null || echo '')
       if [ ! -z "$SZ1" ] && [ "$SZ1" = "$SZ2" ]; then
         break
       fi
     done
     TMP="$DST.tmp.$$"
     cp -f "$SRC" "$TMP"
     SRC_SZ=$(stat -f '%z' "$SRC" 2>/dev/null || echo '')
     TMP_SZ=$(stat -f '%z' "$TMP" 2>/dev/null || echo '')
     if [ ! -z "$SRC_SZ" ] && [ "$SRC_SZ" = "$TMP_SZ" ]; then
       mv -f "$TMP" "$DST"
     else
       rm -f "$TMP" 2>/dev/null || true
       cp -f "$SRC" "$DST"
     fi
     node "$DST" &
     PID=$!
     while kill -0 "$PID" 2>/dev/null; do
       sleep 0.6
       MT=$(stat -f '%m' "$SRC" 2>/dev/null || echo '')
       if [ "${MT}" != "${LAST_SRC_MTIME}" ]; then
         LAST_SRC_MTIME="${MT}"
         echo "Wijziging gedetecteerd. Server herstart..."
         RESTART_REQUESTED=1
         kill -TERM "$PID" 2>/dev/null || true
         for i in {1..40}; do
           sleep 0.2
           kill -0 "$PID" 2>/dev/null || break
         done
         kill -KILL "$PID" 2>/dev/null || true
         break
       fi
     done
     wait "$PID" 2>/dev/null
     EXITCODE=$?
     if [ "${RESTART_REQUESTED}" = "1" ]; then
       continue
     fi
     if [ "${EXITCODE}" -ne 0 ]; then
       echo "Server gestopt (exit ${EXITCODE}). Bewerk + save het bronbestand om opnieuw te starten, of druk op Ctrl+C."
       while true; do
         sleep 0.8
         MT=$(stat -f '%m' "$SRC" 2>/dev/null || echo '')
         if [ "${MT}" != "${LAST_SRC_MTIME}" ]; then
           LAST_SRC_MTIME="${MT}"
           echo "Wijziging gedetecteerd. Opnieuw starten..."
           break
         fi
       done
     fi
   done
 else
   node "$DST"
 fi

 # Wacht op een toets als het script eindigt (zodat het venster open blijft bij fouten)
 echo ""
 echo "Server gestopt. Druk op een toets om dit venster te sluiten"
 read -n 1
