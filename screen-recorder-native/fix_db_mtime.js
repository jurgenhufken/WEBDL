const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://localhost/webdl' });

async function fix() {
  console.log('Updating mtime_ms in PostgreSQL...');
  const res = await pool.query(`
    UPDATE download_files f
    SET mtime_ms = CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT)
    FROM downloads d
    WHERE f.download_id = d.id
      AND d.platform = 'wikifeet';
  `);
  console.log('Fixed', res.rowCount, 'rows!');
  pool.end();
}
fix().catch(console.error);
