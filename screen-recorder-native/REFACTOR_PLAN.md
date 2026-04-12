# Refactor Plan: simple-server.js → Modulaire Architectuur

## Waarom "extract & move" niet werkt

Na de eerste stap (views extraheren, -3.729 regels) bleek dat de rest van het
bestand te sterk verweven is om stuk voor stuk te extraheren:

- **56 inline `db.prepare`** statements zitten verspreid in functies
- **31 mutable globals** worden door 10+ functies gelezen/geschreven
- Downloaders, thumb-gen, en queue-management delen allemaal dezelfde state
- Circulaire afhankelijkheden: `startDownload` → `updateDownload` → `emitActivity` → `activeProcesses`

**Conclusie:** We moeten de architectuur eerst herontwerpen, dan opnieuw opbouwen.

---

## Optie A: Clean Rewrite (aanbevolen)

Nieuw entry-point `src/server.js` dat modules samenstelt. De oude
`simple-server.js` blijft bestaan als fallback totdat alles werkt.

### Nieuwe mapstructuur

```
src/
├── server.js                  ← NIEUW entry-point (~200 regels)
├── config.js                  ← BESTAAND (ongewijzigd)
├── db/
│   ├── connection.js          ← DB connectie + schema migratie
│   └── queries.js             ← Alle prepared statements als factory
├── state/
│   └── index.js               ← Alle mutable globals op één plek
├── views/
│   ├── viewer.js              ← KLAAR (stap 1)
│   ├── gallery.js             ← KLAAR (stap 1)
│   └── dashboard.js           ← KLAAR (stap 1)
├── services/
│   ├── download-queue.js      ← Queue management, scheduler, rehydrate
│   ├── download-activity.js   ← Activity tracking en logging
│   ├── thumb-generator.js     ← FFmpeg thumb gen + scheduling
│   ├── recording.js           ← Screen recording (AVFoundation)
│   ├── addon-builder.js       ← Firefox addon auto-build
│   ├── auto-import.js         ← 4K watcher + disk import
│   └── tag-scanner.js         ← #tag extractie
├── downloaders/
│   ├── dispatcher.js          ← startDownload() router
│   ├── ytdlp.js               ← yt-dlp downloads
│   ├── direct.js              ← Direct file downloads
│   ├── reddit.js              ← Reddit-dl + reddit API
│   ├── ofscraper.js           ← OnlyFans scraper
│   ├── gallery-dl.js          ← gallery-dl
│   ├── tdl.js                 ← Telegram downloader
│   ├── instaloader.js         ← Instagram
│   └── kinky-nl.js            ← kinky.nl scraper
├── routes/
│   ├── media.js               ← /media/*, /api/media/*
│   ├── downloads.js           ← /download, /downloads, cancel, retry
│   ├── recording.js           ← /start-recording, /stop-recording
│   ├── gallery-api.js         ← /gallery, /viewer, /dashboard
│   ├── import.js              ← /import, /upload-recording
│   ├── admin.js               ← /api/stats, /api/tags, /api/rating
│   └── health.js              ← /health, /status
├── utils/
│   ├── logger.js              ← BESTAAND
│   ├── paths.js               ← Path safety, normalisatie
│   ├── url-helpers.js         ← URL parsing, filename extraction
│   ├── media-helpers.js       ← inferMediaType, makeMediaItem, dedup
│   └── ffmpeg.js              ← FFmpeg/FFprobe wrappers
└── middleware/
    └── errorHandler.js        ← BESTAAND
```

### Het `state` pattern

Alle mutable globals op één plek, doorgegeven als context:

```js
// state/index.js
module.exports = function createState() {
  return {
    // Download queue
    activeProcesses: new Map(),
    queuedJobs: [],
    startingJobs: new Set(),
    cancelledJobs: new Set(),
    onHoldJobs: new Set(),
    jobPlatform: new Map(),
    schedulerTimer: null,

    // Thumb generation
    thumbGenQueue: [],
    thumbGenActive: 0,
    thumbGenTimer: null,

    // Recording
    activeRecordings: new Map(),

    // Caches
    statsCache: null,
    statsCacheAt: 0,
    recentFilesTopCache: new Map(),
    
    // Runtime
    isShuttingDown: false,
  };
};
```

