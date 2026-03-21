# WEBDL (Firefox Add-on + lokale server)

WEBDL is een **lokale** downloader/recorder die je bedient vanuit Firefox.
De Firefox add-on toont een toolbar met knoppen (download/screenshot/opnemen) en praat met een lokale Node.js server op `http://localhost:35729`.

De server regelt:

- **Downloads** via:
  - `yt-dlp` (YouTube e.d.)
  - `gallery-dl` (diverse sites)
  - `ofscraper` (OnlyFans)
- **Screen recording** via `ffmpeg` (`avfoundation` op macOS)
- **Screenshots** (upload vanuit de add-on of via macOS `screencapture` fallback)
- **Opslag + historie** in SQLite (`webdl.db`)

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

## Ontwerp / Architectuur (schema)

```text
Firefox tab
  content script (firefox-native-controller/content/debug-toolbar.js)
    |  HTTP fetch (localhost)
    v
WEBDL server (screen-recorder-native/src/simple-server.js)
  |-- SQLite: ~/Downloads/WEBDL/webdl.db
  |-- Files:  ~/Downloads/WEBDL/<platform>/<channel>/<title>/...
  |-- Tools:
      - yt-dlp
      - gallery-dl
      - ofscraper
      - ffmpeg/ffprobe
      - screencapture (macOS)
```

## Repository indeling

- **`StartServer.command`**
  - Start de server en opent automatisch `/addon`.
  - Zet standaard environment variables zoals `WEBDL_VIDEO_DEVICE`, `WEBDL_AUDIO_DEVICE`, `WEBDL_ADDON_SOURCE_DIR`.
- **`screen-recorder-native/`**
  - Lokale server (Node.js) + database + ffmpeg orchestration.
  - Belangrijkste entrypoint: `screen-recorder-native/src/simple-server.js`.
- **`firefox-native-controller/`**
  - Firefox add-on (toolbar UI) die requests naar de server stuurt.
- **Output data (runtime)**
  - Standaard: `~/Downloads/WEBDL/`
  - Database: `~/Downloads/WEBDL/webdl.db`

## Opslag & mappenstructuur

De server schrijft alles naar `BASE_DIR`:

- **Basis**: `~/Downloads/WEBDL`
- **Downloads/recordings/screenshots**: per platform/kanaal/titel in submappen
- **Logs**:
  - `recording_... .log` (ffmpeg opname log)
  - `_ofscraper_<id>.log` (OnlyFans ofscraper gecombineerde log)

Let op:

- `BASE_DIR` staat momenteel vast in de servercode. Als je opslag op een externe schijf wilt, gebruik een **symlink** van `~/Downloads/WEBDL` naar je externe locatie.

## Database (SQLite)

Database file:

- `~/Downloads/WEBDL/webdl.db`

Tabellen:

- **`downloads`**
  - queue/status/progress/metadata van downloads
- **`screenshots`**
  - opgeslagen screenshots

De DB draait in `WAL` mode.

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

## OnlyFans (ofscraper)

OnlyFans downloads lopen via `ofscraper` en gebruiken een config map:

- Config dir: `~/.config/ofscraper` (default)
- Auth: `~/.config/ofscraper/auth.json` (moet valide JSON zijn)

Belangrijk:

- Als `auth.json` per ongeluk als RTF/TextEdit bestand is opgeslagen, faalt login.
- WEBDL maakt per download een tijdelijke kopie van de ofscraper config en schrijft een `_ofscraper_<id>.log` in de output map met stdout/stderr + ofscraper internal log tail.

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

### OnlyFans download: leeg resultaat

- Controleer `~/.config/ofscraper/auth.json` (valide JSON, niet RTF)
- Bekijk `_ofscraper_<id>.log` in de output map voor de echte foutmelding

### YouTube download problemen met cookies

- Zet tijdelijk `WEBDL_YTDLP_COOKIES_MODE=none` en test opnieuw.

## Veiligheid

- De server luistert op `localhost`.
- Installeer de add-on alleen als je deze repo vertrouwt; de add-on draait op `<all_urls>`.
