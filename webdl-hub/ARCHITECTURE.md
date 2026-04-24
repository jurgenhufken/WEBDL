# WebDL-Hub — Architectuur

Centrale orchestrator voor alle download-tools binnen het WEBDL-ecosysteem.
Staat **naast** de bestaande projecten (`screen-recorder-native`, `firefox-native-controller`, `.tools/reddit-dl`) en stuurt ze aan via adapters.

---

## 1. Doel en scope

| Wel                                                         | Niet                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| Eén API + UI voor alle downloads                            | Eigen downloader herschrijven (we hergebruiken tools) |
| Queue, retries, logs, dedup, metadata                       | Schermopname (blijft in screen-recorder-native)       |
| Adapter-per-tool (yt-dlp, gallery-dl, reddit, tdl, …)       | Zware transcoding-pipeline (kan later)                |
| Bediening via Web-dashboard, Firefox-extensie, CLI          | Eigen Electron-venster (gebruiken web-UI)             |

---

## 2. High-level plaatje

```
┌────────────────────────┐     ┌────────────────────────┐
│  Firefox-extensie      │     │  Web-dashboard (SPA)   │
│ (firefox-native-       │     │  http://localhost:PORT │
│  controller, uitbreid) │     └───────────┬────────────┘
└───────────┬────────────┘                 │
            │  POST /jobs                  │  REST + WebSocket
            ▼                              ▼
      ┌─────────────────────────────────────────────┐
      │           WebDL-Hub (Node/Express)          │
      │  ┌────────┐  ┌──────────┐  ┌──────────────┐ │
      │  │  API   │→ │  Queue   │→ │   Workers    │ │
      │  └────────┘  └────┬─────┘  └──────┬───────┘ │
      │                   │                │        │
      │              ┌────▼────┐      ┌────▼─────┐  │
      │              │   DB    │      │ Adapters │  │
      │              │ (SQLite │      │  (yt-dlp,│  │
      │              │ →  PG)  │      │ gallery, │  │
      │              └─────────┘      │  reddit, │  │
      │                               │  tdl, …) │  │
      │                               └────┬─────┘  │
      └────────────────────────────────────┼────────┘
                                           │ spawn
                           ┌───────────────┼────────────────┐
                           ▼               ▼                ▼
                       yt-dlp          gallery-dl      reddit-dl CLI
                                                       (.tools/reddit-dl)
```

---

## 3. Technische keuzes

| Onderwerp        | Keuze                                | Waarom                                                        |
| ---------------- | ------------------------------------ | ------------------------------------------------------------- |
| Runtime          | Node.js 20+                          | Consistent met rest van project                               |
| HTTP             | Express                              | Zelfde als simple-server, laag gewicht                        |
| Realtime         | `ws` (WebSocket)                     | Live job-progress naar UI en extensie                         |
| DB               | **PostgreSQL**, schema `webdl`       | Geen SQLite-lock-issues; hergebruik bestaande DB (simple-server) |
| DB-connectie     | `pg` Pool (node-postgres)            | Zelfde als `src/db-adapter.js` in screen-recorder-native      |
| Queue            | Eigen tabel + `FOR UPDATE SKIP LOCKED` | Race-vrij multi-worker, geen extra dependency (geen pg-boss) |
| Tool-spawning    | `child_process.spawn` + line-reader  | Streams voor progress-parsing                                 |
| Tests            | Node built-in `node:test` + `assert` | Geen extra dependency                                         |
| Lint/Format      | ESLint + Prettier (shared config)    | VS Code-integratie                                            |
| Port             | **35730** (naast 35729)              | Geen clash met screen-recorder-native                         |

---

## 4. Mappenstructuur

```
webdl-hub/
├── package.json
├── README.md
├── ARCHITECTURE.md            ← dit bestand
├── ROADMAP.md
├── .env.example
├── .eslintrc.json
├── .vscode/
│   └── launch.json            ← debug-configs per entrypoint
├── src/
│   ├── server.js              ← bootstrap (klein: <50 regels)
│   ├── config.js
│   ├── db/
│   │   ├── schema.sql
│   │   ├── migrate.js
│   │   └── repo.js            ← data-access, thin
│   ├── queue/
│   │   ├── queue.js           ← enqueue/dequeue logica
│   │   └── worker.js          ← concurrency-loop
│   ├── adapters/
│   │   ├── base.js            ← contract + helpers
│   │   ├── ytdlp.js
│   │   ├── gallerydl.js
│   │   ├── instaloader.js
│   │   ├── ofscraper.js
│   │   ├── tdl.js
│   │   └── reddit.js          ← wrapt .tools/reddit-dl
│   ├── router/
│   │   └── detect.js          ← URL → adapter + prioriteit
│   ├── api/
│   │   ├── routes-jobs.js
│   │   ├── routes-admin.js
│   │   └── ws.js              ← live progress-kanaal
│   ├── util/
│   │   ├── logger.js
│   │   └── process-runner.js
│   └── public/                ← dashboard (statisch, geen bundler)
│       ├── index.html
│       ├── app.js
│       └── styles.css
├── test/
│   ├── adapters/              ← met stdout-fixtures per tool
│   ├── router/
│   ├── queue/
│   └── fixtures/
└── scripts/
    ├── dev.sh
    └── seed-test-jobs.js
```

Richtlijn per bestand: **≤ 200 regels**. Als iets groter wordt → splitsen.

---

## 5. Adapter-contract

Elk bestand in `src/adapters/` exporteert hetzelfde object:

