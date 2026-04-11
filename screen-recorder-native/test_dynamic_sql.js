const { createDb } = require('./src/db-adapter');
const db = createDb({ engine: 'postgres', databaseUrl: 'postgres://postgres:postgres@localhost:5432/webdl' });
// simulate how simple-server creates getRecentHybridMedia
const sql = `
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
  )
  ORDER BY ts DESC
  LIMIT $1 OFFSET $2
`;

function testGen(sourceSql) {
  let sql = sourceSql;
  const isPG = true;
  const vFilter = isPG ? 
    "(f.relpath ILIKE '%.mp4' OR f.relpath ILIKE '%.webm' OR f.relpath ILIKE '%.mov' OR f.relpath ILIKE '%.mkv')" :
    "(f.relpath LIKE '%.mp4' OR f.relpath LIKE '%.webm' OR f.relpath LIKE '%.mov' OR f.relpath LIKE '%.mkv')";
  const iFilter = isPG ? 
    "(f.relpath ILIKE '%.jpg' OR f.relpath ILIKE '%.jpeg' OR f.relpath ILIKE '%.png' OR f.relpath ILIKE '%.gif' OR f.relpath ILIKE '%.webp')" : 
    "(f.relpath LIKE '%.jpg' OR f.relpath LIKE '%.jpeg' OR f.relpath LIKE '%.png' OR f.relpath LIKE '%.gif' OR f.relpath LIKE '%.webp')";
  
  const dvFilter = vFilter.replace(/f\.relpath/g, 'd.filepath');
  const diFilter = iFilter.replace(/f\.relpath/g, 'd.filepath');
  const svFilter = vFilter.replace(/f\.relpath/g, 's.filepath');
  const siFilter = iFilter.replace(/f\.relpath/g, 's.filepath');

  const insertF = vFilter;
  const insertD = dvFilter;
  const insertS = svFilter;

  sql = sql.replace("FROM download_files f\n    JOIN downloads d ON d.id = f.download_id\n    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')", 
    "FROM download_files f\n    JOIN downloads d ON d.id = f.download_id\n    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing') AND " + insertF);

  sql = sql.replace("FROM downloads d\n    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')\n      AND d.filepath IS NOT NULL\n      AND TRIM(d.filepath) != ''", 
    "FROM downloads d\n    WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')\n      AND d.filepath IS NOT NULL\n      AND TRIM(d.filepath) != '' AND " + insertD);

  sql = sql.replace("FROM screenshots s\n    WHERE s.filepath IS NOT NULL\n      AND TRIM(s.filepath) != ''", 
    "FROM screenshots s\n    WHERE s.filepath IS NOT NULL\n      AND TRIM(s.filepath) != '' AND " + insertS);

  console.log(sql);
}
testGen(sql);
