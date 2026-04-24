// src/queue/slave-router.js
// Master/slave router: bepaalt of een URL door de hub zelf wordt gedaan of
// gedelegeerd naar simple-server (shared via public.downloads tabel).
'use strict';

// Platforms waar simple-server gespecialiseerd in is. Voor deze URL-hosts
// voert de hub GEEN eigen download uit, maar inserteert een rij in
// public.downloads met status='pending' — simple-server's auto-rehydrate
// pikt deze op via de normale scheduler.
const SLAVE_PLATFORMS = [
  { match: /footfetishforum\.com/i,       platform: 'footfetishforum' },
  { match: /wikifeet\.com/i,              platform: 'wikifeet' },
  { match: /aznudefeet\.com/i,            platform: 'aznudefeet' },
  { match: /amateurvoyeurforum\.com/i,    platform: 'amateurvoyeurforum' },
  { match: /pornpics\.com/i,              platform: 'pornpics' },
  { match: /forum-area\.com/i,            platform: 'forum-area' },
  { match: /imagetwist\.com/i,            platform: 'imagetwist' },
  { match: /pixhost\.to/i,                platform: 'pixhost' },
  { match: /postimg\.cc/i,                platform: 'postimg' },
  { match: /bunkr\./i,                    platform: 'bunkr' },
  { match: /jpg\.(church|fish|pet|fishing)/i, platform: 'jpg' },
];

function isSlaveUrl(url) {
  if (!url) return null;
  for (const s of SLAVE_PLATFORMS) {
    if (s.match.test(url)) return s;
  }
  return null;
}

/**
 * Delegeer naar simple-server door een rij in public.downloads aan te maken.
 * Returns { downloadId } on success.
 */
async function delegateToSlave(pool, { url, platform, metadata = {} }) {
  // Dedup: als URL al in downloads staat, geen nieuwe rij maken.
  const dup = await pool.query(
    `SELECT id, status FROM downloads
       WHERE (source_url = $1 OR url = $1)
         AND status IN ('pending','queued','downloading','postprocessing','completed')
       ORDER BY CASE status WHEN 'completed' THEN 0 ELSE 1 END, id DESC
       LIMIT 1`,
    [url],
  );
  if (dup.rows.length > 0) {
    return { downloadId: dup.rows[0].id, duplicate: true, existingStatus: dup.rows[0].status };
  }

  const { rows } = await pool.query(
    `INSERT INTO downloads (url, platform, status, metadata, source_url, created_at, updated_at)
     VALUES ($1, $2, 'pending', $3, $1, now(), now())
     RETURNING id`,
    [url, platform, JSON.stringify({ ...metadata, origin: 'webdl-hub' })],
  );
  return { downloadId: rows[0].id, duplicate: false };
}

module.exports = { SLAVE_PLATFORMS, isSlaveUrl, delegateToSlave };
