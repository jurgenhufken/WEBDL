#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Pool } = require('pg');
const {
  deriveFullscalePath,
  isImagePath,
  looksThumbnailish,
} = require('../src/util/image-quality');

const execFileAsync = promisify(execFile);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://jurgen@localhost:5432/webdl';
const DEFAULT_AUDIT = path.resolve(__dirname, '..', '..', 'reports', 'fullscale-image-audit-2026-05-08.json');
const STORAGE_ROOTS = [
  process.env.WEBDL_BASE_DIR,
  process.env.DOWNLOAD_ROOT,
  '/Users/jurgen/Downloads/WEBDL',
  '/Volumes/WEBDL Extra/WEBDL',
  '/Volumes/HDD - One Touch/WEBDL',
].filter(Boolean);

function argValue(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function numberArg(name, fallback) {
  const value = Number(argValue(name, ''));
  return Number.isFinite(value) ? value : fallback;
}

function parseMetadata(raw) {
  try {
    if (!raw) return {};
    return typeof raw === 'object' ? raw : JSON.parse(String(raw));
  } catch (_) {
    return {};
  }
}

function resolveMediaPathInfo(filePath) {
  const fp = String(filePath || '').trim();
  if (!fp) return { abs: '', root: '' };
  if (path.isAbsolute(fp)) {
    const root = STORAGE_ROOTS.find((candidate) => {
      try {
        const rel = path.relative(path.resolve(candidate), path.resolve(fp));
        return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
      } catch (_) {
        return false;
      }
    }) || '';
    return { abs: fp, root };
  }
  for (const root of STORAGE_ROOTS) {
    const abs = path.join(root, fp);
    if (fs.existsSync(abs)) return { abs, root };
  }
  const root = STORAGE_ROOTS[0] || process.cwd();
  return { abs: path.join(root, fp), root };
}

function resolveMediaPath(filePath) {
  return resolveMediaPathInfo(filePath).abs;
}

function relpathForDatabase(originalFilepath, resolvedInfo, newPath) {
  const original = String(originalFilepath || '').trim();
  if (path.isAbsolute(original)) return newPath;
  const root = resolvedInfo && resolvedInfo.root ? resolvedInfo.root : '';
  if (root) return path.relative(root, newPath);
  return path.relative(STORAGE_ROOTS[0] || path.dirname(newPath), newPath);
}

async function imageDimensions(filePath) {
  try {
    const { stdout } = await execFileAsync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], { timeout: 5000 });
    const width = Number(String(stdout).match(/pixelWidth:\s*(\d+)/)?.[1] || 0);
    const height = Number(String(stdout).match(/pixelHeight:\s*(\d+)/)?.[1] || 0);
    return { width, height };
  } catch (_) {
    return { width: 0, height: 0 };
  }
}

function imageMagicOk(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return true;
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a') return true;
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return true;
  if (buffer.slice(4, 12).toString('ascii') === 'ftypavif') return true;
  return false;
}

async function downloadCandidate(url, dest, referer = '', timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      ...(referer ? { Referer: referer } : {}),
    };
    const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!type.startsWith('image/') && !imageMagicOk(bytes)) throw new Error(`geen image response (${type || 'unknown'})`);
    if (!imageMagicOk(bytes)) throw new Error('image magic ongeldig');
    await fsp.writeFile(dest, bytes);
    return { size: bytes.length, contentType: type, finalUrl: String(res.url || url) };
  } finally {
    clearTimeout(timer);
  }
}

function isImprovement(oldStat, oldDims, newStat, newDims) {
  const oldPixels = Number(oldDims.width || 0) * Number(oldDims.height || 0);
  const newPixels = Number(newDims.width || 0) * Number(newDims.height || 0);
  if (oldPixels && newPixels && newPixels > oldPixels) return true;
  if (newStat.size > oldStat.size * 1.10) return true;
  return false;
}

