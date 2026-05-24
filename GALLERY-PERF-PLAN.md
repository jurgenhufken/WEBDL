# Gallery performance plan — multi-tab support

**Doel:** meerdere browser-tabs van de gallery tegelijk vlot (sub-second) bedienen.

**Tabel:** `public.downloads`, 135k+ rows, groeit gestaag.

**Pijnpunt:** `/api/items` feed-query gebruikt `lower()` + `regexp_replace()` + `COALESCE()` in WHERE → geen index-gebruik → seq-scan + per-rij CPU-werk → 2-50s per call → bij parallelle tabs explodeert dat door pool-contention en buffer-lock.

---

## Niveau 1 — Quick cleanup *(low-risk, ~15 min, geen schema-wijziging)*

### 1a. Drop onbenutte indexen

Per `pg_stat_user_indexes` hebben deze 0-3 scans (sinds laatste stats-reset) maar kosten wel disk+write-IO:

| Index | Grootte | Scans | Actie |
|---|---:|---:|---|
| `idx_downloads_metadata_trgm` | 723 MB | 3 | **DROP** — bijna onbenut, kost massa write-overhead |
| `idx_downloads_url_lower_trgm` | 72 MB | 0 | **DROP** |
| `idx_downloads_filepath_ts` | 64 MB | 0 | **DROP** |
| `idx_downloads_ts_calc` | 48 MB | 0 | **DROP** |
| `idx_downloads_ts` | 7.7 MB | 0 | **DROP** |
| `idx_downloads_hub_job_id_recent` | 6.4 MB | 0 | **DROP** |
| `idx_downloads_youtube_filepath_unique` | 3.2 MB | 0 | **CHECK** — naam suggereert UNIQUE constraint, controleer eerst |

**Totaal: ~920 MB disk vrij, minder write-amplification bij elke INSERT/UPDATE.**

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.idx_downloads_metadata_trgm;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_downloads_url_lower_trgm;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_downloads_filepath_ts;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_downloads_ts_calc;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_downloads_ts;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_downloads_hub_job_id_recent;
-- youtube_filepath_unique pas DROP na constraint-check
```

### 1b. REINDEX zwaargebruikte indexen (verwijdert bloat)

Voor indexen met veel scans is bloat na lange tijd typerend. Reindexen comprimeert.

```sql
REINDEX INDEX CONCURRENTLY public.idx_downloads_dedup_filepath;  -- 272MB, 821k scans
REINDEX INDEX CONCURRENTLY public.idx_downloads_url;             -- 43MB, 10k scans
REINDEX INDEX CONCURRENTLY public.idx_downloads_status;          -- 4MB, 138k scans
```

`CONCURRENTLY` = geen lock, langzamer maar non-blocking.

### 1c. Gallery pool tuning

In `webdl-gallery/server.js`:
- `max: 20` is te hoog voor de huidige zware query (geeft contention)
- Optie A: verlaag naar 8 (backpressure)
- Optie B: hou 20 maar zorg eerst dat query snel is (Niveau 3) — dan is 20 prima

**Aanbeveling:** wacht tot na Niveau 3 voor pool-tuning.

---

## Niveau 2 — Caching *(medium, ~1 uur, code-wijziging)*

In `webdl-gallery/server.js` een in-memory LRU-cache voor het zware endpoint:

```js
const NodeCache = require('node-cache'); // of een eigen Map-based
const feedCache = new NodeCache({ stdTTL: 5, checkperiod: 10 });

