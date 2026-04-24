# WEBDL Project — Technische & Functionele Documentatie

> Stand: 2026-04-24. Dit document beschrijft alle drie de services
> (**simple-server**, **webdl-hub**, **webdl-gallery**), hun interactie,
> databaseschema, API's, en file-flow.

---

## 1. Hoog-niveau architectuur

```
┌─────────────────────────────────────────────────────────────────────┐
│                         WEBDL ECOSYSTEEM                            │
│                                                                     │
│   USER BROWSER                                                      │
│         │                                                           │
│         ├──> webdl-hub          (MASTER, port 35730)                │
│         │    POST /api/jobs                                         │
│         │    ├─ classify URL                                        │
│         │    ├─ hub-native (ytdlp/gallerydl/…) → eigen worker       │
│         │    └─ slave-platform → delegate via DB                    │
│         │                                                           │
│         ├──> simple-server      (SLAVE + legacy UI, port 35729)     │
│         │    auto-rehydrate → downloads pending rows                │
│         │    eigen downloaders voor footfetishforum enz.            │
│         │                                                           │
│         └──> webdl-gallery      (NIEUW, port 35731)                 │
│              alleen lees/weergave, direct uit DB                    │
│                                                                     │
│   ┌──────────────────────────── POSTGRES ──────────────────────┐    │
│   │  public.downloads   (gallery data, shared)                 │    │
│   │  public.tags + download_tags (tags)                        │    │
│   │  webdl.jobs         (hub master queue)                     │    │
│   │  webdl.files        (hub geregistreerde bestanden)         │    │
│   │  webdl.logs         (per-job log)                          │    │
│   └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Rollen

| Service | Poort | Rol | Status |
|---|---|---|---|
| **simple-server** | 35729 | Slave downloader + legacy gallery UI + 4K-Watcher | In productie, ~114k downloads historie |
| **webdl-hub** | 35730 | Master: URL intake, adapter routing, lane queue, slave polling | In productie, recent gebouwd |
| **webdl-gallery** | 35731 | Read-only gallery + viewer (fresh) | In ontwikkeling |

### Dataflow

1. Gebruiker plakt URL in hub UI of via `curl POST /api/jobs`
2. Hub **detecteert multi-item** (playlist/kanaal/shorts) → expand naar losse jobs
3. Hub **classificeert lane**: `process-video` (1), `video` (2), `image` (6)
4. Hub **detecteert slave platform** → insert in `public.downloads` met `status='pending'`
5. Of hub pakt het zelf op via adapter (ytdlp, gallerydl, instaloader, ofscraper, tdl)
6. Bij completion: hub syncToGallery → `public.downloads` row met `status='completed'`
7. `webdl-gallery` leest `public.downloads` en toont media

---

## 2. simple-server — Legacy downloader & viewer host

### 2.1 Locatie & tech

- **Pad**: `/Users/jurgen/WEBDL/screen-recorder-native/`
- **Main**: `src/simple-server.compiled.js` (15,956 regels, uit `src/simple-server.js` gegenereerd)
- **Stack**: Node.js, Express, Socket.io, PostgreSQL (pg)
- **Dependencies**: pg, express, multer, ws, socket.io

### 2.2 Kern-verantwoordelijkheden

1. **Download scheduler** met lanes, metadata probe queue, spacing voor YouTube
2. **Custom downloaders** voor platforms die yt-dlp/gallery-dl niet kunnen:
   - footfetishforum (direct HTTP attachment fetch, ~8000 items)
   - wikifeet, aznudefeet, amateurvoyeurforum, pornpics
3. **4K-Watcher**: scanned externe HDD `/Volumes/HDD - One Touch/WEBDL/_4KDownloader` en registreert bestanden
4. **Thumbnail pipeline** (ffmpeg) met retry
5. **Gallery UI**: `/gallery` (oude UI)
6. **Viewer UI**: `/viewer` (oude viewer, wordt vervangen)
7. **Metadata probe**: yt-dlp --print om titel/kanaal op te halen voor queued items
8. **Socket.io** voor real-time updates
9. **Dashboard**: `/dashboard`

### 2.3 Config (src/config.js)

```js
PORT = 35729
DATABASE_URL = 'postgres://localhost/webdl'
BASE_DIR = '/Users/jurgen/Downloads/WEBDL'
HEAVY_DOWNLOAD_CONCURRENCY  // video downloads
LIGHT_DOWNLOAD_CONCURRENCY  // image downloads
POSTPROCESS_CONCURRENCY = 1  // ffmpeg merge
METADATA_PROBE_ENABLED = true
METADATA_PROBE_CONCURRENCY
STARTUP_REHYDRATE_DELAY_MS = 2500
STARTUP_REHYDRATE_MAX_ROWS = 250
STARTUP_REHYDRATE_MODE = 'all'
```

### 2.4 Belangrijke endpoints

| Endpoint | Functie |
|---|---|
| `GET /gallery` | Gallery UI (2244 regels JS) |
| `GET /viewer` | Viewer UI (oud) |
| `GET /dashboard` | Dashboard met stats |
| `POST /download` | URL intake (legacy), auto-expand voor YouTube |
| `GET /api/stats` | Database tellingen |
| `GET /api/media/recent-files` | Gepagineerde media voor gallery/viewer |
| `GET /api/media/channels` | Kanalen per platform |
| `GET /api/media/directories/tree` | Directory tree |
| `GET /api/tags` / `POST /api/tags` | Tags CRUD |
| `POST /api/rating` | Rating set (0-5 in halve stappen) |
| `POST /api/queue/resume` | Rehydrate queued jobs in-memory |
| `GET /api/proxy-thumb` | Thumb proxy voor externe URLs |
| `POST /api/settings/{priority,lanes,youtube}` | Scheduler tuning |
| `GET /api/repair/stuck-downloads` | Cleanup stuck rows |
| `POST /api/4k-trigger` | Force 4K-Watcher scan |

### 2.5 Queue-mechanica (in-memory)

- `queuedHeavy[]`, `queuedLight[]`, `queuedBatch[]`: queue arrays
- `queuedJobs Map<id, job>`: hydrated jobs
- `activeProcesses Map<id, child>`: running yt-dlp processes
- `startingJobs Set<id>`: jobs die nog niet running maar wel claimed
- `lastYoutubeStartMs`: voor spacing tussen YouTube downloads
- Auto-rehydrate: elke N sec als alle queues leeg → pak 250 `pending` uit DB
- Startup rehydrate: bij boot 250 `pending`/`queued`/etc. terugladen

### 2.6 Downloaders

- **yt-dlp**: meeste platforms (YouTube, Vimeo, TikTok, Reddit, Twitch, …)
- **gallery-dl**: niet actief gebruikt hier (hub doet dit)
- **Custom HTTP**: footfetishforum, wikifeet, etc. (met cookies/referrer/user-agent)
- **ffmpeg**: merge audio+video, thumbnails, re-encode

### 2.7 Bekende eigenaardigheden

- Oude viewer had `elModal` ReferenceError → reeds gefixt
- `'\n'` in template literal werd letterlijke newline in JS string → gefixt
- 14k+ error records die soms retry kunnen krijgen
- Auto-expand voor YouTube (playlist/kanaal/shorts) in `/download`

---

## 3. webdl-hub — Master downloader & orkestrator

### 3.1 Locatie & tech

- **Pad**: `/Users/jurgen/WEBDL/webdl-hub/`
- **Main**: `src/server.js`
- **Stack**: Node.js ≥20, Express, pg, ws, dotenv
- **Start**: `node src/server.js` of `npm start`

### 3.2 Adapters (`src/adapters/`)

Elke adapter implementeert: `name`, `priority`, `matches(url)`, `plan(url, opts)`,
`parseProgress(line)`, `collectOutputs(dir)`, optioneel `expandPlaylist(url)`.

| Adapter | Hosts | Gebruikt |
|---|---|---|
| `ytdlp` | YouTube, Vimeo, Twitch, TikTok, Reddit video, …800+ sites | `yt-dlp` binary |
| `gallerydl` | imgur, flickr, deviantart, pixiv, danbooru, gelbooru, 4chan, kemono, pinterest, bsky, twitter, mastodon | `gallery-dl` binary |
| `instaloader` | instagram.com | `instaloader` |
| `ofscraper` | onlyfans.com | `ofscraper` |
| `tdl` | t.me / Telegram | `tdl` |

### 3.3 Lane-systeem (`src/db/repo.js` → `classifyLane`)

| Lane | Concurrency | Voor |
|---|---|---|
| `process-video` | 1 | yt-dlp YouTube/Vimeo/Reddit/Twitch/TikTok (ffmpeg merge nodig) |
| `video` | 2 | Directe `.mp4/.webm` URLs, instagram, onlyfans, telegram |
| `image` | 6 | `.jpg/.png/.webp/...`, gallerydl, reddit-dl |

Classifier test: 10/10 correct (zie PLAN.md). Worker start **3 parallelle
loops**, één per lane, met elke lane z'n eigen `active Set`.

### 3.4 Master/slave router (`src/queue/slave-router.js`)

```js
SLAVE_PLATFORMS = [
  'footfetishforum', 'wikifeet', 'aznudefeet',
  'amateurvoyeurforum', 'pornpics', 'forum-area',
  'imagetwist', 'pixhost', 'postimg', 'bunkr', 'jpg'
]
```

Bij slave URL → `INSERT INTO public.downloads (..., status='pending', metadata)`
waarna simple-server's auto-rehydrate het oppikt.

### 3.5 Slave poller (`src/queue/slave-poller.js`)

Achtergrond-loop (elke 5s) die:
1. Queryt hub-jobs met `adapter='slave-delegate'` en `status='running'`
2. Joint met `public.downloads` op `options.simple_server_download_id`
3. Als slave `completed` → importeert file in `webdl.files`, genereert thumbnail
   (als video en geen `_thumb.jpg`), markeert hub-job `done`
4. Als slave `error`/`cancelled` → markeert hub-job `failed`

### 3.6 Dedup & handoff

**Pre-download dedup** (`worker.js:checkGalleryDuplicate`):
- Voor non-expandable URLs checken of URL al in `public.downloads` met
  `status IN ('completed','downloading','postprocessing')`
- Als ja → hub-job direct `done` zonder download (bewezen: job #68)

**Stale-lock reclaim** (bij worker startup):
- Jobs met `status='running'` en `progress_pct >= 100` → `done`
- Jobs met `status='running'` en stale `locked_at` (>10 min) → requeue

### 3.7 Belangrijke endpoints

| Endpoint | Functie |
|---|---|
| `POST /api/jobs` | Enqueue URL (auto-expand, auto-dedup, auto-slave) |
| `POST /api/jobs/expand` | Explicit playlist expand |
| `GET /api/jobs?status=&limit=` | Lijst jobs |
| `GET /api/jobs/:id` | Detail (job + files + logs) |
| `POST /api/jobs/:id/cancel` | Cancel |
| `POST /api/jobs/:id/retry` | Retry failed |
| `GET /` | Hub UI (jobs overzicht) |
| `WS /ws` | Real-time job updates |

### 3.8 Config (`src/config.js`)

```js
port = 35730
databaseUrl = 'postgres://localhost/webdl'
dbSchema = 'public'  // maar gebruikt eigenlijk 'webdl' tabellen
downloadRoot = '/Users/jurgen/Downloads/WEBDL/_4KDownloader/hub'
workerConcurrency = 2  // LEGACY, wordt vervangen door lane config
```

### 3.9 Tabellen (webdl schema)

```sql
webdl.jobs (
  id, url, adapter, status, priority, options, progress_pct,
  attempts, max_attempts, locked_by, locked_at,
  created_at, started_at, finished_at, error, lane
)
-- lane default 'video', index op (lane, status, priority DESC, created_at ASC)

