# Refactor Plan: simple-server.js

## Huidige staat

- **17.638 regels** / 680KB in één bestand
- 70 Express routes
- 114 prepared SQL statements  
- 3.744 regels inline HTML (Viewer, Gallery, Dashboard)
- 31 mutable globals
- 160 const globals

## Strategie

**Extract & Require** — code verplaatsen naar modules, `require()` in simple-server.js.  
Geen API-wijzigingen, geen framework-wijzigingen. De server blijft identiek werken.

## Stap 1: Views extraheren (3.744 regels, ZERO risico)

Drie pure functies die HTML-strings retourneren. Geen dependencies op server state.

### Nieuwe bestanden

```
src/views/viewer.js    → getViewerHTML()         ~1150 regels
src/views/gallery.js   → getGalleryHTML()        ~2217 regels  
src/views/dashboard.js → getDashboardHTML(...)    ~377 regels
```

### Aanpak per view

1. Knip functie uit simple-server.js
2. Plak in nieuw bestand met `module.exports = function(...) { ... }`
3. Voeg `const getViewerHTML = require('./views/viewer');` toe bovenin simple-server.js
4. Test: `node -c src/simple-server.js && curl localhost:35729/gallery`

## Stap 2: DB Schema + Queries (2.080 regels)

### Nieuwe bestanden

```
src/db/schema.js   → ensurePostgresSchemaReady()   ~240 regels
src/db/queries.js  → alle 114 prepared statements   ~1840 regels
```

### Pattern voor queries.js

```js
module.exports = function initQueries(db) {
  const getDownload = db.prepare('SELECT * FROM downloads WHERE id=?');
  // ... alle 114 statements
  return { getDownload, ... };
};
```

### In simple-server.js

```js
const queries = require('./db/queries')(db);
const { getDownload, updateDownload, ... } = queries;
```

## Stap 3: Utils extraheren (~800 regels)

### Nieuwe bestanden

```
src/utils/reddit.js     → Reddit OAuth, fetching, indexing    ~400 regels
src/utils/paths.js      → safeIsAllowedExistingPath, relPath  ~200 regels
src/utils/url-helpers.js → URL parsing, filename extraction    ~200 regels
```

## Stap 4: Media helpers (1.700 regels)

### Nieuwe bestanden

```
src/media/thumbs.js  → Thumb generation, scheduling, ffmpeg   ~1100 regels
src/media/items.js   → makeMediaItem, mediaItemKey, dedup     ~600 regels
```

### Shared state pattern

```js
// thumbs.js ontvangt een context object
module.exports = function initThumbs(ctx) {
  const { db, config, FFMPEG, BASE_DIR } = ctx;
  // ... alle thumb logica
  return { scheduleThumbGeneration, pickOrCreateThumbPath, ... };
};
```

## Stap 5: Downloaders (2.100 regels)

### Nieuw bestand

```
src/downloaders/index.js → Alle download-functies
  - startDownload (dispatcher)
  - startYtDlpDownload
  - startDirectFileDownload  
  - startRedditDlDownload
  - startOfscraperDownload
  - startGalleryDlDownload
  - startKinkyNlDownload
  - startTdlDownload
  - startInstaloaderDownload
```

### Context die downloaders nodig hebben

```js
module.exports = function initDownloaders(ctx) {
  const { db, config, queries, activeProcesses, spawnNice, ... } = ctx;
  return { startDownload };
};
```

## Stap 6: Routes extraheren (~1.430 regels)

### Nieuwe bestanden

```
src/routes/media-api.js    → /api/media/* routes          ~500 regels
src/routes/download-api.js → download/cancel/retry/batch   ~400 regels
src/routes/recording.js    → start/stop recording, crop    ~530 regels
```

### Pattern

```js
module.exports = function mountMediaRoutes(app, ctx) {
  app.get('/api/media/recent-files', async (req, res) => { ... });
  app.get('/api/media/channel-files', async (req, res) => { ... });
};
```

## Resultaat na refactor

```
simple-server.js      ~5.400 regels (van 17.638 → -69%)
src/views/viewer.js       1.150
src/views/gallery.js      2.217
src/views/dashboard.js      377
src/db/schema.js            240
src/db/queries.js         1.840
src/utils/reddit.js         400
src/utils/paths.js          200
src/utils/url-helpers.js    200
src/media/thumbs.js       1.100
src/media/items.js          600
src/downloaders/index.js  2.100
src/routes/media-api.js     500
src/routes/download-api.js  400
src/routes/recording.js     530
```

## Verificatie per stap

Na elke stap:
1. `node -c src/simple-server.js` (syntax check)
2. Server starten, health check
3. Gallery laden, video afspelen
4. Git commit

## Risico's

- **Circular dependencies**: Vermijden door context-injection pattern
- **Global state**: De 31 `let` globals blijven in simple-server.js en worden via ctx doorgegeven
- **Prepared statements**: Moeten na DB init aangemaakt worden, dus queries.js is een factory
- **Inline HTML**: Views bevatten client-side JS dat geen server-state raakt, veilig om te extraheren
