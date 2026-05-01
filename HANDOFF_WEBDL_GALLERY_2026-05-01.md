# WEBDL Gallery Handoff - 2026-05-01

Dit document is bedoeld om in een nieuwe chat snel verder te kunnen zonder de hele thread opnieuw te lezen.

## Context

- Workspace: `/Users/jurgen/WEBDL`
- Branch: `codex/fix-gallery-keep2share-live`
- App in browser: `http://localhost:35731/`
- Tijdzone gebruiker: Europe/Amsterdam
- Belangrijk: raak deze twee lokale XPI-bestanden niet aan, die zijn niet van deze fixes:
  - `firefox-debug-controller.xpi`
  - `firefox (1).xpi`

## Wat de gebruiker wil

- Gallery moet de nieuwste downloads echt bovenaan tonen, zonder rare subqueries of ingewikkelde sorteerlogica.
- Items die alleen in queue staan mogen niet zichtbaar zijn als gallery-items.
- Nieuwe server/JDownloader/Keep2Share downloads moeten na afronden in de gallery verschijnen.
- Geen thumbnails downloaden of tonen als hoofdmedia wanneer de hoofdafbeelding/video beschikbaar is.
- Afbeeldingen moeten altijd in light viewer worden geopend.
- Viewer moet lijken op de oude gallery viewer:
  - logische boven- en onderoverlay;
  - playknop, duur/seconden en controls zichtbaar bij video;
  - overlay mag niet te groot zijn;
  - overlay moet kunnen verdwijnen zoals vroeger.
- Tags moeten beheersbaar zijn:
  - oude onzin-tags verwijderen of samenvoegen;
  - tags binnen het tagkader houden;
  - naast het tagmenu klikken moet het menu sluiten;
  - vaak gebruikte tags makkelijk selecteerbaar maken of door gebruiker laten pinnen/selecteren.
- Downloads moeten door blijven lopen; gebruiker meldt meerdere keren dat het stil lijkt te staan en dat nieuw opgegeven downloads niet bijkomen.

## Recente commits op deze branch

Deze commits zijn al gepusht:

```text
d2a457d Reject empty slave download completions
45f4519 Handle YouTube throttling and scheduler watchdog
24c4d80 Fix lane-specific simple-server rehydrate
ff8dd8b Remove Keep2Share sync add cap
13a733e Refine gallery viewer overlays and tags
ade5cec Fix Keep2Share server download handling
6cd6f2b Clean gallery tags and restore viewer controls
40b04b3 Restore old viewer HUD behavior
```

## Draaiende services bij laatste check

Laatste lokale check:

```text
Gallery:       http://localhost:35731/api/health -> {"ok":true}
Simple server: http://localhost:35729/health -> running
Hub:           http://localhost:35730/api/health -> {"ok":true,"db":"up"}
```

Processen:

```text
81068 /opt/homebrew/bin/node server.js
92347 /opt/homebrew/bin/node src/server.js
94696 node src/simple-server.js
```

Let op: PIDs kunnen veranderen na restart.

## Wat al is opgelost

### YouTube rate limit

Probleem:

```text
ERROR: [youtube] ... Your account has been rate-limited by YouTube for up to an hour
```

Gefixt in:

- `/Users/jurgen/WEBDL/webdl-hub/src/adapters/ytdlp.js`
- `/Users/jurgen/WEBDL/webdl-hub/src/queue/worker.js`

Gedrag nu:

- yt-dlp krijgt sleep-args voor YouTube.
- Hub pauzeert YouTube tijdelijk bij rate-limit in plaats van continu door te hameren.

### Queue starvation / downloads lijken stil te staan

Probleem:

- Simple-server rehydrate werkte te globaal.
- Als de YouTube/process-video lane vol zat, konden light/server/image downloads blijven hangen.

Gefixt in:

- `/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js`

Belangrijk:

- Rehydrate is lane-specifiek gemaakt.
- Image/direct URLs gaan naar light lane.
- Scheduler watchdog toegevoegd zodat queues weer starten als in-memory lanes capaciteit hebben.

### Keep2Share limiet

Probleem:

- Hub leek gemaximeerd op 500 downloads.

Gefixt in:

- Commit `ff8dd8b Remove Keep2Share sync add cap`

### Lege slave completions

Probleem:

- Hub job `3417` verwees naar simple-server download `233441`.
- Simple-server had die als completed gemarkeerd met lege `filepath`, lege `filename`, `filesize=0`.
- Daardoor verscheen niets in de gallery en bleef hub-job vastlopen.

Gefixt in:

- `/Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js`
- `/Users/jurgen/WEBDL/webdl-hub/src/queue/slave-poller.js`

Gedrag nu:

- Simple-server mag geen completed zonder importeerbaar bestand meer accepteren.
- Hub faalt slave-delegate jobs als slave completed zegt maar geen filepath heeft.

Nog controleren:

- Running hub-proces moet herstart zijn om `slave-poller.js` fix live te hebben.
- Bij laatste check stond job `3417` nog als running, dus waarschijnlijk draait hub nog met oude in-memory state of de poller had die nog niet afgehandeld.

## Actuele bekende problemen

### 1. Active strip toont rare kaarten zoals `DOWNLOADING DOWNLOADING`

Gebruiker zag bovenaan kaarten:

```text
DOWNLOADING DOWNLOADING
your pizza girl flowina
youtube / NA

DOWNLOADING DOWNLOADING
Showing Her Soles
footfetishforum / Showing Her Soles
```

Waarschijnlijke oorzaak:

- In `/Users/jurgen/WEBDL/webdl-gallery/public/app.js` gebruikt `renderActiveItems()` status als fallback voor source/platform.
- Daardoor kan de header dubbel `DOWNLOADING` tonen.