webdl.files (id, job_id, path, size, mime, checksum, created_at)
webdl.logs  (id, job_id, ts, level, msg)
```

### 3.10 Migratie script

`scripts/migrate-from-simple-server.js`:
- `--platform=youtube --limit=100 [--dry-run]`
- Leest `public.downloads` waar `status='pending'`, maakt hub-jobs
- Markeert simple-server rij als `superseded` + metadata.migrated_to_hub_job_id

### 3.11 Huidige status (2026-04-24 13:40)

- 236 hub-jobs `done`, 29 `failed`, 3 `cancelled`
- 8394 `pending` in simple-server (footfetishforum hoofdzakelijk)
- Hub verwerkt YouTube items van gemigreerde batch

---

## 4. webdl-gallery — Lichte viewer & gallery

### 4.1 Locatie & tech

- **Pad**: `/Users/jurgen/WEBDL/webdl-gallery/`
- **Main**: `server.js`
- **Stack**: Node.js, Express, pg — **geen frontend framework**, vanilla JS
- **Grootte**: ~500 regels totaal

### 4.2 Bestandstructuur

```
webdl-gallery/
├── package.json
├── server.js                 # express + API + file streaming
├── public/
│   ├── index.html            # single page app
│   ├── app.js                # client logica (vanilla JS)
│   └── styles.css
├── PLAN.md                   # herbouw plan viewer
├── PROJECT.md                # dit document
└── gallery.log               # runtime log (gitignored)
```

### 4.3 API (server.js)

| Endpoint | Functie |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/items?limit&offset&platform&channel&q&sort&min_rating` | Gepagineerde media |
| `GET /api/platforms` | Platform lijst met counts |
| `GET /api/channels?platform=` | Kanalen (max 500) |
| `POST /api/rating { id, rating }` | Rating bijwerken |
| `GET /media/:id` | Raw bestand streamen |
| `GET /thumb/:id` | Thumbnail (met fallbacks `_thumb_v3.jpg` → `_thumb.jpg` → origineel) |

