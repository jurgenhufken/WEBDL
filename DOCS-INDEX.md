# WEBDL — Documentatie-index

**Laatst bijgewerkt: 2026-05-30**

Centraal overzicht van alle docs in dit repo, met datum + status. Start hier als je net binnenkomt en wil weten wáár wat staat.

---

## 🟢 ACTUEEL — lees deze eerst

| Doc | Datum | Inhoud |
|---|---|---|
| [STATUS-2026-05-24.md](STATUS-2026-05-24.md) | **2026-05-30** | **Live document** — laatste sessie-handoff, Jürgen's klachten, server-status |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 2026-05-24 | Target architectuur, 12-staps migratie, rollback per stap |

**Plus** (buiten dit repo):
- Plan-bestand: `/Users/jurgen/.claude/plans/analyseer-dit-goed-denkk-starry-minsky.md` — diepe context van laatste sessie + open sporen
- Memories: `/Users/jurgen/.claude/projects/-Users-jurgen-WEBDL/memory/` — auto-geladen elke nieuwe sessie via `MEMORY.md` index

---

## 🟡 STABIEL — handoff/scope-docs van 24-mei (specifiek werk-gebonden)

| Doc | Datum | Inhoud |
|---|---|---|
| [CLAUDE-CODE-HANDOFF.md](CLAUDE-CODE-HANDOFF.md) | 2026-05-24 | Handoff Cowork-sessie → Claude Code, P0/P1-lijst |
| [HANDOFF-COWORK-TO-VSCODE-2026-05-24.md](HANDOFF-COWORK-TO-VSCODE-2026-05-24.md) | 2026-05-24 | Cowork → VSCode overdracht |
| [GALLERY-PERF-PLAN.md](GALLERY-PERF-PLAN.md) | 2026-05-24 | Gallery performance plan → migrations/ |
| [TOOLBAR-SCOPE-2026-05-24.md](TOOLBAR-SCOPE-2026-05-24.md) | 2026-05-24 | Toolbar-refactor scope (relevant voor Spoor 3-toolbar) |
| [migrations/2026-05-24-gallery-perf/README.md](migrations/2026-05-24-gallery-perf/README.md) | 2026-05-24 | SQL-migratie (`media_kind` + indexes — Spoor E.1) |

---

## 🔴 VEROUDERD — april/2-mei (gemarkeerd met banner bovenaan)

Niet weggooien — bevatten historische context. Banner verwijst naar actuele docs.

| Doc | Datum | Voor wie? |
|---|---|---|
| [STATUS.md](STATUS.md) | 2026-04-30 | Vroege drie-service-architectuur (verouderd door STATUS-2026-05-24) |
| [CURRENT_WEBDL_PLAN_2026-05-01.md](CURRENT_WEBDL_PLAN_2026-05-01.md) | 2026-05-01 | Naam zegt "Current" maar uit 1 mei |
| [HANDOFF_WEBDL_GALLERY_2026-05-01.md](HANDOFF_WEBDL_GALLERY_2026-05-01.md) | 2026-05-01 | Gallery-handoff van 1 mei |
| [WEBDL-vervolgplan-2026-05-01.md](WEBDL-vervolgplan-2026-05-01.md) | 2026-05-02 | Vervolgplan voor nieuwe chat (2 mei) |
| [webdl-gallery/ROADMAP.md](webdl-gallery/ROADMAP.md) | 2026-04-24 | Gallery-roadmap (april) |
| [webdl-gallery/PLAN.md](webdl-gallery/PLAN.md) | 2026-04-30 | Gallery viewer plan (april) |
| [webdl-hub/ROADMAP.md](webdl-hub/ROADMAP.md) | 2026-04-30 | Hub roadmap (april) |
| [webdl-hub/ARCHITECTURE.md](webdl-hub/ARCHITECTURE.md) | 2026-04-24 | Hub-architectuur (april) |
| [screen-recorder-native/REFACTOR_PLAN.md](screen-recorder-native/REFACTOR_PLAN.md) | 2026-04-12 | Refactor simple-server (april) |

---

## 📚 REFERENTIE — README's per sub-project (component-overzichten)

| Doc | Inhoud |
|---|---|
| [README.md](README.md) | Repo-root README |
| [webdl-core/README.md](webdl-core/README.md) | webdl-core directory + Source-contracten |
| [firefox-screen-tools/README.md](firefox-screen-tools/README.md) | Firefox tools utility |
| [telegram_media_downloader/README.md](telegram_media_downloader/README.md) | Telegram-downloader tool |
| [telegram-channel-downloader/Readme.md](telegram-channel-downloader/Readme.md) | Telegram channel downloader |
| [.tools/reddit-dl/README.md](.tools/reddit-dl/README.md) | Reddit-dl tool |

---

## Conventies voor nieuwe docs

1. **Datum in titel** als doc tijd-gebonden is (bv. `STATUS-2026-05-24.md`, niet `STATUS.md`)
2. **Update banner** voeg bovenaan toe zodra een doc verouderd raakt — verwijs naar actuele
3. **Update DOCS-INDEX.md** bij toevoegen van een nieuw doc
4. **Cross-link** vanuit het actuele doc terug naar de vervangen verouderde versie zodat history vindbaar blijft

## Sessie-handoff checklist

Bij einde van een grote sessie:
1. Update [STATUS-2026-05-24.md](STATUS-2026-05-24.md) met laatste status + commits + open klachten
2. Update plan-bestand in `/Users/jurgen/.claude/plans/` met cumulatieve sub-sessie-info
3. Schrijf nieuwe `project_*.md` of `feedback_*.md` memories voor cross-sessie-info die NIET in code/git-log te vinden is
4. Update `MEMORY.md` index om nieuwe memories te linken
5. Optioneel: voeg banner toe aan docs die door deze sessie verouderd zijn
