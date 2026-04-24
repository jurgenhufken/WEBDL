# WebDL-Hub — Roadmap

Planmatige opbouw in fases. Per fase: duidelijk doel, kleine bestanden, eerst tests, dan uitbreiden.
Pas naar de volgende fase als de **acceptatiecriteria** groen zijn.

---

## Fase 0 — Skeleton & afspraken  *(nu)*

**Doel:** lege projectstructuur, docs, VS Code-config, `package.json`, geen runtime-code.

- [ ] `webdl-hub/` aangemaakt met mappenstructuur uit ARCHITECTURE §4
- [ ] `package.json` met scripts (`dev`, `test`, `lint`)
- [ ] `.eslintrc.json`, `.prettierrc`, `.editorconfig`
- [ ] `.vscode/launch.json` (debug server + tests)
- [ ] `README.md` (quickstart, 1 scherm)
- [ ] `.env.example`

**Klaar als:** project opent schoon in VS Code, `npm install` werkt, structuur zichtbaar.

---

## Fase 1 — Kern: DB + Queue + API + yt-dlp-adapter

**Doel:** je kunt via `POST /api/jobs { url }` een YouTube-video downloaden en het resultaat terugzien.

- [ ] `src/db/schema.sql` + `migrate.js` (better-sqlite3)
- [ ] `src/db/repo.js` — `createJob`, `updateStatus`, `appendLog`, `addFile`
- [ ] `src/util/process-runner.js` — spawn-wrapper met line-emitter
- [ ] `src/queue/queue.js` + `worker.js` — 1 concurrent job
- [ ] `src/adapters/base.js` + `ytdlp.js`
- [ ] `src/router/detect.js`
- [ ] `src/api/routes-jobs.js` (POST, GET list, GET detail)
- [ ] `src/api/ws.js` — event-broadcast
- [ ] `src/server.js` — bootstrap

**Tests (`test/`):**
- [ ] `router.detect` met 10 URL-cases
- [ ] `ytdlp.parseProgress` met fixture-stdout
- [ ] `queue` met fake-adapter (sleep-mock)
- [ ] `repo` CRUD
- [ ] **Integratie (optioneel, `--online`):** 1 tiny public video download

**Klaar als:** `npm test` groen, handmatige smoke-download lukt, WS stuurt progress.

---

## Fase 2 — Web-dashboard

**Doel:** zichtbaar wat de hub doet zonder curl.

- [ ] `src/public/index.html` — job-lijst + "Nieuwe download"-form
- [ ] `src/public/app.js` — vanilla JS, fetch + WS, geen bundler
- [ ] `src/public/styles.css` — donker thema, compact
- [ ] Live progress-balk per job
- [ ] Detailpaneel: logs, bestanden (met `computer://` links)

**Klaar als:** je kunt volledig vanuit browser een URL plakken → download zien verschijnen → file openen.

---

## Fase 3 — Overige adapters

Per adapter: eigen bestand, eigen fixture-tests, eigen priority.

- [ ] `gallerydl.js` (priority 60)
- [ ] `reddit.js` (wrapt `.tools/reddit-dl`, priority 80)
- [ ] `instaloader.js` (priority 80)
- [ ] `ofscraper.js` (priority 80)
- [ ] `tdl.js` (priority 90)
- [ ] `direct.js` — fallback voor .mp4/.zip/… (priority 10)

**Per adapter acceptatiecriteria:**
1. `matches()` test met 5+ URL-cases (positief + negatief)
2. `parseProgress()` test met fixture
3. `plan()` test (argv-samenstelling)
4. Health-check: tool detecteerbaar via `which <tool>`

---

## Fase 4 — Firefox-extensie hook

**Doel:** één klik vanuit pagina → job in hub.

- [ ] Nieuwe knop in `firefox-native-controller`: "Download via WebDL-Hub"
- [ ] Context-menu op links
- [ ] POST naar `http://localhost:35730/api/jobs`
- [ ] Badge/notificatie als job klaar is (via long-poll of eigen WS-client)

**Klaar als:** rechtermuis op willekeurige videolink → "Download" → verschijnt in dashboard.

---

## Fase 5 — Integratie met bestaande stack

- [ ] Optie: output-root delen met `screen-recorder-native/gallery`
- [ ] Optie: schakelbaar naar PostgreSQL (zelfde schema, delen met simple-server)
- [ ] `simple-server` krijgt ondersteuning om downloads door te sturen naar de hub
- [ ] Audit: welke helper-scripts in `screen-recorder-native/src/fix_*` kunnen weg zodra de hub ze overneemt?

---

## Fase 6 — Kwaliteit & onderhoud

- [ ] Health-endpoint laat zien welke tools ontbreken (→ install-instructies)
- [ ] Retry met exponentiële backoff
- [ ] Dedup op URL + checksum
- [ ] Tagging (zoals `auto-tagger.js` in simple-server)
- [ ] Backup-script voor DB

---

## Teststrategie (geldt elke fase)

1. **Unit** — adapters/router/queue met fixtures, zonder netwerk
2. **Integratie (lokaal)** — in-memory DB, fake-adapter
3. **Smoke (online, opt-in)** — met `TEST_ONLINE=1 npm test` een echte yt-dlp-run
4. **Manueel** — per fase 1 korte checklist in de PR-beschrijving / commit

Geen fase wordt afgesloten zonder dat de tests lokaal groen draaien.
