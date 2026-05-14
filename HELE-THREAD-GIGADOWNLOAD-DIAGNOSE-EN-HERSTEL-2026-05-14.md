# Hele thread en gigadownload: diagnose en herstelplan

Datum: 2026-05-14  
Scope: Firefox toolbar, webdl-hub, simple-server/slave, webdl-gallery

Dit document vervangt de losse diagnose- en herstelontwerpdocumenten. Het doel is één bron van waarheid: wat ging er mis, welke valkuilen moeten we vermijden, en hoe herstellen we gewone "Hele thread" plus robuuste Giga downloads.

## Doel en uitgangspunt

Gewone "Hele thread" werkte in git al als gebruikersflow via de normale batch-route. Die git-flow is daarom de herstelbaseline: eerst terug naar bewezen werkend gedrag, daarna pas gericht moderniseren.

Git is niet het eindontwerp. Nieuwe eisen zoals Giga downloads, K2S-preflight, manifests, lifecycle-observability en gallery-audits mogen blijven, maar ze mogen niet opnieuw in de gewone "Hele thread"-knop lekken.

Voor dit document geldt: geen aannames als feit. Elke claim krijgt een bewijsstatus:

- **Bewezen:** bevestigd door lokale code, data, logs, testoutput of read-only query.
- **Hypothese:** plausibel, maar nog te bevestigen.
- **Actie pas na bewijs:** pas uitvoeren nadat de faallocatie is aangetoond.

## Deel 1: Diagnose

Datum: 2026-05-14  
Scope: `firefox-native-controller`, `screen-recorder-native`, `webdl-hub`, `webdl-gallery`

## Korte conclusie

De huidige regressie komt niet door een losse ViperGirls- of Keep2Share-fix op zichzelf. De boosdoener is dat de nieuwe gigadownload/achtergrondscan-logica in dezelfde codepaden is gezet als de bestaande "Hele thread"-knop.

De onderliggende werkfout: er zijn aannames gedaan over threadlinks, next-page links, source context en queue-route zonder eerst de echte hrefs, canonical URLs en metadata-flow per platform uit te schrijven. Dat is precies hoe een fout als `/threads/threads/...` kon ontstaan en daarna door dedupe/gallery-context heen kon lekken.

Daardoor is gedrag dat in git nog simpel en werkend was:

```js
queueBatchDownloadRequest(urls, meta, { force, directHints, sourceContexts })
```

veranderd in een combinatie van:

- chunked queueing via `queueThreadBatchDownloadRequest`
- geforceerde hub-route met `preferHub: true`
- manifest queueing voor grote batches
- FFF-background worker-tabs
- watchdog restarts
- FFF-wrapper resolving
- speciale platform metadata overschrijvingen

Die nieuwe laag hoort bij "giga download", maar beïnvloedt nu ook gewone "Hele thread" downloads voor FootFetishForum en ViperGirls.

## Bewijsstatus na codecheck

De hoofdconclusie is hard bevestigd in de huidige worktree: gewone "Hele thread" downloads voor FootFetishForum en ViperGirls worden nu door dezelfde chunk/manifest/hub-route geleid als de Giga-flow. Ook de ViperGirls `pageUrl`-corruptie met `/threads/threads/` is hard bevestigd in `tmp-vipergirls-14180551-k2s.json`.

Niet alle beschreven symptomen zijn daarmee even hard bewezen als primaire oorzaak. Voor het actieplan geldt daarom dit onderscheid:

- **Bewezen:** normale thread-flow gebruikt nu `queueThreadBatchDownloadRequest`; chunks forceren `preferHub: true`; grote batches kunnen via `/api/jobs/batch-file` alleen `accepted` teruggeven; ViperGirls context kan kapotte `/threads/threads/` URLs bevatten.
- **Hypothese:** K2S-auth, slave-poller, gallery-filtering en worker/watchdog kunnen symptomen versterken, maar hun concrete impact moet per run met logs, responses of read-only queries worden bevestigd.
- **Actie pas na bewijs:** K2S-preflight, lifecycle-endpoints, gallery-audits, watchdog-wijzigingen en Giga-idempotentie worden niet in de eerste herstelstap gebouwd.

Praktische consequentie: Gate 1 herstelt alleen de oude werkende gebruikersflow. Modernisering volgt pas in aparte gates, nadat Gate 0 het bewijs heeft vastgelegd.

## Wat in git werkte

In de git-versie stond de normale thread-flow aan het einde van `runBatchFromWholeThread` nog rechttoe rechtaan:

```js
const result = await queueBatchDownloadRequest(urls, meta, {
  force,
  directHints: selectedDirectHints,
  sourceContexts: selectedSourceContexts
});
```

Belangrijk: dit was geen theoretisch ontwerp maar de bewezen werkende gewone "Hele thread"-flow in git. De normale knop functioneerde op zichzelf al via de bestaande batch-route. Het herstel is daarom eerst een terugkeer naar die baseline, geen herontwerp van "Hele thread".

Dat betekende:

- de browser verzamelde URLs;
- preview-selectie gaf `urls`, `directHints` en `sourceContexts`;
- de hele selectie ging als normale batch naar de bewezen werkende bestaande queue-route;
- de fallback naar background/simple-server bleef hetzelfde als bij gewone downloads;
- er was geen aparte worker-tab, manifest-file, watchdog of FFF-specifieke queue-mutatie.

Belangrijk: "Hele thread" en "Giga" deelden wel dezelfde functie, maar de gigalaag greep nog niet in op de normale queue-afhandeling.

## Wat nu is veranderd

In de huidige worktree is het einde van `runBatchFromWholeThread` gewijzigd naar:

```js
const isFffQueueTarget = isForumPage || isThreadPage;
const shouldChunkThreadBatch =
  isFffQueueTarget || isVipergirlsThread || isVipergirlsForum || urls.length > FFF_THREAD_QUEUE_BATCH_SIZE;

const finalMeta = isFffQueueTarget
  ? {
      ...meta,
      platform: 'footfetishforum',
      webdl_batch_kind: 'footfetishforum_thread_chunked',
      webdl_pin_context: true,
    }
  : meta;

const result = shouldChunkThreadBatch
  ? await queueThreadBatchDownloadRequest(urls, finalMeta, ...)
  : await queueBatchDownloadRequest(urls, finalMeta, ...);
```

Dat lijkt klein, maar het verandert het gedrag fundamenteel:

- FootFetishForum gaat altijd door chunked queueing.
- ViperGirls thread/forum gaat ook altijd door chunked queueing.
- Chunks gebruiken `preferHub: true`, waardoor de oude background/simple-server route wordt overgeslagen.
- Grote batches gaan via `/api/jobs/batch-file`, dus de browser krijgt alleen "accepted", niet de echte queue-resultaten.
- FFF krijgt hard `platform: 'footfetishforum'`, ook als de oorspronkelijke metadata subtieler was.

## Waarom "giga download" de boosdoener is

De gigadownload-wijziging heeft drie dingen tegelijk gedaan:

1. Nieuwe achtergrondscan toegevoegd voor FFF.
2. Nieuwe chunk/manifest-queue toegevoegd voor grote batches.
3. Die nieuwe queue-logica ook onder normale "Hele thread" gehangen.

Het probleem zit vooral in punt 3. De normale knop en de gigaknop blijven dezelfde functie gebruiken:

```js
threadBatchDownloadBtn -> runBatchFromWholeThread(..., { force })
gigaDownloadBtn       -> runBatchFromWholeThread(..., { force, forceGiga: true })
```

Daardoor zijn gigagedrag en normaal threadgedrag niet meer goed gescheiden. Een fix voor "grote scans niet laten vastlopen" heeft de stabiele normale batch-route vervangen.

## Concrete fouten en risico's

### 1. Gewone "Hele thread" gebruikt nu chunked hub-route

Bestand: `firefox-native-controller/content/debug-toolbar.js`

Nieuwe functie:

```js
queueThreadBatchDownloadRequest(urls, meta, options)
```

Deze route:

- splitst in chunks van 50;
- gebruikt bij chunks `preferHub: true`;
- stuurt daardoor direct naar `webdl-hub`;
- gebruikt bij >= 1000 items `/api/jobs/batch-file`.

Voor bestaande forum/media-host downloads was de oude route belangrijk omdat de background/simple-server route beter wist hoe legacy wrappers, cookies en host-specifieke downloads moesten worden behandeld.

### 2. FFF-background worker is niet geïsoleerd van normale thread-flow

Bestanden:

- `firefox-native-controller/content/debug-toolbar.js`
- `firefox-native-controller/background/simple-background.js`

Er is een nieuwe FFF-background worker-tab flow:

```js
startFffBackgroundScanRequest(...)
runFffBackgroundScan(...)
queueFffBackgroundCandidates(...)
```

Die flow is bedoeld voor giga/achtergrondscan, maar wordt ook gestart wanneer de gewone scan `stoppedByGiga` raakt. Dat maakt de normale flow afhankelijk van:

