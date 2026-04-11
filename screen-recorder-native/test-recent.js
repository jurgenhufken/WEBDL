const pg = require('pg');
const pool = new pg.Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });
const sql = `
  SELECT kind, id, platform, title, ts, created_at
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.title AS title,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    UNION ALL
    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.title AS title,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      s.created_at::text AS created_at
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
  ) sub
  ORDER BY ts DESC
  LIMIT 5 OFFSET 0
`;
pool.query(sql).then(r => console.dir(r.rows)).catch(console.error).finally(()=>pool.end());
