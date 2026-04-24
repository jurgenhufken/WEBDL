const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  // Check ALL details of the errored footfetishforum items - esp the filepath and url
  const res = await client.query(`SELECT id, url, platform, channel, title, filepath, status FROM downloads WHERE id >= 160594 AND id <= 160603;`);
  console.log('=== footfetishforum ERROR details (full) ===');
  res.rows.forEach(r => {
    console.log(`id=${r.id} status=${r.status} platform=${r.platform}`);
    console.log(`  url=${r.url}`);
    console.log(`  channel=${r.channel} title=${r.title}`);
    console.log(`  filepath=${r.filepath}`);
  });
  
  // Also check if there's a recent footfetishforum download attempt that shows the pageUrl
  const res2 = await client.query(`SELECT id, url, metadata FROM downloads WHERE id >= 160594 AND id <= 160603 ORDER BY id ASC LIMIT 5;`);
  console.log('\n=== metadata for errored ===');
  res2.rows.forEach(r => {
    console.log(`id=${r.id} url=${r.url}`);
    console.log(`  metadata=${r.metadata}`);
  });
  
  client.end();
})();
