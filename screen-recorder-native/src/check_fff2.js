const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  // Check metadata of the errored footfetishforum items
  const res = await client.query(`SELECT id, url, metadata FROM downloads WHERE id >= 160594 AND platform = 'footfetishforum' LIMIT 3;`);
  console.log('=== footfetishforum ERROR details ===');
  res.rows.forEach(r => {
    console.log(`id=${r.id} url=${(r.url||'').slice(0,120)}`);
    try { console.log('  meta:', JSON.parse(r.metadata)); } catch(e) { console.log('  meta raw:', (r.metadata||'').slice(0,200)); }
  });
  
  // Check when was the last SUCCESSFUL footfetishforum download
  const res2 = await client.query(`SELECT id, status, created_at, filename FROM downloads WHERE platform = 'footfetishforum' AND status = 'completed' ORDER BY id DESC LIMIT 3;`);
  console.log('\n=== Last completed footfetishforum ===');
  res2.rows.forEach(r => console.log(`  id=${r.id} created=${r.created_at} file=${r.filename}`));

  // Check when last 4kdownloader import was
  const res3 = await client.query(`SELECT created_at FROM downloads WHERE platform = '4kdownloader' ORDER BY id DESC LIMIT 1;`);
  console.log('\n=== Last 4kdownloader import ===');
  console.log(res3.rows[0]);
  
  // How many days since last download of any kind?
  const res4 = await client.query(`SELECT platform, MAX(created_at) as last_download FROM downloads WHERE status = 'completed' GROUP BY platform ORDER BY last_download DESC LIMIT 15;`);
  console.log('\n=== Last download per platform ===');
  res4.rows.forEach(r => console.log(`  ${r.platform}: ${r.last_download}`));

  client.end();
})();
