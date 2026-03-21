# WEBDL status – 14 feb 2026

## Actieve focus
1. **Toolbarverbinding stabiliseren**  
   - Bestand: `firefox-native-controller/background/simple-background.js`  
   - Doel: pollende fetches vervangen door één persistente verbinding (socket/WebSocket) zodat REC/Screenshot/Download direct ACK krijgen en de server niet elke 2 s wakker wordt.  
   - Stand: polling- en statuslogica in kaart gebracht; connectielaag wordt nu herschreven. Nog geen stabiele build.

## Openstaande punten / aandachtspunten
1. **Gallery-cache & renderbuffer**  
   - **Doel**: `/api/media` moet direct uit een persistente index + thumbnailcache lezen zodat pagina’s niet telkens opnieuw de volledige disk scannen.  
   - **Backend todo**: 
     - SQLite/JSON index toevoegen met velden: kind, id, platform, channel, title, filepath, thumbPath, status, updated_at.  
     - Thumbnailbuilder (`pickOrCreateThumbPath`) met write-through cache + invalidatie wanneer bronbestanden verdwijnen.  
     - API-endpoints `/api/media/recent-files` en `/api/media/channel-files` laten terugslaan op cache en async refresh kickstarten als cache stale is (>5m).  
   - **Frontend todo**:  
     - Grid moet eerst placeholders uit cache renderen, daarna renderbuffer gebruiken om “echte” thumbs in batches te laden.  
     - Alleen kaartjes tonen wanneer `ready=true` (bestand+thumb beschikbaar); downloads in progress tonen als overlay.  
   - **Blocking dependency**: stabiele toolbar/socket is nodig om statusinfo betrouwbaar te laten pushen naar de gallery.  
   - **Acceptatie**: 1) `/media`-pagina laadt <2s bij 5k items, 2) geen “leeg”-kaarten, 3) thumbnails blijven aanwezig tussen restarts.

2. **Auto load-modus voor YouTube-downloads**  
   - **Doel**: heavy/light downloadlanes automatisch throttlen op basis van CPU/load, met handbediende override in de gallery UI.  
   - **Backend**: monitor loadavg + actieve processen; expose `/api/youtube/settings` + `/api/youtube/auto` endpoints voor status en toggles.  
   - **Frontend**: YT-controls in de gallery krijgen switch (Auto / Manual), indicator van actuele concurrency en throttle-log (laatste aanpassing).  
   - **Blocking**: gallery-cache moet eerst klaar zodat er een plek is om UI te tonen; toolbarfix noodzakelijk om statusupdates realtime binnen te krijgen.  
   - **Acceptatie**: toggles werken, concurrency wijzigt automatisch, UI toont laatste aanpassingstijd en reden (cpu/io/queue).

3. **Toolbarverbinding / socket (lopend)**  
   - **Huidige werk**: `firefox-native-controller/background/simple-background.js` ombouwen van 2s-polling + fetch naar één persistente verbinding (Socket/WS of EventSource).  
   - **Taken**:  
     - Connectie-init + heartbeat + backoff-reconnect.  
     - Eventroutering (connection state, recording state, logmeldingen).  
     - Request/response kanaal voor REC/Screenshot/Download i.p.v. losse fetches.  
   - **Blokkade**: zolang dit niet klaar is blijven REC/Screenshot/Download traag en gaat de server niet “idle”.  
   - **Acceptatie**: toolbar blijft verbonden >30m zonder polling; REC start/stop reageren <1s met één klik.

4. **REC Start/Stop betrouwbaarheid**  
   - **Doel**: knoppen moeten direct reageren en feedback geven; geen 100× klikken meer.  
   - **Plan**: zodra socket staat, debouncing + pending indicator toevoegen, serverresponses laten pushen naar actieve tab, en per tab de eigen recordingstate tonen.  
   - **Extra**: foutmeldingen (bijv. “server bezig”) in notificatiepaneel loggen.

5. **Multi-REC ondersteuning**  
   - **Doel**: meerdere tabs tegelijk kunnen opnemen (elk met eigen opname-ID, map en metadata).  
   - **Backend**: `simple-server.js` moet Recording jobs tracken per `recordingId`, eigen bestandsnamen genereren en state in DB/JWT opslaan.  
   - **Frontend**: toolbar toont per tab status (“REC #123 loopt”, stopknop per tab).  
   - **Dependency**: betrouwbare socket + REC UI (punt 4) moet klaar zijn.  
   - **Acceptatie**: minimaal 3 parallelle REC-sessies zonder dat knoppen blokkeren.

6. **Right-click WEBDL Download**  
   - **Huidige staat**: contextmenu werkt, stuurt metadata + sourceUrl.  
   - **Todo**: logging uitbreiden (download queue feedback tonen), metadata verrijken per site (OnlyFans, Chaturbate, kinky).  
   - **Nice-to-have**: melding tonen wanneer server queue vol loopt.

7. **Extra download tools**  
   - **Packages**: instaloader (Instagram), reddit-dl (Reddit), yt-dlp-facebook plugin.  
   - **Server**: integreren als aparte lanes + UI-knoppen in toolbar/gallery.  
   - **Dependency**: gallery-cache/toolbarfix klaar zodat nieuwe jobs netjes zichtbaar zijn.

8. **Open alle (klaar)**  
   - Toolbar-knop scant gridlinks en opent ze; gereed, maar moet getest worden onder nieuwe socketlaag om te voorkomen dat events verdubbelen.

## Blokkerende issues
- Toolbar gebruikt nog pollende fetches; zolang de socket-herbouw niet klaar is, blijven REC/Screenshot/Download traag en is verder bouwen zinloos.  
- Serverload blijft hoog zolang de toolbar om de 2 s `/status` opvraagt; idem voor content-script, daarom eerst de connectielaag afronden.

## Volgende stap na toolbarfix
1. Wederzijdse ACK/heartbeat testen.  
2. Gallery-cache/index + renderbuffer afronden.  
3. Auto load-modus + UI-toggles.  
4. Multi-REC implementeren.
