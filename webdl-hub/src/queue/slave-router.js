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
  { match: /(?:forum\.)?phun\.org/i,      platform: 'phun' },
  { match: /wikifeet\.com/i,              platform: 'wikifeet' },
  { match: /aznudefeet\.com/i,            platform: 'aznudefeet' },
  { match: /amateurvoyeurforum\.com/i,    platform: 'amateurvoyeurforum' },
  { match: /(?:keep2share\.cc|k2s\.cc)/i, platform: 'keep2share' },
  { match: /pornpics\.com/i,              platform: 'pornpics' },
  { match: /forum-area\.com/i,            platform: 'forum-area' },
  { match: /imagetwist\.com/i,            platform: 'imagetwist' },
  { match: /imagebam\.com/i,              platform: 'imagebam' },
  { match: /imgbox\.com/i,                platform: 'imgbox' },
  { match: /imagevenue\.com/i,            platform: 'imagevenue' },
  { match: /imgchest\.com/i,              platform: 'imgchest' },
  { match: /imgvb\.com/i,                 platform: 'imgvb' },
  { match: /imx\.to/i,                    platform: 'imx' },
  { match: /vipr\.im/i,                   platform: 'vipr' },
  { match: /turboimagehost\.com/i,        platform: 'turboimagehost' },
  { match: /img\.kiwi/i,                  platform: 'imgkiwi' },
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