- worker-tab injectie;
- content-script messaging;
- heartbeat;
- watchdog;
- tab lifecycle;
- wrapper-resolving;
- chunked hub queueing.

Als één onderdeel hapert, lijkt "Hele thread" stuk.

### 3. Watchdog kan dubbel werk veroorzaken

Bestand: `firefox-native-controller/background/simple-background.js`

Nieuwe watchdog:

```js
FFF_BACKGROUND_STALE_MS = 180000
FFF_BACKGROUND_MAX_RESTARTS = 2
```

Bij geen progress sluit hij de oude tab en start opnieuw. Dat is nuttig voor een echte achtergrondscan, maar riskant zolang queueing niet idempotent genoeg is:

- initial URLs kunnen opnieuw worden aangeboden;
- eerder gescande threads kunnen opnieuw starten;
- oude scan krijgt status `stale-restarting`, nieuwe scan krijgt een nieuw `scanId`;
- de UI/logs raken moeilijk te volgen;
- bij trage sites kan "geen progress" ook betekenen dat hij nog bezig is, niet dat hij vast zit.

### 4. ViperGirls/K2S context bevat aantoonbaar kapotte page URLs

Bestand: `tmp-vipergirls-14180551-k2s.json`

In de gegenereerde K2S-data staat vanaf pagina 2 onder `pageUrl`:

```text
https://viper.to/threads/threads/14180551-iCloud-Leaks-3-0-The-fappening-%28full-sets%29/page2
```

Dat is fout. Er staat dubbel:

```text
/threads/threads/
```

Correct zou zijn:

```text
https://viper.to/threads/14180551-iCloud-Leaks-3-0-The-fappening-%28full-sets%29/page2
```

Gevolg:

- `sourceContext.url` kan verkeerd worden opgeslagen;
- dedupe/context lookup mist de echte thread;
- gallery groepering kan vervuilen;
- vervolgpaginering en origin-thread metadata worden onbetrouwbaar;
- K2S items kunnen onder verkeerde context of niet-herkenbare context terechtkomen.

Dit is hard bewijs dat de nieuwe thread/pagination/context-laag fouten introduceert.

### 5. ViperGirls gebruikt FFF-generieke functies

Bestand: `firefox-native-controller/content/debug-toolbar.js`

ViperGirls thread-scans gebruiken onder andere:

```js
loadFootFetishForumDocument(...)
findNextVipergirlsForumPageUrl(...)
```

Dat kan technisch werken omdat het generieke documentloading is, maar de naamgeving verraadt het probleem: FFF, ViperGirls, forumscan, threadscan en gigascan zitten door elkaar. Hierdoor is het moeilijk om wijzigingen voor één platform te doen zonder andere platformen te raken.

### 6. Keep2Share queueing is nu extra gevoelig door hub-auth gate

Bestand: `webdl-hub/src/api/routes-jobs.js`

Voor K2S staat nu:

```js
if (slave.platform === 'keep2share' && !hasKeep2ShareApiAuthConfigured()) {
  throw 409 Keep2Share auth ontbreekt
}
```

Dat is op zichzelf verdedigbaar, maar in combinatie met de nieuwe hub-voorkeur betekent dit:

- vroeger kon K2S via simple-server/background in de bekende legacy route vallen;
- nu forceert chunking vaak de hub-route;
- zonder runtime-zichtbare credentials kan hub de batch direct blokkeren;
- de UI toont dan "batch fout", terwijl het lijkt alsof threadscan stuk is.

Dit kan bijdragen aan het beeld dat K2S/hele-thread ineens "niet meer werkt", maar de concrete impact moet per run worden bevestigd met toolbar-response, hub-log of read-only queue-query.

### 7. Gallery-aanpassingen mengen archives in media-grid

Bestand: `webdl-gallery/server.js`

Archives zijn toegevoegd aan gallery candidates:

```js
ARCHIVE_EXTS = ['rar','zip','7z',...]
DOWNLOAD_EXTS = [...MEDIA_EXTS, ...ARCHIVE_EXTS]
```

Voor K2S is dat logisch, omdat veel bestanden `.rar`/`.zip` zijn. Maar het betekent ook dat de gallery nu downloads toont die geen viewer-media zijn. Dat is geen hoofdoorzaak van de thread-regressie, maar het maakt symptomen verwarrender:

- K2S archives kunnen zichtbaar worden als gallery-items;
- thumbnails ontbreken meestal;
- viewer-gedrag voor type `archive` moet apart gecontroleerd worden.

### 8. Nieuwe downloads lijken niets te doen

Dit is een aparte P0-regressie bovenop de thread/giga-regressie. De huidige code kan een download "aannemen" zonder dat de gebruiker daarna echte voortgang ziet.

Er zijn meerdere plekken waar dit kan gebeuren:

1. **Toolbar krijgt alleen accepted terug**

Bij grote batches gebruikt de nieuwe route:

```js
POST /api/jobs/batch-file
```

Die geeft direct terug:

```js
{ success: true, accepted: true, total, batchId, manifestFile }
```

De echte queueing gebeurt daarna in `setImmediate`. Voor de gebruiker lijkt dit alsof de download gestart is, maar er is nog geen bewijs dat jobs echt claimbaar zijn, door een worker worden opgepakt, of in `downloads` terechtkomen.

2. **Chunked route forceert hub, maar hub-worker/slave-poller moeten draaien**

Door `preferHub: true` gaat de browser niet meer eerst via de oude background/simple-server route. De hub maakt jobs aan, maar daarna moeten deze onderdelen actief zijn:

- `webdl-hub` API;
- `webdl-hub` worker lanes;
- `webdl-hub` slave-poller;
- `screen-recorder-native` simple-server scheduler/rehydrate voor slave-delegates;
- `webdl-gallery` query/sync.

Als één van deze niet draait, ziet het eruit alsof nieuwe downloads niets doen.

3. **Slave-delegate jobs kunnen in running blijven hangen**

Bestanden:

- `webdl-hub/src/api/routes-jobs.js`
- `webdl-hub/src/queue/slave-poller.js`
- `webdl-hub/src/queue/worker.js`

Voor filehosts/K2S/legacy platforms maakt hub een `slave-delegate` job en een rij in `public.downloads`. Daarna moet simple-server die rij oppakken en moet de slave-poller de hub-job afronden.

Als de koppeling `simple_server_download_id` ontbreekt of simple-server de rij niet oppakt, blijft hub op `running` of `queued` staan zonder zichtbare download.

Er is wel nieuwe orphan-recovery toegevoegd in `slave-poller.js`, maar dat helpt alleen als de poller draait en een passende `downloads` rij kan vinden.

4. **`completeJob` rondt alleen running jobs af**

Bestand: `webdl-hub/src/db/repo.js`

Nieuwe wijziging:

```js
WHERE id = $1 AND status = 'running'
```

Dit voorkomt race bugs, maar betekent ook: als een job ondertussen gecancelled, requeued, stale of verkeerd gekoppeld is, wordt hij niet meer afgerond. In `worker.js` wordt dat gelogd als:

```js
job.complete.skipped
```

Voor de gebruiker kan dat voelen als "download klaar, maar niets verschijnt".

5. **Gallery sync gebeurt pas na worker completion**

Bestand: `webdl-hub/src/queue/worker.js`

Hub-native downloads syncen pas naar `public.downloads` in:

```js
syncToGallery(...)
repo.markGallerySynced(...)
```

Als een job niet echt `done` wordt, of als `syncToGallery` faalt, komt er niets nieuws in `webdl-gallery`.

6. **Slave downloads moeten importeerbare files hebben**

Bestand: `webdl-hub/src/queue/slave-poller.js`

Bij completed slave downloads wordt gecontroleerd:

```js
collectSlaveMediaFiles(...)
inspectSlaveFile(...)
indexSlaveDownloadFiles(...)
```

Als het resultaat een HTML/login-pagina, lege file, preview, tempbestand of niet-herkende output is, zet de poller de hub-job op failed/error. Voor K2S zonder auth is dit waarschijnlijk: de filehost geeft geen echte media/archive terug.

7. **Gallery kan records hebben maar ze niet tonen**

Bestand: `webdl-gallery/server.js`

De gallery filtert op onder andere:

- `status` niet verborgen;
- `filepath` aanwezig;
- `filesize > 0`;
- extensie of download-hint herkend;
- geen temp/aux path;
- soms `is_thumb_ready`, vooral in snelle recent-route.

Dus "niets in gallery" kan twee oorzaken hebben:

- er komt echt niets in `public.downloads`;
- er komt wel iets in `public.downloads`, maar de gallery-query filtert het weg.

## Extra diagnose voor "niets gebeurt"

Deze tellingen moeten worden toegevoegd of handmatig gedraaid bij herstel:

