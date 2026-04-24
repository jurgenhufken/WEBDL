require('dotenv').config();
const { Client } = require('pg');

const isExecute = process.argv.includes('--execute');

console.log(`[AUDIT] Starting DB Deduplication Audit`);
console.log(`[AUDIT] Mode: ${isExecute ? 'EXECUTE (HARD DELETE DUPES)' : 'DRY RUN (Read Only)'}`);
console.log(`-----------------------------------------------------`);

async function runAudit() {
  const client = new Client(process.env.DATABASE_URL || 'postgres://localhost/webdl');
  await client.connect();

  try {
    console.log(`\n--- Finding Duplicates in 'downloads' table ---`);
    
    // We group by filepath. For each filepath with >1 records, we keep the one with the highest files count or the newest one.
    // SQL window function is perfect for this:
    const sql = `
      WITH RankedDownloads AS (
        SELECT d.id, d.filepath,
               (SELECT count(*) FROM download_files f WHERE f.download_id = d.id) as files_count,
               ROW_NUMBER() OVER(PARTITION BY d.filepath ORDER BY 
                  (SELECT count(*) FROM download_files f WHERE f.download_id = d.id) DESC, 
                  d.id DESC
               ) as rnum
        FROM downloads d
        WHERE d.filepath IS NOT NULL AND d.filepath != ''
      )
      SELECT id, filepath, files_count, rnum 
      FROM RankedDownloads 
      WHERE rnum > 1;
    `;
    
    const res = await client.query(sql);
    const duplicates = res.rows.map(r => r.id);
    
    console.log(`Found ${duplicates.length} duplicate database records pointing to the exact same file!`);
    
    // Print top 5 examples
    if (res.rows.length > 0) {
      console.log(`\nExamples of duplicates to remove:`);
      for (let i = 0; i < Math.min(5, res.rows.length); i++) {
        console.log(` - ID: ${res.rows[i].id} | Path: ${res.rows[i].filepath.substring(0, 80)}...`);
      }
    }

    if (isExecute && duplicates.length > 0) {
      console.log(`\nDeleting ${duplicates.length} duplicate records...`);
      const chunkSize = 1000;
      for (let i = 0; i < duplicates.length; i += chunkSize) {
        const chunk = duplicates.slice(i, i + chunkSize);
        await client.query('DELETE FROM downloads WHERE id = ANY($1::bigint[])', [chunk]);
      }
      console.log(`[OK] Deleted ${duplicates.length} duplicate records. DB is now strictly 1-to-1!`);
    }

    console.log(`\n[AUDIT] Deduplication Complete!`);
    if (!isExecute) {
      console.log(`[AUDIT] This was a DRY RUN. No data was actually deleted.`);
      console.log(`[AUDIT] Run 'node src/audit-db-dupes.js --execute' to perform the deletions.`);
    }

  } catch (err) {
    console.error(`\n[AUDIT] Error during deduplication:`, err);
  } finally {
    await client.end();
  }
}

runAudit();
