# WEBDL batch method per site

Laatste update: 2026-02-21

## Doel
In 1 klik op een zoek-/listingpagina alle onderliggende videolinks verzamelen en als batch naar `/download/batch` sturen.

## Technische methode (nu in code)

### 1) Client-side extractie (Firefox toolbar)
Bestand: `firefox-native-controller/content/debug-toolbar.js`

- Domeinlijst voor listing-heurstieken:
  - motherless.com
  - pornzog.com
  - txxx.com
  - omegleporn.to
  - tnaflix.com
  - thisvid.com
  - pornone.com
  - pornhex.com
  - xxxi.porn
  - cums.net
  - gig.sex
- Alleen actief op listing-achtige paden (`/search`, `/term`, `/tags`, `/categories`, etc.).
- Voor elk `<a href>` op dezelfde host:
  - reject: search/login/policy/static assets
  - accept: detailpatronen zoals `/video`, `/videos`, `/watch`, `/clip`, `/embed`, `/view`
  - fallback accept: slug-achtige paden met thumbnail/tijd-indicatie in de anchor

Resultaat: lijst met kandidaat-detail-URLs voor batch.

### 2) Server-side downloadflow
Bestand: `screen-recorder-native/src/simple-server.js`

- Batch endpoint blijft dedupliceren voor queue insert.
- Voor genoemde domeinen wordt yt-dlp metadata-probe overgeslagen om 403-spam te verminderen.
- Download zelf loopt nog via normale yt-dlp/direct flow.

## Status per site

| Site | Batch linkcollectie op listingpagina | Metadata-probe | Opmerking |
|---|---|---|---|
| motherless.com | Geactiveerd via listing-heuristiek | Skip (anti-403) | Detail-URL's uit search/term |
| pornzog.com | Geactiveerd via listing-heuristiek | Skip (anti-403) | Detail-URL's uit search |
| txxx.com | Geactiveerd via listing-heuristiek | Skip (anti-403) | Detail-URL's uit search |
| omegleporn.to | Geactiveerd via listing-heuristiek | Skip (anti-403) | Detail-URL's uit search |
| tnaflix.com | Geactiveerd via listing-heuristiek | Skip (anti-403) | Detail-URL's uit search |
| thisvid.com | Geactiveerd via listing-heuristiek | Skip (anti-403) | Detail-URL's uit search |
| pornone.com | Geactiveerd via listing-heuristiek | Skip (anti-403) | Detail-URL's uit search |
| pornhex.com | Geactiveerd via listing-heuristiek | Skip (anti-403) | Detail-URL's uit search |
| xxxi.porn | Geactiveerd via listing-heuristiek | Skip (anti-403) | Detail-URL's uit search |
| cums.net | Geactiveerd via listing-heuristiek | Skip (anti-403) | Detail-URL's uit search |
| gig.sex | Geactiveerd via listing-heuristiek | Skip (anti-403) | Detail-URL's uit search |

## Hoe je test

1. Start server opnieuw.
2. Reload addon/content script (nieuwe build marker zichtbaar in serverlog).
3. Open 1 van de zoekpagina’s.
4. Klik `⏬ Batch`.
5. Controleer in notificatie/log:
   - aantal gevonden URLs > 0
   - `Batch gestart: N downloads`
6. Check dashboard `/dashboard` of `/downloads` op ingestarte queue.

## Uitleg 403 logs

`⚠️ Metadata ophalen mislukt: HTTP Error 403: Blocked` betekende dat yt-dlp metadata op sommige hosts wordt geblokkeerd.
Dat is niet per se een totale downloadfout. De flow gaat door met de downloadpoging zonder metadata.

Met de nieuwe skip-regel wordt metadata voor deze domeinen vooraf overgeslagen, zodat je minder/nooit die 403-spam ziet.