```sql
-- hub jobs per status
SELECT status, adapter, lane, COUNT(*)
FROM webdl.jobs
GROUP BY status, adapter, lane
ORDER BY status, adapter, lane;

-- slave-delegate jobs zonder gekoppelde simple-server download
SELECT id, url, status, locked_by, locked_at, options
FROM webdl.jobs
WHERE adapter='slave-delegate'
  AND NOT (options ? 'simple_server_download_id')
ORDER BY id DESC
LIMIT 50;

-- pending/queued downloads die simple-server had moeten oppakken
SELECT id, url, platform, status, created_at, updated_at, error
FROM public.downloads
WHERE status IN ('pending','queued','downloading','postprocessing')
ORDER BY id DESC
LIMIT 100;

-- completed downloads die gallery waarschijnlijk wegfiltert
SELECT id, platform, status, filepath, filename, format, filesize, is_thumb_ready, source_url
FROM public.downloads
WHERE status='completed'
ORDER BY id DESC
LIMIT 100;
```

Deze regressie moet dus niet alleen als UI-probleem worden gezien. Het is een ketenprobleem: toolbar intake -> hub queue -> worker/slave -> public.downloads -> gallery filter.

## Waarom het nu slechter voelt dan alleen "één bug"

Er zijn meerdere gedragsveranderingen tegelijk gedaan:

- queue-route veranderd;
- transport veranderd;
- dedupe veranderd;
- context metadata veranderd;
- worker lifecycle veranderd;
- watchdog toegevoegd;
- K2S auth gate toegevoegd;
- gallery itemtypen uitgebreid.
- intake en zichtbaarheid losgekoppeld via accepted/manifests en background workers.

Daardoor is het lastig om één foutmelding te zien. Het systeem kan op verschillende plekken falen, maar voor de gebruiker ziet alles eruit als:

```text
Hele thread / giga download werkt niet meer.
Nieuwe downloads doen niets.
Er komt niets in de gallery.
```

## Waarschijnlijke regressieketen

1. Gebruiker klikt "Hele thread" of "Giga".
2. Browser verzamelt candidates.
3. Door nieuwe logic gaat de selectie door `queueThreadBatchDownloadRequest`.
4. Voor FFF/ViperGirls wordt chunked queueing gebruikt, ook bij normale thread.
5. Chunks gaan direct naar hub door `preferHub: true`.
6. Hub routeert K2S/filehosts/slave-platforms anders dan de oude background route.
7. Bij K2S kan hub blokkeren op ontbrekende auth.
8. Bij FFF kan worker/wrapper-resolve/watchdog extra falen of dubbel werk doen.
9. Bij ViperGirls kan `sourceContext.pageUrl` kapot raken (`/threads/threads/`).
10. Gallery toont later onvolledig, onder verkeerde context, of met archive-items zonder normale media-preview.
11. Als worker/slave-poller/simple-server niet doorpakken, blijft er helemaal niets zichtbaar.

## Hardheid van de regressieketen

Deze keten is bruikbaar als werkhypothese, maar niet elke stap heeft hetzelfde bewijsniveau:

- Stap 3, 4 en 5 zijn hard in de toolbar-code zichtbaar.
- Stap 7 is hard als hub-gedrag zichtbaar, maar moet per run worden gekoppeld aan de concrete foutmelding of batchrespons.
- Stap 8 is een reëel risico door de worker/watchdog-code, maar mag niet worden behandeld als oorzaak van gewone "Hele thread" zolang de normale knop eerst uit die flow wordt gehaald.
- Stap 10 en 11 vragen read-only database/logdiagnose voordat er queue-state wordt aangepast.

Onderzoeksregel: eerst de route herstellen, dan met read-only tellingen controleren of er nog een no-op probleem in hub/slave/gallery overblijft. Geen jobs pauzeren, retryen, prioriteiten wijzigen of manifests opnieuw aanbieden tijdens deze diagnose.

## Gate-based herstelplan

### Gate 0: bewijs verzamelen

Elke diagnoseclaim moet worden gelabeld als `bewezen`, `hypothese` of `actie pas na bewijs`. Gate 0 is read-only:

- `/threads/threads/` tracen naar bron: next-page parsing, URL-resolving, page-builder, JSON-export of `sourceContext`-opbouw.
- Controleren of `normalizeUrl`, `normalizeBatchUrl` en hub `sourceContextLookupKey` dezelfde `sourceContexts` en `directHints` kunnen terugvinden.
- K2S-impact per run aantonen met toolbar-response, hub-log of read-only query; de auth-gate is bewezen aanwezig, maar niet automatisch de enige oorzaak.
- No-op klachten onderzoeken met read-only tellingen op hub jobs, slave-delegate koppeling, `public.downloads` en gallery-filtering.
- Geen jobs pauzeren, retryen, prioriteiten wijzigen, manifests opnieuw aanbieden of queue-state muteren.

### Gate 1: baseline herstellen

Herstel gewone "Hele thread" naar de bewezen werkende git-route:

```js
queueBatchDownloadRequest(urls, meta, { force, directHints, sourceContexts })
```

Acceptatie:

- gewone FFF "Hele thread" gebruikt geen `queueThreadBatchDownloadRequest`;
- gewone ViperGirls "Hele thread" gebruikt geen `queueThreadBatchDownloadRequest`;
- geen standaard chunking, manifest, worker-tab, watchdog of `preferHub: true`;
- dit is herstel naar baseline, geen nieuw ontwerp van "Hele thread".

Beslisregel: als gewone "Hele thread" na Gate 1 weer betrouwbaar werkt, wordt de normale queue-route niet verder aangepast in dezelfde herstelronde.

### Gate 2: gerichte regressiefixes

Pas alleen bewezen regressies gericht aan:

- ViperGirls `/threads/threads/` pas fixen nadat de bron is vastgesteld.
- Minimaal 5-10 echte input/output voorbeelden vastleggen vóór URL-normalisatie wordt gewijzigd.
- `fetchUrl`/`pageUrl` scheiden van canonical `origin_thread.url`: browser-fetch mag de host/context houden die cookies nodig heeft; dedupe en origin mogen canonical zijn.
- Defensieve normalisatie mag bestaan, maar mag de bronanalyse niet vervangen.

### Gate 3: modernisering nieuwe eisen

Nieuwe eisen worden apart gebouwd nadat Gate 1 stabiel is:

- K2S runtime-preflight: toon wat hub/simple-server op dat moment echt aan credentials ziet, niet alleen wat in `.env` staat.
- Manifeststatus: `accepted` betekent alleen aangenomen voor achtergrondverwerking; niet gelijkstellen aan `queued`, `running` of downloadsucces.
- No-op/gallery/slave fixes alleen plannen na bewezen faallocatie uit read-only diagnose.
- Lifecycle- of gallery-visibility endpoints alleen bouwen als de diagnose laat zien dat ze nodig zijn voor herhaalbare debugging.

### Gate 4: Giga robuust maken

Giga wordt een aparte moderne flow:

- eigen entrypoint voor Giga, los van gewone "Hele thread";
- checkpoints voor forum page, thread index, thread page en queued count;
- idempotente chunks en manifeststatus;
- watchdog alleen voor echte `mode: 'giga'` scans;
- UI/logs tonen duidelijk verschil tussen `accepted`, `queued`, `running`, `done`, `failed` en gallery-zichtbaarheid.

## Werkstatus

`npm test` in `webdl-hub` is groen:

```text
141 tests, 141 pass
```

Maar die tests bewijzen vooral dat de hub intern consistent is. Ze testen niet voldoende dat de Firefox-toolbar nog dezelfde user-flow heeft als voorheen. De regressie zit juist in de browser-flow en de routing-keuze vóórdat hub-tests relevant worden.

## Eerste uitvoering volgens gates

De eerste uitvoering is gate-bound en klein:

1. Gate 0: leg de bewijsstatus vast voor route-keuze, `/threads/threads/`, K2S-auth, source-context lookup en no-op klachten.
2. Gate 1: zet alleen de normale thread-knop terug op de oude git-route.
3. Controleer dat gewone "Hele thread" geen `queueThreadBatchDownloadRequest`, manifest, background worker of `preferHub: true` raakt.
4. Bouw daarna pas de XPI opnieuw.

Niet tegelijk gallery, K2S auth, watchdog, lifecycle endpoints of manifest-idempotentie uitbreiden. Eerst moet de oude werkende "Hele thread" flow weer betrouwbaar zijn.

### Eerste read-only onderzoek

Voor en na Gate 1, maar vóór extra brede fixes:

1. Draai read-only tellingen op hub jobs per status, slave-delegate jobs zonder `simple_server_download_id`, recente `public.downloads` records en completed records die gallery mogelijk wegfiltert.
2. Controleer logs op concrete K2S-auth fouten en op `batch_file.start`/`batch_file.chunk` voor manifest-batches.
3. Controleer of de gewone thread-knop na herstel nog `queueThreadBatchDownloadRequest`, `/api/jobs/batch-file`, `startFffBackgroundScanRequest` of `preferHub: true` raakt.
4. Pas daarna beslissen of lifecycle endpoint, gallery visibility endpoint of slave-poller herstel nodig is.

