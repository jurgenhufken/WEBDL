const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`SELECT id, status, created_at, updated_at, finished_at FROM downloads WHERE id >= 160594 AND id <= 160603;`);
  console.log('=== Dates for fixed footfetishforum items ===');
  res.rows.forEach(r => console.log(`  #${r.id} status=${r.status} created=${r.created_at} updated=${r.updated_at} finished=${r.finished_at}`));
  
  // What does the gallery sort by?
  const res2 = await client.query(`SELECT id, created_at, updated_at, finished_at FROM downloads ORDER BY id DESC LIMIT 3;`);
  console.log('\n=== Latest 3 by ID ===');
  res2.rows.forEach(r => console.log(`  #${r.id} created=${r.created_at} updated=${r.updated_at} finished=${r.finished_at}`));
  
  client.end();
})();
