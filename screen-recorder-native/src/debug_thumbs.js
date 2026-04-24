const { Client } = require('pg');
const fs = require('fs');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Get latest FFF downloads and check for duplicates
  const res = await client.query(`
    SELECT d.id, d.channel, d.title, d.filename, d.filepath, d.is_thumb_ready, d.thumbnail,
           df.relpath, df.mtime_ms
    FROM downloads d
    LEFT JOIN download_files df ON df.download_id = d.id
    WHERE d.platform = 'footfetishforum' AND d.status = 'completed'
    ORDER BY d.id DESC
    LIMIT 30
  `);
  
  // Check for duplicate relpaths
  const relpathCount = {};
  for (const r of res.rows) {
    if (r.relpath) {
      relpathCount[r.relpath] = (relpathCount[r.relpath] || 0) + 1;
    }
  }
  const dupes = Object.entries(relpathCount).filter(([k,v]) => v > 1);
  console.log(`Duplicate relpaths: ${dupes.length}`);
  dupes.forEach(([path, cnt]) => console.log(`  ${cnt}x ${path.slice(-60)}`));
  
  // Check for duplicate filepaths across downloads
  const fpCount = {};
  for (const r of res.rows) {
    if (r.filepath) {
      if (!fpCount[r.filepath]) fpCount[r.filepath] = [];
      fpCount[r.filepath].push(r.id);
    }
  }
  const fpDupes = Object.entries(fpCount).filter(([k,v]) => v.length > 1);
  console.log(`\nDuplicate filepaths: ${fpDupes.length}`);
  fpDupes.forEach(([fp, ids]) => console.log(`  IDs ${ids.join(',')} → ${fp.slice(-60)}`));

  // Check if thumbs exist on disk
  console.log('\n=== Thumb check ===');
  for (const r of res.rows.slice(0, 10)) {
    const thumbPath = r.filepath ? r.filepath.replace(/\.[^.]+$/, '_thumb_v3.jpg') : '';
    const thumbExists = thumbPath ? fs.existsSync(thumbPath) : false;
    console.log(`  #${r.id} thumb_ready=${r.is_thumb_ready} thumb_file=${thumbExists} file=${(r.filename||'').slice(0,40)}`);
  }
  
  client.end();
})();
