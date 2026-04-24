# WebDL-Hub

Centrale download-orchestrator voor het WEBDL-ecosysteem.
Stuurt `yt-dlp`, `gallery-dl`, `reddit-dl`, `tdl`, `ofscraper` en `instaloader` aan via één API + web-dashboard.

> **Status:** Fase 0 — skeleton. Zie [ROADMAP.md](./ROADMAP.md).

## Quickstart

```bash
# 1. Dependencies
npm install

# 2. Config
cp .env.example .env

# 3. DB-schema aanmaken (vanaf Fase 1)
npm run migrate

# 4. Dev-server (vanaf Fase 1)
npm run dev
```

Server draait op `http://localhost:35730`.

## Scripts

| Script         | Wat                                                  |
| -------------- | ---------------------------------------------------- |
| `npm run dev`  | Server met `--watch` (auto-restart)                  |
| `npm start`    | Productie-start                                      |
| `npm run migrate` | Schema `webdl` aanmaken in PostgreSQL             |
| `npm test`     | Unit-tests (offline, geen netwerk)                   |
| `npm run test:online` | Inclusief smoke-tests die echt downloaden    |
| `npm run lint` | ESLint over `src/` en `test/`                        |
| `npm run format` | Prettier schrijven                                 |

## Stack

- Node.js 20+ (CommonJS)
- Express + `ws` (WebSocket voor live progress)
- PostgreSQL via `pg` (schema `webdl`) — hergebruikt de bestaande `webdl`-DB
- Geen bundler, geen transpiler

## Documentatie

- [ARCHITECTURE.md](./ARCHITECTURE.md) — keuzes, modules, adapter-contract, DB, API
- [ROADMAP.md](./ROADMAP.md) — gefaseerd plan met acceptatiecriteria
