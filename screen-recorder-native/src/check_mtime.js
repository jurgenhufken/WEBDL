const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Check mtime_ms in download_files for our items
  const res = await client.query(`
    SELECT df.download_id, df.relpath, df.mtime_ms, 
           d.finished_at, d.created_at,
           EXTRACT(EPOCH FROM d.finished_at)::bigint * 1000 as finished_epoch_ms
    FROM download_files df 
    JOIN downloads d ON d.id = df.download_id
    WHERE df.download_id >= 160594 AND df.download_id <= 160603;
  `);
  console.log('=== download_files mtime_ms ===');
  res.rows.forEach(r => console.log(`  dl=${r.download_id} mtime_ms=${r.mtime_ms} finished_epoch=${r.finished_epoch_ms} path=${r.relpath}`));
  
  // Check what ts ends up being in the gallery query for these items
  const res2 = await client.query(`
    SELECT 'p' AS kind, df.relpath AS id, d.platform,
      (COALESCE(df.mtime_ms, EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at))::bigint * 1000)) AS ts
    FROM download_files df
    JOIN downloads d ON d.id = df.download_id
    WHERE df.download_id >= 160594 AND df.download_id <= 160603
    ORDER BY ts DESC;
  `);
  console.log('\n=== Effective ts for gallery sort ===');
  res2.rows.forEach(r => console.log(`  ts=${r.ts} (${new Date(Number(r.ts)).toISOString()}) id=${r.id}`));
  
  // Compare with the newest items in the gallery
  const res3 = await client.query(`
    SELECT d.id, d.platform,
      EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at))::bigint * 1000 AS ts
    FROM downloads d
    WHERE d.status = 'completed' AND d.platform = 'footfetishforum'
    ORDER BY COALESCE(d.finished_at, d.updated_at, d.created_at) DESC
    LIMIT 5;
  `);
  console.log('\n=== Newest footfetishforum by finished_at ===');
  res3.rows.forEach(r => console.log(`  #${r.id} ts=${r.ts} (${new Date(Number(r.ts)).toISOString()})`));
  
  client.end();
})();
