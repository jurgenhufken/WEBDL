#!/bin/bash

# Navigeer naar de directory waar dit script staat
cd "$(dirname "$0")"

# Toon een bericht
echo "Simple Screen Recorder Server wordt gestart..."
echo "Dit venster niet sluiten zolang de server draait!"
echo "---------------------------------------------"
echo ""

# Controleer of er al een proces is dat poort 35729 gebruikt en beëindig het
echo "Controleren of poort 35729 al in gebruik is..."
PORTPROC=$(lsof -ti:35729)
if [ ! -z "$PORTPROC" ]; then
    echo "Proces(sen) gevonden op poort 35729: $PORTPROC"
    echo "Beëindigen van bestaande processen..."
    kill -9 $PORTPROC
    echo "Oude proces(sen) beëindigd"
    # Even wachten om zeker te zijn dat de poort vrijgegeven is
    sleep 2
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
# Start de eenvoudige server versie zonder Socket.IO
export WEBDL_VIDEO_DEVICE=3
export WEBDL_AUDIO_DEVICE=1
if [ -z "$WEBDL_YOUTUBE_DOWNLOAD_CONCURRENCY" ]; then
    export WEBDL_YOUTUBE_DOWNLOAD_CONCURRENCY=1
fi
if [ -z "$WEBDL_YOUTUBE_START_SPACING_MS" ]; then
    export WEBDL_YOUTUBE_START_SPACING_MS=3500
fi
if [ -z "$WEBDL_YOUTUBE_START_JITTER_MS" ]; then
    export WEBDL_YOUTUBE_START_JITTER_MS=1500
fi
if [ -z "$WEBDL_YTDLP_YOUTUBE_SLEEP_INTERVAL" ]; then
    export WEBDL_YTDLP_YOUTUBE_SLEEP_INTERVAL=2
fi
if [ -z "$WEBDL_YTDLP_YOUTUBE_MAX_SLEEP_INTERVAL" ]; then
    export WEBDL_YTDLP_YOUTUBE_MAX_SLEEP_INTERVAL=8
fi
if [ -z "$WEBDL_YTDLP_YOUTUBE_SLEEP_REQUESTS" ]; then
    export WEBDL_YTDLP_YOUTUBE_SLEEP_REQUESTS=1.2
fi
if [ -z "$WEBDL_YTDLP_YOUTUBE_LIMIT_RATE" ]; then
    export WEBDL_YTDLP_YOUTUBE_LIMIT_RATE=2500K
fi
if [ -z "$WEBDL_YTDLP_CONCURRENT_FRAGMENTS" ]; then
    export WEBDL_YTDLP_CONCURRENT_FRAGMENTS=1
fi
if [ -z "$WEBDL_REDDIT_INDEX_MAX_ITEMS" ]; then
    export WEBDL_REDDIT_INDEX_MAX_ITEMS=5000
fi
if [ -z "$WEBDL_REDDIT_INDEX_MAX_PAGES" ]; then
    export WEBDL_REDDIT_INDEX_MAX_PAGES=120
fi
if [ -z "$WEBDL_AUTO_IMPORT_ON_START" ]; then
    export WEBDL_AUTO_IMPORT_ON_START=0
fi
if [ -z "$WEBDL_AUTO_IMPORT_ROOT_DIR" ]; then
    export WEBDL_AUTO_IMPORT_ROOT_DIR="$HOME/Downloads/Video DownloadHelper"
fi
if [ -z "$WEBDL_AUTO_IMPORT_MAX_DEPTH" ]; then
    export WEBDL_AUTO_IMPORT_MAX_DEPTH=3
fi
if [ -z "$WEBDL_ADDON_AUTO_BUILD_ON_START" ]; then
    export WEBDL_ADDON_AUTO_BUILD_ON_START=0
fi
if [ -z "$WEBDL_STARTUP_REHYDRATE_DELAY_MS" ]; then
    export WEBDL_STARTUP_REHYDRATE_DELAY_MS=2500
fi
if [ -z "$WEBDL_REDDIT_DL" ]; then
    if [ -x "$HOME/.local/bin/reddit-dl" ]; then
        export WEBDL_REDDIT_DL="$HOME/.local/bin/reddit-dl"
    elif command -v reddit-dl >/dev/null 2>&1; then
        export WEBDL_REDDIT_DL="$(command -v reddit-dl)"
    fi
fi
if [ -z "$WEBDL_REDDIT_AUTH_FILE" ]; then
    if [ -f "$HOME/.config/reddit-dl/auth.conf" ]; then
        export WEBDL_REDDIT_AUTH_FILE="$HOME/.config/reddit-dl/auth.conf"
    elif [ -f "$HOME/reddit-dl/auth.conf" ]; then
        export WEBDL_REDDIT_AUTH_FILE="$HOME/reddit-dl/auth.conf"
    fi
fi
WEBDL_REDDIT_AUTH_FILE="${WEBDL_REDDIT_AUTH_FILE:-}"
if [ -z "$WEBDL_OFSCRAPER" ] && [ -x "$HOME/.local/share/uv/tools/ofscraper/bin/ofscraper" ]; then
    export WEBDL_OFSCRAPER="$HOME/.local/share/uv/tools/ofscraper/bin/ofscraper"
fi
node src/simple-server.js

# Wacht op een toets als het script eindigt (zodat het venster open blijft bij fouten)
echo ""
echo "Server gestopt. Druk op een toets om dit venster te sluiten"
read -n 1