function hostnameFromUrl(raw) {
  try {
    return new URL(String(raw || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function canonicalPlatformAlias(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^www\./, '');
  if (!raw) return '';
  if (raw === 'k2s' || raw === 'k2scc' || raw === '_keep2share') return 'keep2share';
  if (raw === 'keep2share.cc' || raw === 'k2s.cc' || raw === 'k2s.io') return 'keep2share';
  if (raw.endsWith('.keep2share.cc') || raw.endsWith('.k2s.cc') || raw.endsWith('.k2s.io')) return 'keep2share';
  return raw;
}

function normalizeSourceSite(sourceContext) {
  if (!sourceContext || typeof sourceContext !== 'object') return '';
  const platform = canonicalPlatformAlias(sourceContext.platform);
  if (platform) return platform;
  return canonicalPlatformAlias(hostnameFromUrl(sourceContext.url));
}

function buildSourceGraph({ mediaUrl, storagePlatform, sourceContext }) {
  const sourceSite = normalizeSourceSite(sourceContext);
  const nodes = [];
  const edges = [];
  const addNode = (node) => {
    if (!node || !node.id || nodes.some((n) => n.id === node.id)) return;
    nodes.push(node);
  };
  const addEdge = (from, to, type) => {
    if (!from || !to || !type) return;
    if (edges.some((e) => e.from === from && e.to === to && e.type === type)) return;
    edges.push({ from, to, type });
  };

  let mediaNode = '';
  const fileId = keep2ShareFileId(mediaUrl);
  if (fileId) {
    mediaNode = `file:keep2share:${fileId}`;
    addNode({ id: mediaNode, type: 'file', platform: 'keep2share', file_id: fileId, url: mediaUrl });
  } else if (mediaUrl) {
    mediaNode = `url:${mediaUrl}`;
    addNode({ id: mediaNode, type: 'url', platform: storagePlatform || '', url: mediaUrl });
  }

  const hostNode = storagePlatform ? `host:${storagePlatform}` : '';
  if (hostNode) {
    addNode({ id: hostNode, type: 'host', platform: storagePlatform });
    if (mediaNode) addEdge(mediaNode, hostNode, 'hosted_on');
  }

  const siteNode = sourceSite ? `site:${sourceSite}` : '';
  if (siteNode) addNode({ id: siteNode, type: 'site', platform: sourceSite, url: sourceContext && sourceContext.url || null });

  const threadMatch = String(sourceContext && sourceContext.channel || '').match(/^thread_(\d+)/i);
  const threadId = sourceContext && (sourceContext.thread_id || (threadMatch && threadMatch[1]));
  const threadNode = sourceSite && threadId ? `thread:${sourceSite}:${threadId}` : '';
  if (threadNode) {
    addNode({
      id: threadNode,
      type: 'thread',
      platform: sourceSite,
      thread_id: String(threadId),
      channel: sourceContext.channel || `thread_${threadId}`,
      title: sourceContext.title || null,
      url: sourceContext.url || null,
    });
    if (siteNode) addEdge(threadNode, siteNode, 'belongs_to');
    if (mediaNode) addEdge(mediaNode, threadNode, 'found_on');
  } else if (siteNode && mediaNode) {
    addEdge(mediaNode, siteNode, 'found_on');
  }

  return { version: 1, nodes, edges };
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

  const sourceContext = metadata && typeof metadata === 'object'
    ? (metadata.origin_thread && typeof metadata.origin_thread === 'object'
      ? metadata.origin_thread
      : metadata.source_context && typeof metadata.source_context === 'object'
        ? metadata.source_context
        : null)
    : null;
  const originalPlatform = canonicalPlatformAlias(metadata.original_platform || metadata.source_site || metadata.original_site || '');
  const originalChannel = String(metadata.original_channel || '').trim();
  const originalTitle = String(metadata.original_title || '').trim();
  const sourceUrl = sourceContext && sourceContext.url ? String(sourceContext.url) : url;
  const sourceSite = sourceContext && sourceContext.url ? normalizeSourceSite(sourceContext) : '';
  const storagePlatform = canonicalPlatformAlias(sourceSite || originalPlatform || platform);
  const storageChannel = sourceContext && sourceContext.channel ? String(sourceContext.channel) : originalChannel || 'unknown';
  const storageTitle = sourceContext && sourceContext.title ? String(sourceContext.title) : originalTitle || 'untitled';
  const storedSourceContext = sourceContext && typeof sourceContext === 'object'
    ? { ...sourceContext, platform: sourceSite || canonicalPlatformAlias(sourceContext.platform) || storagePlatform }
    : null;
  const storedMetadata = {
    ...metadata,
    origin: 'webdl-hub',
  };
  if (storedSourceContext && storedSourceContext.url) {
    storedMetadata.webdl_pin_context = true;
    storedMetadata.origin_thread = storedSourceContext;
    storedMetadata.source_context = storedSourceContext;
    storedMetadata.source_site = sourceSite || '';
    storedMetadata.source_sites = Array.from(new Set([sourceSite, ...(Array.isArray(metadata.source_sites) ? metadata.source_sites.map(canonicalPlatformAlias) : [])].filter(Boolean)));
    storedMetadata.source_graph = buildSourceGraph({ mediaUrl: url, storagePlatform, sourceContext: storedSourceContext });
    storedMetadata.webdl_media_url = url;
    storedMetadata.webdl_detected_platform = platform;
  } else if (originalPlatform && originalPlatform !== platform) {
    storedMetadata.webdl_pin_context = true;
    storedMetadata.source_site = originalPlatform;
    storedMetadata.source_sites = Array.from(new Set([originalPlatform, ...(Array.isArray(metadata.source_sites) ? metadata.source_sites.map(canonicalPlatformAlias) : [])].filter(Boolean)));
    storedMetadata.webdl_media_url = url;
    storedMetadata.webdl_detected_platform = platform;
  }

  const { rows } = await pool.query(
    `INSERT INTO downloads (url, platform, channel, title, status, metadata, source_url, priority, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, now(), now())
     RETURNING id`,
    [url, storagePlatform, storageChannel, storageTitle, JSON.stringify(storedMetadata), sourceUrl, Math.max(Number(priority) || 0, 10)],
  );
  return { downloadId: rows[0].id, duplicate: false };
}

module.exports = { SLAVE_PLATFORMS, isSlaveUrl, delegateToSlave };
