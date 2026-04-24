const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const BASE = '/Users/jurgen/Downloads/WEBDL';

(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Find FFF downloads in unknown/ directories that have a real channel set
  const res = await client.query(`
    SELECT d.id, d.channel, d.title, d.filepath, d.filename
    FROM downloads d
    WHERE d.platform = 'footfetishforum'
      AND d.status = 'completed'
      AND d.filepath LIKE '%/unknown/%'
      AND d.channel IS NOT NULL
      AND d.channel != 'unknown'
      AND d.channel != ''
  `);
  
  console.log(`Found ${res.rows.length} FFF downloads in unknown/ with correct channel`);
  let moved = 0, skipped = 0, errors = 0;
  
  for (const r of res.rows) {
    const oldPath = r.filepath;
    if (!oldPath || !fs.existsSync(oldPath)) { skipped++; continue; }
    
    const safeChan = r.channel.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
    const newDir = path.join(BASE, 'footfetishforum', safeChan);
    const newPath = path.join(newDir, path.basename(oldPath));
    
    if (newPath === oldPath) { skipped++; continue; }
    if (fs.existsSync(newPath)) { skipped++; continue; } // Already exists at destination
    
    try {
      fs.mkdirSync(newDir, { recursive: true });
      fs.renameSync(oldPath, newPath);
      
      // Update DB: filepath
      await client.query(`UPDATE downloads SET filepath = $1 WHERE id = $2`, [newPath, r.id]);
      
      // Update download_files relpaths
      const oldRel = path.relative(BASE, oldPath);
      const newRel = path.relative(BASE, newPath);
      await client.query(
        `UPDATE download_files SET relpath = $1 WHERE download_id = $2 AND relpath = $3`,
        [newRel, r.id, oldRel]
      );
      
      // Clean up empty old directory
      const oldDir = path.dirname(oldPath);
      try {
        const remaining = fs.readdirSync(oldDir);
        if (remaining.length === 0) fs.rmdirSync(oldDir);
      } catch (e) {}
      
      moved++;
      console.log(`  ✅ #${r.id} → ${safeChan}/${path.basename(oldPath)}`);
    } catch (e) {
      errors++;
      console.log(`  ❌ #${r.id}: ${e.message}`);
    }
  }
  
  // Also fix ones where channel IS 'unknown' but origin_thread has the real channel
  const res2 = await client.query(`
    SELECT d.id, d.filepath, d.filename, d.metadata
    FROM downloads d
    WHERE d.platform = 'footfetishforum'
      AND d.status = 'completed'
      AND d.filepath LIKE '%/unknown/%'
      AND (d.channel IS NULL OR d.channel = 'unknown' OR d.channel = '')
      AND d.metadata IS NOT NULL
  `);
  
  console.log(`\nFound ${res2.rows.length} FFF downloads in unknown/ needing channel from metadata`);
  for (const r of res2.rows) {
    try {
      const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
      const ot = meta && meta.origin_thread;
      const chan = ot && ot.title ? ot.title : null;
      if (!chan) continue;
      
      const safeChan = chan.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
      const oldPath = r.filepath;
      if (!oldPath || !fs.existsSync(oldPath)) continue;
      
      const newDir = path.join(BASE, 'footfetishforum', safeChan);
      const newPath = path.join(newDir, path.basename(oldPath));
      if (newPath === oldPath || fs.existsSync(newPath)) continue;
      
      fs.mkdirSync(newDir, { recursive: true });
      fs.renameSync(oldPath, newPath);
      
      await client.query(`UPDATE downloads SET filepath = $1, channel = $2 WHERE id = $3`, [newPath, chan, r.id]);
      
      const oldRel = path.relative(BASE, oldPath);
      const newRel = path.relative(BASE, newPath);
      await client.query(
        `UPDATE download_files SET relpath = $1 WHERE download_id = $2 AND relpath = $3`,
        [newRel, r.id, oldRel]
      );
      
      const oldDir = path.dirname(oldPath);
      try { if (fs.readdirSync(oldDir).length === 0) fs.rmdirSync(oldDir); } catch (e) {}
      
      moved++;
      console.log(`  ✅ #${r.id} → ${safeChan}/${path.basename(oldPath)} (from metadata)`);
    } catch (e) {
      errors++;
    }
  }
  
  console.log(`\nDone: moved=${moved} skipped=${skipped} errors=${errors}`);
  client.end();
})();