app.get('/api/items', async (req, res) => {
  const key = JSON.stringify(req.query); // limit, order, cursor, filters
  const hit = feedCache.get(key);
  if (hit) {
    res.set('X-Cache', 'HIT');
    return res.json(hit);
  }
  const result = await runFeedQuery(req.query);
  feedCache.set(key, result);
  res.set('X-Cache', 'MISS');
  res.json(result);
});
```

**Effect:** 90% van UI-calls vragen dezelfde first-page → cache hit = 1ms.
**Trade-off:** updates zijn 5s later zichtbaar (acceptabel).

Plus ETag/304 voor browsers:

```js
const etag = sha256(JSON.stringify(result)).slice(0, 16);
if (req.headers['if-none-match'] === etag) return res.status(304).end();
res.set('ETag', etag);
```

---

## Niveau 3 — Schema-fix *(de echte oplossing, ~2-3 uur incl. test)*

### 3a. Generated column + partial index

```sql
-- Stap 1: kolom toevoegen (snel, geen scan)
ALTER TABLE public.downloads
  ADD COLUMN media_kind text GENERATED ALWAYS AS (
    CASE
      WHEN lower(COALESCE(NULLIF(format,''), regexp_replace(filepath, '^.*\.', '')))
           IN ('mp4','mov','webm','mkv','m4v','avi','flv','wmv','m3u8','ts') THEN 'video'
      WHEN lower(COALESCE(NULLIF(format,''), regexp_replace(filepath, '^.*\.', '')))
           IN ('jpg','jpeg','png','gif','webp','avif','bmp','svg') THEN 'image'
      ELSE NULL
    END
  ) STORED;

-- Stap 2: partial index op precies de gallery-feed predikaten
CREATE INDEX CONCURRENTLY idx_downloads_gallery_v2
  ON public.downloads (
    COALESCE(finished_at, updated_at, created_at) DESC,
    id DESC
  )
  WHERE media_kind IS NOT NULL
    AND status NOT IN ('pending','queued','downloading','postprocessing','superseded')
    AND filepath IS NOT NULL
    AND filepath <> '';
```

### 3b. Query herschrijven in gallery server

In `webdl-gallery/server.js` waar de feed-query staat:

```sql
-- VAN (huidig, seq-scan):
WHERE d.filepath IS NOT NULL AND d.filepath <> ''
  AND d.status <> ALL(ARRAY['pending','queued','downloading','postprocessing','superseded'])
  AND (lower(COALESCE(NULLIF(d.format,''), regexp_replace(d.filepath, '^.*\.', '')))
       IN ('mp4', ...))

-- NAAR (index-hit):
WHERE d.media_kind IS NOT NULL
  AND d.status NOT IN ('pending','queued','downloading','postprocessing','superseded')
  AND d.filepath IS NOT NULL AND d.filepath <> ''
```

**Verwacht effect:** 2700ms → <50ms per call. Multi-tab werkt vlot.

### 3c. Migratie-impact

- `ALTER TABLE … ADD COLUMN GENERATED STORED` op 135k rows = enkele minuten + tijdelijke exclusive lock op de tabel
- Beste in een rustig moment uitvoeren
- Alle bestaande writes wachten kort tijdens ALTER

---

## Niveau 4 — Architectuur *(weken, niet nodig als 1-3 volstaan)*

- Materialized view die elke 30s ververst
- Move-naar-search-engine (Meilisearch/Typesense)
- Hot/cold partitionering (recent in aparte tabel)

Skip tenzij Niveau 3 onvoldoende blijkt.

---

## Volgorde van uitvoering

1. **Nu:** Niveau 1a (drops) — instant ruimte vrij, geen risico
2. **Nu (background):** Niveau 1b (reindex) — non-blocking, paar minuten
3. **Daarna met user-OK:** Niveau 3 (de echte fix) — 5-10 min schema-migratie + 5 min query-rewrite + test
4. **Optioneel later:** Niveau 2 (cache) — als multi-tab nog niet vlot genoeg is na Niveau 3
5. **Niveau 4:** alleen als het ooit weer traag wordt bij verdere groei

## Rollback strategie

- Indexen droppen: simpel terug te brengen via `CREATE INDEX`
- REINDEX: oude index blijft tot nieuwe klaar is, geen risico
- Generated column: `ALTER TABLE … DROP COLUMN media_kind;` + index drop
- Cache: code-revert via git

Geen schema-wijziging is destructief.
