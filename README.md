# WEBDL — Media Downloader & Recorder

**Firefox Add-on + Lokale Node.js Server**

WEBDL is een lokale media downloader en screen recorder die je bedient vanuit Firefox. De Firefox add-on toont een toolbar met knoppen (download / screenshot / opnemen / batch) en communiceert met een lokale Node.js server op `localhost:35729`.

## 🎯 Concept & Doel

WEBDL verzamelt media van diverse platforms in één centrale plek:

- **Downloads**: YouTube, OnlyFans, Reddit, Instagram, TikTok, forums, en meer
- **Screen Recording**: Direct opnemen van je scherm (macOS avfoundation)
- **Screenshots**: Snelle captures van webpagina's
- **Gallery/Viewer**: Doorzoekbare interface voor al je verzamelde media
- **Batch Processing**: Meerdere URLs in één keer downloaden

De server regelt:

- **Downloads** via:
  - `yt-dlp` (YouTube e.d.)
  - `gallery-dl` (diverse sites)
  - `ofscraper` (OnlyFans)
  - `reddit-dl` (Reddit)
  - `instaloader` (Instagram)
- **Screen recording** via `ffmpeg` (`avfoundation` op macOS)
- **Screenshots** (upload vanuit de add-on of via macOS `screencapture` fallback)
- **Opslag + historie** in PostgreSQL/SQLite (`webdl.db`)

## Snelstart

1. Start de server:
   - Dubbelklik `StartServer.command`
2. Open:
   - `http://localhost:35729/status` (check of server draait)
   - `http://localhost:35729/addon` (download de add-on `.xpi`)
3. Installeer de add-on in Firefox:
   - `about:addons`
   - tandwiel
   - **Install Add-on From File…**
   - kies de gedownloade `.xpi`

## 🏗️ Architectuur

```text
Firefox tab
  content script (firefox-native-controller/content/debug-toolbar.js)
    |  HTTP fetch (localhost)
    v
WEBDL Server (Node.js) — localhost:35729
  ├─ Express HTTP API
  │   ├─ /download — Enqueue downloads
  │   ├─ /download/batch — Batch downloads
  │   ├─ /start-recording — Screen recording
  │   ├─ /screenshot — Save screenshots
  │   ├─ /dashboard — Web UI
  │   └─ /viewer — Media viewer
  ├─ Download Queue Manager (Heavy/Light lanes)
  ├─ Media Resolution Engine
  │   ├─ HTML wrapper → direct URL resolving
  │   ├─ Thumbnail → full-size upgrading
  │   └─ Attachment ID matching (FootFetishForum)
  └─ Storage
      ├─ PostgreSQL/SQLite: webdl.db
      └─ Files: ~/Downloads/WEBDL/<platform>/<channel>/...
```

## Repository indeling

| Pad | Doel |
|------|------|
| `StartServer.command` | Start server + open `/addon` pagina |
| `firefox-native-controller/` | Firefox add-on (toolbar UI) |
| `screen-recorder-native/` | Node.js server + database + ffmpeg |
| `screen-recorder-native/src/simple-server.pg.refactored.js` | Main server (runtime) |
| `screen-recorder-native/src/simple-server.js.pg.refactored` | Source server (master) |
| `screen-recorder-native/src/sync-onlyfans-auth-from-firefox.py` | **OnlyFans auth helper** |
| `STATUS.md` | Huidige ontwikkelingsstatus & TODO |

## Opslag & mappenstructuur

De server schrijft alles naar `BASE_DIR`:

- **Basis**: `~/Downloads/WEBDL`
- **Downloads/recordings/screenshots**: per platform/kanaal/titel in submappen
- **Logs**:
  - `recording_... .log` (ffmpeg opname log)
  - `_ofscraper_<id>.log` (OnlyFans ofscraper gecombineerde log)

Let op:

- `BASE_DIR` staat momenteel vast in de servercode. Als je opslag op een externe schijf wilt, gebruik een **symlink** van `~/Downloads/WEBDL` naar je externe locatie.

## Database

