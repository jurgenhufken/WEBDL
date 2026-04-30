# WEBDL status - 30 april 2026

## Huidige conclusie

WEBDL is inmiddels voorbij de oude "skeleton"-fase. De kern is nu een
drie-service architectuur:

| Service | Poort | Rol | Huidige stand |
|---|---:|---|---|
| `screen-recorder-native` / simple-server | 35729 | legacy downloader, recording, screenshots, oude UI, forum-downloaders | productie/legacy |
| `webdl-hub` | 35730 | master intake, URL-routing, queue, adapters, dashboard | actief, in uitbreiding |
| `webdl-gallery` | 35731 | snelle gallery/viewer direct op PostgreSQL | MVP klaar, viewer bijna feature-complete |

De belangrijkste verschuiving is: **nieuwe download-intake moet naar
`webdl-hub`; simple-server blijft voorlopig slave voor legacy-platforms en
recording/screenshot functionaliteit.**

## Wat er al staat

### Hub

- Express app met `/api/jobs`, `/api/files`, `/api/downloads`, admin routes en WebSocket.
- Adapters voor `yt-dlp`, `gallery-dl`, `instaloader`, `ofscraper`, `tdl` en vBulletin-script.
- Lane queue: `process-video`, `video`, `image`.
- Playlist/channel auto-expand voor YouTube.
- Slave delegation naar `public.downloads` voor platforms die simple-server nog afhandelt.
- Slave poller en gallery sync richting `public.downloads`.
- Pre-download dedup tegen bestaande gallery/downloads.
- Stale-lock reclaim bij worker-start.
- Dashboard is onderweg naar unified view: hub-jobs plus legacy server-downloads.
- Domain throttle/backoff zit al in de worker.

### Gallery

- Express service met `/api/items`, `/api/items-since`, `/api/platforms`,
  `/api/channels`, `/api/rating`, `/media/:id`, `/thumb/:id`.
- Tag API bestaat: `/api/tags` en `/api/items/:id/tags`.
- Finder endpoint bestaat: `/api/finder`.
- Frontend heeft grid, filters, infinite scroll, viewer shell, `viewer.js`,
  slideshow/random/wrap/video-wait, tags dialog, sidebar en keyboard/mouse
  controls.

### Firefox extensie

- Contextmenu en toolbar bestaan.
- Background build wijst op `simple-background-v2-hub-proxy`.
- HTTP-probing naar simple-server is nog actief; `SOCKET_ENABLED = false`.
- Er is een hub URL constant, maar recording/status blijft nog primair aan
  simple-server gekoppeld.

## Wat nog moet gebeuren

### P0 - eerst stabiliseren

1. **Hub dashboard afronden**
   - De nieuwe `/api/downloads` legacy routes zijn toegevoegd, maar de
     frontend gebruikt de nieuwe `source`, serverstats, platformfilter en
     inline media viewer nog niet volledig.
   - Actie: `webdl-hub/src/public/app.js` afmaken voor hub/server toggling,
     legacy download detail, cancel/retry, stats en media preview.
   - Acceptatie: je kunt in `http://localhost:35730` zowel hub-jobs als
     simple-server downloads beheren zonder naar de oude dashboard-UI te gaan.

2. **Contextmenu routing fixen**
   - Rechtermuisklik-downloads moeten standaard naar hub `POST /api/jobs`.
   - Recording/screenshot/status mogen naar simple-server blijven.
   - Acceptatie: contextmenu op link/image/video maakt een hub-job of
     slave-delegated hub-job aan en verschijnt direct in het hub-dashboard.

3. **Gallery zichtbaarheid auditen**
   - Controleer waarom niet alle completed `public.downloads` zichtbaar zijn.
   - Waarschijnlijke oorzaken: `filepath IS NOT NULL`, dedup op
     `(title/filename/filepath, filesize)`, `format`-detectie, ontbrekende
     bestanden, of platform/channel filters.
   - Acceptatie: een SQL telling per oorzaak en een bewuste keuze welke rijen
     de gallery wel/niet hoort te tonen.

4. **HTML entities/titels normaliseren**
   - Hub dashboard toont soms encoded titels.
   - Actie: decode in rendering of bij metadata ingest, maar niet dubbel.
   - Acceptatie: `&amp;`, `&#39;`, enz. verschijnen leesbaar in UI.

### P1 - daarna uitbreiden

5. **Prioriteit voor losse downloads**
   - Grote playlist-batches mogen losse downloads niet blokkeren.
   - Actie: bij expanded jobs lagere default priority gebruiken dan bij single
     jobs, of een aparte `batch`/`interactive` priority policy toevoegen.
   - Acceptatie: een nieuwe losse URL start voor wachtende playlist-items.

6. **Gallery viewer plan actualiseren en testen**
   - De code is verder dan `PLAN.md` zegt; documentatie en testchecklist lopen
     achter.
   - Actie: browsermatig testen: open viewer, navigeer, rate, tag, slideshow,
     video seek/mute, Finder, mobile viewport.

7. **Hub health/tooling endpoint**
   - Toon welke binaries ontbreken: `yt-dlp`, `gallery-dl`, `instaloader`,
     `ofscraper`, `tdl`, `ffmpeg`.
   - Acceptatie: dashboard laat per adapter zien of hij bruikbaar is.

### P2 - migratie/afbouw legacy

8. **Forum-platforms hub-native maken**
   - Footfetishforum, wikifeet, aznudefeet, amateurvoyeurforum en pornpics
     draaien nu via simple-server/slave delegation.
   - Actie: alleen verplaatsen als de hub-dashboard en gallery visibility eerst
     stabiel zijn.

9. **Simple-server uitfaseren per verantwoordelijkheid**
   - Eerst downloads naar hub, daarna oude gallery redirecten naar
     webdl-gallery.
   - Recording/screenshot pas later verplaatsen; die zijn functioneel anders
     dan downloads.

10. **Tests en regressiecheck**
    - Hub heeft al tests; gallery heeft nog geen automatische smoke/e2e.
    - Actie: minimaal gallery API smoke plus viewer browser smoke toevoegen.

## Directe bouwvolgorde

1. Maak `webdl-hub/src/public/app.js` consistent met de al aangepaste
   `index.html` en de nieuwe `routes-legacy.js`.
2. Test `npm test` in `webdl-hub`.
3. Start hub en controleer `GET /api/downloads/meta/stats`,
   `GET /api/downloads`, en de UI op port 35730.
4. Pas Firefox contextmenu routing aan naar hub.
5. Audit gallery query/tellingen en beslis welke completed records ontbreken
   door data-kwaliteit versus query-bug.

## Niet vergeten

- Er staan al ongestagede wijzigingen in de worktree. Niet blind resetten.
- `firefox-debug-controller.xpi` is gewijzigd; bij extensiewijzigingen moet de
  XPI opnieuw bewust worden gebouwd of juist buiten de commit blijven.
- `webdl-hub/src/api/routes-legacy.js` is nieuw en moet getest worden voordat
  het als onderdeel van de hub-dashboard unificatie wordt gezien.
