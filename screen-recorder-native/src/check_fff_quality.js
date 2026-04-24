const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Check the most recent footfetishforum completed downloads - focus on metadata quality
  const res = await client.query(`
    SELECT id, platform, channel, title, filename, filepath, filesize, status, format,
           source_url, url, thumbnail, is_thumb_ready
    FROM downloads 
    WHERE platform = 'footfetishforum' 
      AND status = 'completed'
    ORDER BY COALESCE(finished_at, updated_at, created_at) DESC
    LIMIT 15
  `);
  console.log('=== Recent footfetishforum completed ===');
  res.rows.forEach(r => {
    console.log(`  #${r.id} ch="${r.channel}" title="${(r.title||'').slice(0,40)}" file="${r.filename}" thumb=${r.is_thumb_ready}`);
    console.log(`    filepath=${(r.filepath||'').slice(-80)}`);
    console.log(`    url=${(r.url||'').slice(0,80)}`);
    console.log(`    format=${r.format} size=${r.filesize}`);
  });
  
  // Check if any have channel=unknown
  const res2 = await client.query(`
    SELECT COUNT(*) as cnt FROM downloads 
    WHERE platform = 'footfetishforum' AND channel = 'unknown' AND status = 'completed'
  `);
  console.log(`\nfff items with channel=unknown: ${res2.rows[0].cnt}`);
  
  // Check items with .unknown_video extension
  const res3 = await client.query(`
    SELECT id, filename, filepath, channel, title FROM downloads 
    WHERE platform = 'footfetishforum' AND filename LIKE '%unknown%'
    ORDER BY id DESC LIMIT 5
  `);
  console.log(`\nfff items with unknown in filename:`);
  res3.rows.forEach(r => console.log(`  #${r.id} ch="${r.channel}" file="${r.filename}"`));
  
  client.end();
})();