Te patchen:

- Toon platform/source links en status rechts.
- Gebruik status niet als source fallback.
- Voorbeeldlogica:

```js
const platform = (it.platform || it.source || 'active').toString().toUpperCase();
const status = (it.status || '').toString().toUpperCase();
const right = status && status !== platform ? status : '';
```

### 2. `Showing Her Soles` komt uit oude footfetishforum queue

Dit is niet ineens verzonnen door de gallery. Het zijn echte oude simple-server queue entries rond:

```text
https://footfetishforum.com/threads/showing-her-soles.5311/
```

Bij eerdere DB-check:

```text
Showing Her Soles: downloading 4, queued 14, error 4449
```

Veel daarvan falen met Cloudflare/403 als de server geen geldige Firefox cookies heeft.

Vervolg:

- Check of deze oude entries nog queued/downloading staan.
- Als gebruiker ze niet meer wil: zet alleen deze oude `Showing Her Soles` queue entries op `error` of `paused/on_hold`.
- Doe dit bewust en gericht, niet met brede delete/reset.

### 3. Gallery krijgt mogelijk geen nieuwe server-downloads binnen

Gebruiker meldt:

- “er komt weer niets bij de gallery”
- “ik heb van alles in opdracht gegeven”
- “ik bedoel downloads via de servers”

Te controleren:

```bash
curl -sS 'http://localhost:35730/api/jobs?status=running&limit=20'
curl -sS 'http://localhost:35730/api/jobs?status=queued&limit=20'
curl -sS 'http://localhost:35729/downloads?status=downloading&limit=20'
curl -sS 'http://localhost:35729/downloads?status=queued&limit=20'
curl -sS 'http://localhost:35731/api/items?limit=20&sort=recent'
```

Let op:

- `/api/active-items` op de gallery gaf bij laatste check leeg terug:

```json
{"items":[],"count":0}
```

- Hub had toen nog running jobs, waaronder:

```text
job 3872 tiktok ytdlp running
job 3417 slave-delegate running -> simple_server_download_id 233441
```

Dit verschil tussen hub-running en gallery-active moet worden onderzocht.

### 4. TikTok cards zonder thumbnails

Gebruiker ziet TikTok cards bovenaan zonder thumbnails.

Waarschijnlijke richtingen:

- TikTok live/profile/tag URLs leveren soms geen direct thumbnail-bestand.
- Sommige entries zijn live/profile discovery items en geen echte gedownloade media.
- Queue/discovery items moeten niet als gallery-items zichtbaar zijn.

Controleer:

- Of deze items `filepath` hebben.
- Of `status=completed` is.
- Of `thumbnail` echt bestaat.
- Of `source_url`/metadata op discovery/profile staat in plaats van een echte video.

## Belangrijk voor volgende chat

Niet opnieuw groot ontwerpen. De gebruiker wil juist dat het simpeler wordt:

- Sorteer op nieuwste download/import, niet op ingewikkelde subqueries.
- Queue-items niet in gallery.
- Alleen completed/imported media tonen.
- Server/JDownloader/Keep2Share downloads moeten na afronden zichtbaar worden.
- De oude viewer-stijl herstellen in plaats van nieuwe overlay-stijl verzinnen.

## Aanbevolen eerstvolgende stappen

1. Patch `renderActiveItems()` in `/Users/jurgen/WEBDL/webdl-gallery/public/app.js` zodat `DOWNLOADING DOWNLOADING` verdwijnt.
2. Check hub job `3417` en simple-server download `233441`; herstart eventueel hub zodat `d2a457d` actief wordt en de stale slave-delegate faalt.
3. Query simple-server DB of API op recente server/Keep2Share downloads en vergelijk met gallery `/api/items?sort=recent`.
4. Controleer waarom nieuwe completed downloads niet in gallery komen:
   - ontbreekt `filepath`;
   - bestandsextensie niet importeerbaar;
   - gallery filtert status/platform verkeerd;
   - watcher/importer ziet downloadmap niet.
5. Gebruik browser-use om de huidige in-app browser zelf te bekijken en na reload te verifiëren.
6. Pas tag-menu CSS/JS aan:
   - lijst binnen kader laten scrollen;
   - backdrop/outside click sluit menu;
   - pinned/favorite tags toevoegen.
7. Commit en push alleen codewijzigingen, niet de XPI-bestanden.

## Handige commands

Status:

```bash
cd /Users/jurgen/WEBDL
git status --short --branch
git log --oneline -8
```

Health:

```bash
curl -sS http://localhost:35731/api/health
curl -sS http://localhost:35729/health
curl -sS http://localhost:35730/api/health
```

Queues:

```bash
curl -sS 'http://localhost:35730/api/jobs?status=running&limit=20'
curl -sS 'http://localhost:35730/api/jobs?status=queued&limit=20'
curl -sS 'http://localhost:35729/downloads?status=downloading&limit=20'
curl -sS 'http://localhost:35729/downloads?status=queued&limit=20'
```

Gallery:

```bash
curl -sS 'http://localhost:35731/api/active-items'
curl -sS 'http://localhost:35731/api/items?limit=20&sort=recent'
```

Processen:

```bash
ps -p 81068,92347,94696 -o pid,ppid,command
lsof -i :35731 -i :35730 -i :35729
```

## Git state bij overdracht

Laatste bekende status:

```text
## codex/fix-gallery-keep2share-live...origin/codex/fix-gallery-keep2share-live
 M firefox-debug-controller.xpi
?? "firefox (1).xpi"
```

Er waren op dat moment geen oncommitted codewijzigingen, alleen de lokale XPI-bestanden.