Deze onderzoeksstap is read-only. Geen queue-state muteren zonder expliciete opdracht.

---

## Deel 2: Herstelontwerp

## Doel

We moeten twee workflows opnieuw strak scheiden:

1. **Hele thread**  
   De normale, voorspelbare flow. Browser verzamelt links, gebruiker ziet preview, selectie gaat naar de bestaande batch queue. Geen worker-tab, geen watchdog, geen manifest tenzij expliciet nodig en veilig.

2. **Giga download**  
   Een aparte, robuuste achtergrond-flow voor zeer grote forum/thread scans. Deze mag worker-tabs, checkpoints, chunks en manifests gebruiken, maar moet eigen status, herstelbaarheid en idempotente queueing hebben.

Het herstel moet voorkomen dat een verbetering voor Giga opnieuw de normale "Hele thread" kapot maakt.

## Ontwerpprincipes

- **Mode scheiding:** `whole-thread` en `giga` mogen niet hetzelfde uitvoerende pad delen na de candidate-scan.
- **Oude stabiele route eerst:** gewone thread-download moet terug naar het gedrag dat in git werkte.
- **Giga is expliciet:** alleen de Giga-knop of een expliciete bevestiging mag de achtergrondscan starten.
- **Idempotent queueing:** elke giga-chunk moet veilig opnieuw aangeboden kunnen worden zonder duplicaatlawines.
- **Checkpointbaar:** Giga moet kunnen rapporteren waar hij is gebleven: forum page, thread index, thread page, queued count.
- **Platform-specifieke context blijft intact:** ViperGirls, FFF en K2S mogen niet via generieke FFF-metadata vervuild raken.
- **Auth-gates vroeg tonen:** K2S mag niet halverwege een batch pas ontdekken dat credentials ontbreken.
- **End-to-end zichtbaar:** een aangenomen download moet traceerbaar zijn van toolbar naar hub job, worker/slave, `public.downloads` en gallery-item.

## Valkuilen die we expliciet moeten vermijden

### 1. Aannames doen zonder threadlinks en context echt te analyseren

Dit is de grootste fout die tot de huidige regressie heeft geleid. Niet aannemen dat een threadlink, next-page link, wrapper-link of source context "wel ongeveer klopt".

Voor elke platform-flow eerst inspecteren:

- welke `href` letterlijk in de pagina staat;
- wat `new URL(href, baseHref)` ervan maakt;
- wat de canonical URL wordt;
- of `sourceContext.url` de echte thread is of per ongeluk een wrapper/page/kapotte URL;
- of `origin_thread.url` hetzelfde moet zijn als de pagina-URL of juist de canonical thread-root;
- of dedupe op URL, file-id of thread-id moet gebeuren.

Concreet voorbeeld van de fout:

```text
https://viper.to/threads/threads/14180551-.../page2
```

Dit had niet door mogen komen. Eerst de echte next-page hrefs en de `baseHref` analyseren, dan pas normalisatie en queueing aanpassen.

Werkinstructie:

```text
Geen code wijzigen aan thread/page/URL-normalisatie zonder eerst 5-10 echte input/output voorbeelden vast te leggen.
```

### 2. Giga-fixes in normale "Hele thread" laten lekken

Giga mag complex zijn. Normale "Hele thread" moet simpel blijven. Iedere wijziging die worker-tabs, manifests, chunking, watchdog of `preferHub` introduceert moet een expliciete `mode === 'giga'` guard hebben.

### 3. "Accepted" verwarren met "download gestart"

Een API-response met `accepted: true` betekent alleen dat de aanvraag is aangenomen. Het zegt niets over:

- jobs aangemaakt;
- worker heeft geclaimd;
- slave heeft opgepakt;
- bestand is geschreven;
- gallery sync is gelukt.

De UI/logs mogen dat niet presenteren als klaar of gestart zonder status-pad.

### 4. Platformcontext overschrijven met generieke metadata

Nooit zomaar:

```js
platform: 'footfetishforum'
```

zetten voor gemengde thread/giga code. ViperGirls, FFF, K2S, imagehosts en direct media hebben elk eigen storage platform, source site en origin thread.

### 5. Dedupe op de verkeerde sleutel

Voor K2S is URL-string niet genoeg. De juiste primaire sleutel is:

```text
keep2share:<file_id>
```

Voor forum media is vaak nodig:

```text
media URL + origin thread
```

Voor thread scans:

```text
platform + thread_id
```

Eerst bepalen wat de echte identiteit is, dan dedupe bouwen.

### 6. Gallery-zichtbaarheid als vanzelfsprekend zien

Een completed rij in `public.downloads` is niet automatisch zichtbaar in de gallery. Altijd controleren:

- `filepath`;
- `filesize`;
- `format/ext`;
- temp/aux filters;
- `download_files`;
- `is_thumb_ready`;
- platform/channel filters.

### 7. Te veel tegelijk repareren

Niet tegelijk:

- normale thread-route;
- giga worker;
- K2S auth;
- gallery archive support;
- watchdog;
- XPI build;
- queue retry semantics

door elkaar wijzigen. Eerst de oude werkende normale route herstellen, dan Giga apart verbeteren.

### 8. Op eigen houtje pauzeren, voorsorteren of tussenqueries vergeten

Dit moet expliciet niet meer gebeuren. Geen jobs/downloads pauzeren, prioriteiten aanpassen, batches voorsorteren, tijdelijke subsets maken of eigen queue-volgordes opleggen zonder dat daar een duidelijke reden en opdracht voor is.

Fouten die hiermee ontstaan:

- echte gebruikersintentie raakt verborgen achter mijn tijdelijke sortering;
- sommige downloads lijken "niets te doen" omdat ze door een eerdere pauze/priority/filter nooit meer aan bod komen;
- tussenqueries worden gebruikt om een aanname te maken, maar daarna niet meer herhaald of gevalideerd;
- tijdelijke bestanden/manifests/selecties blijven liggen en worden later aangezien voor waarheid;
- debugging verandert de queue-state, waardoor diagnose en oorzaak door elkaar lopen;
- er ontstaan extra queues/wachtrijen die misschien nooit vanzelf herstellen, omdat niemand meer weet dat ze tijdelijk waren;
- jobs blijven op `paused`, `queued`, `running` met stale locks, of lage priority staan terwijl latere code ervan uitgaat dat de queue vanzelf leegloopt;
- manifests of batchfiles kunnen op achtergrond blijven enqueueën nadat de oorspronkelijke context al fout of achterhaald is;
- orphan recovery kan de verkeerde rij herstellen als tijdelijke testdata en echte downloads door elkaar staan.

Werkinstructie:

```text
Geen queue-state muteren tijdens diagnose, tenzij de gebruiker dat expliciet vraagt.
```

Als een tussenquery of tijdelijke selectie nodig is:

- noteer exact welke SQL/query is gebruikt;
- noteer timestamp en doel;
- noteer of het alleen-lezen was of state heeft gewijzigd;
- bewaar het resultaat in het document of verwijder het bewust;
- herhaal de query na de fix om te controleren of de conclusie nog klopt;
- noteer welke jobs/downloads hierdoor bewust buiten de normale flow zijn gezet;
- maak een expliciete herstelactie voor elke pauze, priority-wijziging, manifest, retry of tijdelijke batch.

Voor pauzeren/resumen/retry/priority geldt:

```text
Eerst rapporteren wat de huidige state is. Pas daarna wijzigen, en alleen met expliciete opdracht of als onderdeel van een afgesproken herstelstap.
```

Elke state-mutatie moet een terugweg hebben:

```text
wijziging -> waarom -> welke IDs -> hoe terugzetten -> wanneer gecontroleerd
```

Zonder die terugweg geen mutatie uitvoeren.

## Gewenste architectuur

### Laag 1: scan/candidate collectors

Deze laag verzamelt alleen kandidaten en context:

- `collectFootFetishForumThreadCandidates`
- `collectFootFetishForumForumCandidates`
- `collectVipergirlsMixedThreadCandidates`
- `collectVipergirlsKeep2ShareThreadCandidates`
- `collectXvideosListingCandidates`

Outputvorm:

```js
{
  candidates: [
    {
      url,
      kind,
      sourceContext,
      directHint
    }
  ],
  stats: {
    pages,
    forumPages,
    threadPages,
    threads
  }
}
```

Deze laag mag geen downloads queueën.

### Laag 2: normale queue

Voor gewone "Hele thread":

```js
queueWholeThreadBatch({
  urls,
  meta,
  force,
  directHints,
  sourceContexts
})
```

Intern gebruikt deze voorlopig weer:

```js
queueBatchDownloadRequest(urls, meta, {
  force,
  directHints,
  sourceContexts
})
```

Geen `preferHub: true` standaard. Geen manifest standaard. Geen worker-tab.

### Laag 3: giga orchestration

Voor Giga:

