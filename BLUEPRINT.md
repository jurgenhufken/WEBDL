# WEBDL — Technische Blauwdruk

> Companion bij [WEBDL-Blauwdruk.docx](screen-recorder-native/WEBDL-Blauwdruk.docx)
> — de productvisie. Dit document vertaalt die visie naar architectuur en code.

---

## De Drie Wetten (uit de productblauwdruk)

1. **De viewer is het product** — Alles staat in dienst van de kijkervaring
2. **Het bestand is de waarheid** — DB is index, niet bron
3. **Informeer, dwing niet af** — Gebruiker kiest, app adviseert

## De Vier Pijlers

| Pijler | Verantwoordelijkheid |
|--------|---------------------|
| **Ingest** | Media binnenhalen: downloaden, importeren, recording |
| **Bibliotheek** | Opslaan, indexeren, organiseren (disk + DB) |
| **Viewer** | Bekijken, navigeren, genieten — het product |
| **Beheer** | Zoeken, filteren, tags, ratings, dedup, onderhoud |

---

## Huidige Staat

### De Monoliet

`simple-server.js`: **13.910 regels** (was 17.638, views geëxtraheerd)

Alle vier pijlers zitten door elkaar heen in één bestand. De refactor
splitst ze in modules die elk bij één pijler horen.

### Wat al werkt

- [x] Views geëxtraheerd naar `src/views/` (viewer, gallery, dashboard)
- [x] `/media/stream` endpoint: MKV→MP4 remuxing voor browser playback
- [x] gallery-dl Twitter/X ondersteuning (hele profielen + threads)
- [x] Thumbnail generator met ffmpeg
- [x] Cursor-based gallery paginering
- [x] Tag-systeem (handmatig)

### Wat mist (t.o.v. de blauwdruk)

- [ ] Modulaire serverarchitectuur (alles zit nog in de monoliet)
- [ ] DB als pure index (nu worden records soms als waarheid behandeld)
- [ ] Automatische tag-extractie bij ingest
- [ ] Batch-acties in de viewer
- [ ] Mobiele companion (premium)
- [ ] Content-hashing voor slimme dedup (premium)

---

## Doelarchitectuur

### Mappenstructuur

Elke module hoort bij precies één pijler.

```
src/
  server.js                ← Entry-point (~200 regels)
  config.js                ← .env configuratie (bestaand)

  state/
    index.js               ← Alle mutable globals (Beheer)

  db/
    connection.js           ← Connectie + schema (Bibliotheek)
    queries.js              ← Prepared statements factory (Bibliotheek)

  views/                    ← KLAAR
    viewer.js               ← Viewer HTML (Viewer)
    gallery.js              ← Gallery HTML (Viewer)
    dashboard.js            ← Dashboard HTML (Beheer)

  services/
    download-queue.js       ← Queue, scheduler (Ingest)
    download-activity.js    ← Activity logging (Ingest)
    thumb-generator.js      ← FFmpeg thumbs (Bibliotheek)
    recording.js            ← Screen recording (Ingest)
    addon-builder.js        ← Firefox addon (Ingest)
    auto-import.js          ← Disk import + 4K watcher (Ingest)
    tag-scanner.js          ← Auto-tagging bij ingest (Bibliotheek)
    reindexer.js            ← Disk→DB sync (Bibliotheek)

  downloaders/
    dispatcher.js           ← startDownload router (Ingest)
    ytdlp.js                ← yt-dlp (Ingest)
    direct.js               ← Direct files (Ingest)
    reddit.js               ← Reddit-dl + API (Ingest)
    gallery-dl.js           ← gallery-dl (Ingest)
    ofscraper.js            ← OnlyFans (Ingest)
    tdl.js                  ← Telegram (Ingest)
    instaloader.js          ← Instagram (Ingest)

  routes/
    media.js                ← /media/*, stream, thumb (Viewer)
    downloads.js            ← /download*, batch, cancel (Ingest)
    recording.js            ← Start/stop recording (Ingest)
    pages.js                ← /gallery, /viewer, /dashboard (Viewer)
    import.js               ← /import, /upload (Ingest)
    admin.js                ← /api/stats, tags, rating (Beheer)
    health.js               ← /health, /status

  utils/
    logger.js               ← Logging (bestaand)
    paths.js                ← Path safety
    url-helpers.js          ← URL parsing
    media-helpers.js        ← Media type detectie, items
    ffmpeg.js               ← FFmpeg/FFprobe wrappers
```

### Context Pattern

