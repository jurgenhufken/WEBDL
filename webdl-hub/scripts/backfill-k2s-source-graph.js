#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');

const DATABASE_URL = process.env.WEBDL_DATABASE_URL || process.env.DATABASE_URL || 'postgres://localhost/webdl';
const DRY_RUN = process.argv.includes('--dry-run');

function keep2ShareFileId(url) {
  try {
    const u = new URL(String(url || ''));
    const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
    if (!(host === 'keep2share.cc' || host === 'k2s.cc' || host === 'k2s.io' || host.endsWith('.keep2share.cc') || host.endsWith('.k2s.cc') || host.endsWith('.k2s.io'))) return '';
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

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return {};
  }
}

function normalizeSourceSite(ctx) {
  const platform = String(ctx && ctx.platform || '').trim().toLowerCase();
  if (platform) return platform;
  return hostnameFromUrl(ctx && ctx.url);
}

function sourceContextFromJob(job) {
  const opts = parseJson(job.options);
  const contexts = opts.webdl_source_contexts && typeof opts.webdl_source_contexts === 'object' ? opts.webdl_source_contexts : {};
  const jobFileId = keep2ShareFileId(job.url);
  let ctx = contexts[job.url] || opts.sourceContext || null;
  if (!ctx && jobFileId) {
    for (const [candidateUrl, candidateCtx] of Object.entries(contexts)) {
      if (keep2ShareFileId(candidateUrl) === jobFileId) {
        ctx = candidateCtx;
        break;
      }
    }
  }
  if (!ctx && opts.contextUrl) {
    ctx = {
      url: opts.contextUrl,
      platform: opts.platform || 'vipergirls',
      channel: opts.channel || '',
      title: opts.title || '',
    };
  }
  if (!ctx || typeof ctx !== 'object' || !ctx.url) return null;
  const channel = String(ctx.channel || opts.channel || '').trim();
  const threadMatch = channel.match(/^thread_(\d+)/i) || String(ctx.url || '').match(/\/threads\/(\d+)-/i);
  return {
    url: String(ctx.url),
    platform: String(ctx.platform || opts.platform || 'vipergirls').trim().toLowerCase(),
    channel: channel || (threadMatch && threadMatch[1] ? `thread_${threadMatch[1]}` : ''),
    title: String(ctx.title || opts.title || '').trim(),
    thread_id: String(ctx.thread_id || (threadMatch && threadMatch[1]) || '').trim(),
  };
}

