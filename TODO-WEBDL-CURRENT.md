# WEBDL Current TODO

Last updated: 2026-05-08

## Done

- Stop FootFetishForum page-60 jobs that were writing direct CDN preview images to the gallery.
- Requeue the same FootFetishForum batch through `footfetishforum.com/attachments/...` pages so the existing fullscale resolver is used.
- Add toolbar filtering so FootFetishForum direct images under attachment links are not selected when the attachment page is available.
- Add server-side FootFetishForum guard that rejects small direct CDN attachment images as preview/thumb candidates.
- Remove page-60 preview/thumb rows from the gallery and delete the small preview files that were already written.
- Add selectable channel sorting in the gallery: count, name, recent, rating.
- Make channel counts use the same item sources as the gallery grid, including `download_files`.
- Add YouTube channel metadata from yt-dlp expansion and sync it into gallery metadata.
- Rebuild `firefox-debug-controller.xpi`.
- Fix viewer next-click pagination so it keeps requesting the next page and serializes rapid next/previous clicks.
- Remove the hidden hard caps from whole-thread scans; normal thread crawls now follow next pages until the thread ends.
- Pin thread-gallery, external-image-host, and Keep2Share downloads back to their original thread context for `source_url`, platform/channel/title, and `origin_thread` metadata.
- Keep FootFetishForum fullscale validation based on URL/source quality, not filesize alone; small original uploads are allowed.
- Requeue the 9 FootFetishForum attachment-page items that were incorrectly rejected by the temporary size-only retro-check.
- Add Keep2Share premium resolve support through `WEBDL_KEEP2SHARE_AUTH_TOKEN`, `K2S_AUTH_TOKEN`, `WEBDL_KEEP2SHARE_USERNAME`/`WEBDL_KEEP2SHARE_PASSWORD`, plus cookie env fallback.
- Disable native-server automatic `kill -9` on port conflict; server restarts must not close or disturb Firefox.
- Make the gallery viewer top overlay auto-hide with the rest of the HUD.

## In Progress / Watch

- FootFetishForum page-60 recovery batch is running via attachment-page URLs only.
- Keep checking that completed FootFetishForum items are fullscale files, not direct CDN preview images.

## Still To Verify

- Confirm in Firefox that the freshly rebuilt toolbar preview no longer selects `img_under_link` CDN previews when matching attachment links exist.
- Confirm gallery channel counts remain aligned after the current recovery batch finishes.
- Confirm viewer right-arrow/next button can continue past the currently loaded page without wrapping unless query-loop is explicitly enabled.
- Confirm in Firefox that "Hele thread" no longer stops at the old 60 pages / 5000 items limits.
- Confirm new thread-gallery downloads appear under the originating thread, not under the intermediate gallery/filehost page.
- Add real Keep2Share credentials to `screen-recorder-native/.env` and retry failed K2S rows; no local `K2S_*`/`WEBDL_KEEP2SHARE_*` keys are currently configured.