```js
const ctx = { db, queries, state, config, services };
// Elke module ontvangt ctx — geen circulaire deps
require('./routes/media')(app, ctx);
```

---

## Resource Management

De app is een **gast op jouw computer**, geen eigenaar.

| Principe | Implementatie |
|----------|--------------|
| **Startup < 5s** | Express + health eerst, zware taken na delay |
| **HDD mag slapen** | Geen bulk-scans, lazy loading, lokale disk prioriteit |
| **CPU respect** | nice(10), max 2 concurrent thumbs |
| **Memory bounded** | Caches met TTL en max-size |
| **Netwerk zuinig** | Configureerbare concurrency, YouTube spacing |

### Startup Volgorde

```
 0s  Express luistert, /health beschikbaar
 2s  DB connectie + schema
 5s  Gallery/viewer serveerbaar
10s  Queue rehydrate (async)
15s  Thumb generator (lazy)
30s  Auto-import watcher
60s  Metadata probe (optioneel)
```

---

## Data-filosofie

### Wet 2 in de praktijk: "Het bestand is de waarheid"

```
BESTAND BESTAAT OP DISK?
  ├─ Ja + in DB    → normaal: toon in gallery
  ├─ Ja + niet DB  → toon alsnog (filesystem = waarheid), markeer voor indexering
  └─ Nee + in DB   → markeer als "ontbrekend", NIET verwijderen uit DB
```

### Mappenstructuur als metadata

```
BASE_DIR/
  {platform}/
    {channel}/
      {title}.mp4
      {title}.jpg       ← thumbnail naast het bestand
      {title}.stream.mp4 ← gecachte browser-versie (MKV→MP4)
```

Het pad zelf communiceert platform, channel, en titel.
De DB is een snelle index, herbouwbaar vanuit disk.

### Deduplicatie (twee niveaus)

| Niveau | Wanneer | Actie |
|--------|---------|-------|
| **Download-preventie** | Vóór download | URL-check, melding aan gebruiker |
| **Gallery-weergave** | Tijdens browsen | Path-normalisatie, dubbelen zichtbaar, gebruiker kiest |

---

## Toekomstige Richting

### Auto-tagging bij Ingest

Tags worden niet handmatig toegevoegd, maar automatisch geëxtraheerd:

- Uit bestandsnaam: `#barefoot #outdoor`
- Uit video-titel van platform
- Uit URL-structuur (subreddit, channel)
- Uit metadata (yt-dlp/gallery-dl JSON)

### Premium Laag (toekomst)

Kernprincipe: **premium verrijkt, blokkeert nooit**.

| Free | Premium |
|------|---------|
| Volledige gallery + viewer | Playlists, autoplay series |
| Alle downloaders | Content-hash dedup |
| Tags + ratings | AI-tags + beschrijvingen |
| Zoeken + filteren | Cloud metadata sync |
| Import + reindex | Mobiele companion |

---

## Migratiefasen

### Fase 0 — KLAAR
- [x] Views → `src/views/` (-3.729 regels)
- [x] `/media/stream` MKV→MP4 remuxing
- [x] Twitter/X profiel download via gallery-dl

### Fase 1 — Foundation
- [ ] `state/index.js` — globals centraliseren
- [ ] `db/queries.js` — statements als factory
- [ ] `db/connection.js` — DB setup extraheren

### Fase 2 — Services
- [ ] `services/thumb-generator.js`
- [ ] `services/download-queue.js`
- [ ] `services/download-activity.js`

### Fase 3 — Downloaders
- [ ] `downloaders/dispatcher.js`
- [ ] Elke downloader → eigen bestand

### Fase 4 — Routes
- [ ] Routes → `routes/*.js`
- [ ] Nieuw `server.js` entry-point

### Fase 5 — Viewer Verrijking
- [ ] Auto-tagging bij ingest
- [ ] Batch-acties
- [ ] Verbeterde keyboard controls

### Per fase
1. Bouw module, test individueel
2. Git commit
3. Vervang in monoliet door require()
4. Test: health, gallery, video playback
5. Commit + push

---

## Ontwerpprincipes (uit de blauwdruk)

Bij elke wijziging toetsen:

- **Viewer-first**: maakt het de kijkervaring beter?
- **DB als index**: sla alleen op wat niet regenereerbaar is
- **Informeer, dwing niet af**: geef inzicht en keuze
- **Max 500 regels per module**: helder, leesbaar, testbaar
- **Open Source kern**: premium verrijkt, blokkeert nooit

---

*Code verandert. De filosofie is stabiel.*
