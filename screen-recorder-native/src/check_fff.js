const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`SELECT id, status, platform, channel, title, filename, filepath, filesize, created_at FROM downloads WHERE platform = 'footfetishforum' ORDER BY id DESC LIMIT 15;`);
  console.log('=== LATEST footfetishforum ===');
  res.rows.forEach(r => console.log(`  id=${r.id} status=${r.status} size=${r.filesize} file=${(r.filename||'').slice(0,80)} path=${(r.filepath||'').slice(0,120)}`));
  
  const res2 = await client.query(`SELECT id, status, platform, channel, title, filename, filepath, filesize, created_at FROM downloads WHERE platform ILIKE '%4k%' ORDER BY id DESC LIMIT 10;`);
  console.log('\n=== LATEST 4kdownloader ===');
  res2.rows.forEach(r => console.log(`  id=${r.id} status=${r.status} size=${r.filesize} created=${r.created_at} file=${(r.filename||'').slice(0,80)}`));

  const res3 = await client.query(`SELECT id, status, platform, created_at FROM downloads ORDER BY id DESC LIMIT 20;`);
  console.log('\n=== LATEST 20 downloads (any platform) ===');
  res3.rows.forEach(r => console.log(`  id=${r.id} platform=${r.platform} status=${r.status} created=${r.created_at}`));

  client.end();
})();
