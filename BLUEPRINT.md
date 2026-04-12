# WEBDL Blauwdruk

## Kernfilosofie

WEBDL is een persoonlijk mediabeheersysteem dat als **gast op jouw computer** draait, niet als eigenaar. Het systeem groeit organisch mee met de gebruiker, zonder opgedrongen structuur.

### Ontwerpprincipes

1. **Gast, geen eigenaar** — Het systeem claimt geen eigenaarschap over bestanden. Het indexeert, organiseert en verrijkt — maar de gebruiker bepaalt waar bestanden staan en wat ermee gebeurt. Geen lock-in, geen proprietary formaten, geen verplichte mapstructuur.

2. **Groeiproces** — De architectuur erkent dat het systeem evolueert. Features worden iteratief toegevoegd. De codebase moet dit ondersteunen zonder telkens een herschrijving te vereisen.

3. **Resource-bewust** — De app is zuinig met CPU, disk I/O en geheugen. Achtergrondtaken (thumbs, imports, scans) worden geThrottled. De HDD mag slapen. Startup blokkeert niet de event loop.

4. **Lokaal eerst** — Alle data blijft lokaal. Geen cloud-afhankelijkheid. De browser-extensie en de server communiceren alleen via localhost.

---

## Huidige Architectuur

### Componenten

```
Firefox Extensie (content scripts + background)
    ↕ localhost:35729
WEBDL Server (Node.js/Express)
    ↕
PostgreSQL (media catalogus)
    ↕
Bestandssysteem (lokale SSD + externe HDD)
    ↕
Externe tools (yt-dlp, ffmpeg, gallery-dl, ofscraper, etc.)
```

### Probleem: De Monoliet

`simple-server.js` is 13.900+ regels (was 17.600 voor views-extractie) met:
- 70 Express routes
- 114 prepared SQL statements (58 top-level, 56 inline)
- 31 mutable globals gedeeld tussen alle onderdelen
- Downloaders, queue-management, thumb-gen en routes door elkaar heen

---

## Doel-Architectuur

### Mapstructuur

```
src/
  server.js              — Entry-point, compositie (~200 regels)
  config.js              — Configuratie (bestaand)

  db/
    connection.js         — DB connectie + schema migratie
    queries.js            — Prepared statements factory

  state/
    index.js              — Gecentraliseerde mutable state

  views/
    viewer.js             — Viewer HTML (klaar)
    gallery.js            — Gallery HTML (klaar)
    dashboard.js          — Dashboard HTML (klaar)

  services/
    download-queue.js     — Queue, scheduler, rehydrate
    download-activity.js  — Activity tracking
    thumb-generator.js    — FFmpeg thumb gen + scheduling
    recording.js          — Screen recording
    addon-builder.js      — Firefox addon auto-build
    auto-import.js        — 4K watcher + disk import
    tag-scanner.js        — Tag extractie bij ingest

  downloaders/
    dispatcher.js         — startDownload() router
    ytdlp.js              — yt-dlp
    direct.js             — Direct file downloads
    reddit.js             — Reddit-dl + API
    ofscraper.js          — OnlyFans
    gallery-dl.js         — gallery-dl
    tdl.js                — Telegram
    instaloader.js        — Instagram
    kinky-nl.js           — kinky.nl

  routes/
    media.js              — /media/*, /api/media/*
    downloads.js          — /download*, cancel, retry, batch
    recording.js          — start/stop recording
    pages.js              — /gallery, /viewer, /dashboard
    import.js             — /import, /upload
    admin.js              — /api/stats, /api/tags, /api/rating
    health.js             — /health, /status

  utils/
    logger.js             — Logging (bestaand)
    paths.js              — Path safety, normalisatie
    url-helpers.js        — URL parsing, filenames
    media-helpers.js      — Media type detectie, item constructie
    ffmpeg.js             — FFmpeg/FFprobe wrappers
```

### Context Pattern

Eén object dat alle gedeelde state en services bevat:

```js
// server.js
const ctx = {
  db,                    // Database connectie
  queries,               // Prepared statements
  state,                 // Mutable globals
  config,                // Configuratie
  services: {
    queue,               // Download queue manager
    thumbs,              // Thumb generator
    activity,            // Activity tracker
  }
};

// Elke module ontvangt ctx
require('./routes/media')(app, ctx);
require('./services/thumb-generator').init(ctx);
```

