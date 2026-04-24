const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`EXPLAIN ANALYZE SELECT * FROM downloads d TABLESAMPLE SYSTEM(5) WHERE d.status = 'completed' AND d.filepath IS NOT NULL AND (d.filepath ILIKE '%.mp4' OR d.filepath ILIKE '%.webm' OR d.filepath ILIKE '%.mov' OR d.filepath ILIKE '%.mkv' OR d.filepath ILIKE '%.avi' OR d.filepath ILIKE '%.flv') ORDER BY RANDOM() LIMIT 15000;`);
  console.log(res.rows.map(r => r["QUERY PLAN"]).join('\n'));
  client.end();
})();
