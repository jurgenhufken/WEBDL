const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Get the failed redd.it URLs
  const res = await client.query(`SELECT id, url FROM downloads WHERE id >= 160594 AND id <= 160603 AND status = 'error';`);
  console.log(`Found ${res.rows.length} errored footfetishforum items to fix`);
  
  for (const row of res.rows) {
    // Fix the URL: redd.it/title-v0-id.ext → i.redd.it/id.ext
    const oldUrl = row.url;
    const match = oldUrl.match(/-v0-([a-z0-9]+\.[a-z]{2,5})$/i);
    if (match) {
      const newUrl = `https://i.redd.it/${match[1]}`;
      await client.query(`UPDATE downloads SET url = $1, status = 'pending', progress = 0 WHERE id = $2`, [newUrl, row.id]);
      console.log(`  Fixed #${row.id}: ${oldUrl} → ${newUrl}`);
    } else {
      console.log(`  Skipped #${row.id}: no -v0- pattern in ${oldUrl}`);
    }
  }
  
  client.end();
})();
