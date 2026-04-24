const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  const res = await client.query(`SELECT id, is_thumb_ready, thumbnail, filepath, filename FROM downloads WHERE id >= 160594 AND id <= 160603;`);
  console.log('=== Thumb status for footfetishforum items ===');
  res.rows.forEach(r => console.log(`  #${r.id} thumb_ready=${r.is_thumb_ready} thumb=${(r.thumbnail||'').slice(0,50)} file=${r.filename} path=${(r.filepath||'').slice(0,80)}`));
  
  // Also check if download_files entries exist
  const res2 = await client.query(`SELECT download_id, relpath FROM download_files WHERE download_id >= 160594 AND download_id <= 160603;`);
  console.log(`\ndownload_files entries: ${res2.rows.length}`);
  res2.rows.forEach(r => console.log(`  download_id=${r.download_id} relpath=${r.relpath}`));
  
  client.end();
})();
