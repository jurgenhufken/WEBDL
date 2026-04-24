# WEBDL Roadmap & Concept

> Complete roadmap: wat gebouwd is, wat er NU wordt gebouwd, en wat er
> nog aan zit te komen. Samen met `PROJECT.md` (architectuur) en
> `PLAN.md` (viewer herbouw) vormt dit de complete project-visie.

---

## 1. Concept in één alinea

WEBDL is een **persoonlijke download- en media-archief-suite** die URLs
van allerlei platforms (YouTube, Instagram, OnlyFans, Telegram, imgur,
danbooru, footfetishforum, etc.) downloadt, organiseert per
platform/kanaal, voorziet van thumbnails en metadata, en presenteert in
een snelle gallery + viewer met rating, tags en slideshow. Het ecosysteem
bestaat uit drie losse services die samenwerken via een gedeelde
PostgreSQL database: een **master** (webdl-hub) voor intake/scheduling,
een **slave + legacy UI** (simple-server) voor historische downloaders, en
een **lichte read-only viewer** (webdl-gallery) voor media consumption.

---

## 2. Fase-gebaseerde roadmap

### ✅ Fase 0 — Legacy stabiliteit (klaar)

- simple-server draait 114k+ downloads historie
- PostgreSQL migratie voltooid
- Gallery UI + viewer UI in simple-server
- 4K-Watcher voor externe HDD
- Thumbnail pipeline + metadata probe
- Auto-rehydrate queue

### ✅ Fase 1 — Hub introductie (klaar)

- webdl-hub op poort 35730
- 5 adapters: ytdlp, gallerydl, instaloader, ofscraper, tdl
- Basic jobs queue + worker pool
- Socket.io / WebSocket updates
- Playlist expand endpoint

### ✅ Fase 2 — Unificatie (recent voltooid)

- [x] Pre-download dedup hub ↔ simple-server gallery
- [x] Stale-lock reclaim bij hub startup
- [x] **Lane-systeem**: process-video=1, video=2, image=6
- [x] Classifier (10/10 correct)
- [x] Master/slave router (auto detectie slave platforms)
- [x] Slave poller (tracking + file import + thumb gen)
- [x] Auto-detect playlist in POST /api/jobs
- [x] Migratie script simple-server → hub
- [x] 110+ YouTube items gemigreerd en afgewerkt door hub

### 🛠 Fase 3 — Nieuwe gallery + viewer (IN UITVOERING)

- [x] webdl-gallery service op poort 35731
- [x] API endpoints: items/platforms/channels/rating
- [x] File streaming + thumbnail endpoint
- [x] Grid met thumbs + infinite scroll
- [x] Basic viewer modal (← → Esc Space M 0-9)
- [ ] **Volledige viewer rebuild** met alle controls (zie PLAN.md)
- [ ] Tag systeem + dialog
- [ ] Slideshow/Wrap/Random/Video-wait toggles
- [ ] Mode (channel/recent) + filter selectors
- [ ] Sidebar toggle + log panel
- [ ] Mouse controls (dubbelklik, rechterklik ster, scroll wheel)
- [ ] popstate (browser back/forward)
- [ ] Fallback thumb + retry logic
- [ ] HUD pills met info

### 🔜 Fase 4 — Hub feature-parity & scale

- [ ] **Footfetishforum adapter** in hub (HTTP direct download)
- [ ] **Wikifeet / aznudefeet / amateurvoyeurforum / pornpics** adapters
- [ ] **YouTube spacing/jitter** in hub (rate-limit preventie)
- [ ] **Metadata probe queue** in hub
- [ ] **Migratie overige 8k+ items** naar hub
- [ ] Simple-server scheduler uitzetten voor niet-legacy platforms
- [ ] Hub UI uitbreiden: lane stats, per-lane filters, worker health

### 🔮 Fase 5 — Intelligence & discovery

- [ ] **Content-hash dedup** (perceptual hash voor beelden, chromaprint voor video)
- [ ] **Auto-tagging** via AI/ML (object detection, scene tags)
- [ ] **Gezichtsherkenning** (lokaal, via face-api.js of dlib) voor grouping per persoon
- [ ] **OCR op frames** voor video-search
- [ ] **Whisper/speech-to-text** voor searchable transcripts
- [ ] **Recommendation**: "meer zoals dit" op basis van tags/channel/rating
- [ ] **Smart collections**: auto-generate op basis van query ("5 sterren + YouTube + afgelopen week")
- [ ] **Duplicate detection**: UI om dubbele files te zien en op te ruimen

### 🔮 Fase 6 — Graph & relations

Er zijn al `graph_nodes` en `graph_edges` tabellen — benutting idee:

- [ ] **Kanaal-graaf**: kanalen die vergelijkbare content hebben linken
- [ ] **Tag-co-occurrence**: welke tags vaak samen voorkomen
- [ ] **Collection graph**: handmatige relaties tussen items
- [ ] **Graph visualisatie** (D3 of Cytoscape) in aparte UI

