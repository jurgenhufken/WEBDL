# WEBDL-Gallery: Viewer Herbouw Plan

> Lichte standalone gallery + viewer op poort 35731, direct verbonden met
> PostgreSQL. Vervangt de simple-server viewer functionaliteit zonder
> legacy code.

## 1. Status

| Onderdeel | Status |
|---|---|
| Node + Express backend op poort 35731 | ✅ klaar |
| DB-connectie `postgres://localhost/webdl` | ✅ klaar |
| Grid met thumbs + infinite scroll | ✅ klaar |
| Filters: platform, channel, zoek, sort, min-rating | ✅ klaar |
| API: `/api/items`, `/api/platforms`, `/api/channels`, `/api/rating` | ✅ klaar |
| File stream: `/media/:id`, `/thumb/:id` | ✅ klaar |
| Rating via toets 0-9 + klik op sterrenbalk | ✅ klaar |
| Viewer modal basis (klik → open, ← → nav, Esc sluit) | ✅ klaar |
| **Volledige viewer met alle controls** | 🛠 nog te doen |
| **Tag-systeem + API endpoints** | 🛠 nog te doen |
| **Slideshow / Wrap / Random / Video-wait** | 🛠 nog te doen |

## 2. Viewer feature-lijst (overgenomen uit simple-server viewer)

### 2.1 Sidebar links (items-lijst)

- Mode selector: **Kanaal** / **Recent**
- Filter selector: **Media** / **alleen video** / **alleen foto** / **alles**
- Tag filter dropdown (alleen items met die tag)
- **↻ Herladen** button
- Items-lijst met scroll, active item highlighted + auto-scroll naar active
- Platform + channel filters
- Zoek-input

### 2.2 Topbar rechts-boven

- `nowTitle` + `nowSub` (kanaal/bron info)
- Rating display (interactief)
- **☰** Sidebar toggle
- **Open** (originele bron URL in nieuwe tab)
- **Finder** (lokaal pad openen — alleen bij lokaal bestand)
- **Volume** slider
- **Mute** button
- **Seek** slider (video positie)
- **🏷️ Tags** button → opent dialog

### 2.3 Controls-rij

- **▶︎ Dia** (slideshow start/stop)
- Interval select: **2 / 4 / 7 / 10 / 15 / 30 / 60 / 300s**
- **🔁 Wrap** toggle (aan einde terug naar begin)
- **🔀 Random** toggle (next = random item)
- **⏳ Video afwachten** toggle (wacht op video-einde voor slideshow-next)

### 2.4 Stage (hoofd-gedeelte)

- Gecentreerd media (`object-fit: contain`)
- **Geen zoom** (was buggy in oude viewer)
- Volledig uitgevuld langs 1 as (horizontaal óf verticaal)
- HUD pills links/rechts met extra info (bv index/total, platform)
- Video autoplay muted (browser-policy safe)
- Switching items: oude video pauzeren + element verwijderen → geen memory leak

### 2.5 Tag dialog

- Lijst van bestaande tags met **+/−** (toevoegen/verwijderen voor huidig item)
- Nieuwe tag invoeren + toevoegen
- Tag globaal verwijderen

### 2.6 Log panel

- Onderaan, togglebaar met knop of `L` toets
- Toont rating-events, errors, API status

## 3. Toetsen & muiscontroles

### 3.1 Keyboard shortcuts

| Toets | Actie |
|---|---|
| ← | Vorige item |
| → | Volgende item |
| ↑ | Vorig kanaal (in channel-mode) |
| ↓ | Volgend kanaal (in channel-mode) |
| Space | Video play/pause |
| M | Video mute toggle |
| Esc | Sluit viewer (of sidebar/log eerst) |
| 0-9 | Rating: `0=5.0, 1=4.5, ..., 9=0.5` |
| S | Sidebar toggle |
| L | Log toggle |

### 3.2 Mouse controls

| Muis | Waar | Actie |
|---|---|---|
| Klik | Kaart in lijst/grid | Open item in viewer |
| Klik | Ster | Rating (halve ster via X-positie) |
| Rechterklik | Ster | Rating wissen (null) |
| Klik | Stage (video) | Toggle play/pause |
| Klik | Stage (image) | Niks |
| Dubbelklik | Stage | Sidebar toggle |
| Klik | Sidebar backdrop (mobiel) | Sluit sidebar |
| Klik | Buiten viewer | Sluit viewer |
| Klik | ← / → nav pijlen | Vorige/volgende |
| Scroll wheel | Stage | **TBD — jij kiest** |
| Mousedown + drag | Seek slider | Scrub video positie |

