# WEBDL-Gallery viewer plan - 30 april 2026

`webdl-gallery` is verder dan het oude plan aangaf. De service heeft inmiddels
een volledige viewer-module (`public/viewer.js`), tag-API's en Finder-support.
Dit plan focust daarom op verificatie, polish en ontbrekende randgevallen.

## Status

| Onderdeel | Status |
|---|---|
| Node + Express backend op port 35731 | klaar |
| DB-connectie `postgres://localhost/webdl` | klaar |
| Grid met thumbnails + infinite scroll | klaar |
| Filters: platform, channel, zoek, sort, min-rating | klaar |
| Extra filters: media type en tag | basis klaar |
| API: `/api/items`, `/api/items-since`, `/api/platforms`, `/api/channels` | klaar |
| API: `/api/rating` | klaar |
| API: `/api/tags`, `/api/items/:id/tags` | klaar |
| File stream: `/media/:id`, `/thumb/:id` | klaar |
| Finder endpoint: `/api/finder` | klaar |
| Viewer shell + `viewer.js` | klaar |
| Rating via keys/click | klaar |
| Slideshow / Wrap / Random / Video-wait | aanwezig, testen |
| Sidebar, tag dialog, HUD, keyboard/mouse controls | aanwezig, testen |
| Browser/mobile smoke tests | nog te doen |
| Gallery visibility audit | nog te doen |

## Eerstvolgende werk

### 1. Gallery visibility audit

Doel: verklaren waarom "niet alle downloads" zichtbaar zijn.

Te controleren SQL-categorieen:

- `status != 'completed'`
- `filepath IS NULL`
- `filepath` bestaat niet meer op disk
- dubbele records die door `DISTINCT ON (title/filename/filepath, filesize)`
  worden samengevouwen
- onbekende of lege `format`
- filters in de UI die nog actief blijven

Acceptatie:

- Een korte telling per categorie.
- Bewuste keuze of de query moet wijzigen of de data gerepareerd moet worden.

### 2. Viewer handmatig verifiëren

Checklist desktop:

- Grid item opent viewer.
- Vorige/volgende via knoppen en pijltoetsen.
- Esc sluit viewer of overlay.
- Space speelt/pauzeert video.
- M mute toggle.
- Rating 0-9 werkt en update grid.
- Sterrenklik en rating wissen werken.
- Slideshow start/stopt.
- Wrap aan einde werkt.
- Random kiest ander item.
- Video-wait wacht tot video-einde.
- Tag dialog kan tag toevoegen, koppelen, ontkoppelen, verwijderen.
- Finder opent het bestand in macOS Finder.
- Browser back sluit viewer via popstate.

Checklist responsive:

- Sidebar overlay is bruikbaar op smalle viewport.
- Topbar en controls overlappen media niet.
- Lange titels breken netjes af.

### 3. Tests toevoegen

Minimaal:

- API smoke met Node test of shell script:
  - `/api/health`
  - `/api/items?limit=5`
  - `/api/platforms`
  - `/api/channels`
  - `/api/tags`
- Viewer browser smoke:
  - pagina opent zonder console errors
  - eerste item openen
  - next/prev
  - rating call mocken of op test-id uitvoeren

### 4. Performance polish

Bij >100k rows kan offset-paginering traag worden.

Latere verbetering:

- Cursor-paginering met `(COALESCE(finished_at, created_at), id)`.
- Optionele materialized/index table voor media-items.
- Indexen controleren op `status`, `finished_at`, `platform`, `channel`,
  `rating`, `source_url`, `filepath`.

## Beslissingen

| Punt | Voorkeur |
|---|---|
| Scrollwheel op stage | zoom/pan behouden zoals `viewer.js` nu doet |
| Finder-button | houden, want dit is localhost/macOS tooling |
| Channel-mode toetsen | `up/down` behouden als snelle navigatie |
| Zoom | aanwezig; alleen behouden als het stabiel blijft zonder layout-jitter |

## Niet nu

- Geen auth toevoegen zolang alles localhost blijft.
- Geen nieuwe frontend framework introduceren.
- Geen gallery-cache bouwen voordat duidelijk is dat de DB-query werkelijk de
  bottleneck is.