### 🔮 Fase 7 — Multi-storage & sync

- [ ] **Meerdere storage backends**: lokale schijf, externe HDD, S3/Backblaze/R2
- [ ] **Storage rules**: bv. >30 dagen oud → archief, ratings ≥4 → fast SSD
- [ ] **Background rebalance**: periodic move volgens rules
- [ ] **Cloud sync**: optie om kopie in private S3 te zetten
- [ ] **Failover**: als lokaal bestand weg → probeer cloud

### 🔮 Fase 8 — Mobile + deelbaarheid

- [ ] **PWA** gallery (installeerbaar op iOS/Android)
- [ ] **Responsieve viewer** (touch-swipe ← →)
- [ ] **Share links** met expiry + rate limit
- [ ] **Guest-mode** read-only access
- [ ] **Public collections** (deelbare lijsten)

### 🔮 Fase 9 — Automation & monitoring

- [ ] **Watchers**: "download alles nieuws van kanaal X"
  - Cron-achtige taken in hub
  - RSS / YouTube API poll
  - Notificatie bij nieuw item
- [ ] **Webhook triggers** (bv. van n8n/Zapier)
- [ ] **Prometheus metrics** endpoint
- [ ] **Grafana dashboard**
- [ ] **Alerting** bij stuck queues, disk-full, adapter-fail

### 🔮 Fase 10 — Kwaliteit & transcoding

- [ ] **Auto-transcode** grote video's naar efficient formaat (H.265/AV1)
- [ ] **Aspect-correctie**: portrait videos detecteren + rotate
- [ ] **Intro/outro trimming** via silence-detection
- [ ] **HDR preservation** bij transcode
- [ ] **Quality presets** (archief HQ, mobile LQ)

---

## 3. Volledige server-functies overzicht

### 3.1 simple-server (port 35729)

**Download-engine:**
- Heavy/light lane scheduler
- YouTube spacing/jitter
- Auto-expand playlist/kanaal/shorts
- Metadata probe queue
- Custom downloaders voor forum-platforms
- Postprocess-cap (ffmpeg concurrency)
- Auto-rehydrate queue
- Startup rehydrate

**Media pipeline:**
- Thumbnail generator (ffmpeg) met retry
- 4K-Watcher externe HDD scan
- Channel/title enrichment uit info.json
- File deduplicatie bij insert
- Reparatie-endpoints voor stuck downloads

**UI:**
- `/gallery` — media grid + viewer modal (oud)
- `/viewer` — aparte viewer page (oud)
- `/dashboard` — stats + status

**API:**
- Media query (recent, search, channels, directories/tree)
- Tags CRUD
- Rating
- Settings (priority, lanes, youtube)
- Screenshot CRUD
- Viewer navigate
- 4K-Watcher trigger
- Repair endpoints

**Background tasks:**
- Socket.io real-time updates
- Log rotation
- Scheduler timers

### 3.2 webdl-hub (port 35730)

**Core engine:**
- 3 parallelle worker-loops (per lane)
- Adapter dispatching
- Auto-detect playlist + expand
- Classify-lane per URL
- Pre-download dedup tegen gallery
- Stale-lock reclaim bij startup

**Master/slave:**
- Slave URL router
- Slave delegate (insert pending row)
- Slave poller (sync status + file import + thumb gen)

**Post-processing:**
- Thumbnail generator (ffmpeg)
- Gallery sync (public.downloads insert met dedup)
- Info.json metadata reader

**API:**
- POST /api/jobs (auto: dedup/slave/expand/single)
- POST /api/jobs/expand
- GET /api/jobs (list + filters)
- GET /api/jobs/:id (met files + logs)
- Cancel/retry per job
- WebSocket real-time

**UI:**
- Jobs overzicht + filters
- Job detail met logs
- Per-lane statistieken

**Background tasks:**
- Slave-poller elke 5s
- WebSocket broadcast

### 3.3 webdl-gallery (port 35731)

**Read/serve:**
- Media lijst met filters (platform, channel, sort, rating, zoek)
- Platform + channel aggregaties
- File streaming (`/media/:id`)
- Thumbnail streaming met fallbacks (`/thumb/:id`)

**Write (beperkt):**
- Rating update (alleen deze kolom)

**UI:**
- Grid met thumbs
- Infinite scroll
- Filter-balk
- Viewer modal (in aanbouw)

**Geen afhankelijkheden:**
- Alleen PostgreSQL
- Geen hub-API calls
- Geen simple-server afhankelijkheid

---

## 4. Nog te bouwen — kort-termijn (deze week)

### Gallery + viewer voltooien (zie PLAN.md)