function sourceContextFromSourceUrl(sourceUrl) {
  try {
    const u = new URL(String(sourceUrl || ''));
    const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
    if (!(host === 'vipergirls.to' || host === 'viper.to' || host.endsWith('.vipergirls.to') || host.endsWith('.viper.to'))) return null;
    const m = String(u.pathname || '').match(/^\/threads\/(\d+)-([^\/?#]+)/i);
    if (!m || !m[1]) return null;
    return {
      url: u.toString(),
      platform: 'vipergirls',
      channel: `thread_${m[1]}`,
      title: String(m[2] || '').replace(/[-_]+/g, ' ').trim(),
      thread_id: String(m[1]),
    };
  } catch (_) {
    return null;
  }
}

function buildSourceGraph({ mediaUrl, platform, sourceContext }) {
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

  const fileId = keep2ShareFileId(mediaUrl);
  const mediaNode = fileId ? `file:keep2share:${fileId}` : `url:${mediaUrl}`;
  addNode(fileId
    ? { id: mediaNode, type: 'file', platform: 'keep2share', file_id: fileId, url: mediaUrl }
    : { id: mediaNode, type: 'url', platform, url: mediaUrl });

  const hostNode = `host:${platform}`;
  addNode({ id: hostNode, type: 'host', platform });
  addEdge(mediaNode, hostNode, 'hosted_on');

  const siteNode = sourceSite ? `site:${sourceSite}` : '';
  if (siteNode) addNode({ id: siteNode, type: 'site', platform: sourceSite, url: sourceContext.url });

  const threadId = sourceContext.thread_id || (String(sourceContext.channel || '').match(/^thread_(\d+)/i) || [])[1];
  const threadNode = sourceSite && threadId ? `thread:${sourceSite}:${threadId}` : '';
  if (threadNode) {
    addNode({
      id: threadNode,
      type: 'thread',
      platform: sourceSite,
      thread_id: String(threadId),
      channel: sourceContext.channel || `thread_${threadId}`,
      title: sourceContext.title || null,
      url: sourceContext.url,
    });
    addEdge(threadNode, siteNode, 'belongs_to');
    addEdge(mediaNode, threadNode, 'found_on');
  } else if (siteNode) {
    addEdge(mediaNode, siteNode, 'found_on');
  }

  return { version: 1, nodes, edges };
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  let scanned = 0;
  let updated = 0;
  try {
    const { rows: downloads } = await pool.query(`
      SELECT d.id, d.url, d.source_url, d.platform, d.channel, d.title, d.metadata,
             COALESCE(
               substring(lower(COALESCE(d.source_url, '')) from '(?:keep2share\\.cc|k2s\\.cc|k2s\\.io)/file/([^/?#]+)'),
               substring(lower(COALESCE(d.url, '')) from '(?:keep2share\\.cc|k2s\\.cc|k2s\\.io)/file/([^/?#]+)')
             ) AS k2s_file_id
        FROM public.downloads d
       WHERE d.platform = 'keep2share'
    `);
    const downloadsById = new Map();
    const downloadsByFileId = new Map();
    for (const d of downloads) {
      downloadsById.set(String(d.id), d);
      const fileId = String(d.k2s_file_id || '').trim().toLowerCase();
      if (!fileId) continue;
      if (!downloadsByFileId.has(fileId)) downloadsByFileId.set(fileId, []);
      downloadsByFileId.get(fileId).push(d);
    }

    const { rows: jobs } = await pool.query(`
      SELECT id, url, options
        FROM webdl.jobs
       WHERE adapter = 'slave-delegate'
         AND (options->>'platform' = 'vipergirls' OR options ? 'webdl_source_contexts' OR options ? 'contextUrl')
         AND url ~* '(keep2share\\.cc|k2s\\.cc|k2s\\.io)/file/'
       ORDER BY id DESC
    `);

    for (const job of jobs) {
      scanned += 1;
      const ctx = sourceContextFromJob(job);
      const jobFileId = keep2ShareFileId(job.url);
      if (!ctx || !jobFileId) continue;
      const opts = parseJson(job.options);
      const bySimpleId = String(opts.simple_server_download_id || '').trim();
      const matched = new Map();
      if (bySimpleId && downloadsById.has(bySimpleId)) matched.set(bySimpleId, downloadsById.get(bySimpleId));
      for (const d of downloadsByFileId.get(jobFileId) || []) matched.set(String(d.id), d);
      for (const d of matched.values()) {
        const meta = parseJson(d.metadata);
        const sourceSite = normalizeSourceSite(ctx);
        const mediaUrl = keep2ShareFileId(d.source_url) ? d.source_url : job.url;
        const nextMeta = {
          ...meta,
          origin_thread: ctx,
          source_context: ctx,
          source_site: sourceSite,
          source_sites: Array.from(new Set([sourceSite, ...(Array.isArray(meta.source_sites) ? meta.source_sites : [])].filter(Boolean))),
          source_graph: buildSourceGraph({ mediaUrl, platform: 'keep2share', sourceContext: ctx }),
          webdl_media_url: mediaUrl,
          webdl_detected_platform: 'keep2share',
          original_platform: ctx.platform,
          original_channel: ctx.channel,
          original_title: ctx.title,
          original_url: ctx.url,
        };
        const nextChannel = d.channel && d.channel !== 'unknown' ? d.channel : (ctx.channel || d.channel);
        if (!DRY_RUN) {
          await pool.query(
            `UPDATE public.downloads
                SET metadata = $1::jsonb,
                    source_url = $2,
                    channel = COALESCE(NULLIF($3, ''), channel),
                    updated_at = now()
              WHERE id = $4`,
            [JSON.stringify(nextMeta), ctx.url, nextChannel || '', d.id],
          );
        }
        updated += 1;
      }
    }

    const { rows: sourcedDownloads } = await pool.query(`
      SELECT d.id, d.url, d.source_url, d.platform, d.channel, d.title, d.metadata
        FROM public.downloads d
       WHERE d.platform = 'keep2share'
         AND d.source_url ~* 'https?://([^/]+\\.)?(vipergirls\\.to|viper\\.to)/threads/[0-9]+-'
    `);
    for (const d of sourcedDownloads) {
      const ctx = sourceContextFromSourceUrl(d.source_url);
      if (!ctx) continue;
      const meta = parseJson(d.metadata);
      if (meta.source_site && meta.source_graph && d.channel && d.channel !== 'unknown') continue;
      const mediaUrl = keep2ShareFileId(meta.webdl_media_url) ? meta.webdl_media_url : (keep2ShareFileId(d.url) ? d.url : d.source_url);
      const nextMeta = {
        ...meta,
        origin_thread: meta.origin_thread || ctx,
        source_context: meta.source_context || ctx,
        source_site: normalizeSourceSite(ctx),
        source_sites: Array.from(new Set([normalizeSourceSite(ctx), ...(Array.isArray(meta.source_sites) ? meta.source_sites : [])].filter(Boolean))),
        source_graph: meta.source_graph || buildSourceGraph({ mediaUrl, platform: 'keep2share', sourceContext: ctx }),
        webdl_media_url: meta.webdl_media_url || mediaUrl,
        webdl_detected_platform: meta.webdl_detected_platform || 'keep2share',
        original_platform: meta.original_platform || ctx.platform,
        original_channel: meta.original_channel || ctx.channel,
        original_title: meta.original_title || ctx.title,
        original_url: meta.original_url || ctx.url,
      };
      const nextChannel = d.channel && d.channel !== 'unknown' ? d.channel : ctx.channel;
      if (!DRY_RUN) {
        await pool.query(
          `UPDATE public.downloads
              SET metadata = $1::jsonb,
                  channel = COALESCE(NULLIF($2, ''), channel),
                  updated_at = now()
            WHERE id = $3`,
          [JSON.stringify(nextMeta), nextChannel || '', d.id],
        );
      }
      updated += 1;
    }
    console.log(JSON.stringify({ dryRun: DRY_RUN, scannedJobs: scanned, updatedDownloads: updated }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