**Openstaande vraag:** Scrollwheel op stage =
(a) next/prev door lijst, of
(b) niets doen.

## 4. API endpoints

### 4.1 Bestaand (werkt)

- `GET /api/items?limit&offset&platform&channel&q&sort&min_rating` → media lijst
- `GET /api/platforms` → platforms met counts
- `GET /api/channels?platform=` → kanalen
- `POST /api/rating { id, rating }` → rating bijwerken
- `GET /media/:id` → bestand streamen
- `GET /thumb/:id` → thumbnail streamen
- `GET /api/health`

### 4.2 Nog toe te voegen

- `GET /api/tags` → alle globale tags
- `GET /api/items/:id/tags` → tags van 1 item
- `POST /api/items/:id/tags { tag_id }` → tag koppelen
- `DELETE /api/items/:id/tags/:tagId` → tag ontkoppelen
- `POST /api/tags { name }` → nieuwe tag
- `DELETE /api/tags/:id` → tag globaal verwijderen

Schema: hergebruik simple-server's `public.tags` + `public.download_tags`
(bestaat al, simple-server gebruikt dezelfde tabellen).

## 5. State-model (client)

```js
state = {
  items: [],                 // geladen media
  index: 0,                  // huidige in items
  cursor: 0,                 // paginatie
  done: false,               // alles geladen?
  mode: 'recent',            // 'channel' | 'recent'
  filter: 'media',           // 'media' | 'video' | 'image' | 'all'
  tag: '',                   // geselecteerde tag filter
  platform: '',              // geselecteerd platform
  channel: '',               // geselecteerd kanaal
  q: '',                     // zoekquery
  sort: 'recent',            // 'recent' | 'rating' | 'random'
  minRating: null,

  channels: [],              // in channel-mode: lijst van kanalen
  chIndex: 0,                // huidig kanaal

  slideshow: false,
  slideshowTimer: null,
  slideshowInterval: 4,      // seconden
  wrap: true,
  random: false,
  videoWait: true,

  sidebarOpen: true,
  logOpen: false,

  viewerOpen: false,
};
```

## 6. Bugs die ik voorkom (vs oude viewer)

1. **`elModal` ReferenceError** → defensive `typeof el === 'undefined'` check
2. **`\n` in string literal** in template-literal HTML → aparte `.js`/`.html` files
3. **Layout-jitter bij media-load** → vaste stage grootte, `object-fit: contain`
4. **Video memory leak** bij snel wisselen → oude `<video>` pauzeren + removen
5. **Focus-issues** → window-level keydown met `{capture:true}`, skip form inputs
6. **Autoplay block** → `muted=true` bij autoplay

## 7. Bouwvolgorde (geprioriteerd)

1. HTML structuur: sidebar + topbar + stage + controls-rij + log panel
2. CSS: layout grid, object-fit, responsive
3. JS core: state + open/close/showCurrent/next/prev
4. Keyboard handlers
5. Mouse handlers (klik, dubbelklik, scroll)
6. Rating (toetsen + halve-ster klik + rechterklik wissen)
7. Slideshow + Wrap + Random + Video-wait logica
8. Volume + Mute + Seek controls
9. Sidebar toggle + Log panel toggle
10. Mode (channel/recent) + filter selectors + channel navigatie
11. Tags API (server) + tag dialog (client)
12. popstate (browser back/forward)
13. HUD pills, fallback thumb, thumb retry
14. Finder button (localhost alleen, via `file://` of shell call)
15. Playwright end-to-end test

## 8. Beslispunten voor gebruiker

- [ ] **Scrollwheel op stage**: next/prev of niks?
- [ ] **Channel-mode**: wil je ↑/↓ voor kanaal-sprong behouden?
- [ ] **Finder-button**: alleen lokaal zinvol — houden of skippen?
- [ ] **HUD pills**: welke info wil je standaard zien (index/total, platform, size, duration)?

## 9. Dependencies

Package.json (al geïnstalleerd):
- express ^4.19.2
- pg ^8.12.0

Geen andere dependencies nodig: vanilla JS voor frontend.

## 10. Runcommand

```bash
cd /Users/jurgen/WEBDL/webdl-gallery
npm start   # server op http://localhost:35731
```