1. Sidebar-lijst met items + auto-scroll naar active
2. Mode/filter/tag selectors + channel navigatie
3. Slideshow + Wrap + Random + Video-wait
4. Volume/mute/seek controls
5. Tag dialog + endpoints in gallery server
6. Sidebar toggle + log panel
7. popstate history
8. Mouse controls (dubbelklik, rechterklik ster, scroll wheel)
9. HUD pills
10. Finder-button (beslissing: wel/niet)
11. Fallback thumb + retry
12. Playwright end-to-end test

### Hub uitbreiden

- YouTube spacing/jitter
- Metadata probe queue
- Lane-stats endpoint voor UI

---

## 5. Medium-termijn

### Simple-server uitfaseren

Stap voor stap overgang:

1. Foorfetishforum adapter bouwen in hub (hub-native, geen slave delegation meer)
2. Overige forum-platforms adapters
3. Pending items migreren in batches
4. Simple-server scheduler uitschakelen
5. Simple-server gallery UI redirect → webdl-gallery
6. 4K-Watcher logica porten naar apart service of hub-background
7. Metadata probe porten
8. Simple-server afbouwen tot alleen "read-only archive"

### Schaalbaarheid

- Worker horizontaal schalen (meerdere hub-worker processen)
- Job queue via Redis/Postgres advisory locks
- Large file storage via S3 voor archief

---

## 6. Lange-termijn ideeën / experimenten

### Intelligence features

| Feature | Tech stack | Waarde |
|---|---|---|
| Perceptual hash dedup | `imagehash` (Python) of `sharp` + hash | Vindt dubbele beelden ongeacht formaat |
| Face grouping | face-api.js, dlib | "Alle foto's van persoon X" |
| Scene tagging | YOLOv8, CLIP | Auto-tags zonder handmatig werk |
| Transcript search | whisper.cpp | Zoek in video-audio |
| Smart recommendation | collaborative filtering op ratings | "Jij vond dit leuk → probeer…" |

### Mobile & multi-user

- PWA met offline support
- Per-gebruiker ratings/tags (nu global)
- Authenticatie (lokaal, geen externe OAuth)

### Monitoring

- Prometheus + Grafana of `node-exporter` + custom metrics
- Alerting via Pushover/ntfy bij stuck queues of disk-full

### Nieuwe bronnen

Adapters voor:
- Telegram channels (tdl bestaat al)
- Discord messages/attachments
- Twitter spaces
- TikTok live recordings
- Bluesky (via gallery-dl)
- Podcast feeds
- Patreon / Kemono-Party

---

## 7. Niet-functionele aandachtspunten

### Prestaties

- Huidige gallery-server is eenvoudig, 500 items per query snel
- Bij >100k completed items kan infinite scroll traag worden → paginering via cursor (created_at, id) ipv offset
- Thumb caching via browser (Cache-Control 1h/24h set)

### Robuustheid

- PostgreSQL single point of failure → pg_dump daily backup cron
- Bij pg-crash: beide servers hebben `SIGINT` handlers, retry-policies
- Workers hebben stale-lock reclaim (hub) en auto-rehydrate (simple-server)

### Security

- Geen authenticatie op gallery/hub — alleen `localhost`
- Bij mobile/remote toegang: Tailscale of SSH tunnel
- `/media/:id` serveert bestandspaden uit DB → geen path-traversal want ID-based

### Ontwikkeling

- Node.js ≥ 20 voor `--watch`
- PostgreSQL 16 via Homebrew
- Geen CI/CD pipeline — lokaal development
- Geen tests (unit/integration minimaal) → groeipunt

---

## 8. Meetbare doelen

| Doel | Huidig | Streven |
|---|---|---|
| Totaal completed downloads | 71,841 | 100k+ na migratie |
| Hub jobs done | 236 | 5000+ binnen 2 weken |
| Simple-server pending | 8,394 | < 100 (rest via hub) |
| Gallery response tijd (first paint) | ~800ms | < 300ms |
| Viewer frame-open latency | <500ms | <100ms |
| Error rate downloads | ~14% | < 5% |
| Disk usage WEBDL/ | ? | max 500GB local, rest archief |

---

## 9. Uitstap-strategie (exit plan)

Als user wil stoppen:
1. Database: `pg_dump webdl > backup.sql` — portable
2. Files: alle downloads in `/Users/jurgen/Downloads/WEBDL/` blijven op disk
3. Code: 3 repo's (screen-recorder-native, webdl-hub, webdl-gallery) staan los
4. Geen cloud lock-in — alles lokaal

---

## 10. Referenties

- `PROJECT.md` — architectuur + API documentatie
- `PLAN.md` — gedetailleerd plan voor viewer herbouw
- `/Users/jurgen/WEBDL/webdl-hub/ARCHITECTURE.md` — hub-specifieke architectuur
- `/Users/jurgen/WEBDL/webdl-hub/ROADMAP.md` — hub roadmap (ouder)

---

*Dit is een levend document. Bij elke fase-overgang hier bijwerken.*
