const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://localhost/webdl' });
async function test() {
  const query = `
    EXPLAIN ANALYZE
    SELECT
      (SELECT COUNT(*) FROM downloads WHERE status = 'finished') AS count_d,
      (SELECT COUNT(*) FROM screenshots) AS count_s,
      (SELECT COUNT(*) FROM download_files) AS count_p,
      (SELECT MAX(created_at) FROM downloads) AS max_dc,
      (SELECT MAX(created_at) FROM screenshots) AS max_sc,
      (SELECT MAX(created_at) FROM download_files) AS max_pc
  `;
  const res = await pool.query(query);
  console.log(res.rows.map(r => r['QUERY PLAN']).join('\n'));
  pool.end();
}
test().catch(console.error);
