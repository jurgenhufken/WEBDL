const { createDb } = require('./src/db-adapter');
const db = createDb({ engine: 'postgres', databaseUrl: 'postgres://localhost/webdl' });
const sql = db.isPostgres ? `
  SELECT kind, id, platform, channel, title, filepath, created_at, ts, thumbnail, url, source_url, rating, rating_kind, rating_id
  FROM (
    SELECT
      'p' AS kind,
      f.relpath AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      NULL AS filepath,
      COALESCE(NULLIF(f.created_at, ''), d.created_at::text) AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM download_files f
    JOIN downloads d ON d.id = f.download_id
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')

    UNION ALL

    SELECT
      'd' AS kind,
      CAST(d.id AS TEXT) AS id,
      d.platform AS platform,
      d.channel AS channel,
      d.title AS title,
      d.filepath AS filepath,
      d.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at)) * 1000 AS BIGINT) AS ts,
      d.thumbnail AS thumbnail,
      d.url AS url,
      d.source_url AS source_url,
      d.rating AS rating,
      'd' AS rating_kind,
      d.id AS rating_id
    FROM downloads d
    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
      AND d.filepath IS NOT NULL
      AND TRIM(d.filepath) != ''

    UNION ALL

    SELECT
      's' AS kind,
      CAST(s.id AS TEXT) AS id,
      s.platform AS platform,
      s.channel AS channel,
      s.title AS title,
      s.filepath AS filepath,
      s.created_at::text AS created_at,
      CAST(EXTRACT(EPOCH FROM s.created_at) * 1000 AS BIGINT) AS ts,
      NULL AS thumbnail,
      s.url AS url,
      NULL AS source_url,
      s.rating AS rating,
      's' AS rating_kind,
      s.id AS rating_id
    FROM screenshots s
    WHERE s.filepath IS NOT NULL
      AND TRIM(s.filepath) != ''
  ) sub
  ORDER BY ts DESC
  LIMIT ? OFFSET ?
` : '';
const dynamicStmt = db.prepare(sql);
dynamicStmt.all(10, 0).then(r => console.log(r)).catch(console.error).finally(()=>db.close());