### 4.4 Filters in `/api/items`

- `status = 'completed'` + `filepath IS NOT NULL` (alleen werkelijk aanwezige files)
- `platform`, `channel` exact match
- `q` LIKE op title/filename
- `min_rating` >=
- `sort`: `recent` (finished_at DESC), `rating` (rating DESC), `random` (RANDOM())
- Type detectie via extensie → `type: 'video'|'image'`

### 4.5 Frontend (app.js huidige stand)

- State object met items/filters/viewIdx
- IntersectionObserver op sentinel → auto-load more
- Cards met thumb, title, channel, sterren
- Viewer modal: basic (← → Space M Esc 0-9)
- Rating POST bij toets of klik op sterrenbalk
- Platforms + kanalen dropdowns geladen uit API

### 4.6 Nog te bouwen

Zie `PLAN.md` sectie 2-7. Belangrijkste:
- Slideshow/Wrap/Random/Video-wait
- Tag systeem + dialog
- Volume/mute/seek
- Sidebar toggle + log panel
- Mode (channel/recent) + filter (media/video/image/all)
- Channel ↑↓ navigatie
- Mouse controls (dubbelklik sidebar, rechterklik ster)

---

## 5. Database schema

### 5.1 public.downloads (gedeeld, simple-server + hub + gallery)

