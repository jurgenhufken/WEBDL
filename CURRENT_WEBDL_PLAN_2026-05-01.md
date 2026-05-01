# WEBDL Current Plan - 2026-05-01

This is the current working note after reconstructing the previous Codex session.
It supersedes the older gallery handoff for the next steps.

## Current State

- Branch: `codex/fix-gallery-keep2share-live`
- Main services are running:
  - simple-server: `http://localhost:35729`
  - hub: `http://localhost:35730`
  - gallery: `http://localhost:35731`
- PostgreSQL is running again after a stale `postmaster.pid` blocked startup.
- `StartServer.command` now checks PostgreSQL before starting Node services and tries to recover a stale Postgres lock.
- New extra storage is mounted as `/Volumes/WEBDL Extra`, with about `4.5 TiB` free.
- Old WEBDL storage is still mounted as `/Volumes/HDD - One Touch`, with about `598 GiB` free.
- Gallery now has local work to discover multiple `/Volumes/*/WEBDL` roots, so old and new storage can both remain visible.
- Hub queue live status at the last check:
  - total jobs: `22612`
  - paused: `1608`
  - running: `0`
  - done: `20416`
  - failed: `583`
  - cancelled: `5`
- SABNZBD should use the new `WEBDL Extra` disk for new downloading/completed output.
- Old SABNZBD completed output on `HDD - One Touch` remains a read/import root so existing DB/gallery paths stay valid.

## What Went Wrong

The system drifted into too many partial responsibilities:

- The hub should be the source of truth, but some flows still behave like simple-server, gallery, SABNZBD and file watchers are independent systems.
- The hub UI previously inferred too much from a limited job window, so the visible dashboard did not match the real database.
- Newer imports could hide older queued work, which made the backlog feel lost.
- Gallery visibility was fixed for some cases, but storage-root handling was still too implicit.
- SABNZBD and the new HDD were treated too narrowly at first; the new disk needs to be a general WEBDL storage root, not only SAB storage.
- Forum/gallery pages need a first-class expansion flow. The hub cannot only think in single video URLs.

## Decisions

- The hub/database must be the brain and motor:
  planned, running, paused, failed, completed, imported and visible states must be auditable from the hub.
- The gallery should only show real imported/completed media, not queued or discovery-only placeholders.
- New WEBDL downloads, including SABNZBD, should use `/Volumes/WEBDL Extra/WEBDL` as the preferred output root, while existing media remains valid on old roots.
- SABNZBD should be monitored and imported through the hub; the hub must watch both old and new SAB completed roots.
- Queue priority must be explicit. A new URL should not silently starve old playlist jobs forever, and old playlist jobs should not block urgent/manual jobs without visible controls.
- ViperGirls should be implemented with the same user-facing pattern as FootFetishForum: thread expansion, per-post/media jobs, visible progress, retry/cancel/pause controls.

## Immediate Next Work

1. Stabilize live state before new feature work:
   - confirm whether SABNZBD itself is running;
   - explain why `/api/sabnzbd/status` is `fetch failed`;
   - confirm why the hub queue is still paused;
   - decide whether to resume all paused jobs, only selected groups, or keep paused while adding ViperGirls.

2. Make storage policy explicit:
   - define one preferred new output root: `/Volumes/WEBDL Extra/WEBDL`;
   - keep `HDD - One Touch` as an existing media root;
   - ensure hub, gallery, simple-server, auto-import and SAB watcher agree on allowed roots;
   - set SABNZBD downloading/completed paths to `WEBDL Extra`;
   - add a status panel or endpoint showing roots, free space and which root new jobs will use.

3. Improve hub quality before more adapters:
   - make the right-hand panel useful when no job is selected;
   - show paused/running/failed groups clearly;
   - show why a job is blocked: paused, no worker, missing tool, auth/cookies, network, hoster login, output root unavailable;
   - add true process cancel where current cancel only changes DB status.

4. Add ViperGirls support:
   - detect `vipergirls.to/threads/...`;
   - fetch pages using the existing forum/cookie approach used for FootFetishForum;
   - expand a multi-page thread into post/set jobs;
   - extract gallery image links and video/filehost links separately;
   - create hub jobs with platform `vipergirls`, thread title, post title/model name and page/post metadata;
   - make the hub UI show expansion results before flooding the queue.

5. Re-audit adapters that failed:
   - OnlyFans: identify whether failures are auth, ofscraper config, output detection or no files from provider;
   - Instagram: identify whether failures are missing instaloader/gallery-dl auth, rate limit or unsupported URL type;
   - filehost/forum: classify login-page/403 failures separately from downloader bugs.

## ViperGirls Design Sketch

ViperGirls is not a single-video downloader problem. It is a forum thread ingestion problem.

Flow:

1. User submits a ViperGirls thread URL to the hub.
2. Hub creates one parent job: `adapter=forum`, `platform=vipergirls`, `kind=thread-expand`.
3. Expander fetches page 1, detects page count, then queues remaining pages with a cap/confirmation for huge threads.
4. Each post becomes a logical set:
   - title/model name from post text;
   - post id/page number;
   - images as image jobs;
   - videos/filehost links as video/filehost jobs.
5. Gallery imports completed media with platform `vipergirls`, channel/thread name, and set title.
6. Hub UI shows:
   - parent thread progress;
   - pages scanned;
   - sets found;
   - media queued/downloaded/failed;
   - buttons for pause/resume/retry per thread or set.

## Git Scope

Safe to commit now:

- `StartServer.command`
- `screen-recorder-native/src/simple-server.js`
- `screen-recorder-native/src/simple-server.compiled.js`
- `webdl-gallery/server.js`
- `webdl-hub/.env.example`
- this file

Do not commit unless explicitly intended:

- `firefox-debug-controller.xpi`
- `firefox (1).xpi`