```js
startGigaDownload({
  seedUrl,
  platform,
  mode,
  metadata,
  limits,
  initialCandidates
})
```

Deze laag mag:

- worker-tab starten;
- chunks gebruiken;
- manifest gebruiken;
- heartbeat/status sturen;
- checkpoints loggen;
- watchdog gebruiken.

Maar alleen binnen `mode: 'giga'`.

### Laag 4: download lifecycle observability

Voor elk nieuw downloadverzoek moet de UI of log kunnen tonen waar het blijft hangen:

```text
accepted -> queued -> claimed/running -> delegated/downloading -> completed -> gallery_synced -> visible
```

Daarvoor moet elke route een herkenbare id teruggeven:

- `hubJobId` voor hub-native jobs;
- `simpleServerDownloadId` voor slave-delegate jobs;
- `batchId` voor manifest/giga;
- `galleryDownloadId` zodra iets in `public.downloads` staat.

Als een route alleen `accepted` teruggeeft, moet de UI dat expliciet tonen als "aangenomen, verwerking loopt op achtergrond", niet als "download gestart/klaar".

## Concreet gateplan

### Gate 1: gewone "Hele thread" terug naar oude batch-route

Bestand: `firefox-native-controller/content/debug-toolbar.js`

Herstel het normale pad aan het einde van de gewone thread-flow naar:

```js
const result = await queueBatchDownloadRequest(urls, meta, {
  force,
  directHints: selectedDirectHints,
  sourceContexts: selectedSourceContexts
});
```

Alleen expliciete Giga-flow mag `queueThreadBatchDownloadRequest`, manifest of background worker gebruiken.

Acceptatie:

- gewone FFF thread gebruikt geen `queueThreadBatchDownloadRequest`;
- gewone ViperGirls thread gebruikt geen `queueThreadBatchDownloadRequest`;
- gewone thread-knop triggert geen `startFffBackgroundScanRequest`;
- hub krijgt dezelfde payloadvorm als voor de regressie.

### Gate 2: ViperGirls bronfix na bewijs

Geen blinde URL-normalisatie als eerste stap. Eerst vaststellen of `/threads/threads/` ontstaat in:

- next-page href parsing;
- `new URL(href, baseHref)`;
- eigen page-builder;
- JSON-export;
- `sourceContext`-opbouw.

Pas daarna de bron fixen. Defensieve normalisatie mag aanvullend, maar alleen met testcases die zowel de kapotte als de juiste URLs dekken.

Regel:

- `fetchUrl`/`pageUrl` mag pagina- en host-specifiek blijven voor browsercookies;
- `origin_thread.url` moet canonical thread-root zijn voor opslag, dedupe en gallery-context.

### Gate 3: K2S, no-op en gallery pas na read-only diagnose

K2S-preflight, lifecycle-checks en gallery visibility audit zijn moderne vervolgacties, geen eerste herstelstap.

Onderzoekscriteria:

- K2S-auth impact aantonen met runtime-status, toolbar-response of hub-log.
- No-op downloads lokaliseren: geen job, niet geclaimd, ontbrekende slave-koppeling, failed output of gallery-filtering.
- Gallery visibility endpoint alleen bouwen als read-only diagnose aantoont dat completed records bestaan maar weggefilterd worden.

Acceptatie voor vervolgacties:

- K2S faalt vóór queueing met een runtime-gebaseerde melding als credentials ontbreken.
- Geen half aangemaakte giga-manifesten voor onuitvoerbare K2S batches.
- Geen queue-state mutaties tijdens diagnose.

### Gate 4: Giga-state, idempotentie en manifeststatus

Voor Giga gebruiken we een expliciete state:

```js
{
  scanId,
  mode: 'giga',
  platform,
  seedUrl,
  status: 'starting' | 'scanning' | 'queueing' | 'paused' | 'done' | 'error',
  checkpoint: { forumPage, threadIndex, threadUrl, threadPage },
  totals: { discovered, queued, duplicates, errors, skipped }
}
```

Manifestgebruik blijft bestaan, maar normale "Hele thread" gebruikt het niet standaard. Als manifest wel wordt gebruikt, betekent `accepted` alleen dat achtergrondverwerking is aangenomen. De UI moet dat niet als `queued` of downloadsucces tonen.

Watchdog mag alleen scans beheren met `mode === 'giga'`. Restart moet checkpoint/context behouden en dubbele queueing moet door idempotentie worden opgevangen.

## Gewenste knopgedrag

### Hele thread

Klik:

1. scan huidige thread/forum met browser-login;
2. toon preview;
3. queue selectie via oude batch-route;
4. toon echte queue-resultaten.

Shift/Alt:

- force duplicates, maar blijft normale batch-route.

Cmd/Ctrl:

- limieten instellen, maar blijft normale batch-route.

### Giga

Klik:

1. start expliciete giga-flow;
2. scan in worker-tab of server-worker;
3. queue in chunks;
4. toon status via scan dashboard/log;
5. kan lange tijd doorlopen.

Shift/Alt:

- force mode.

Cmd/Ctrl:

- limieten en batch/chunk opties.

## Platformregels

### FootFetishForum

- Gewone thread: oude batch-route.
- Giga: worker-tab toegestaan.
- Wrapper resolving alleen in Giga of browser-media route, niet als verplichte stap voor gewone batch.
- `origin_thread` altijd thread-context.

### ViperGirls

- Gewone thread: oude batch-route.
- K2S knop: preflight auth, dan batch-route.
- `viper.to` canonicaliseren naar `vipergirls.to`.
- `/threads/threads/` altijd corrigeren.
- K2S source graph:
  - media/file node = `keep2share:<file_id>`;
  - origin node = ViperGirls thread.

### Xvideos

- Listing/giga browser-batch mag eigen flow houden.
- Niet mengen met FFF/ViperGirls thread queueing.

## Testplan

### Unit tests

In toolbar-code is unit-testen lastig, maar we kunnen helpers apart testbaar maken of minimaal browserless tests maken voor:

- `normalizeVipergirlsThreadUrl`;
- `keep2ShareFileId`;
- `queue mode decision`.

Gewenste testcases:

```text
normal FFF thread -> queue mode: normal-batch
normal ViperGirls thread -> queue mode: normal-batch
Giga FFF -> queue mode: giga-worker
Giga ViperGirls -> queue mode: giga-worker or giga-chunk
K2S no auth -> preflight fail before queue
```

### Hub tests

Toevoegen:

- `/batch-file` alleen gebruiken waar caller dat kiest;
- `/batch-file` exposeert batchstatus of logt enqueued counts per batchId;
- ViperGirls `/threads/threads/` normaliseert;
- K2S duplicate lookup dedupet op file id;
- slave-delegate bewaart `origin_thread`.
- slave-delegate lifecycle endpoint toont gekoppelde `downloads` rij.
- gallery visibility diagnose verklaart waarom een completed row niet zichtbaar is.

### Handmatige browser-test

1. Installeer verse XPI.
2. Open gewone FFF thread.
3. Klik "Hele thread".
4. Controleer:
   - geen worker-tab;
   - preview komt op;
   - batch queue-resultaat komt terug;
   - hub/simple-server toont items.
5. Open ViperGirls thread.
6. Klik K2S pagina en K2S hele thread.
7. Controleer:
   - geen `/threads/threads/` in logs/metadata;
   - juiste thread context;
   - duidelijke authmelding als K2S auth ontbreekt.
8. Klik Giga op FFF forum.
9. Controleer:
   - worker-tab start;
   - heartbeat/status loopt;
   - chunks worden queued;
   - restart veroorzaakt geen duplicaten.
10. Start een gewone nieuwe download.
11. Controleer:
   - hub job verschijnt;
   - job wordt geclaimd;
   - bij slave-delegate verschijnt `simpleServerDownloadId`;
   - `public.downloads` status verandert;
   - completed item wordt zichtbaar of visibility endpoint geeft een concrete reden.

## Gate-beslisregels en uitvoering

### Gate 0: bewijs verzamelen

1. Label elke diagnoseclaim als `bewezen`, `hypothese` of `actie pas na bewijs`.
2. Verzamel read-only bewijs voor `/threads/threads/`, source-context keying, K2S-auth impact en no-op/gallery/slave klachten.
3. Mutatieverbod: geen queue-state wijzigen, geen jobs retryen, geen manifests opnieuw aanbieden.

### Gate 1: baseline herstellen

1. Normale "Hele thread" terugzetten naar de oude git-route.
2. Geen extra gedrag toevoegen in dezelfde stap.
3. Controleer met codezoekactie dat gewone "Hele thread" geen `queueThreadBatchDownloadRequest`, manifest, background worker of `preferHub: true` gebruikt.
4. Hub-tests draaien en XPI rebuilden.

Beslisregel: als gewone "Hele thread" na deze gate werkt, blijft de normale queue-route verder met rust.

### Gate 2: gerichte regressiefixes