**Engine**: PostgreSQL (productie) / SQLite (legacy)

Database file: `~/Downloads/WEBDL/webdl.db` (SQLite) of PostgreSQL via `DATABASE_URL`

Tabellen:
- **`downloads`** — queue/status/progress/metadata van downloads
- **`screenshots`** — opgeslagen screenshots
- **`download_files`** — individuele bestanden per download
- **`tags`** + **`media_tags`** — tagging systeem

De DB draait in `WAL` mode (SQLite) of transactions (PostgreSQL).

## HTTP API (server endpoints)

Belangrijkste endpoints:

- **`GET /status`**
  - Server health + recording status + queue info + huidige device settings.
- **`GET /addon`**
  - Redirect naar de meest recente `.xpi`.
- **`GET /addon/firefox-debug-controller.xpi`**
  - Bouwt (indien nodig) een `.xpi` uit `WEBDL_ADDON_SOURCE_DIR` en serveert die.
- **`GET /avfoundation-devices`**
  - Geeft de output van `ffmpeg -f avfoundation -list_devices true -i ""` terug.

- **`POST /download`**
  - Start 1 download (yt-dlp / gallery-dl / ofscraper afhankelijk van platform).
- **`POST /download/batch`**
  - Meerdere URLs in 1 keer.
- **`POST /download/:id/cancel`**
  - Annuleer download.

- **`POST /start-recording`**
  - Start ffmpeg screen recording (mp4).
- **`POST /recording/crop-update`**
  - Alleen voor lock-mode opname: crop positie updates.
- **`POST /stop-recording`**
  - Stopt opname en start (optioneel) lock-mode postprocess.

- **`POST /screenshot`**
  - Slaat screenshot op (upload of base64).

- **`GET /dashboard`**
  - Ingebouwde web UI met downloads/screenshot historie.
- **`GET /viewer`**
  - Ingebouwde viewer voor recente media.

## Screen recording (macOS / ffmpeg / avfoundation)

WEBDL gebruikt `ffmpeg` met input `avfoundation`.

### Device selectie

- Video device index: `WEBDL_VIDEO_DEVICE`
- Audio device index: `WEBDL_AUDIO_DEVICE`

Je kunt beschikbare devices opvragen via:

- `http://localhost:35729/avfoundation-devices`

### Bestanden

- Recordings worden opgeslagen als **`.mp4`**.
- Bij lock-mode wordt eerst een `*_raw.mp4` opgenomen en daarna een gecropte final `.mp4` gemaakt.
- Bij elke opname schrijft WEBDL een `.log` met de volledige ffmpeg commandline.

### Zwart beeld (black video) troubleshooting

Als de opname “zwart” is (vaak alleen het videovak, terwijl de rest van je scherm wel zichtbaar is):

- Zet in Firefox uit:
  - **Use recommended performance settings**
  - **Use hardware acceleration when available**
  - herstart Firefox volledig

Daarna kun je (experimenteel) een andere input pixel format proberen.
Let op: niet elke avfoundation input ondersteunt `bgra`.

- Default is `WEBDL_RECORDING_INPUT_PIXEL_FORMAT=nv12`
- Als je `bgra` wilt proberen, zet expliciet:
  - `WEBDL_RECORDING_INPUT_PIXEL_FORMAT=bgra`

## Downloads

WEBDL zet downloads in een queue met lanes:

- **Heavy lane**: o.a. OnlyFans (ofscraper)
- **Light lane**: de meeste reguliere downloads

De server bepaalt lane en concurrency.

## Media Resolution Engine (Belangrijk!)

De server heeft een **wrapper resolution engine** voor sites die thumbnails/low-res previews tonen:

**Voorbeeld: FootFetishForum attachment pagina**
```
Input:  https://footfetishforum.com/attachments/img_1234.jpg.56789/
Output: https://.../data/attachments/56789/.../full_image.jpg
```

**Hoe het werkt:**
1. HTML pagina wordt opgehaald
2. Directe media URLs worden geëxtraheerd
3. **Attachment ID matching** — URLs met matching ID krijgen hogere score
4. Thumbnails worden geupgrade naar full-size
5. Hoogste score wint → download