```sql
CREATE TABLE downloads (
  id             BIGSERIAL PRIMARY KEY,
  url            TEXT NOT NULL,
  platform       TEXT DEFAULT 'unknown',
  channel        TEXT DEFAULT 'unknown',
  title          TEXT DEFAULT 'untitled',
  description    TEXT,
  duration       TEXT,
  thumbnail      TEXT,
  filename       TEXT,
  filepath       TEXT,
  filesize       BIGINT,
  format         TEXT,
  status         TEXT DEFAULT 'pending',   -- pending | queued | downloading | postprocessing | completed | error | cancelled | superseded
  progress       INT  DEFAULT 0,
  error          TEXT,
  metadata       TEXT,                     -- JSON als text
  source_url     TEXT,
  created_at     TIMESTAMP DEFAULT now(),
  updated_at     TIMESTAMP DEFAULT now(),
  finished_at    TIMESTAMP,
  rating         DOUBLE PRECISION,         -- 0.5 t/m 5.0, half-stars
  ts_ms          BIGINT,
  is_thumb_ready BOOLEAN DEFAULT false,
  priority       INT DEFAULT 0,
  gallery_bumped_at TIMESTAMPTZ
);
```

**Status tellingen actueel:**
- completed: 71,841
- cancelled: 32,471
- error: 15,462
- pending: 8,394
- queued: 244
- superseded: 124

### 5.2 public.tags / public.download_tags

- `tags (id, name, created_at)`
- `download_tags (download_id, tag_id)` many-to-many

### 5.3 public.screenshots, public.download_files

- `screenshots`: separate kind van media (opgenomen screens)
- `download_files`: multi-file downloads (1 download → meerdere files)

### 5.4 webdl.jobs (hub master queue)

Zie sectie 3.9. Ontkoppeld van downloads tabel — koppeling via
`options.simple_server_download_id` voor slave-delegated jobs.

### 5.5 webdl.files

- `(id, job_id, path, size, mime, checksum, created_at)`
- Gevuld door hub worker bij voltooiing én door slave-poller bij slave handoff

### 5.6 webdl.logs

- `(id, job_id, ts, level, msg)` — level IN (info, warn, error)

---

## 6. File storage layout

### 6.1 Base directories

- `/Users/jurgen/Downloads/WEBDL/` — hoofd downloads (simple-server)
  - `youtube/<channel>/<title>/<file>.mp4` enz.
  - `footfetishforum/<channel>/<file>`
  - `_4KDownloader/hub/<job_id>/<file>` — hub eigen downloads
- `/Volumes/HDD - One Touch/WEBDL/_4KDownloader/` — externe 4K downloader archief

### 6.2 Thumbnails

- `<name>_thumb.jpg` (hub pipeline, simple-server nieuwe)
- `<name>_thumb_v3.jpg` (simple-server legacy)
- `<name>.webp` (yt-dlp auto)

---

## 7. Belangrijke processen

### 7.1 Running processes controleren

```bash
# Simple-server
lsof -iTCP:35729 -sTCP:LISTEN

# Webdl-hub
lsof -iTCP:35730 -sTCP:LISTEN

# Webdl-gallery
lsof -iTCP:35731 -sTCP:LISTEN
```