1. ViperGirls `/threads/threads/` bron vaststellen en alleen die bron fixen.
2. `fetchUrl`/`pageUrl` gescheiden houden van canonical `origin_thread.url`.
3. Source-context/direct-hint keying alleen wijzigen als Gate 0 een mismatch bewijst.

### Gate 3: modernisering nieuwe eisen

1. K2S runtime-preflight toevoegen als Gate 0 bevestigt dat auth-status vooraf nodig is.
2. Manifeststatus apart tonen: `accepted` is geen `queued` of downloadsucces.
3. No-op/gallery/slave fixes alleen bouwen na bewezen faallocatie.
4. Lifecycle endpoint of gallery visibility endpoint alleen toevoegen als read-only diagnose laat zien dat dit nodig is.

### Gate 4: Giga robuust maken

1. Giga-state model toevoegen.
2. Checkpoints in progress events.
3. Idempotente chunk keys.
4. Watchdog alleen voor `mode: 'giga'`.
5. Status zichtbaar maken in toolbar of hub.

### Gate 5: opschonen

1. FFF/ViperGirls helpernamen scheiden nadat gedrag stabiel is.
2. Gallery archive-weergave apart behandelen.
3. Documentatie bijwerken.

## Uitvoering

Deze sectie wordt bijgehouden tijdens de uitvoering. Elke stap vermeldt status, bewijs, actie en verificatie. Queue-state mutaties horen hier alleen thuis als ze expliciet zijn uitgevoerd en omkeerbaar zijn beschreven.

### 2026-05-14: start uitvoering

Status:

- Branch: `codex/fix-gallery-keep2share-live`.
- Laatste commits vóór uitvoering:
  - `50bd203 docs: add gate-based WebDL recovery plan`
  - `9e0fb9c fix: harden WebDL thread and K2S flows`

Gate 0 bewijs:

- Bewezen: gewone thread-flow raakt nog steeds de Giga/chunk-route. In `firefox-native-controller/content/debug-toolbar.js` staan `shouldChunkThreadBatch` en `queueThreadBatchDownloadRequest` in de normale `runBatchFromWholeThread` afsluiting.
- Bewezen: gewone FFF thread kan nog steeds `startFffBackgroundScanRequest` raken via `res.stoppedByGiga`.
- Bewezen: de XPI wordt normaal uit `firefox-native-controller` gebouwd via `/usr/bin/zip`; `StartServer.command` zet `WEBDL_ADDON_SOURCE_DIR` en `WEBDL_ADDON_PACKAGE_PATH`.
- Besluit: Gate 1 is nodig vóór verdere ViperGirls/K2S/Giga-modernisering.

Gate 1 geplande actie:

- Normale "Hele thread" terugzetten naar `queueBatchDownloadRequest(urls, meta, { force, directHints, sourceContexts })`.
- Gewone thread-scan mag geen automatische Giga-overdracht meer aanbieden.
- Expliciete Giga-knop mag de bestaande Giga-route blijven gebruiken totdat Gate 4 een aparte moderne flow bouwt.
- XPI opnieuw inpakken na toolbar-wijziging.

Gate 1 uitgevoerd:

- `firefox-native-controller/content/debug-toolbar.js` build-label gezet op `debug-toolbar-2026-05-14-gate1-whole-thread-baseline`.
- Gewone FFF thread-scan krijgt geen `shouldStopForGigaBatch` meer mee.
- `res.stoppedByGiga` kan alleen nog een background/server-gigascan starten wanneer `options.forceGiga === true`.
- De normale queue-afsluiting gebruikt alleen `queueBatchDownloadRequest`; `queueThreadBatchDownloadRequest` zit achter `useGigaQueue = options.forceGiga === true`.
- `firefox-debug-controller.xpi` opnieuw ingepakt uit `firefox-native-controller`.

Gate 1 verificatie:

- `node --check firefox-native-controller/content/debug-toolbar.js`: groen.
- `node --check firefox-native-controller/background/simple-background.js`: groen.
- XPI bevat build-label `debug-toolbar-2026-05-14-gate1-whole-thread-baseline`.
- Statische check: `shouldChunkThreadBatch` en `shouldStop: shouldStopForGigaBatch` komen niet meer voor in `debug-toolbar.js`.
- `npm test` in `webdl-hub`: groen, 141 tests geslaagd.

### 2026-05-14: Gate 2 ViperGirls page URL

Gate 2 bewijs:

- `tmp-vipergirls-14180551-k2s.json` bevat 153 K2S-rijen: 10 met de eerste thread-URL en 143 met een kapotte `pageUrl` onder `/threads/threads/.../page2` t/m `/page9`.
- Repo-zoekactie vond geen generator voor `tmp-vipergirls-14180551-k2s.json`; het bestand is diagnose-output.
- Reproducer met native URL-resolutie:
  - base `https://viper.to/threads/14180551-title` + href `threads/14180551-title/page2` geeft `https://viper.to/threads/threads/14180551-title/page2`;
  - base `https://viper.to/threads/14180551-title/page2` + href `../threads/14180551-title/page2` geeft ook `https://viper.to/threads/threads/14180551-title/page2`;
  - href `/threads/14180551-title/page2` blijft correct.
- Bron in toolbar: `findNextVipergirlsForumPageUrl` resolveerde next-links met `new URL(href, baseHref)` en retourneerde die URL zonder ViperGirls thread-prefix-correctie. `parseVipergirlsThreadContext` gebruikte daarna de pagina-URL als context.

Gate 2 actie:

- `firefox-native-controller/content/debug-toolbar.js` kreeg `normalizeVipergirlsPageUrl(...)`, die ViperGirls page URLs na resolving corrigeert met `/threads/threads/ -> /threads/` zonder de host naar `vipergirls.to` te forceren.
- `normalizeVipergirlsThreadUrl(...)`, `parseVipergirlsThreadContext(...)` en `findNextVipergirlsForumPageUrl(...)` gebruiken deze page-normalisatie.
- `webdl-hub/src/api/routes-jobs.js` corrigeert dezelfde dubbele prefix defensief in `normalizeVipergirlsThreadUrl(...)`, zodat bestaande of externe kapotte context toch naar canonical `vipergirls.to/threads/<id>-...` wordt gerouteerd.
- Build-label gezet op `debug-toolbar-2026-05-14-gate2-vipergirls-pageurl`.

Gate 2 verificatie:

- `node --check firefox-native-controller/content/debug-toolbar.js`: groen.
- `node --check webdl-hub/src/api/routes-jobs.js`: groen.
- `npm test` in `webdl-hub`: groen, 143 tests geslaagd.
- Nieuwe tests bevestigen dat zowel een job-URL als `sourceContext.url` met `/threads/threads/` naar canonical ViperGirls thread worden hersteld.

### 2026-05-14: Gate 3 read-only K2S/no-op/gallery/slave diagnose

Scope:

- Alleen read-only diagnose uitgevoerd: `SELECT`-queries, `curl` health/status en code-inspectie.
- Geen jobs gepauzeerd, geretried, geprioriteerd, opnieuw aangeboden of gemuteerd.
- Doel van deze gate: vaststellen waar K2S/no-op/gallery/slave/lifecycle werkelijk faalt voordat er een endpoint, poller, gallery-fix of retry-actie wordt gebouwd.

Gate 3 runtimebewijs:

- Bewezen: hub health is groen: `GET http://localhost:35730/api/health` geeft `{"ok":true,"db":"up"}`.
- Bewezen: gallery health is groen: `GET http://localhost:35731/api/health` geeft `{"ok":true}`.
- Bewezen: simple-server draait en meldt `activeDownloads=0`, `queuedDownloads=0`, `pendingDownloads=1`, `db_active_by_status.pending=1`.
- Bewezen: de ene actieve/pending simple-server rij is geen K2S/slave-run maar oude TikTok-download `public.downloads.id=255834`, status `pending`, platform `tiktok`, channel `@lesbienna.jen`, aangemaakt op `2026-05-01 19:03:09`.
- Bewezen: `webdl-hub/tmp/batch-manifests` bevatte tijdens de diagnose `0` bestanden.
- Bewezen: huidige schema's gebruiken `webdl.jobs.adapter/options/lane/status`, niet een losse `source`-kolom; logregels gebruiken `webdl.logs.ts/msg`, niet `created_at/message`.

Gate 3 K2S-authbewijs:

- Bewezen: `webdl-hub/src/api/routes-jobs.js` definieert een K2S-auth gate via `K2S_AUTH_KEYS`.
- Bewezen: `hasKeep2ShareApiAuthConfigured()` controleert eerst `process.env`, daarna `screen-recorder-native/.env` en `webdl-hub/.env`.
- Bewezen zonder secretwaarden te lezen of te documenteren:
  - `screen-recorder-native/.env`: bestaat en bevat K2S-keynamen `K2S_USERNAME`, `K2S_COOKIE`, `K2S_X_BC`.
  - `webdl-hub/.env`: bestaat, maar bevat geen K2S-keynamen uit de gate-lijst.
  - huidig shellproces: geen K2S-keynamen aanwezig in `process.env`.
