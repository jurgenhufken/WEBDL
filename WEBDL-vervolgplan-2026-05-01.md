> ⚠️ **VEROUDERD per 2026-05-30** — uit 2 mei. Voor actueel:
> - [STATUS-2026-05-24.md](STATUS-2026-05-24.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DOCS-INDEX.md](DOCS-INDEX.md)

# WEBDL vervolgplan voor nieuwe chat

## Huidige status

- Hub hoofdpoort hoort `http://localhost:35730` te zijn, maar poort `35730` gaf op 2026-05-02 een tijdelijk `EADDRINUSE` conflict.
- Er draait nu een tijdelijke hub-worker op `http://localhost:35732` om de vastgelopen Vipergirls full-size queue af te maken.
- Recorder/simple-server draait op `http://localhost:35729`.
- Gallery draait op `http://localhost:35731`.
- SABNZBD is bereikbaar, maar queue is leeg: `0 slots`, `0 B`.
- Nieuwe hoofdschijf is `/Volumes/WEBDL Extra/WEBDL`.
- Oude schijf blijft leesbaar: `/Volumes/HDD - One Touch/WEBDL`.
- Hub watcher kijkt naar oude en nieuwe SAB completed folders.
- Hub UI is aangepast: links groepen/playlists, rechts losse videos per groep, met leesbare namen in plaats van codes.
- Na de laatste hub-restart stond er nog 1 echte hub-download actief. Oude spook-running jobs zijn teruggezet naar wachtrij.
- Gallery viewer is aangepast naar versie `20260502-46`:
  - knop `↻ Video` herbouwt alleen de huidige player, niet de hele browser;
  - bij video-error verschijnt ook `Opnieuw laden`;
  - als de viewer open is, pauzeert de gallery achtergrond-polls;
  - `∞ Oneindig` laadt verder uit de database, `Query loop` is optioneel;
  - random, kanaal/model-scope, positie onthouden bij browser-back, slowmotion en achteruit afspelen zijn toegevoegd;
  - dit is gedaan omdat de hapering vooral lijkt te komen door laptop-/browser-/decoder-belasting, niet door een kapot bestand.
- ViperGirls image-batch is hersteld:
  - thumbnails van `vipr.im/th/...` worden omgezet naar full-size `vipr.im/i/.../30.jpg`;
  - oude kleine/bad imports zijn `superseded`;
  - nieuwe full-size items worden als `vipergirls / thread_6777850` in `Alle media` geïnjecteerd.
- Firefox toolbar add-on is opnieuw gepackt als `firefox-debug-controller.xpi` met build `debug-toolbar-2026-05-02-05`.
  - Nieuwe knop: `🔐 K2S pagina`.
  - Klik: Keep2Share-links op huidige ViperGirls pagina.
  - Shift/Alt-klik: Keep2Share-links uit de hele thread scannen.
  - Cmd/Ctrl-klik: scanlimieten instellen.

## Belangrijke waarschuwingen

- Stop geen opnames zonder expliciete toestemming.
- Verwijder niets automatisch.
- Oude SAB partial downloads niet verplaatsen; gebruik NZB's opnieuw invoeren als herstelroute.
- Completed media op oude schijf laten staan totdat DB/gallery gecontroleerd zijn.
- De hub en gallery moeten duidelijke, mensvriendelijke omschrijvingen tonen, geen interne IDs als hoofdtitel.
- Bij gallery/video haperingen niet meteen bestanden verdenken. Eerst systeemdruk controleren: Firefox/GPU, WindowServer, PostgreSQL, ffmpeg-opname, yt-dlp en gallery-polls kunnen samen de speler laten vastlopen.

## Aangepaste bestanden

- `/Users/jurgen/WEBDL/webdl-hub/src/db/repo.js`
- `/Users/jurgen/WEBDL/webdl-hub/src/api/routes-jobs.js`
- `/Users/jurgen/WEBDL/webdl-hub/src/public/index.html`
- `/Users/jurgen/WEBDL/webdl-hub/src/public/app.js`
- `/Users/jurgen/WEBDL/webdl-hub/src/public/styles.css`
- `/Users/jurgen/WEBDL/webdl-gallery/server.js`
- `/Users/jurgen/WEBDL/webdl-gallery/public/index.html`
- `/Users/jurgen/WEBDL/webdl-gallery/public/app.js`
- `/Users/jurgen/WEBDL/webdl-gallery/public/viewer.js`
- `/Users/jurgen/WEBDL/webdl-gallery/public/styles.css`
- `/Users/jurgen/WEBDL/firefox-native-controller/content/debug-toolbar.js`
- `/Users/jurgen/WEBDL/firefox-debug-controller.xpi`

## Volgende stappen

1. Controleer visueel de hub na harde refresh: `Cmd + Shift + R`.
2. Check of links alleen groepen staan en rechts losse videos verschijnen.
3. Controleer of er nergens meer codes zoals `dcdfa...` of `Playlist PL...` als hoofdtitel staan.
4. Controleer de gallery viewer na harde refresh van alleen het huidige tabblad: `Cmd + Shift + R`.
   - Open een video.
   - Als de speler meldt dat video niet kan worden afgespeeld, klik `↻ Video`.
   - Als dat niet helpt, gebruik volgende/vorige als tijdelijke player-reset.
   - Check bij herhaling systeemdruk voordat je media-bestanden gaat repareren.
5. Controleer dat de tijdelijke hub-worker klaar is met de Vipergirls full-size queue:
   - `done` moet doorlopen tot alle `full-size-vipr-requeue` jobs klaar zijn;
   - `Alle media` moet de nieuwe `vipergirls / thread_6777850` items bovenaan tonen.
6. Daarna poortconflict `35730` opruimen en hub weer normaal op `35730` starten.
7. Daarna pas verder met SAB:
   - oude NZB's uit `/Volumes/HDD - One Touch/WEBDL/_SABNZBD/Downloading` inventariseren;
   - staged NZB-map controleren:
     `/Volumes/WEBDL Extra/WEBDL/_SABNZBD/_RESTORE_NZB_FROM_OLD_DOWNLOADING_2026-05-01`;
   - duplicaten verwijderen uit die NZB-lijst;
   - daarna opnieuw toevoegen aan SAB op de nieuwe HDD.
8. Cleanup pas daarna:
   - grote duplicaten zoeken op grootte en hash;
   - ballast rapporteren;
   - niets verwijderen zonder expliciete akkoordstap.

## Handige checks voor volgende chat

```bash
curl -fsS http://localhost:35729/status
curl -fsS http://localhost:35730/api/jobs/meta/stats
curl -fsS http://localhost:35732/health
curl -fsS http://localhost:35730/api/sabnzbd/status
curl -fsS 'http://localhost:35731/api/items?limit=10&sort=recent'
screen -ls
git status --short
ps -Ao pid,ppid,%cpu,%mem,command | sort -nrk3 | head -30
```

## Belangrijkste open taak

SAB-queue herstellen. Niet de oude partial mappen verplaatsen, maar NZB's opnieuw invoeren op de nieuwe HDD, na controle van SAB categorieen en paden.