### 7.2 Logs

- Simple-server: `/Users/jurgen/WEBDL/screen-recorder-native/server.log`
- Hub: `/Users/jurgen/WEBDL/webdl-hub/webdl-hub.log` (JSON lines)
- Gallery: `/Users/jurgen/WEBDL/webdl-gallery/gallery.log`

### 7.3 Restart commands

```bash
# Simple-server
cd /Users/jurgen/WEBDL/screen-recorder-native
pkill -f "simple-server.compiled.js"
nohup node src/simple-server.compiled.js >> server.log 2>&1 & disown

# Hub
cd /Users/jurgen/WEBDL/webdl-hub
pkill -f "node src/server.js"
nohup node src/server.js >> webdl-hub.log 2>&1 & disown

# Gallery
cd /Users/jurgen/WEBDL/webdl-gallery
pkill -f "webdl-gallery/server.js"
nohup node server.js >> gallery.log 2>&1 & disown
```

---

## 8. Integratie-punten

### 8.1 Hub → simple-server (delegatie)

1. Hub classificeert URL via `isSlaveUrl()`
2. INSERT in `public.downloads` met:
   ```json
   {
     "status": "pending",
     "metadata": {
       "delegated_from_hub": true,
       "hub_job_id": "<id>"
     }
   }
   ```
3. Simple-server's auto-rehydrate (elke N sec) laadt `pending` rijen
4. Download + thumbnail + updates via eigen pipeline
5. Status naar `completed` → slave-poller pikt op

### 8.2 Hub → gallery sync (hub-native downloads)

`worker.js:syncToGallery` na job-done:
- Parse `info.json` voor metadata (channel, title, platform)
- INSERT in `public.downloads` met `status='completed'`, `metadata.hub_job_id`
- Dedup op `filepath` en `source_url`

### 8.3 Gallery → alle bronnen (read-only)

- Leest uitsluitend uit `public.downloads`
- Schrijft alleen `rating` via `UPDATE downloads SET rating=...`
- Geen afhankelijkheid van hub of simple-server

---

## 9. Huidige deploy-status

| Service | Draait? | Port | Process |
|---|---|---|---|
| simple-server | ✅ | 35729 | live tests bezig |
| webdl-hub | ✅ | 35730 | live tests bezig |
| webdl-gallery | ✅ | 35731 | live tests bezig |
| PostgreSQL 16 | ✅ | 5432 | localhost |

---

## 10. Nog openstaande bouwtaken

Zie `PLAN.md` voor complete lijst. Hoogste prioriteit:

1. **webdl-gallery viewer** voltooien met alle controls (plan in PLAN.md)
2. **Tag endpoints** in gallery server toevoegen
3. **Finder-button** besluit: wel/niet meenemen (alleen zinvol lokaal)
4. **Scroll wheel gedrag** op stage beslissen (next/prev of niks)
5. **Simple-server YouTube migratie** afmaken (359 items → hub)
6. **Footfetishforum adapter** in hub (optioneel — nu via slave delegation)

---

## 11. Commands cheatsheet

```bash
# Hub: URL submitten
curl -X POST http://localhost:35730/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=..."}'

# Expand playlist (auto-detect werkt ook via /api/jobs)
curl -X POST http://localhost:35730/api/jobs/expand \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/playlist?list=..."}'

# Gallery: items ophalen
curl 'http://localhost:35731/api/items?platform=youtube&limit=10'

# Rating zetten
curl -X POST http://localhost:35731/api/rating \
  -H "Content-Type: application/json" \
  -d '{"id":214333,"rating":4.5}'

# Simple-server: stats
curl http://localhost:35729/api/stats
```

---

## 12. Foutoplossing

| Probleem | Check | Fix |
|---|---|---|
| Downloads lijken vast | `SELECT status, COUNT(*) FROM downloads GROUP BY status` | `UPDATE downloads SET status='pending' WHERE status='queued'` (trigger auto-rehydrate) |
| Hub jobs stuck op running | `SELECT * FROM webdl.jobs WHERE status='running' AND locked_at < NOW() - INTERVAL '10 min'` | Hub restarten (stale-lock reclaim draait automatisch) |
| Postgres errors | `brew services restart postgresql@16` + restart beide servers | |
| Port in gebruik | `lsof -iTCP:PORT -sTCP:LISTEN -t \| xargs kill -9` | |
| Viewer cache | Cmd+Shift+R hard refresh of DevTools "Disable cache" | |

---

*Laatst bijgewerkt: 2026-04-24 — na lane-systeem + master/slave + gallery MVP*