- Bewezen gevolg: de hub-code kan K2S-auth als "geconfigureerd" zien via `screen-recorder-native/.env`.
- Niet bewezen: dat K2S de aanwezige cookie/token bij elke run accepteert. De foutdata hieronder bewijst juist dat token/API/fallback-fouten nog voorkomen.

Gate 3 K2S/slave-queuebewijs:

- Bewezen: K2S-hubjobs zijn te selecteren als `adapter='slave-delegate'` met `options->>'slave_platform'='keep2share'`.
- Bewezen: er waren tijdens de diagnose geen K2S-hubjobs met status `queued` of `running`.
- Bewezen: actuele K2S-hubjobtotalen:
  - `cancelled/image`: 452, waarvan 443 met `simple_server_download_id`, max `created_at=2026-05-08 18:53:12+02`;
  - `cancelled/paused`: 61, alle 61 met `simple_server_download_id`, max `created_at=2026-05-08 18:51:09+02`;
  - `done/image`: 1014, alle 1014 met `simple_server_download_id`, max `created_at=2026-05-14 03:30:23+02`;
  - `done/video`: 11, alle 11 met `simple_server_download_id`, max `created_at=2026-05-14 03:30:22+02`;
  - `failed/image`: 347, alle 347 met `simple_server_download_id`, max `created_at=2026-05-14 03:30:24+02`;
  - `failed/video`: 1, met `simple_server_download_id`, max `created_at=2026-05-14 03:30:27+02`.
- Bewezen: K2S-hubjobs van `2026-05-14` hadden duidelijke terminale uitkomsten: 11 `done` met `public.downloads.status='completed'` en 5 `failed` met `public.downloads.status='error'`.
- Bewezen: actuele K2S job/download lifecycle-join:
  - `cancelled/cancelled`: 465;
  - `cancelled/completed`: 32;
  - `cancelled/error`: 7;
  - `cancelled` zonder gekoppelde download: 9;
  - `done/completed`: 1025;
  - `failed/completed`: 133;
  - `failed/error`: 215.
- Bewezen: voor alle slave-delegate jobs samen bestaat lifecycle-mismatch ook buiten K2S:
  - `failed/completed`: 184;
  - `failed/error`: 314;
  - `failed/superseded`: 132;
  - `done/completed`: 4751;
  - `done/superseded`: 141.
- Conclusie als bewezen negatieve claim: er is op dit meetmoment geen actieve K2S/slave no-op backlog aangetroffen.
- Conclusie als bewezen risico: lifecycle-mismatch bestaat historisch wel; een hubjob kan `failed` zijn terwijl de gekoppelde `public.downloads`-rij `completed` is.

Gate 3 public.downloads/gallerybewijs:

- Bewezen: actuele K2S-achtige `public.downloads` statusverdeling, geselecteerd op platform/url/source_url met `keep2share` of `k2s`:
  - `cancelled`: 477;
  - `completed`: 2783;
  - `error`: 226.
- Bewezen: op `2026-05-14` waren de K2S-achtige `public.downloads`-rijen binnen deze selector `completed|vipergirls|11` en `error|vipergirls|5`.
- Bewezen: completed K2S-achtige rijen hebben geen brede bestandskwaliteit-gaten: totaal 2783, `missing_filepath=0`, `zero_filesize=0`.
- Bewezen: van die 2783 completed rijen voldoen 2782 aan de brede gallery-kandidaatcheck `filepath aanwezig + filesize > 0 + bekende media/archive/image-extensie`.
- Bewezen: 1188 van de 2783 completed K2S-achtige rijen hebben een gekoppelde `download_files`-rij.
- Bewezen: extensieverdeling van completed K2S-achtige rijen wordt gedomineerd door `mp4`:
  - `mp4`: 2764;
  - `rar`: 9;
  - `jpg`: 6;
  - `zip`: 2;
  - `mkv`: 1;
  - 1 pad zonder herkenbare extensie in de query (`h9MkpAAC`).
- Niet bewezen: dat completed K2S-resultaten breed door gallery-filters verborgen worden. De huidige data wijst eerder op geldige gallery-kandidaten; exact verborgen gedrag moet per item via een visibility-diagnose worden bewezen.

Gate 3 foutbewijs:

- Bewezen: top K2S-achtige downloaderrors bevatten concrete auth/API/fallback-klassen:
  - 72 keer: `K2S web-API gaf geen JSON terug (404, auth=firefox-localstorage)...`;
  - 24 keer: `Keep2Share web-download faalde: HTTP 403...`;
  - 13 keer: `slave download completed without importable media files`;
  - 10 keer: generic `HTTP Error 404`;
  - 7 keer: generic direct-video metadata-pad met `Cannot write...`;
  - 3 keer: `Keep2Share premium-resolve faalde: fetch failed`.
- Bewezen: K2S-achtige errors op `2026-05-14` waren:
  - 4 keer generic direct-video metadatafout `Cannot write video metadata to JS...`;
  - 1 keer browser-token door K2S API geweigerd met JSON/web fallback;
  - 1 keer browser-token door K2S API geweigerd met web-download fallback;
  - 1 keer `Keep2Share premium-resolve faalde: fetch failed`.
- Bewezen: hublogs over de laatste 7 dagen bevatten 545 keer `Keep2Share premium API-token ontbreekt...`; dit is historisch bewijs voor auth-gate/fallbackproblemen.
- Bewezen: hublogs van `2026-05-14` tonen vooral succesvolle gallery/slave lifecycle-activiteit:
  - 558 keer `gallery sync voltooid`;
  - 465 keer `live gallery sync: 1 nieuw`;
  - 179 keer `slave klaar: 1 bestand(en) gekoppeld, 1 voor gallery geindexeerd`;
  - 65 keer `Kon wrapper media URL niet resolven naar een direct bestand`.

Gate 3 interpretatie zonder aannames:

- Bewezen: K2S-authconfiguratie is aanwezig genoeg om de hub-gate te passeren, maar dit bewijst geen geldige K2S-sessie.
- Bewezen: er was bij diagnose geen actieve K2S/slave no-op in de queue.
- Bewezen: K2S heeft nog reële faalklassen: browser-token/API-acceptatie, web-download `403`, premium-resolve `fetch failed`, wrapper-resolutie en direct-video metadata-output.
- Bewezen: completed K2S-achtige downloads zien er in bulk niet uit als gallery-filteruitval door ontbrekend pad of nul bytes.
- Hypothese: een door de gebruiker waargenomen no-op kan eerder een oude auth/fallback-fout, een transient worker/poller timing, of UI-verwarring tussen `accepted`, `queued`, `running` en `completed` zijn geweest. Deze hypothese blijft onbewezen totdat een concrete run-id, URL, job-id of download-id door de lifecycle is gevolgd.

Gate 3 vervolgplan:

1. Bouw eerst een read-only K2S preflight/status: rapporteer welke authbron is gevonden (`process.env`, `screen-recorder-native/.env`, `webdl-hub/.env`) zonder waarden te tonen, en onderscheid "key aanwezig" van "K2S accepteert token/cookie".
2. Bouw daarna een read-only lifecycle-diagnose voor een URL/job/download: hubjobstatus, `simple_server_download_id`, `public.downloads.status`, laatste fout/logregel, gallery-kandidaatreden en eventuele mismatch.
3. Maak de UI-taal rondom K2S/Giga/manifest expliciet: `accepted` is niet hetzelfde als `queued`, `running`, `completed` of "zichtbaar in gallery".
4. Onderzoek `Kon wrapper media URL niet resolven naar een direct bestand` als aparte failure-class.
5. Onderzoek generic direct-video metadatafouten als aparte failure-class.
6. Plan pas daarna een poller-, retry-, endpoint- of gallery-fix, en alleen als de diagnose per concrete run bewijst waar de faallocatie zit.

Gate 3 acceptatie voor de volgende codewijziging:

- Geen muterende queue-operaties als onderdeel van diagnose.
- Geen globale retry of manifest-resubmit op basis van bulkcounts.
- Geen claim "K2S werkt/niet werkt" zonder run-id of download-id.
- Nieuwe status/preflight moet secretwaarden maskeren en alleen bron/type/status tonen.
- Lifecycle-diagnose moet mismatch expliciet kunnen tonen, vooral `hub failed` met `download completed`.

Gate 3 K2S-preflight uitgevoerd:

- `webdl-hub/src/api/routes-jobs.js` heeft nu `GET /api/jobs/meta/k2s-preflight`.
- Endpoint is read-only en doet geen K2S API/web-request.
- Response toont:
  - `configured`: lokale config aanwezig ja/nee;
  - `sources`: `process.env`, `screen-recorder-native/.env`, `webdl-hub/.env`;
  - per source alleen status, count en credentialtypes zoals `cookie`, `x_bc`, `auth_token`, `username`;
  - `queueGate.localConfigPass`: of de lokale hub-gate nieuwe K2S-jobs zou doorlaten;
  - `remoteAcceptance.checked=false`: expliciet bewijs dat token/cookie-acceptatie door K2S niet is vastgesteld.
