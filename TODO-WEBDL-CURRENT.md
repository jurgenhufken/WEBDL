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

## In Progress / Watch

- FootFetishForum page-60 recovery batch is running via attachment-page URLs only.
- Keep checking that completed FootFetishForum items are fullscale files, not direct CDN preview images.

## Still To Verify

- Confirm in Firefox that the freshly rebuilt toolbar preview no longer selects `img_under_link` CDN previews when matching attachment links exist.
- Confirm gallery channel counts remain aligned after the current recovery batch finishes.
