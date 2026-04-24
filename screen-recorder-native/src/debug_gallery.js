const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Check mtime_ms on the download_files for these items
  const res = await client.query(`
    SELECT df.download_id, df.relpath, df.mtime_ms,
           EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at))::bigint * 1000 AS db_ts,
           d.finished_at, d.status
    FROM download_files df
    JOIN downloads d ON d.id = df.download_id
    WHERE df.download_id >= 160594 AND df.download_id <= 160603
    ORDER BY df.download_id;
  `);
  console.log('=== download_files mtime_ms vs db_ts ===');
  res.rows.forEach(r => {
    const mtime = r.mtime_ms ? new Date(Number(r.mtime_ms)).toISOString() : 'NULL';
    const dbts = r.db_ts ? new Date(Number(r.db_ts)).toISOString() : 'NULL';
    console.log(`  #${r.download_id} mtime=${mtime} db_ts=${dbts} finished=${r.finished_at}`);
  });
  
  // What's the actual ts used in gallery sort for these?
  const res2 = await client.query(`
    SELECT 
      'p' AS kind,
      df.download_id,
      (COALESCE(df.mtime_ms, EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at))::bigint * 1000)) AS ts
    FROM download_files df
    JOIN downloads d ON d.id = df.download_id
    WHERE df.download_id >= 160594 AND df.download_id <= 160603
    ORDER BY ts DESC;
  `);
  console.log('\n=== Effective ts for gallery sort ===');
  res2.rows.forEach(r => console.log(`  #${r.download_id} ts=${r.ts} (${new Date(Number(r.ts)).toISOString()})`));
  
  // Compare with the newest items in the gallery
  const res3 = await client.query(`
    SELECT d.id, d.platform,
           EXTRACT(EPOCH FROM COALESCE(d.finished_at, d.updated_at, d.created_at))::bigint * 1000 AS ts
    FROM downloads d
    WHERE d.status = 'completed' AND d.is_thumb_ready = true
    ORDER BY COALESCE(d.finished_at, d.updated_at, d.created_at) DESC
    LIMIT 5;
  `);
  console.log('\n=== Top 5 newest completed items ===');
  res3.rows.forEach(r => console.log(`  #${r.id} ${r.platform} ts=${new Date(Number(r.ts)).toISOString()}`));
  
  client.end();
})();
