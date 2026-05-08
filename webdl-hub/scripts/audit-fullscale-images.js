#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://jurgen@localhost:5432/webdl';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.avif', '.heic', '.heif']);

function isImagePath(value) {
  const ext = path.extname(String(value || '').split(/[?#]/)[0]).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

function looksThumbnailish(value) {
  const s = String(value || '').trim();
  if (!s || !isImagePath(s)) return false;
  let host = '';
  let pathname = s;
  try {
    const u = new URL(s);
    host = String(u.hostname || '').toLowerCase();
    pathname = String(u.pathname || '');
  } catch (_) {}
  const p = pathname.toLowerCase();
  if (/^(?:thumbs?|thumbnails?)\d*\./i.test(host)) return true;
  if ((host === 'vipr.im' || host.endsWith('.vipr.im')) && /^\/th\//i.test(p)) return true;
  if ((host === 'pixhost.to' || host.endsWith('.pixhost.to')) && /\/thumbs\//i.test(p)) return true;
  if (/\/(?:thumb|thumbs|thumbnail|thumbnails|preview|previews|small|mini|square)\//i.test(p)) return true;
  if (/\.(?:th|thumb|thumbnail|preview|small|md)\.(?:jpe?g|png|gif|webp|bmp|avif|heic|heif)(?:$|[?#])/i.test(s)) return true;
  if (/(?:^|[-_.\/])(?:thumb|thumbnail|preview|small|mini)(?:[-_.\/]|$)/i.test(p)) return true;
  return false;
}

function fullscaleCandidateUrl(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const host = String(u.hostname || '').toLowerCase();
    const p = String(u.pathname || '');
    if ((host === 'vipr.im' || host.endsWith('.vipr.im')) && /^\/th\//i.test(p)) {
      const m = p.match(/^\/th\/([^/]+)\/([^/?#]+\.jpe?g)$/i);
      if (m && m[1] && m[2]) {
        u.pathname = `/i/${m[1]}/${m[2]}/30.jpg`;
        return u.toString();
      }
    }
    if ((host === 'pixhost.to' || host.endsWith('.pixhost.to')) && /\/thumbs\//i.test(p)) {
      u.pathname = p.replace(/\/thumbs\//i, '/images/');
      return u.toString();
    }
    const upgradedPath = p
      .replace(/\.(?:md|th)\.(jpe?g|png|gif|webp|bmp|avif|heic|heif)$/i, '.$1')
      .replace(/(?:^|[-_.])(?:thumb|thumbnail|preview|small|mini)([-_.])([^/]+\.(?:jpe?g|png|gif|webp|bmp|avif|heic|heif))$/i, '$2');
    if (upgradedPath !== p) {
      u.pathname = upgradedPath;
      return u.toString();
    }
    return '';
  } catch (_) {
    return '';
  }
}

function parseMetadata(raw) {
  try {
    if (!raw) return {};
    return typeof raw === 'object' ? raw : JSON.parse(String(raw));
  } catch (_) {
    return {};
  }
}

function quality(row) {
  const metadata = parseMetadata(row.metadata);
  const fileValues = [row.filepath, row.filename].filter(Boolean);
  const sourceValues = [
    row.url,
    row.source_url,
    row.thumbnail,
    metadata.webdl_media_url,
    metadata.webdl_resolved_url,
    metadata.webdl_input_url,
  ].filter(Boolean);
  const fileHits = fileValues.filter(looksThumbnailish);
  const sourceHits = sourceValues.filter(looksThumbnailish);
  const hits = [...fileHits, ...sourceHits];
  const issueType = fileHits.length
    ? 'confirmed_file_thumbnail'
    : sourceHits.length
      ? 'source_url_thumbnail_check_file'
      : metadata.webdl_image_quality === 'thumbnail_rejected' || metadata.webdl_was_thumbnail_url === true
        ? 'metadata_thumbnail_flag'
        : '';
  return {
    suspicious: hits.length > 0,
    hits,
    fileHits,
    sourceHits,
    issueType,
    recordedQuality: metadata.webdl_image_quality || '',
    wasThumbnailUrl: metadata.webdl_was_thumbnail_url === true,
  };
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function tsvCell(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const { rows } = await pool.query(`
      SELECT 'download' AS kind,
             d.id::text AS item_id,
             d.id AS download_id,
             d.platform,
             d.channel,
             d.title,
             d.filepath,
             d.filename,
             d.filesize,
             d.url,
             d.source_url,
             d.thumbnail,
             d.metadata
        FROM public.downloads d
       WHERE d.filepath IS NOT NULL
         AND lower(COALESCE(d.filepath, '')) ~ '\\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|avif|heic|heif)$'
      UNION ALL
      SELECT 'download_file' AS kind,
             'file-' || df.id::text AS item_id,
             df.download_id,
             d.platform,
             d.channel,
             d.title,
             df.relpath AS filepath,
             path_leaf(df.relpath) AS filename,
             df.filesize,
             d.url,
             d.source_url,
             d.thumbnail,
             d.metadata
        FROM public.download_files df
        JOIN public.downloads d ON d.id = df.download_id
       WHERE df.relpath IS NOT NULL
         AND lower(COALESCE(df.relpath, '')) ~ '\\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|avif|heic|heif)$'
    `).catch(async (err) => {
      if (!/path_leaf/i.test(String(err.message || ''))) throw err;
      return pool.query(`
        SELECT 'download' AS kind,
               d.id::text AS item_id,
               d.id AS download_id,
               d.platform,
               d.channel,
               d.title,
               d.filepath,
               d.filename,
               d.filesize,
               d.url,
               d.source_url,
               d.thumbnail,
               d.metadata
          FROM public.downloads d
         WHERE d.filepath IS NOT NULL
           AND lower(COALESCE(d.filepath, '')) ~ '\\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|avif|heic|heif)$'
        UNION ALL
        SELECT 'download_file' AS kind,
               'file-' || df.id::text AS item_id,
               df.download_id,
               d.platform,
               d.channel,
               d.title,
               df.relpath AS filepath,
               split_part(df.relpath, '/', array_length(string_to_array(df.relpath, '/'), 1)) AS filename,
               df.filesize,
               d.url,
               d.source_url,
               d.thumbnail,
               d.metadata
          FROM public.download_files df
          JOIN public.downloads d ON d.id = df.download_id
         WHERE df.relpath IS NOT NULL
           AND lower(COALESCE(df.relpath, '')) ~ '\\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|avif|heic|heif)$'
      `);
    });

    const suspicious = [];
    for (const row of rows) {
      const q = quality(row);
      if (!q.suspicious && q.recordedQuality !== 'thumbnail_rejected' && q.wasThumbnailUrl !== true) continue;
      suspicious.push({
        issue_type: q.issueType,
        kind: row.kind,
        item_id: row.item_id,
        download_id: row.download_id,
        platform: row.platform,
        channel: row.channel,
        title: row.title,
        filepath: row.filepath,
        filesize: row.filesize,
        url: row.url,
        source_url: row.source_url,
        thumbnail_hits: q.hits,
        file_hits: q.fileHits,
        source_hits: q.sourceHits,
        fullscale_candidate_url: q.hits.map(fullscaleCandidateUrl).find(Boolean) || '',
        recorded_quality: q.recordedQuality,
        was_thumbnail_url: q.wasThumbnailUrl,
      });
    }

    const reportDir = path.resolve(__dirname, '..', '..', 'reports');
    fs.mkdirSync(reportDir, { recursive: true });
    const stamp = todayStamp();
    const jsonPath = path.join(reportDir, `fullscale-image-audit-${stamp}.json`);
    const tsvPath = path.join(reportDir, `fullscale-image-audit-${stamp}.tsv`);
    fs.writeFileSync(jsonPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      total_images_checked: rows.length,
      suspicious_count: suspicious.length,
      issue_counts: suspicious.reduce((acc, row) => {
        const key = row.issue_type || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      suspicious,
    }, null, 2));
    fs.writeFileSync(tsvPath, [
      ['issue_type', 'kind', 'item_id', 'download_id', 'platform', 'channel', 'title', 'filesize', 'filepath', 'fullscale_candidate_url', 'thumbnail_hits'].join('\t'),
      ...suspicious.map((r) => [
        r.issue_type,
        r.kind,
        r.item_id,
        r.download_id,
        r.platform,
        r.channel,
        r.title,
        r.filesize,
        r.filepath,
        r.fullscale_candidate_url,
        r.thumbnail_hits.join(' | '),
      ].map(tsvCell).join('\t')),
    ].join('\n'));

    console.log(JSON.stringify({
      total_images_checked: rows.length,
      suspicious_count: suspicious.length,
      json: jsonPath,
      tsv: tsvPath,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
