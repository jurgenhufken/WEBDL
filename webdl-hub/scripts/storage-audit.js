#!/usr/bin/env node
'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const DEFAULT_ROOTS = [
  '/Volumes/HDD - One Touch/WEBDL',
  '/Volumes/WEBDL Extra/WEBDL',
];
const MEDIA_EXTS = new Set([
  '.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.flv', '.ts', '.wmv',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif',
]);
const BALLAST_EXTS = new Set(['.rar', '.par2', '.nzb', '.sfv', '.tmp']);
const BALLAST_SEGMENT_RE = /^(?:__ADMIN__|_UNPACK_|_FAILED_|admin)$/i;

function parseArgs(argv) {
  const args = {
    roots: DEFAULT_ROOTS,
    databaseUrl: process.env.DATABASE_URL || 'postgres://jurgen@localhost:5432/webdl',
    hashDuplicates: true,
    maxHashBytes: Number.POSITIVE_INFINITY,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-hash') args.hashDuplicates = false;
    else if (arg === '--root') args.roots = String(argv[++i] || '').split(/[;\n]/).filter(Boolean);
    else if (arg === '--database-url') args.databaseUrl = argv[++i] || args.databaseUrl;
    else if (arg === '--max-hash-gb') args.maxHashBytes = Number(argv[++i] || 0) * 1024 * 1024 * 1024;
    else if (arg === '--help') {
      console.log('Usage: node scripts/storage-audit.js [--root "/old;/new"] [--no-hash] [--max-hash-gb N]');
      process.exit(0);
    }
  }
  args.roots = args.roots.map((p) => path.resolve(p));
  return args;
}

function classify(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const parts = filePath.split(path.sep);
  if (parts.some((part) => BALLAST_SEGMENT_RE.test(part))) return 'ballast';
  if (/^r\d\d$/i.test(ext.replace('.', ''))) return 'ballast';
  if (BALLAST_EXTS.has(ext)) return 'ballast';
  if (/thumbs\.db$/i.test(path.basename(filePath))) return 'ballast';
  if (MEDIA_EXTS.has(ext)) return 'media';
  return 'other';
}

function walk(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (!entry || !entry.name || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          files.push({ path: full, size: Number(stat.size || 0), kind: classify(full) });
        } catch (_) {}
      }
    }
  }
  return files;
}

function hashFile(filePath) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      h.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

async function loadDbPaths(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT filepath
        FROM public.downloads
       WHERE filepath IS NOT NULL AND filepath <> ''
    `);
    return new Set(result.rows.map((r) => path.resolve(r.filepath)));
  } finally {
    await client.end();
  }
}

function summarize(files, dbPaths) {
  const summary = {
    totalFiles: files.length,
    totalBytes: 0,
    byKind: {},
    dbReferenced: 0,
    missingDbReferenced: 0,
  };
  for (const f of files) {
    summary.totalBytes += f.size;
    summary.byKind[f.kind] ||= { files: 0, bytes: 0 };
    summary.byKind[f.kind].files++;
    summary.byKind[f.kind].bytes += f.size;
    if (dbPaths.has(path.resolve(f.path))) summary.dbReferenced++;
  }
  for (const dbPath of dbPaths) {
    if (!fs.existsSync(dbPath)) summary.missingDbReferenced++;
  }
  return summary;
}

function duplicateReport(files, { hashDuplicates, maxHashBytes }) {
  const bySize = new Map();
  for (const f of files.filter((file) => file.kind === 'media' && file.size > 0)) {
    const arr = bySize.get(f.size) || [];
    arr.push(f);
    bySize.set(f.size, arr);
  }
  const sizeGroups = Array.from(bySize.values()).filter((arr) => arr.length > 1);
  if (!hashDuplicates) {
    return { exact: false, candidateGroups: sizeGroups.length, groups: [] };
  }
  const groups = [];
  for (const group of sizeGroups) {
    const totalBytes = group.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > maxHashBytes) {
      groups.push({ skipped: 'over_max_hash_bytes', size: group[0].size, files: group.map((f) => f.path) });
      continue;
    }
    const byHash = new Map();
    for (const f of group) {
      let hash = null;
      try { hash = hashFile(f.path); } catch (e) { hash = `error:${String(e.message || e)}`; }
      const arr = byHash.get(hash) || [];
      arr.push(f.path);
      byHash.set(hash, arr);
    }
    for (const [hash, paths] of byHash) {
      if (paths.length > 1 && !hash.startsWith('error:')) groups.push({ hash, size: group[0].size, files: paths });
    }
  }
  return { exact: true, candidateGroups: sizeGroups.length, groups };
}

async function main() {
  const args = parseArgs(process.argv);
  const files = args.roots.flatMap((root) => walk(root));
  const dbPaths = await loadDbPaths(args.databaseUrl);
  const report = {
    generatedAt: new Date().toISOString(),
    roots: args.roots,
    summary: summarize(files, dbPaths),
    ballastTop: files
      .filter((f) => f.kind === 'ballast')
      .sort((a, b) => b.size - a.size)
      .slice(0, 200),
    duplicates: duplicateReport(files, args),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