```js
// src/adapters/base.js (pseudo)
export const AdapterShape = {
  name: 'ytdlp',                    // uniek
  matches(url) { /* boolean */ },   // accepteert deze adapter de URL?
  priority: 50,                     // hoger = wint bij meerdere matches
  plan(url, opts) { /* returns { argv, cwd, env } */ },
  parseProgress(line) { /* returns { pct, speed, eta } | null */ },
  collectOutputs(workdir) { /* returns [{path, size, mime}] */ },
};
```

De **worker** roept `plan()` aan, spawnt de CLI, piped stdout/stderr door `parseProgress()` en schrijft events naar de queue. `collectOutputs()` wordt na exit 0 uitgevoerd om files aan het job-record te koppelen.

---

## 6. DB-schema (PostgreSQL, schema `webdl`)

Hergebruikt de bestaande `webdl` database (`postgres://jurgen@localhost:5432/webdl`) maar plaatst alles in een **eigen schema** zodat er geen botsing is met de tabellen van `simple-server`.

```sql
CREATE SCHEMA IF NOT EXISTS webdl;
SET search_path TO webdl, public;

CREATE TABLE IF NOT EXISTS webdl.jobs (
  id            BIGSERIAL PRIMARY KEY,
  url           TEXT        NOT NULL,
  adapter       TEXT        NOT NULL,
  status        TEXT        NOT NULL
                CHECK (status IN ('queued','running','done','failed','cancelled')),
  priority      INT         NOT NULL DEFAULT 0,
  options       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  progress_pct  REAL        NOT NULL DEFAULT 0,
  attempts      INT         NOT NULL DEFAULT 0,
  max_attempts  INT         NOT NULL DEFAULT 3,
  locked_by     TEXT,                       -- worker-id (nullable)
  locked_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_prio
  ON webdl.jobs (status, priority DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS webdl.files (
  id          BIGSERIAL PRIMARY KEY,
  job_id      BIGINT NOT NULL REFERENCES webdl.jobs(id) ON DELETE CASCADE,
  path        TEXT   NOT NULL,
  size        BIGINT,
  mime        TEXT,
  checksum    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_files_job ON webdl.files(job_id);

CREATE TABLE IF NOT EXISTS webdl.logs (
  id      BIGSERIAL PRIMARY KEY,
  job_id  BIGINT NOT NULL REFERENCES webdl.jobs(id) ON DELETE CASCADE,
  ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
  level   TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  msg     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_job_ts ON webdl.logs(job_id, ts DESC);
```

### Queue-claim (race-vrij, multi-worker)

```sql
-- één job claimen zonder conflicten
UPDATE webdl.jobs
   SET status = 'running',
       attempts = attempts + 1,
       locked_by = $1,
       locked_at = now(),
       started_at = COALESCE(started_at, now())
 WHERE id = (
    SELECT id FROM webdl.jobs
     WHERE status = 'queued'
     ORDER BY priority DESC, created_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT 1
 )
 RETURNING *;
```

`SKIP LOCKED` zorgt dat meerdere workers tegelijk kunnen pollen zonder lock-contention — exact het probleem dat SQLite had.

---

## 7. API

| Method | Path                   | Doel                                          |
| ------ | ---------------------- | --------------------------------------------- |
| POST   | `/api/jobs`            | Nieuwe download-job (`{ url, options? }`)     |
| GET    | `/api/jobs`            | Lijst (filter: status, adapter, q)            |
| GET    | `/api/jobs/:id`        | Detail + files + laatste logs                 |
| POST   | `/api/jobs/:id/retry`  | Opnieuw proberen                              |
| POST   | `/api/jobs/:id/cancel` | Afbreken                                      |
| DELETE | `/api/jobs/:id`        | Verwijderen (optioneel files)                 |
| GET    | `/api/adapters`        | Lijst beschikbare adapters + versies          |
| GET    | `/api/health`          | Status (DB, tools aanwezig?)                  |
| WS     | `/ws`                  | Live events: `job:progress`, `job:status`, …  |

---

## 8. URL-router

Router vraagt elke adapter `matches(url)`. Als er meerdere matches zijn wint de hoogste `priority`. Voorbeeld:

| URL                                 | Matchende adapters     | Wint                 |
| ----------------------------------- | ---------------------- | -------------------- |
| `youtube.com/watch?v=…`             | ytdlp                  | ytdlp                |
| `reddit.com/r/x/comments/…`         | reddit (80), ytdlp(50) | reddit               |
| `instagram.com/p/…`                 | instaloader (80), ytdlp| instaloader          |
| `t.me/channel/123`                  | tdl                    | tdl                  |
| `example.com/video.mp4`             | ytdlp (50) `direct`(40)| ytdlp                |

Client mag `adapter`-hint meegeven (`POST /api/jobs { url, adapter: 'gallerydl' }`) → router respecteert hint.

---

## 9. Integratie met bestaande code

- **`firefox-native-controller`**: één extra knop + message → POST naar `http://localhost:35730/api/jobs`. Geen breaking changes.
- **`screen-recorder-native/simple-server.js`**: kan op termijn downloads delegeren via HTTP-call naar de hub. Eerste versie: parallel laten draaien.
- **`.tools/reddit-dl`**: wordt aangeroepen door de `reddit`-adapter als subprocess. Blijft standalone bruikbaar.
- **Gallery**: in fase 5 kan de hub naar dezelfde output-folder schrijven zodat de bestaande gallery het oppikt.

---

## 10. Niet-functionele eisen

- **Logs**: JSON-lines naar `./data/logs/YYYY-MM-DD.log` + per job in DB.
- **Config**: via `.env` (DB-pad, poort, output-root, concurrency).
- **Concurrency**: standaard 2 simultane downloads, configureerbaar.
- **Resume-safe**: bij crash → jobs in `running` → teruggezet naar `queued` bij opstart.
- **Testbaar**: elke adapter heeft fixture-stdout zodat parser zonder internet te testen is.
