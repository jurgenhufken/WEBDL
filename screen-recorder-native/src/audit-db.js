require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const readline = require('readline');

const isExecute = process.argv.includes('--execute');

// Gebruik een bredere base directory voor de FIND command (om alle bestanden in WEBDL in 1x te indexeren)
let BASE_DIR = process.env.WEBDL_AUTO_IMPORT_ROOT_DIR
  ? path.resolve(process.env.WEBDL_AUTO_IMPORT_ROOT_DIR)
  : path.resolve(path.join(os.homedir(), 'Downloads', 'WEBDL', '_Downloads'));

// Als BASE_DIR eindigt in _4KDownloader of iets specifieks, pak dan gewoon de hoofd WEBDL map!
if (BASE_DIR.includes('WEBDL/')) {
  BASE_DIR = BASE_DIR.substring(0, BASE_DIR.indexOf('WEBDL/') + 6);
} else if (BASE_DIR.endsWith('WEBDL')) {
  // It's already the root
}

console.log(`[AUDIT] Starting ULTRA-FAST Database vs Filesystem Audit`);
console.log(`[AUDIT] Base Directory: ${BASE_DIR}`);
console.log(`[AUDIT] Mode: ${isExecute ? 'EXECUTE (HARD DELETE)' : 'DRY RUN (Read Only)'}`);
console.log(`-----------------------------------------------------`);

// We build a giant Set of all files in the base directory
const allFiles = new Set();

async function buildFileSet() {
  console.log(`\n[1/4] Scanning hard drive for all files using native 'find'...`);
  console.log(`(Dit kan 1 à 2 minuten duren, maar is véél sneller dan 1 miljoen individuele checks)`);
  return new Promise((resolve, reject) => {
    const findCmd = spawn('find', [BASE_DIR, '-type', 'f']);
    const rl = readline.createInterface({ input: findCmd.stdout, terminal: false });
    
    let count = 0;
    let lastTime = Date.now();
    let speed = 0;
    rl.on('line', (line) => {
      allFiles.add(line);
      count++;
      if (count % 500 === 0) {
        const now = Date.now();
        speed = Math.floor(500 / ((now - lastTime) / 1000));
        lastTime = now;
        process.stdout.write(`\r\x1b[K=> Mappen aan het scannen... al ${count} bestanden gevonden (${speed} files/sec) `);
      }
    });

    findCmd.stderr.on('data', (data) => {
      // ignore permission denied errors from find
    });

    findCmd.on('close', (code) => {
      console.log(`\n[OK] Indexed ${allFiles.size} files total into RAM!`);
      resolve();
    });
    findCmd.on('error', reject);
  });
}

function fileExistsFast(fp) {
  // Try fast path first
  if (fp.startsWith(BASE_DIR)) {
    return allFiles.has(fp);
  }
  // Fallback
  try { return fs.existsSync(fp); } catch (e) { return false; }
}

