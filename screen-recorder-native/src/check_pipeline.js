const { Client } = require('pg');
const fs = require('fs');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Get latest footfetishforum downloads
  const res = await client.query(`
    SELECT id, status, platform, channel, title, filename, filepath, filesize, 
           is_thumb_ready, thumbnail,
           created_at, finished_at
    FROM downloads 
    WHERE platform = 'footfetishforum' 
    ORDER BY id DESC 
    LIMIT 15
  `);
  
  console.log('=== Latest 15 footfetishforum downloads ===');
  for (const r of res.rows) {
    const exists = r.filepath ? fs.existsSync(r.filepath) : false;
    const realSize = exists ? fs.statSync(r.filepath).size : 0;
    console.log(`#${r.id} status=${r.status} thumb=${r.is_thumb_ready}`);
    console.log(`  file=${r.filename || 'NONE'} size_db=${r.filesize} size_disk=${realSize} exists=${exists}`);
    console.log(`  path=${(r.filepath||'').slice(0,100)}`);
    console.log(`  channel=${r.channel} title=${(r.title||'').slice(0,40)}`);
    console.log('');
  }
  
  // Check download_files for these
  const ids = res.rows.map(r => r.id);
  const res2 = await client.query(`
    SELECT download_id, relpath, mtime_ms 
    FROM download_files 
    WHERE download_id = ANY($1)
  `, [ids]);
  console.log(`\n=== download_files entries: ${res2.rows.length} ===`);
  res2.rows.forEach(r => {
    const fullPath = '/Users/jurgen/Downloads/WEBDL/' + r.relpath;
    const exists = fs.existsSync(fullPath);
    console.log(`  #${r.download_id} exists=${exists} ${r.relpath}`);
  });
  
  client.end();
})();