**Ondersteunde sites:**
- FootFetishForum attachments
- AmateurVoyeurForum attachments  
- Pixhost.to thumbnails → full images
- Imgur/RedGifs via gallery-dl
- Externe hosts (jpg.pet, pixeldrain, etc.)

**Batch Preview:**
De add-on detecteert automatisch attachment links en toont ze bovenaan in de preview modal.

## OnlyFans (ofscraper)

OnlyFans downloads lopen via `ofscraper` en gebruiken een config map:

- Config dir: `~/.config/ofscraper` (default)
- Auth: `~/.config/ofscraper/auth.json` (moet valide JSON zijn)

### Auth Sync Helper (NIEUW)

Probleem: `auth.json` kan verouderde cookies bevatten → "Wrong user" error.

Oplossing: Python helper syncs live Firefox cookies:

```bash
python3 screen-recorder-native/src/sync-onlyfans-auth-from-firefox.py
```

Wat het doet:
1. Leest `cookies.sqlite` uit Firefox profiel
2. Haalt `sess`, `auth_id`, `csrf`, `st`, `c`, `fp` op
3. Update `~/.config/ofscraper/auth.json`
4. Maakt backup (`.pre_firefox_sync.bak`)

Belangrijk:
- Als `auth.json` per ongeluk als RTF/TextEdit bestand is opgeslagen, faalt login.
- Controleer: `cat ~/.config/ofscraper/auth.json | head -c 100` moet starten met `{"auth":{...`

## Relevante instellingen (Environment variables)

### Add-on / server

- **`WEBDL_ADDON_SOURCE_DIR`**
  - Source map van de Firefox add-on die naar `.xpi` wordt gezipt.
- **`WEBDL_ADDON_PACKAGE_PATH`**
  - Bestandslocatie van de gegenereerde `.xpi`.
- **`WEBDL_NICE_LEVEL`** (default `10`)
  - Process priority voor spawned tools.

### FFmpeg recording (avfoundation)

- **`WEBDL_VIDEO_DEVICE`** (default `1`)
- **`WEBDL_AUDIO_DEVICE`** (default `none` in code, maar `StartServer.command` zet default `1`)
- **`WEBDL_RECORDING_FPS`** (default `30`)
- **`WEBDL_VIDEO_CODEC`** (default `h264_videotoolbox`)
- **`WEBDL_VIDEO_BITRATE`** (default `6000k`)
- **`WEBDL_RECORDING_AUDIO_CODEC`** (default `aac_at`)
- **`WEBDL_AUDIO_BITRATE`** (default `192k`)
- **`WEBDL_RECORDING_INPUT_PIXEL_FORMAT`** (default `nv12`)
- **`WEBDL_RECORDING_FPS_MODE`** (default `cfr` bij videotoolbox)
- **`WEBDL_FFMPEG_THREAD_QUEUE_SIZE`** (default `8192`)
- **`WEBDL_FFMPEG_RTBUFSIZE`** (default `1500M`)
- **`WEBDL_FFMPEG_PROBESIZE`** (default `50M`)
- **`WEBDL_FFMPEG_ANALYZEDURATION`** (default `50M`)
- **`WEBDL_FFMPEG_MAX_MUXING_QUEUE_SIZE`** (default `4096`)

Chaturbate overrides:

- **`WEBDL_CHB_RECORDING_INPUT_PIXEL_FORMAT`** (default `nv12`)
- **`WEBDL_CHB_RECORDING_VIDEO_CODEC`** (default `libx264`)
- **`WEBDL_CHB_RECORDING_X264_PRESET`** (default `WEBDL_X264_PRESET`)

### yt-dlp

- **`WEBDL_YTDLP_CONCURRENT_FRAGMENTS`** (default `1`)
- **`WEBDL_YTDLP_COOKIES_MODE`** (default `browser`)
  - `browser` | `file` | `none`
