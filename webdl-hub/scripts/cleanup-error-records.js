// scripts/cleanup-error-records.js
// Ruimt foutieve download-records + bijbehorende rommel-files op.
// Draait binnen één transactie; backup-tabel wordt eerst gemaakt.
'use strict';

const { Client } = require('pg');
const fs = require('fs');

async function main() {
  const c = new Client({ connectionString: 'postgres://localhost/webdl' });
  await c.connect();
  await c.query('BEGIN');
  try {
    console.log('=== Backup ===');
    await c.query('DROP TABLE IF EXISTS downloads_error_backup_20260424');
    const bak = await c.query(
      "CREATE TABLE downloads_error_backup_20260424 AS SELECT * FROM downloads WHERE status='error'"
    );
    console.log('  backup-tabel aangemaakt, rijen:', bak.rowCount);

    // STAP A: stubs zonder filepath of zonder file op disk
    console.log('\n=== Stap A: stubs zonder bestand ===');
    const delA1 = await c.query(
      "DELETE FROM downloads WHERE status='error' AND filepath IS NULL"
    );
    console.log('  verwijderd (filepath IS NULL):', delA1.rowCount);

    const maybeMissing = await c.query(
      "SELECT id,filepath FROM downloads WHERE status='error' AND filepath IS NOT NULL"
    );
    const missingIds = [];
    for (const r of maybeMissing.rows) {
      if (!fs.existsSync(r.filepath)) missingIds.push(r.id);
    }
    if (missingIds.length) {
      const delA2 = await c.query(
        'DELETE FROM downloads WHERE id = ANY($1::int[])',
        [missingIds]
      );
      console.log('  verwijderd (file missing):', delA2.rowCount);
    } else {
      console.log('  geen missende files');
    }

    // STAP B: clusters ≥3× zelfde Corrupt-error (HTML error-pages)
    console.log('\n=== Stap B: identieke-size clusters ===');
    const clusters = await c.query(
      "SELECT substring(error,1,80) AS err, count(*) FROM downloads WHERE status='error' AND error LIKE 'Corrupt%' GROUP BY err HAVING count(*)>=3"
    );
    console.log('  clusters (>=3x zelfde size):', clusters.rows.length);
    let bFiles = 0;
    let bRows = 0;
    for (const cl of clusters.rows) {
      const rows = await c.query(
        "SELECT id,filepath FROM downloads WHERE error=$1 AND status='error'",
        [cl.err]
      );
      for (const r of rows.rows) {
        if (r.filepath && fs.existsSync(r.filepath)) {
          try {
            fs.unlinkSync(r.filepath);
            bFiles++;
          } catch (e) {
            /* laat staan */
          }
        }
      }
      const del = await c.query(
        "DELETE FROM downloads WHERE error=$1 AND status='error'",
        [cl.err]
      );
      bRows += del.rowCount;
    }
    console.log('  files verwijderd van disk:', bFiles);
    console.log('  DB-rijen verwijderd:', bRows);

    // STAP C: overige Corrupt-errors met file < 100KB
    console.log('\n=== Stap C: resterende Corrupt < 100KB ===');
    const rest = await c.query(
      "SELECT id,filepath FROM downloads WHERE status='error' AND error LIKE 'Corrupt%'"
    );
    console.log('  kandidaten resterend:', rest.rows.length);
    let cFiles = 0;
    const cIds = [];
    for (const r of rest.rows) {
      if (!r.filepath) {
        cIds.push(r.id);
        continue;
      }
      if (!fs.existsSync(r.filepath)) {
        cIds.push(r.id);
        continue;
      }
      try {
        const size = fs.statSync(r.filepath).size;
        if (size < 102400) {
          try {
            fs.unlinkSync(r.filepath);
            cFiles++;
          } catch (e) {
            /* skip */
          }
          cIds.push(r.id);
        }
      } catch (e) {
        /* skip */
      }
    }
    if (cIds.length) {
      const del = await c.query(
        'DELETE FROM downloads WHERE id = ANY($1::int[])',
        [cIds]
      );
      console.log('  files verwijderd van disk:', cFiles);
      console.log('  DB-rijen verwijderd:', del.rowCount);
    } else {
      console.log('  niks meer over');
    }

    console.log('\n=== Samenvatting ===');
    const remain = await c.query(
      "SELECT count(*) FROM downloads WHERE status='error'"
    );
    console.log('  error-records resterend:', remain.rows[0].count);
    await c.query('COMMIT');
    console.log(
      '\n✓ COMMIT. Rollback mogelijk via tabel: downloads_error_backup_20260424'
    );
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ROLLBACK wegens fout:', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