- Secretwaarden en concrete keynamen worden niet teruggegeven.
- `hasKeep2ShareApiAuthConfigured()` gebruikt dezelfde preflightbron voor consistentie met de bestaande K2S queue-gate.
- Tests toegevoegd in `webdl-hub/test/api/routes-jobs-k2s-preflight.test.js`.

Gate 3 K2S-preflight verificatie:

- `node --check webdl-hub/src/api/routes-jobs.js`: groen.
- `node --check webdl-hub/test/api/routes-jobs-k2s-preflight.test.js`: groen.
- `npm test` in `webdl-hub`: groen, 146 tests geslaagd.

Gate 3 concrete K2S-fout uit extensie:

- Gebruikersmelding: `Firefox K2S-login gevonden, maar de K2S API accepteert deze browser-token niet voor getUrl: You are not authorized for this action. Web-cookie fallback: K2S web-API gaf geen JSON terug (404, auth=firefox-localstorage). Zet K2S_COOKIE/K2S_X_BC of een permanent K2S API-token in .env.`
- Bewezen codebron: fouttekst komt uit `screen-recorder-native/src/simple-server.js` in `resolveKeep2ShareDirectUrl(...)`.
- Bewezen runtimecontext: live simple-server draaide als launchd-proces met `cwd=/` en command `/opt/homebrew/bin/node /Users/jurgen/WEBDL/screen-recorder-native/src/simple-server.js`.
- Bewezen oorzaak 1: `screen-recorder-native/src/config.js` gebruikte `require('dotenv').config()` zonder expliciet pad. Met `cwd=/` laadt dotenv niet automatisch `screen-recorder-native/.env`.
- Bewezen oorzaak 2: `screen-recorder-native/.env` bevatte wel K2S-keynamen `K2S_COOKIE`, `K2S_X_BC`, `K2S_USERNAME`, maar de live startvorm kon die file zonder padfix missen.
- Bewezen oorzaak 3: in de K2S web-token fallback probeerde `getKeep2ShareWebAccessToken(...)` Firefox-localStorage vóór de cookie-tokenflow. Daardoor kon de fout blijven eindigen op `auth=firefox-localstorage`, zelfs wanneer een expliciete cookie bedoeld was.

Gate 3 K2S-authfix uitgevoerd:

- `screen-recorder-native/src/config.js` laadt `.env` nu via `path.resolve(__dirname, '..', '.env')`, onafhankelijk van de process working directory.
- `screen-recorder-native/src/simple-server.js` en runtimekopie `screen-recorder-native/src/simple-server.compiled.js` onderscheiden cookiebronnen:
  - `env-cookie`;
  - `metadata-cookie`;
  - `firefox-cookie`.
- Expliciete metadata/env-cookie wordt nu vóór Firefox-localStorage geprobeerd bij het ophalen van een K2S web access token.
- Errorlabels zijn aangescherpt: een geweigerde `.env` accessToken wordt niet meer als Firefox-login gelabeld.
- Deze fix bewijst nog niet dat K2S de huidige cookie accepteert; hij bewijst alleen dat de juiste lokale bron geladen en vóór Firefox-localStorage geprobeerd wordt.

Gate 3 K2S-authfix verificatie:

- `node --check screen-recorder-native/src/config.js`: groen.
- `node --check screen-recorder-native/src/simple-server.js`: groen.
- `node --check screen-recorder-native/src/simple-server.compiled.js`: groen.
- Reproducer vanuit `cwd=/`: `require('/Users/jurgen/WEBDL/screen-recorder-native/src/config')` laadt non-secret K2S-keynamen `K2S_COOKIE`, `K2S_X_BC`, `K2S_USERNAME`.
- `npm test` in `webdl-hub`: groen, 146 tests geslaagd.
- Live herstart uitgevoerd via launchd voor `com.webdl.simple-server` en `com.webdl.hub`.
- Live health na herstart:
  - simple-server: groen;
  - hub: groen.
- Live simple-server draait nog steeds met `cwd=/`; de padfix is dus relevant voor deze echte startvorm.
- Live hub-preflight `GET /api/jobs/meta/k2s-preflight`:
  - `configured=true`;
  - `credentialTypes=["cookie","username","x_bc"]`;
  - `process_env`: leeg;
  - `screen-recorder-native/.env`: configured, `keyCount=3`;
  - `webdl-hub/.env`: leeg;
  - `remoteAcceptance.status="not_checked"`.
- Live simple-server status na herstart: `activeDownloads=0`, `queuedDownloads=0`, `pendingDownloads=1`; die ene pending rij blijft de oude TikTok-rij en is geen K2S-run.

Gate 3 K2S-herstelpoging afgelopen uur:

- Venster: `2026-05-14 06:05:08+02` t/m `2026-05-14 07:05:08+02`.
- Bewezen: in dat uur waren er 5 K2S-achtige `error` downloadrijen, 4 unieke K2S file-ids.
- Bewezen foutklasse: alle 5 vielen onder `auth_firefox_token_rejected`.
- Bewezen herstelkandidaten:
  - hubjob `46441`, oorspronkelijke download `387139`, file-id `0962a96510e86`;
  - hubjob `46442`, oorspronkelijke download `387141`, file-id `0266c56647e96`;
  - hubjob `46443`, oorspronkelijke download `387142`, file-id `755d8d9d42cac`;
  - hubjob `46444`, oorspronkelijke download `387143`, file-id `9424e49b9f91c`.
- Bewezen niet apart geretried: download `387140`, omdat die dezelfde file-id had als `387141` en `387141` betere thread-context had.
- Actie uitgevoerd na toestemming: `POST /api/jobs/:id/retry` voor `46441`, `46442`, `46443`, `46444`.
- Bewezen resultaat: alle vier retries maakten nieuwe simple-server downloadrijen maar faalden opnieuw:
  - hubjob `46441` -> download `387153` -> `error`;
  - hubjob `46442` -> download `387154` -> `error`;
  - hubjob `46443` -> download `387151` -> `error`;
  - hubjob `46444` -> download `387152` -> `error`.
- Nieuwe fout na retry: `K2S web-API gaf geen JSON terug (404, auth=firefox-localstorage). Zet K2S_COOKIE/K2S_X_BC of WEBDL_KEEP2SHARE_AUTH_TOKEN/K2S_AUTH_TOKEN of WEBDL_KEEP2SHARE_USERNAME/PASSWORD in .env.`
- Non-secret `.env` inspectie:
  - `K2S_COOKIE` aanwezig;
  - cookie-namen: `auth_id`, `sess`, `auth_hash`, `auth_uniq_*`, `auth_uid_*`;
  - geen `accessToken`;
  - geen `refreshToken`;
  - geen `pcId`;
  - geen `x-ec1jam0tc2vzc2lvbi1pza-id`;
  - `K2S_X_BC` aanwezig;
  - `K2S_USERNAME` aanwezig;
  - geen `K2S_PASSWORD`;
  - geen `K2S_AUTH_TOKEN`;
  - geen `K2S_ACCESS_TOKEN`;
  - geen `K2S_WEB_ACCESS_TOKEN`.
- Conclusie als bewezen negatieve claim: de vier K2S-downloads van het afgelopen uur zijn niet automatisch herstelbaar met de huidige lokale auth.
- Conclusie als actievoorwaarde: verder herstel vereist eerst een K2S-authbron die remote geaccepteerd wordt, bijvoorbeeld een geldige permanente API-token, geldige access/web-access token, of complete loginconfig met wachtwoord. Daarna pas opnieuw dezelfde vier file-ids retryen.
- Niet doen: deze vier jobs blijven herhaald retryen met dezelfde auth; dat levert alleen nieuwe error-rijen op.

## Rollbackstrategie

Als er iets misgaat:

1. Zet alleen normale thread-route terug naar oude `queueBatchDownloadRequest`.
2. Laat Giga-knop tijdelijk disabled of achter confirm.
3. Laat hub/gallery wijzigingen ongemoeid zolang ze tests groen houden.
4. Rebuild XPI.

Dit is de veilige fallback omdat het de bekende werkende user-flow herstelt zonder database- of hub-migraties terug te draaien.

## Definitie van klaar

Het herstel is klaar wanneer:

- gewone "Hele thread" weer werkt zoals in git;
- Giga start alleen via Giga of expliciete overdracht;
- ViperGirls maakt geen `/threads/threads/` meer;
- K2S geeft vooraf duidelijke authstatus;
- nieuwe losse downloads zichtbaar door de lifecycle heen bewegen;
- completed downloads in gallery verschijnen of een concrete hidden reason hebben;
- Giga kan grote scans in chunks queueën zonder gewone downloads te breken;
- `npm test` in `webdl-hub` groen blijft;
- XPI bewust opnieuw gebouwd is.
