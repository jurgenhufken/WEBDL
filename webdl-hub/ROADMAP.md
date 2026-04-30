# WebDL-Hub roadmap - 30 april 2026

Hub is niet meer in de skeleton-fase. Dit document beschrijft de huidige,
praktische roadmap voor de download-master op port `35730`.

## Huidige status

| Onderdeel | Status |
|---|---|
| Express app + static dashboard | klaar |
| PostgreSQL schema `webdl.jobs/files/logs` | klaar |
| Queue claim met `FOR UPDATE SKIP LOCKED` | klaar |
| Lane workers: `process-video`, `video`, `image` | klaar |
| WebSocket progress events | klaar |
| Adapters: `ytdlp`, `gallerydl`, `instaloader`, `ofscraper`, `tdl` | basis klaar |
| YouTube playlist/channel expand | klaar |
| Slave delegation naar simple-server | klaar |
| Slave poller terugkoppeling | klaar |
| Gallery sync naar `public.downloads` | klaar |
| Domain throttle/backoff | basis klaar |
| Unified dashboard voor hub + legacy downloads | in uitvoering |
| Firefox contextmenu direct naar hub | nog te doen |
| Tool health/status in UI | nog te doen |

## P0 - huidige sprint

### 1. Unified dashboard afronden

De backend-route `src/api/routes-legacy.js` is toegevoegd onder
`/api/downloads`. De HTML bevat al controls voor `source=hub/server`, server
stats, platformfilter en inline media viewer. De clientlogica moet nog
consistent worden gemaakt.

Taken:

- Voeg client state toe voor `source`, `serverDownloads`, `serverStats` en
  `platformFilter`.
- Laat `loadJobs()` schakelen tussen `/api/jobs` en `/api/downloads`.
- Implementeer server-list rendering voor `public.downloads` records.
- Implementeer server-detail rendering met `/api/downloads/:id`,
  `/api/downloads/:id/serve` en `/api/downloads/:id/thumb`.
- Laat bulk cancel/retry schakelen tussen `/api/jobs/bulk` en
  `/api/downloads/bulk`.
- Vul serverstats via `/api/downloads/meta/stats`.
- Vul platformfilter via `/api/downloads/meta/platforms`.

Acceptatie:

- Hub dashboard toont hub-jobs en legacy server-downloads via dezelfde UI.
- Cancel/retry werkt voor beide bronnen.
- Media preview werkt voor images en videos.
- Er zijn geen dode DOM-referenties naar velden die niet bestaan.

### 2. Route-volgorde legacy API bewaken

Dit is in deze ronde gecorrigeerd: `/meta/platforms` en `/meta/stats` staan
nu voor `/:id`, met een regressietest.

Nog te controleren met echte data:

- `GET /api/downloads/meta/stats`
- `GET /api/downloads/meta/platforms`
- `GET /api/downloads?limit=10`
- `GET /api/downloads/:id`

Acceptatie:

- Meta endpoints geven JSON terug en worden niet opgegeten door `/:id`.
- De queries passen bij de echte `public.downloads` kolommen.

Handmatige smoke:

  - `GET /api/downloads/meta/stats`
  - `GET /api/downloads/meta/platforms`
  - `GET /api/downloads?limit=10`
  - `GET /api/downloads/:id`

### 3. Contextmenu routing naar hub

De Firefox background gebruikt nog simple-server als primaire endpoint voor
status/recording. Dat is goed voor REC/screenshot, maar download-intake moet
naar hub.

Taken:

- Houd `SERVER_URL` voor status/recording/screenshot.
- Gebruik `HUB_URL` voor contextmenu download en toolbar download.
- Fallback: als hub niet bereikbaar is, toon foutmelding; niet stil terugvallen
  naar oude `/download` tenzij expliciet gewenst.

Acceptatie:

- Rechtermuisklik op link/image/video maakt een hub-job aan.
- Slave-platforms verschijnen als hub-job met `adapter='slave-delegate'`.

### 4. Titels en HTML entities

Taken:

- Decodeer titels in de dashboard-rendering of bij `videoTitle()` fallback.
- Voorkom dubbele decode door de data in de DB ongemoeid te laten totdat er een
  duidelijke ingest-policy is.

Acceptatie:

- Dashboard toont leesbare titels bij `&amp;`, `&#39;`, `&quot;`.

## P1 - queuekwaliteit

### 5. Interactieve downloads voorrang geven

Probleem: grote expanded playlist-groepen kunnen losse downloads verdringen.

Voorkeursoplossing:

- Single jobs krijgen default priority `10`.
- Expanded playlist-items krijgen default priority `0` of lager.
- Bestaande expliciete `priority` uit API blijft leidend.

Acceptatie:

- Een nieuwe single URL start voor reeds wachtende playlist-items in dezelfde
  lane.
- Tests voor `expandAndEnqueue`/priority of repo-claim volgorde.

### 6. Health endpoint voor externe tools

Taken:

- Check binaries: `yt-dlp`, `gallery-dl`, `instaloader`, `ofscraper`, `tdl`,
  `ffmpeg`.
- Toon versie waar goedkoop beschikbaar.
- Dashboard badge per adapter.

Acceptatie:

- Ontbrekende tools zijn zichtbaar voordat een job faalt.

### 7. Adapter-testdekking uitbreiden

Per adapter:

- `matches()` positieve en negatieve URL cases.
- `plan()` argv-samenstelling.
- `parseProgress()` fixtures waar relevant.
- Online smoke blijft opt-in.

## P2 - legacy verminderen

### 8. Forum-platforms hub-native

Pas doen nadat dashboard en gallery visibility stabiel zijn.

Volgorde:

1. Footfetishforum direct HTTP attachment downloader.
2. Wikifeet.
3. Aznudefeet.
4. Amateurvoyeurforum.
5. Pornpics.

Acceptatie per adapter:

- Kan bestaande cookies/referrer/user-agent policy overnemen.
- Schrijft outputs naar hub download root.
- Sync naar `public.downloads` geeft zichtbaarheid in webdl-gallery.

### 9. Simple-server download scheduler afbouwen

Niet in een keer verwijderen.

Stappen:

1. Nieuwe intake naar hub.
2. Oude pending batches per platform migreren.
3. Simple-server houdt recording/screenshot/4K-watcher totdat die apart zijn.
4. Oude gallery/viewer redirecten naar `webdl-gallery`.

## Teststrategie

- Run lokaal: `cd /Users/jurgen/WEBDL/webdl-hub && npm test`.
- Voeg route-smoke toe voor nieuwe legacy endpoints.
- Online downloads alleen met `TEST_ONLINE=1`.
- Voor UI: handmatige browsercheck op port `35730` na elke dashboardwijziging.
