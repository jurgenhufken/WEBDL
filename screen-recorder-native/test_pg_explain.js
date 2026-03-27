const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://localhost/webdl' });
async function test() {
  const query = `
    EXPLAIN ANALYZE
    SELECT kind, id FROM (
      SELECT 'p' AS kind, f.relpath AS id,
      COALESCE(NULLIF(CAST(f.mtime_ms AS BIGINT), 0), CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT)) AS ts
      FROM download_files f
      JOIN downloads d ON d.id = f.download_id
      WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      UNION ALL
      SELECT 'd' AS kind, CAST(d.id AS TEXT) AS id,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts
      FROM downloads d
      WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
        AND d.filepath IS NOT NULL AND TRIM(d.filepath) != ''
    ) x
    ORDER BY ts DESC LIMIT 60 OFFSET 0;
  `;
  const res = await pool.query(query);
  console.log(res.rows.map(r => r['QUERY PLAN']).join('\n'));
  pool.end();
}
test().catch(console.error);