async function updateDatabase(pool, item, oldPath, newPath, info, oldStat, oldDims, newDims) {
  const metadataPatch = {
    webdl_image_quality: 'fullscale_repaired',
    webdl_fullscale_repaired_at: new Date().toISOString(),
    webdl_previous_thumbnail_path: oldPath,
    webdl_previous_thumbnail_url: item.thumbnail_hits && item.thumbnail_hits.find((v) => /^https?:/i.test(v)) || '',
    webdl_fullscale_candidate_url: item.fullscale_candidate_url,
    webdl_repair_previous_size: oldStat.size,
    webdl_repair_new_size: info.size,
    webdl_repair_previous_dimensions: oldDims,
    webdl_repair_new_dimensions: newDims,
  };
  if (item.kind === 'download_file') {
    const id = Number(String(item.item_id || '').replace(/^file-/, ''));
    const resolvedInfo = resolveMediaPathInfo(item.filepath);
    await pool.query(
      `UPDATE public.download_files
          SET relpath=$1, filesize=$2, mtime_ms=$3, is_thumb_ready=false, updated_at=now()
        WHERE id=$4`,
      [relpathForDatabase(item.filepath, resolvedInfo, newPath), info.size, Date.now(), id],
    );
    await pool.query(
      `UPDATE public.downloads
          SET metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $1::jsonb,
              updated_at=now()
        WHERE id=$2`,
      [JSON.stringify(metadataPatch), Number(item.download_id)],
    );
  } else {
    await pool.query(
      `UPDATE public.downloads
          SET filepath=$1, filename=$2, filesize=$3, url=$4, format=$5,
              metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $6::jsonb,
              is_thumb_ready=false, updated_at=now()
        WHERE id=$7`,
      [newPath, path.basename(newPath), info.size, info.finalUrl || item.fullscale_candidate_url, path.extname(newPath).replace(/^\./, '').toLowerCase(), JSON.stringify(metadataPatch), Number(item.download_id || item.item_id)],
    );
  }
}

async function repairOne(pool, item, opts) {
  const currentPath = resolveMediaPath(item.filepath);
  if (!item.fullscale_candidate_url) return { status: 'skipped', reason: 'geen fullscale_candidate_url', item };
  if (!fs.existsSync(currentPath)) return { status: 'skipped', reason: 'bestand ontbreekt', item };
  if (!isImagePath(currentPath)) return { status: 'skipped', reason: 'geen image pad', item };

  const oldStat = await fsp.stat(currentPath);
  const oldDims = await imageDimensions(currentPath);
  const targetPath = deriveFullscalePath(currentPath, item.fullscale_candidate_url);
  const finalPath = looksThumbnailish(targetPath) ? currentPath : targetPath;
  const tmpPath = `${finalPath}.webdl-fullscale-${process.pid}.tmp`;

  if (opts.dryRun) {
    return { status: 'dry_run', item, currentPath, finalPath, oldSize: oldStat.size, oldDims };
  }

  await fsp.mkdir(path.dirname(finalPath), { recursive: true });
  const info = await downloadCandidate(item.fullscale_candidate_url, tmpPath, item.source_url || item.url || '', opts.timeoutMs);
  const newStat = await fsp.stat(tmpPath);
  const newDims = await imageDimensions(tmpPath);
  if (!isImprovement(oldStat, oldDims, newStat, newDims)) {
    await fsp.rm(tmpPath, { force: true });
    return { status: 'skipped', reason: 'kandidaat is niet groter/beter', item, oldSize: oldStat.size, newSize: newStat.size, oldDims, newDims };
  }

  await fsp.rename(tmpPath, finalPath);
  if (finalPath !== currentPath) await fsp.rm(currentPath, { force: true }).catch(() => {});
  await updateDatabase(pool, item, currentPath, finalPath, info, oldStat, oldDims, newDims);
  return { status: 'repaired', item, oldPath: currentPath, newPath: finalPath, oldSize: oldStat.size, newSize: info.size, oldDims, newDims };
}

async function main() {
  const auditPath = path.resolve(argValue('--audit', DEFAULT_AUDIT));
  const includeSourceCheck = hasArg('--include-source-check');
  const opts = {
    dryRun: !hasArg('--apply'),
    limit: numberArg('--limit', 0),
    offset: numberArg('--offset', 0),
    timeoutMs: numberArg('--timeout-ms', 30000),
  };
  const report = JSON.parse(await fsp.readFile(auditPath, 'utf8'));
  let items = (report.suspicious || []).filter((item) =>
    item.fullscale_candidate_url &&
    (item.issue_type === 'confirmed_file_thumbnail' || includeSourceCheck && item.issue_type === 'source_url_thumbnail_check_file')
  );
  if (opts.offset > 0) items = items.slice(opts.offset);
  if (opts.limit > 0) items = items.slice(0, opts.limit);

  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  const results = [];
  try {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        const result = await repairOne(pool, item, opts);
        results.push(result);
      } catch (e) {
        results.push({ status: 'error', reason: String(e.message || e), item });
      }
      if ((i + 1) % 25 === 0) console.error(`[repair] ${i + 1}/${items.length}`);
    }
  } finally {
    await pool.end();
  }

  const outDir = path.resolve(__dirname, '..', '..', 'reports');
  await fsp.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `fullscale-image-repair-${stamp}.json`);
  const summary = results.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, { total: results.length, dry_run: 0, repaired: 0, skipped: 0, error: 0 });
  await fsp.writeFile(outPath, JSON.stringify({ generated_at: new Date().toISOString(), dry_run: opts.dryRun, summary, results }, null, 2));
  console.log(JSON.stringify({ ...summary, report: outPath }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  resolveMediaPath,
  resolveMediaPathInfo,
  relpathForDatabase,
  imageMagicOk,
  isImprovement,
};
