const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE_DIR = '/Volumes/HDD - One Touch/WEBDL';
const dbContext = { isPostgres: true };
const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });

function isInsidePrimaryBaseDir(p) {
  try {
    const root = fs.realpathSync(BASE_DIR);
    const target = fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);
    return target.startsWith(root);
  } catch (e) {
    return false;
  }
}
function safeIsAllowedExistingPath(p) {
  try {
    const abs = path.resolve(p);
    if (!isInsidePrimaryBaseDir(abs)) return false;
    return fs.existsSync(abs);
  } catch (e) {}
  return false;
}
function isMediaFilePath(fp) {
  const ext = String(path.extname(fp || '')).toLowerCase();
  return ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.avif', '.heic', '.heif'].includes(ext);
}
function isAuxiliaryMediaPath(inputPath) {
  try {
    const base = String(path.basename(String(inputPath || '')) || '').toLowerCase();
    if (!base) return false;
    if (base === 'metadata.json') return true;
    if (base.endsWith('.webp')) return true;
    if (/_thumb_v[0-9]+\.(jpe?g|png|gif)$/i.test(base)) return true;
    if (/[_\-.](?:thumb|thumbnail|logo|poster|preview|cover)(?:[_\-.][a-z0-9]+)?\.(?:jpe?g|png|gif|webp|bmp|svg|avif|heic|heif)$/i.test(base)) return true;
    if (/(?:^|[_\-.])(?:thumb|thumbnail|logo|poster|preview|cover)(?:[_\-.][a-z0-9]+)?$/i.test(path.basename(base, path.extname(base)))) return true;
  } catch (e) {}
  return false;
}
function relPathFromBaseDir(p) {
  try {
    return path.relative(BASE_DIR, p);
  } catch (e) { return ''; }
}
function isReadyDownloadStatus(s) {
  return s === 'completed';
}

const upsertOne = async (absFile) => {
  const downloadId = 76623;
  const createdAt = '2026-03-28 05:45:22.109373';
  const allowNotReady = false;
  const status = 'completed';
  const DOWNLOAD_FILES_ACTIVE_FILE_STABLE_MS = 2000;
  
  if (!absFile) { console.log('[UPSERT-DEBUG] No absFile'); return; }
  if (!safeIsAllowedExistingPath(absFile)) { console.log('[UPSERT-DEBUG] Not allowed path:', absFile); return; }
  if (!isMediaFilePath(absFile)) { console.log('[UPSERT-DEBUG] Not media path:', absFile); return; }
  if (isAuxiliaryMediaPath(absFile)) { console.log('[UPSERT-DEBUG] Is auxiliary path:', absFile); return; }
  
  const rel = relPathFromBaseDir(absFile);
  if (!rel) { console.log('[UPSERT-DEBUG] No rel path:', absFile); return; }
  if (!path.isAbsolute(rel) && rel.startsWith('..')) { console.log('[UPSERT-DEBUG] Out of bounds rel:', rel); return; }
  
  const st2 = fs.statSync(absFile);
  const size = st2 && Number.isFinite(st2.size) ? st2.size : 0;
  const mtime = st2 && Number.isFinite(st2.mtimeMs) ? Math.floor(st2.mtimeMs) : 0;
  
  if (allowNotReady && !isReadyDownloadStatus(status)) {
    const ageMs = mtime > 0 ? (Date.now() - mtime) : 0;
    if (!(mtime > 0 && ageMs >= DOWNLOAD_FILES_ACTIVE_FILE_STABLE_MS)) {
      console.log('[UPSERT-DEBUG] Ignoring young file during non-ready status', rel);
      return;
    }
  }
  try {
    const sql = `
      INSERT INTO download_files (download_id, relpath, filesize, mtime_ms, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(download_id, relpath) DO UPDATE SET
        filesize=excluded.filesize,
        mtime_ms=excluded.mtime_ms,
        created_at=COALESCE(download_files.created_at, excluded.created_at),
        updated_at=excluded.updated_at
    `;
    const result = await pool.query(sql, [downloadId, rel, size, mtime, createdAt, createdAt]);
    console.log('[UPSERT-DEBUG] Successfully upserted:', rel, result.rowCount);
  } catch (dbErr) {
    console.error('[UPSERT-DEBUG] DB Error on insert for', rel, dbErr.message);
  }
};

async function runTest() {
  const abs = '/Volumes/HDD - One Touch/WEBDL/onlyfans/matilda_tilda/matilda_tilda/Archived/Images/3726x5273_1e614508afb7f990aa923e21df948cbf.jpeg';
  await upsertOne(abs);
  process.exit();
}
runTest().catch(console.error);
