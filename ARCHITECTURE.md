# WEBDL — Architectuur (target + migratie)

**Datum:** 2026-05-24
**Status:** voorstel · klaar voor goedkeuring
**Probleem:** Jürgen — "het is allemaal aan elkaar geregen zonder architectuur, dat wil ik nu wel"

---

## 1. Wat we nu hebben (de "geregen" toestand)

### Componenten

| Component | Locatie | Rol | Pijnpunt |
|---|---|---|---|
| `simple-server.js` | `screen-recorder-native/src/` | HTTP API, lane-scheduler, download dispatch, K2S auth, channel-derivation, /api/sites, /api/recommendations | **16k regels** monolith — geen module-splitsing |
| `webdl-hub` | `webdl-hub/src/` | Tweede HTTP service voor Reddit BDFR, gallery-sync triggers | Loopt apart, eigen DB-pool, eigen schema |
| `webdl-gallery` | `webdl-gallery/` | Read-only UI op DB | 3k+ regels, cache wordt elke 15s geïnvalideerd |
| `debug-toolbar.js` | `firefox-native-controller/content/` | Browser-side: forum-scans, vipergirls, K2S batch, screenshots, recording | **9415 regels**, oude+nieuwe flows naast elkaar |
| `site-engine.js` | `firefox-native-controller/content/` | Browser-side: generieke UI voor 22 sites/*.js | Nieuw, klein, maar mist Source-abstractie |
| `sites/*.js` (22 stuks) | `firefox-native-controller/content/sites/` | Per-site config (URL-patterns, selectors, channel) | Logica zit alleen in browser — niet herbruikbaar server-side |
| Python scrapers | `scripts/` | `erome_dl.py`, `pictoa_dl.py`, `darknet_dl.py`, `foot_album_dl.py` | **Spawn direct vanuit endpoint, omzeilt lane-scheduler** |
| PostgreSQL `webdl` | local | 1 platte `downloads` tabel met JSON-metadata-kolom | Ad-hoc velden, geen typed kolommen voor lane/source_url/parent_job |

### Data-flow nu

```
Firefox add-on (browser)
  ├─ debug-toolbar.js (9415 regels)
  │   • scant forum-pages in browser
  │   • dedupet 1000en URLs in browser
  │   • POST grote batch naar simple-server
  │
  └─ site-engine.js + sites/*.js
      • detecteert page-type
      • POST per item naar simple-server

           ↓
simple-server.js (:35729)
  • /download accepteert {url, platform, channel, title}
  • detectLane() → heavy of light
  • startDownload() → spawn yt-dlp child
  • UPDATE downloads tabel met status

  • /api/erome/album, /api/pictoa/album, /api/darknetvideos/video,
    /api/footstockings/album → DIRECT spawn python script
    (BYPASS van lane-scheduler — bug)

           ↓
yt-dlp processen        Python processen
  (lane-managed)          (NIET lane-managed)

           ↓
Postgres `downloads` tabel
  (alle download-state in 1 platte tabel + JSON metadata)

           ↓
webdl-gallery (:35731)
  • leest tabel
  • slow query op format-extensie regex (seq-scan)
  • cache wordt elke 15s gewist
```

### De 7 fundamentele pijnpunten

1. **Geen contracten** — `/download` body is vrij format, geen schema, geen versie. Elke caller (extensie / scraper / hub) heeft eigen variant.
2. **Channel/platform-derivation gedupliceerd op 3 plekken** — extensie, simple-server, Python scrapers. Wijzigingen moeten 3× gemaakt.
3. **Browser doet zwaar werk** — 100 pages scrapen + dedupen in Firefox = blokt UI, scan-state verloren bij tab-close, geen progress voor user.
4. **Twee toolbar-implementaties** in extensie — debug-toolbar (oud) + site-engine (nieuw). Guard heen-en-weer ipv één weg.
5. **Geen visibility** — user klikt knop, ziet geen terugkoppeling wat in queue kwam. Eigen klacht: "ik krijg geen terugkoppeling".
6. **Geen typed queue** — geen `jobs` tabel, alleen `downloads` met inconsistente metadata. Kan niet rapporteren "deze 113 items horen bij thread-scan X".
7. **Lanes zijn JS-arrays + globale teller** — geen per-host rate-limit (vipergirls vs k2s), geen runtime-config voor specifieke platforms, geen audit-trail.

---

## 2. Target-architectuur

### Componenten

```
┌─────────────────────────────────────────────────────────────┐
│  Firefox add-on (THIN client — ~500 regels totaal)          │
│  • UI: 3 knoppen per pagina (Single / Page / Whole-thread)  │
│  • POST /jobs {intent, url}                                 │
│  • Toont status van laatste batch (poll /jobs/:id)          │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  webdl-core  (NIEUWE module, ~3-5k regels totaal)           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ sources/     │  │ jobs/        │  │ workers/         │   │
│  │ — 1 file per │  │ — Job-type   │  │ — yt-dlp         │   │
│  │   host       │  │ — scheduler  │  │ — python-spawn   │   │
│  │ — inspect()  │  │ — lanes      │  │ — fetch          │   │
│  │ — listItems()│  │ — rate-limit │  │ — uniform contract│  │
│  │ — paginate() │  │   per host   │  │                  │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────┬──────────────────┬──────────────────┬─────────────┘
          │ reads/writes     │                  │ spawns
          ▼                  ▼                  ▼
   ┌──────────────┐   ┌─────────────┐    ┌─────────────────┐
   │ Postgres     │   │ FileStore   │    │ yt-dlp / python │
   │ (zie schema) │   │ /Volumes/.. │    │                 │
   └──────┬───────┘   └─────────────┘    └─────────────────┘
          │ reads only
          ▼
   ┌──────────────┐
   │ webdl-gallery│
   │ — query-only │
   │ — geen muts. │
   └──────────────┘
```

### Database-schema

**Nieuwe tabellen** (bestaande `downloads` blijft, krijgt extra kolommen):

```sql
-- 1. SOURCES: registry van ondersteunde hosts
CREATE TABLE sources (
  id            TEXT PRIMARY KEY,           -- 'heavyfetish', 'vipergirls', ...
  display_name  TEXT NOT NULL,
  default_lane  TEXT NOT NULL,              -- 'heavy' | 'middle' | 'light'
  rate_limit    INT,                         -- max requests/min naar deze host
  config        JSONB,                       -- selectors, paginatie-pattern, etc.
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. LANES: runtime-configurabel
CREATE TABLE lanes (
  id              TEXT PRIMARY KEY,         -- 'heavy', 'middle', 'light'
  max_concurrent  INT NOT NULL,
  description     TEXT,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 3. JOBS: alle scans/batches (boven downloads)
CREATE TABLE jobs (
  id            BIGSERIAL PRIMARY KEY,
  intent        TEXT NOT NULL,              -- 'single' | 'page' | 'whole-thread' | 'forum-scan'
  source_id     TEXT REFERENCES sources(id),
  source_url    TEXT NOT NULL,
  parent_job_id BIGINT REFERENCES jobs(id),
  status        TEXT NOT NULL,              -- 'queued' | 'running' | 'done' | 'error'
  items_total   INT DEFAULT 0,
  items_done    INT DEFAULT 0,
  items_error   INT DEFAULT 0,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 4. DOWNLOADS uitbreiden:
ALTER TABLE downloads ADD COLUMN lane TEXT;
ALTER TABLE downloads ADD COLUMN job_id BIGINT REFERENCES jobs(id);
ALTER TABLE downloads ADD COLUMN host TEXT;     -- voor per-host rate-limit
ALTER TABLE downloads ADD COLUMN worker_type TEXT;  -- 'ytdlp' | 'python' | 'fetch'
```

### Contracten (TypeScript-stijl)

```ts
// 1. SOURCE — implementeert per host
interface Source {
  id: string;                                              // 'heavyfetish'
  matches(url: string): boolean;
  detectPageType(url: string): 'single' | 'listing' | null;
  inspect(url: string): Promise<{                          // server-side scan
    items: Item[];
    paginationUrls?: string[];                             // voor whole-thread
    channel: string;
    title?: string;
  }>;
  paginate(baseUrl: string, page: number): string;
  deriveChannel(url: string): string;
}

interface Item {
  url: string;                                             // direct download URL
  type: 'video' | 'image' | 'archive';
  metadata?: Record<string, any>;
}

// 2. JOB — wat in DB komt
interface Job {
  id: number;
  intent: 'single' | 'page' | 'whole-thread' | 'forum-scan';
  sourceId: string;
  sourceUrl: string;
  parentJobId?: number;
  status: 'queued' | 'running' | 'done' | 'error';
  itemsTotal: number;
  itemsDone: number;
  itemsError: number;
}

// 3. WORKER — uniform contract voor downloaders
interface Worker {
  type: 'ytdlp' | 'python-script' | 'fetch';
  canHandle(item: Item, source: Source): boolean;
  download(item: Item, channel: string, onProgress: (pct: number) => void): Promise<{
    filepath: string;
    size: number;
    duration?: number;
  }>;
}

// 4. LANE-POLICY — uit DB-tabel
interface LanePolicy {
  id: 'heavy' | 'middle' | 'light';
  maxConcurrent: number;
  hostRateLimits: Map<string, number>;                     // per-host requests/min
}
```

### Hoe het werkt — voorbeeld

```
1. User klikt "🧵 Whole thread" op vipergirls.to/threads/X
2. Extensie POST /jobs { intent: 'whole-thread', url: 'vipergirls.to/threads/X' }
3. webdl-core/jobs.create():
   • INSERT INTO jobs (id=42, intent='whole-thread', source_id='vipergirls', ...)
   • Source.inspect(url) → { items: [], paginationUrls: [page1..page99] }
   • Voor elke pagination-URL: create child job (intent='page', parent_job_id=42)
4. Scheduler pakt child-jobs op:
   • page-jobs gaan naar middle/light lane (alleen scrape, geen download)
   • Per page: Source.inspect() → items[]
   • Voor elke item: INSERT downloads (job_id=child, lane=detect, host=k2s.cc)
5. Workers consumeren downloads-queue:
   • Worker.canHandle? → dispatch
   • Per-host rate-limit check (max N k2s.cc requests/min)
   • Progress → UPDATE downloads + parent job items_done++
6. Extensie polt /jobs/42 → ziet items_total/items_done/items_error
   → user heeft EINDELIJK terugkoppeling
```

---

## 3. Wat dit oplost (per pijnpunt uit §1)

| Pijnpunt | Oplossing |
|---|---|
| 1. Geen contracten | TypeScript interfaces Source/Job/Worker, gevalideerd bij entry-point |
| 2. Channel-derivation gedupliceerd | Alleen in `sources/<host>.ts`. Browser POST stuurt alleen URL, server derived |
| 3. Browser doet zwaar werk | Extensie wordt thin client. Scans lopen op server, overleven tab-close, progress polbaar |
| 4. Twee toolbars | debug-toolbar wordt gesloopt. site-engine wordt ook thin (UI only) |
| 5. Geen visibility | `/jobs/:id` endpoint + polling = real-time progress per batch |
| 6. Geen typed queue | `jobs` tabel met parent/child + status + counters |
| 7. Lane-config hardcoded | `lanes` tabel + per-host rate-limit kolom |

---

## 4. Migratie-plan

### Principe
- **Strangler pattern** — bouw nieuwe stack naast oude. Migreer 1 site, valideer, migreer rest.
- **Geen big-bang refactor** — oude code blijft draaien tot elke flow apart vervangen is.
- **DB-schema additief eerst** — nieuwe kolommen/tabellen toegevoegd, oude blijven. Pas verwijderen na complete migratie.

### Stappen (geschat 2-3 dagen, opbreekbaar in sessies van 2-4u)

| # | Wat | Geschat | Risico |
|---|---|---|---|
| **1** | Nieuwe directory `webdl-core/` aanmaken. Definieer interfaces (sources.ts, jobs.ts, workers.ts) als TypeScript types, GEEN implementatie. | 1u | Geen |
| **2** | DB-migratie 01-add-jobs-sources-lanes.sql — nieuwe tabellen, ALTER downloads. Backwards-compatible, oude code blijft werken. | 1u | Laag (additief) |
| **3** | Implementeer 1 Source: `webdl-core/sources/heavyfetish.ts`. Identiek aan huidige `sites/heavyfetish.js` maar TypeScript + server-side runnable. | 2u | Geen |
| **4** | Implementeer 1 Worker: `webdl-core/workers/ytdlp.ts`. Wrappt huidige startDownload-logica achter Worker interface. | 2u | Laag |
| **5** | Implementeer jobs/scheduler: `webdl-core/jobs/scheduler.ts`. Pakt Job uit DB, vraagt Source.inspect, queue't downloads via Worker. | 4u | Middel |
| **6** | Nieuwe endpoint `POST /jobs` in simple-server.js die `webdl-core` aanroept. Bestaande `/download` blijft. | 1u | Laag |
| **7** | Extensie: feature-flag `useNewJobsApi` per site. Voor heavyfetish: stuur naar `/jobs` ipv `/download`. Test op echte site. | 2u | Middel (rollback = flag uit) |
| **8** | Migreer overige 21 sites mechanisch — per site een Source + flag aan. | 4-6u | Laag (mechanisch) |
| **9** | Sloop oude `detectLane`, `enqueueDownloadJob`, `startDownload` uit simple-server.js. Routes blijven. | 2u | Laag (alle traffic via nieuwe stack) |
| **10** | Sloop forum-scan logic uit debug-toolbar.js (vipergirls, fff). Verplaats naar sources/. | 4-6u | Middel |
| **11** | Per-host rate-limit toevoegen in scheduler (cloudflare-hosts max N/min). | 1u | Laag |
| **12** | Documentatie + ARCHITECTURE.md updaten naar werkelijkheid. | 1u | Geen |

**Totaal:** ~25-30u, verspreid over meerdere sessies.

### Wat NIET wijzigt
- `downloads` tabel blijft bestaan (krijgt alleen extra kolommen)
- `webdl-gallery` blijft read-only op `downloads` — geen wijziging nodig
- Bestaande Python scrapers blijven werken, worden alleen via Worker-laag aangeroepen ipv direct spawn

---

## 5. Beslissingen die nog open zijn

| Beslissing | Opties | Aanbeveling | Status |
|---|---|---|---|
| **Taal** voor webdl-core | TypeScript / JavaScript | TypeScript — type-safety bij contracten essentieel | **Open** — Jürgen: "TS toevoegen is bewuste keuze, eerst bespreken" |
| **Runtime** | Node / Deno / Bun | Node — al in stack | Aanbeveling |
| **Process model** | In-process / Separate service | In-process eerst, splitsen later | Aanbeveling |
| **DB-migration tool** | psql scripts / Prisma / Drizzle | psql scripts — al in `migrations/` | Aanbeveling |
| **Job-polling vs WebSocket** | Polling 2s / SSE / WebSocket | SSE — simpler dan WS, real-time genoeg | Aanbeveling |
| **Sites-migratie aanpak** | Mechanisch 1:1 / Per-site met feature-flags | Feature-flags (zie §4.3) | **Bevestigd** — niet mechanisch |

### 5.1 TypeScript-beslissing — argumenten

**Voor TS in webdl-core:**
- Source/Job/Worker contracten zijn waardevol om typed te hebben
- Auto-complete + refactor-safety bij wijzigingen
- Runtime-validatie via Zod o.i.d. is dubbel werk

**Tegen:**
- Build-stap toevoegen aan project dat nu pure JS draait
- Mentale switch + dep-installs (tsc / ts-node / esbuild)
- Overige codebase blijft JS — context-switch per file

**Alternatieven:**
- JSDoc-types met `// @ts-check` — type-safety zonder build-stap
- Pure JS met runtime-validation via Zod — type-safety alleen at boundary

**Vraag aan Jürgen:** TS / JSDoc+ts-check / pure JS + Zod / iets anders?

## 6. Sites-migratie — feature-flag aanpak (niet mechanisch)

**Inzicht (van Jürgen):** "21 sites mechanisch migreren werkt niet — elke site heeft eigen rariteit."

Voorbeelden van rariteiten:
- **FFF (FootFetishForum)** — `upload.footfetishforum.com/image/<id>` wrapper-URL die client-side opgelost moet via Chevereto-fetch
- **K2S** — JWT-resolve via accessToken OR cookie-fallback, file-specifieke errors, abuse-flag handling
- **X/Twitter** — eigen target-detection (post / profile / hashtag), guest-token flow
- **Reddit** — BDFR fallback, subreddit vs user vs post mode
- **Vipergirls** — whole-thread + thread-context + viper.to alias normalisatie
- **Cloudflare-hosts** — challenge-detect, cookie-from-firefox

### Per-site featurevector

Elke Source moet declareren welke features hij ondersteunt:

```ts
interface Source {
  // ... bestaande methods ...
  features: {
    paginate?: boolean;          // multi-page support
    wholeThread?: boolean;       // forum thread-walking
    forumScan?: boolean;         // subforum → thread-discovery
    wrapperResolve?: boolean;    // bv. Chevereto image-page → direct image
    cloudflareCookie?: boolean;  // vereist cookies-from-firefox
    authToken?: boolean;         // bv. K2S accessToken
    rateLimit?: number;          // requests/min naar deze host
  };
}
```

### Migratie per site = 3 stappen

1. **Source-file maken** met huidige selectors + URL-patterns
2. **Eigen rariteiten als features declareren** (paginate, wholeThread, wrapperResolve, etc.)
3. **Test live** — feature-flag aan, oude flow blijft fallback. Pas weghalen na bevestiging.

### Volgorde van migratie (van laag → hoog complexiteit)

| Fase | Sites | Reden |
|---|---|---|
| **Fase A** (simpel, ~30min/site) | xnxx, tnaflix, spankbang, redtube, darknetvideos, footstockings, heavyfetish, erome, pictoa | yt-dlp native of simple scraper, weinig rariteiten |
| **Fase B** (medium, ~1u/site) | darknessporn, tubesafari, pornzog, alohatube, usersporn, pornkai, xfree, zzztube, favoyeurtube, spycamhub, sexygirlspics, nakedneighbour | Site-engine sites, mogelijk Cloudflare |
| **Fase C** (complex, ~2-4u/site) | porncoven, vipergirls, footfetishforum, amateurvoyeurforum, foot-fetish.club, phun | Forum-rariteiten (whole-thread, attachment-wrappers, dedupe-context) |
| **Fase D** (specialistisch, ~3-6u/site) | x.com/twitter, reddit, xvideos, k2s, redgifs, instagram, onlyfans | Eigen scrapers met auth/token/extractor-specifieke flows |

**Totaal:** 22+ sites × gemiddeld 1.5u = ~30-40u, niet mechanisch. Verdeeld over sessies.

## 7. Rollback-strategie

Geen big-bang. Elke stap heeft eigen rollback-pad.

| Stap | Rollback |
|---|---|
| DB-migratie (nieuwe tabellen/kolommen) | `migrations/.../99-rollback.sql` — DROP nieuwe objecten, downloads-kolommen worden DROP'd |
| Source-implementatie | Niet ingeschakeld via flag → oude flow blijft draaien. Source-file delete = stap terug |
| `/jobs` endpoint live | Feature-flag `useNewJobsApi` per site UIT → extensie POST'st naar `/download` zoals voorheen |
| Per-site feature-flag aan | Flag UIT → oude debug-toolbar / site-engine pad weer actief |
| `debug-toolbar.js` deels gesloopt | **Hier wordt rollback duur** — daarom: pas slopen NA 2 weken stabiel draaien op alle flags AAN |
| Lane-policy uit DB | Default-waarden fallback in code als DB-rij ontbreekt |

**Rollback-vereisten per stap:**
- Elke commit raakt **één laag** (DB / core / endpoint / extensie). Geen mengsel.
- Elke nieuwe code zit achter een feature-flag die default OFF is.
- Migratie-script heeft een spiegel-rollback in zelfde directory.
- "Geen rollback meer mogelijk" punt: pas NA verwijdering oude code uit debug-toolbar.js. Dat is fase 6, geschat 6-8 weken na start.

### Gevaarlijke punten

1. **Stap 9 (oude code uit simple-server slopen)** — onomkeerbaar zonder git-revert. Beslis pas na bewijs dat alle sites via nieuwe stack werken (1 week monitoring).
2. **Stap 10 (forum-scan uit debug-toolbar)** — vipergirls/FFF werken al jaren, bestaande user-gewoontes. Eerst nieuwe flow live + 2 weken parallel, dan pas oude weghalen.
3. **DB-kolom DROP** — nooit doen zonder backup + read-only window. Hou downloads-kolommen 30 dagen na laatste write.

---

## 6. Wat dit NIET aanpakt (apart traject)

- **YouTube anti-throttle** (sleep-requests) — apart, niet architectuur-werk
- **Gallery performance** (slow-query) — apart migratie-plan in `~/WEBDL/migrations/2026-05-24-gallery-perf/`
- **K2S auth refresh** — apart traject
- **Source-link bug** in gallery (channel-URL ipv video-URL) — apart fix

---

## 7. Hoe nu verder

1. **Jij beslist:** ga ik op deze schets bouwen, of moeten er eerst dingen gewijzigd?
2. Bij goedkeuring: ik start met stap 1 (interfaces) + stap 2 (DB-migratie) in deze sessie. Niets is dan nog risicovol — alleen nieuwe code naast oude.
3. Stap 3-7 (1 site end-to-end migreren) is goede milestone voor 2e sessie — daarna weten we of het werkt.
4. Stap 8-12 zijn herhaalbaar werk dat ook in achtergrond kan.

**Eindstaat:** simple-server.js is ~3-4k regels (alleen HTTP routes), webdl-core is ~3-5k regels (echte logica), debug-toolbar.js is gesloopt, site-engine.js is ~200 regels, extensie wordt thin client, gallery onveranderd.