---

## Toekomstige Richting: Graph-Based Media

### Van platte tabel naar relatienetwerk

De huidige `downloads` tabel is plat: elke rij is een bestand met platform, channel, titel. Maar media heeft inherent **relaties**:

- Een **creator** heeft meerdere **channels**
- Een **channel** bevat meerdere **posts**
- Een **post** bevat meerdere **media items**
- Media items delen **tags**, **series**, **thema's**
- Dezelfde creator kan op meerdere **platforms** actief zijn

### Datamodel (toekomst)

```
creators ──1:N──> channels
channels ──1:N──> posts
posts    ──1:N──> media_items
media_items ──N:M──> tags
creators ──N:M──> platforms
media_items ──1:1──> files (fysiek bestand)
```

Dit kan in PostgreSQL met junction tables, of later met een graph-extensie (Apache AGE) als de queries te complex worden.

### Tag-Scraping bij Ingest

Tags worden niet achteraf handmatig toegevoegd, maar **automatisch geëxtraheerd bij ingest**:

- Uit de bestandsnaam: `#barefoot #outdoor → tags: barefoot, outdoor`
- Uit de video-titel van het platform
- Uit de URL-structuur (subreddit, channel naam)
- Uit metadata (yt-dlp json, gallery-dl info)

Dit gebeurt in `services/tag-scanner.js` en draait als onderdeel van de download-pipeline.

---

## Resource Management

### Principe: De app is een gast

| Resource | Beleid |
|----------|--------|
| **CPU** | Thumb-gen en ffmpeg draaien met nice(10). Max 2 concurrent thumb jobs. |
| **Disk I/O** | HDD-bestanden worden lazy geladen. Geen bulk-scans bij startup. |
| **Memory** | Caches hebben TTL en max-size. Geen onbeperkte groei. |
| **Netwerk** | Download concurrency is configureerbaar. YouTube-spacing voorkomt rate-limits. |
| **Startup** | Server moet binnen 5s HTTP kunnen serveren. Zware taken starten na 10-30s delay. |

### Startup Volgorde

```
0s    — Express luistert, health endpoint beschikbaar
2s    — DB verbinding + schema check
5s    — Gallery/viewer/dashboard serveerbaar
10s   — Queue rehydrate (async, blokkeert niet)
15s   — Thumb generator start (lazy, low priority)
30s   — Auto-import watcher start
60s   — Metadata probe start (als enabled)
```

---

## Migratiestrategie

Dit is een groeiproces. We herbouwen niet alles in één keer.

### Fase 0 (klaar)
- [x] Views geëxtraheerd naar `src/views/`
- [x] simple-server.js van 17.638 naar 13.909 regels

### Fase 1 — Foundation
- [ ] `state/index.js` — alle mutable globals centraliseren
- [ ] `db/queries.js` — prepared statements als factory
- [ ] `db/connection.js` — DB setup uit simple-server halen

### Fase 2 — Services
- [ ] `services/thumb-generator.js` — thumb gen extraheren
- [ ] `services/download-queue.js` — queue management extraheren
- [ ] `services/download-activity.js` — activity tracking

### Fase 3 — Downloaders
- [ ] `downloaders/dispatcher.js` — startDownload router
- [ ] Elke downloader naar eigen bestand

### Fase 4 — Routes
- [ ] Express routes naar `routes/*.js`
- [ ] Nieuw `server.js` entry-point

### Fase 5 — Enrichment
- [ ] Graph-based media model
- [ ] Tag-scraping bij ingest
- [ ] Creator-channel-post hiërarchie

### Per fase:
1. Module bouwen en testen
2. Git committen
3. In simple-server.js vervangen door require()
4. Server testen (health, gallery, video playback)
5. Committen en pushen

---

## Niet-functionele Eisen

- **Geen downtime** — Elke fase levert werkende code op
- **Git-veilig** — Elke stap gecommit, rollback altijd mogelijk
- **Backward compatible** — Geen API-wijzigingen voor de Firefox extensie
- **Testbaar** — Modules kunnen individueel getest worden
- **Leesbaar** — Elke module past in één scherm (~200-400 regels)