async function runAudit() {
  const client = new Client(process.env.DATABASE_URL || 'postgres://localhost/webdl');
  await client.connect();

  try {
    await buildFileSet();

    // 1. Audit 'downloads' table
    console.log(`\n[2/4] Auditing 'downloads' table (Videos & Directories)...`);
    let res = await client.query("SELECT id, filepath FROM downloads WHERE filepath IS NOT NULL AND filepath != ''");
    
    let missingDownloads = [];
    let dChecked = 0;
    for (const row of res.rows) {
      if (!fileExistsFast(row.filepath)) {
        missingDownloads.push(row.id);
      }
      dChecked++;
      if (dChecked % 500 === 0) {
        process.stdout.write(`\r\x1b[K=> Database check: ${dChecked} / ${res.rows.length} records gecontroleerd...`);
      }
    }
    
    console.log(`\n[OK] Found ${missingDownloads.length} orphaned downloads out of ${res.rows.length} total.`);
    
    if (isExecute && missingDownloads.length > 0) {
      console.log(`Deleting ${missingDownloads.length} orphaned downloads...`);
      const chunkSize = 1000;
      for (let i = 0; i < missingDownloads.length; i += chunkSize) {
        const chunk = missingDownloads.slice(i, i + chunkSize);
        await client.query('DELETE FROM downloads WHERE id = ANY($1::bigint[])', [chunk]);
      }
      console.log(`Deleted ${missingDownloads.length} orphaned downloads.`);
    }

    // 2. Audit 'screenshots' table
    console.log(`\n[3/4] Auditing 'screenshots' table...`);
    res = await client.query("SELECT id, filepath FROM screenshots WHERE filepath IS NOT NULL AND filepath != ''");
    let missingScreenshots = [];
    let sChecked = 0;
    for (const row of res.rows) {
      if (!fileExistsFast(row.filepath)) {
        missingScreenshots.push(row.id);
      }
      sChecked++;
      if (sChecked % 500 === 0) {
        process.stdout.write(`\r\x1b[K=> Database check: ${sChecked} / ${res.rows.length} screenshots gecontroleerd...`);
      }
    }
    console.log(`\n[OK] Found ${missingScreenshots.length} orphaned screenshots out of ${res.rows.length} total.`);
    if (isExecute && missingScreenshots.length > 0) {
      const chunkSize = 1000;
      for (let i = 0; i < missingScreenshots.length; i += chunkSize) {
        const chunk = missingScreenshots.slice(i, i + chunkSize);
        await client.query('DELETE FROM screenshots WHERE id = ANY($1::bigint[])', [chunk]);
      }
      console.log(`Deleted ${missingScreenshots.length} orphaned screenshots.`);
    }

    // 3. Audit 'download_files' table
    console.log(`\n[4/4] Auditing 'download_files' table (Individual images)...`);
    const maxIdRes = await client.query('SELECT MAX(id) as max_id FROM download_files');
    const maxId = parseInt(maxIdRes.rows[0].max_id) || 0;
    
    let totalFilesChecked = 0;
    let missingDownloadFiles = [];
    const batchSize = 100000; 
    
    for (let currentId = 0; currentId <= maxId; currentId += batchSize) {
      const { rows } = await client.query('SELECT id, relpath FROM download_files WHERE id > $1 AND id <= $2', [currentId, currentId + batchSize]);
      
      for (const row of rows) {
        if (!row.relpath) continue;
        const absPath = path.resolve(BASE_DIR, row.relpath);
        if (!fileExistsFast(absPath)) {
          missingDownloadFiles.push(row.id);
        }
      }
      
      totalFilesChecked += rows.length;
      process.stdout.write(`\r\x1b[K=> Database check: ${totalFilesChecked} image records gecontroleerd...`);
    }
    
    console.log(`\n[OK] Found ${missingDownloadFiles.length} orphaned file records out of ${totalFilesChecked} total.`);
    
    if (isExecute && missingDownloadFiles.length > 0) {
      console.log(`Deleting ${missingDownloadFiles.length} orphaned download_files...`);
      const chunkSize = 5000;
      let deletedCount = 0;
      for (let i = 0; i < missingDownloadFiles.length; i += chunkSize) {
        const chunk = missingDownloadFiles.slice(i, i + chunkSize);
        await client.query('DELETE FROM download_files WHERE id = ANY($1::bigint[])', [chunk]);
        deletedCount += chunk.length;
        if (deletedCount % 20000 === 0) process.stdout.write(`Deleted ${deletedCount}...\r`);
      }
      console.log(`\nDeleted ${missingDownloadFiles.length} orphaned download_files.`);
    }

    console.log(`\n[AUDIT] Audit Complete!`);
    if (!isExecute) {
      console.log(`[AUDIT] This was a DRY RUN. No data was actually deleted.`);
      console.log(`[AUDIT] Run 'node src/audit-db.js --execute' to perform the deletions.`);
    }

  } catch (err) {
    console.error(`\n[AUDIT] Error during audit:`, err);
  } finally {
    await client.end();
  }
}

runAudit();
