const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  const res = await client.query(`
    SELECT is_thumb_ready, COUNT(*) as cnt 
    FROM downloads 
    WHERE platform = 'footfetishforum' AND status = 'completed'
    GROUP BY is_thumb_ready
  `);
  console.log('footfetishforum thumb_ready status:');
  res.rows.forEach(r => console.log(`  ${r.is_thumb_ready}: ${r.cnt}`));
  
  // Check the download path - these go through yt-dlp, let's see if they set thumbs
  const res2 = await client.query(`
    SELECT id, filepath, filename, is_thumb_ready, thumbnail 
    FROM downloads 
    WHERE platform = 'footfetishforum' AND status = 'completed' AND is_thumb_ready = false
    ORDER BY id DESC LIMIT 5
  `);
  console.log('\nRecent no-thumb items:');
  res2.rows.forEach(r => console.log(`  #${r.id} thumb=${r.thumbnail} file=${r.filename} path=${(r.filepath||'').slice(-60)}`));
  
  client.end();
})();