### Het `queries` pattern

Factory die prepared statements aanmaakt na DB init:

```js
// db/queries.js
module.exports = function initQueries(db) {
  return {
    // Downloads
    insertDownload: db.prepare(`INSERT INTO downloads ...`),
    getDownload: db.prepare(`SELECT * FROM downloads WHERE id=?`),
    updateDownloadStatus: db.prepare(`UPDATE downloads SET status=? ...`),
    // ... alle 114 statements
  };
};
```

### Het `server.js` entry-point

```js
// server.js — ~200 regels max, puur compositie
const config = require('./config');
const { connectDb, ensureSchema } = require('./db/connection');
const initQueries = require('./db/queries');
const createState = require('./state');
const express = require('express');

async function main() {
  const db = await connectDb(config);
  await ensureSchema(db);
  const queries = initQueries(db);
  const state = createState();
  const app = express();
  
  // Context object dat alle modules ontvangen
  const ctx = { db, queries, state, config, app };
  
  // Mount routes
  require('./routes/health')(ctx);
  require('./routes/media')(ctx);
  require('./routes/downloads')(ctx);
  require('./routes/recording')(ctx);
  require('./routes/gallery-api')(ctx);
  require('./routes/import')(ctx);
  require('./routes/admin')(ctx);
  
  // Start services
  require('./services/download-queue').init(ctx);
  require('./services/thumb-generator').init(ctx);
  require('./services/auto-import').init(ctx);
  require('./services/addon-builder').init(ctx);
  
  app.listen(config.PORT);
}

main().catch(console.error);
```

### Migratiestrategie

1. Bouw nieuwe modules op, test ze individueel
2. Nieuwe `server.js` draait parallel (andere port)
3. Test alle endpoints via automatische vergelijking
4. Wanneer alles werkt: verwissel entry-point
5. `simple-server.js` wordt `simple-server.legacy.js`

### Voordelen

- Elke module is testbaar
- IDE kan functies traceren
- Geen circulaire dependencies (alles gaat via ctx)
- Nieuwe features zijn makkelijk toe te voegen

### Risico's

- **Groot:** 17.000+ regels herschrijven kost tijd
- **Regressies:** Subtiele edge cases in de download pipeline
- **Parallel onderhoud:** Bugfixes moeten tijdelijk in beide versies

---

## Optie B: Big Bang Extract (sneller, risicovoller)

Eén groot Node.js script dat simple-server.js automatisch opsplitst:

1. Parse het bestand met een AST parser (recast/babel)
2. Identificeer functie-boundaries automatisch
3. Groepeer per domein op basis van naampatronen
4. Genereer module-bestanden met juiste imports/exports
5. Genereer nieuw simple-server.js dat alles require()'t

**Voordeel:** Snel, mechanisch, weinig handwerk
**Nadeel:** AST tools werken slecht met 680KB bestanden, edge cases

---

## Optie C: Incrementeel maar slimmer

Niet functie-voor-functie, maar **domein-voor-domein**:

### Fase 1 — State centraliseren (1 dag)
`state/index.js` aanmaken met alle 31 `let` globals.
In simple-server.js verwijzen naar `state.xxx` i.p.v. losse variabelen.

### Fase 2 — Queries centraliseren (1 dag)
Alle `db.prepare` naar `db/queries.js`, inclusief de inline ones.
Simple-server.js krijgt `const Q = require('./db/queries')(db)`.

### Fase 3 — Utils extraheren (halve dag)
Pure functies (geen state) naar utils/*.js.

### Fase 4 — Services extraheren (2 dagen)
Download-queue, thumb-gen, auto-import.

### Fase 5 — Routes extraheren (1 dag)
Express routes naar routes/*.js.

---

## Aanbeveling

**Optie A (Clean Rewrite)** als je de tijd hebt en een schone architectuur wilt.
**Optie C (Incrementeel slim)** als je werkende code wilt behouden en stap voor stap wilt gaan.

Optie B is te fragiel voor een bestand van deze grootte.

Welke richting wil je?
