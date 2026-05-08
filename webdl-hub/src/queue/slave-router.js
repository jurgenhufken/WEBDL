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
  { match: /flc\.nyc3\.digitaloceanspaces\.com\/data\/(?:attachments|video)\//i, platform: 'footfetishforum' },
  { match: /wikifeet\.com/i,              platform: 'wikifeet' },
  { match: /aznudefeet\.com/i,            platform: 'aznudefeet' },
  { match: /amateurvoyeurforum\.com/i,    platform: 'amateurvoyeurforum' },
  { match: /(?:keep2share\.cc|k2s\.cc)/i, platform: 'keep2share' },
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

function keep2ShareFileId(url) {
  try {
    const u = new URL(String(url || ''));
    const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
    if (!(host === 'keep2share.cc' || host === 'k2s.cc' || host === 'k2s.io' || host.endsWith('.keep2share.cc') || host.endsWith('.k2s.cc') || host.endsWith('.k2s.io'))) {
      return '';
    }
    const m = String(u.pathname || '').match(/^\/file\/([^\/?#]+)/i);
    return m && m[1] ? decodeURIComponent(m[1]).trim().toLowerCase() : '';
  } catch (_) {
    return '';
  }
}

/**
 * Delegeer naar simple-server door een rij in public.downloads aan te maken.
 * Returns { downloadId } on success.
 */
async function delegateToSlave(pool, { url, platform, metadata = {}, priority = 0 }) {
  // Dedup: als URL al in downloads staat, geen nieuwe rij maken.
  const k2sId = keep2ShareFileId(url);
  const params = [url];
  let extraWhere = '';
  if (k2sId) {
    params.push(k2sId);
    extraWhere = `OR substring(lower(source_url) from '(?:keep2share\\.cc|k2s\\.cc|k2s\\.io)/file/([^/?#]+)') = $2
                  OR substring(lower(url) from '(?:keep2share\\.cc|k2s\\.cc|k2s\\.io)/file/([^/?#]+)') = $2`;
  }
  const dup = await pool.query(
    `SELECT id, status FROM downloads
       WHERE (source_url = $1 OR url = $1 ${extraWhere})
         AND status IN ('pending','queued','downloading','postprocessing','completed')
       ORDER BY CASE status WHEN 'completed' THEN 0 ELSE 1 END, id DESC
       LIMIT 1`,
    params,
  );
  if (dup.rows.length > 0) {
    return { downloadId: dup.rows[0].id, duplicate: true, existingStatus: dup.rows[0].status };
  }

  const { rows } = await pool.query(
    `INSERT INTO downloads (url, platform, status, metadata, source_url, priority, created_at, updated_at)
     VALUES ($1, $2, 'pending', $3, $1, $4, now(), now())
     RETURNING id`,
    [url, platform, JSON.stringify({ ...metadata, origin: 'webdl-hub' }), Math.max(Number(priority) || 0, 10)],
  );
  return { downloadId: rows[0].id, duplicate: false };
}

module.exports = { SLAVE_PLATFORMS, isSlaveUrl, delegateToSlave };