- **`WEBDL_YTDLP_COOKIES_FILE`** (pad naar cookies file, bij mode `file`)
- **`WEBDL_YTDLP_COOKIES_BROWSER`** (default `firefox`)
- **`WEBDL_YTDLP_COOKIES_BROWSER_PROFILE`** (optioneel)
- **`WEBDL_YTDLP_USE_COOKIES_FOR_METADATA`** (default `0`)

### ofscraper

- **`WEBDL_OFSCRAPER`** (pad naar executable)
- **`WEBDL_OFSCRAPER_CONFIG_DIR`** (default `~/.config/ofscraper`)
- **`WEBDL_OFSCRAPER_TIMEOUT_MS`** (default `2h`)
- **`WEBDL_OFSCRAPER_DOWNLOAD_SEMS`** (default `1`)

### gallery-dl / ffprobe

- **`WEBDL_GALLERY_DL`**
- **`WEBDL_FFPROBE`**

### Scheduler / queue

- **`WEBDL_HEAVY_DOWNLOAD_CONCURRENCY`** (default `1`)
- **`WEBDL_LIGHT_DOWNLOAD_CONCURRENCY`** (default `3`)
- **`WEBDL_METADATA_PROBE_CONCURRENCY`** (default `1`)
- **`WEBDL_SMALL_DURATION_SECONDS`** (default `480`)

### Screenshots

- **`WEBDL_MIN_SCREENSHOT_BYTES`** (default `12000`)

### Postprocessing (Final Cut preset)

- **`WEBDL_FINALCUT_OUTPUT`** (default `0`)
- **`WEBDL_FINALCUT_VIDEO_CODEC`** (default `libx264`)
- **`WEBDL_FINALCUT_X264_PRESET`** (default `fast`)
- **`WEBDL_FINALCUT_X264_CRF`** (default `18`)
- **`WEBDL_FINALCUT_AUDIO_BITRATE`** (default `WEBDL_AUDIO_BITRATE`)

## macOS permissies

Voor opname/screenshot is meestal nodig:

- System Settings → **Privacy & Security** → **Screen Recording**
  - geef toestemming aan Terminal / het proces waarmee je `StartServer.command` start
- Voor audio capture kan extra permissie nodig zijn.

## Troubleshooting

### Server draait niet / geen verbinding

- Check `http://localhost:35729/status`
- Check of poort 35729 vrij is (StartServer.command probeert bestaande processen te killen)

### ffmpeg: Error opening input (Input/output error)

Als je in de opname `.log` dit ziet:

- `[avfoundation] Selected pixel format ((null)) is not supported by AVFoundation.`
- `Error opening input file 1:1.`

Dan is de gekozen `WEBDL_RECORDING_INPUT_PIXEL_FORMAT` niet compatibel met jouw avfoundation input.
Zet terug naar:

- `WEBDL_RECORDING_INPUT_PIXEL_FORMAT=nv12`

### FootFetishForum: lage resolutie afbeeldingen

De server **zou** nu automatisch attachment URLs moeten prefereren. Check:

1. **Batch preview** toont attachment links (`.519294/`, `.519728/`, etc.) bovenaan
2. **Server log** toont "upgraded" URLs met attachment ID matching
3. **Download bestand** is groot (MB, niet KB)

Als je nog steeds lage resolutie krijgt:
- Controleer of je de juiste attachment links selecteert (niet `upload.footfetishforum.com/image/...` thumbnails)
- Restart server: `Ctrl+C` → `./StartServer.command`
- Herlaad extension: `about:debugging` → Herladen

### OnlyFans download: "Wrong user" error

- Sync cookies: `python3 screen-recorder-native/src/sync-onlyfans-auth-from-firefox.py`
- Controleer `~/.config/ofscraper/auth.json` (moet starten met `{"auth":{...`)
- Bekijk `_ofscraper_<id>.log` in de output map voor de echte foutmelding

### YouTube download problemen met cookies

- Zet tijdelijk `WEBDL_YTDLP_COOKIES_MODE=none` en test opnieuw.

## Veiligheid

- De server luistert op `localhost`.
- Installeer de add-on alleen als je deze repo vertrouwt; de add-on draait op `<all_urls>`.
