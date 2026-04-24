require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

const isExecute = process.argv.includes('--execute');

console.log(`[AUDIT] Starting FAST Database vs Filesystem Audit (Videos Only)`);
console.log(`[AUDIT] Mode: ${isExecute ? 'EXECUTE (HARD DELETE)' : 'DRY RUN (Read Only)'}`);
console.log(`-----------------------------------------------------`);

async function runAudit() {
  const client = new Client(process.env.DATABASE_URL || 'postgres://localhost/webdl');
  await client.connect();

  try {
    console.log(`\n--- Auditing 'downloads' table (Videos) ---`);
    let res = await client.query("SELECT id, filepath FROM downloads WHERE filepath IS NOT NULL AND filepath != ''");
    
    let missingDownloads = [];
    let dChecked = 0;
    let lastTime = Date.now();
    
    for (const row of res.rows) {
      // Directe snelle check voor video's
      try { 
        if (!fs.existsSync(row.filepath)) {
          missingDownloads.push(row.id);
        }
      } catch(e) { 
        missingDownloads.push(row.id); 
      }
      
      dChecked++;
      if (dChecked % 200 === 0) {
        const now = Date.now();
        const speed = Math.floor(200 / ((now - lastTime) / 1000));
        lastTime = now;
        process.stdout.write(`\r\x1b[K=> Database check: ${dChecked} / ${res.rows.length} video's gecontroleerd... (${speed} files/sec)`);
      }
    }
    
    console.log(`\n\n[OK] Found ${missingDownloads.length} orphaned downloads (spook-video's) out of ${res.rows.length} total.`);
    
    if (isExecute && missingDownloads.length > 0) {
      console.log(`Deleting ${missingDownloads.length} orphaned downloads...`);
      const chunkSize = 1000;
      for (let i = 0; i < missingDownloads.length; i += chunkSize) {
        const chunk = missingDownloads.slice(i, i + chunkSize);
        await client.query('DELETE FROM downloads WHERE id = ANY($1::bigint[])', [chunk]);
      }
      console.log(`Deleted ${missingDownloads.length} orphaned downloads.`);
    }

    console.log(`\n[AUDIT] Audit Complete!`);
    if (!isExecute) {
      console.log(`[AUDIT] This was a DRY RUN. No data was actually deleted.`);
      console.log(`[AUDIT] Run 'node src/audit-db-fast.js --execute' to perform the deletions.`);
    }

  } catch (err) {
    console.error(`\n[AUDIT] Error during audit:`, err);
  } finally {
    await client.end();
  }
}

runAudit();
