const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const pool = new Pool({ connectionString: 'postgres://localhost/webdl' });

async function run() {
  const res = await pool.query("SELECT id, url, filepath FROM downloads WHERE id >= 191981 AND id <= 191986");
  for (const row of res.rows) {
    const match = row.url.match(/([a-zA-Z0-9-]+-jpg)/);
    if (match) {
      const correctBase = match[1];
      const correctFilename = correctBase + '.jpg';
      const dir = path.dirname(row.filepath);
      const correctFilepath = path.join(dir, correctFilename);
      
      console.log(`ID ${row.id}: Correcting to ${correctFilename}`);
      
      let size = 0;
      if (fs.existsSync(correctFilepath)) {
        size = fs.statSync(correctFilepath).size;
      }
      
      await pool.query("UPDATE downloads SET filepath = $1, filename = $2, filesize = $3, is_thumb_ready = false WHERE id = $4", [
        correctFilepath,
        correctFilename,
        size,
        row.id
      ]);
      
      // Hit the API to generate thumb
      require('http').get(`http://localhost:35729/media/thumb?id=${row.id}`, () => {});
    }
  }
  console.log('Done!');
  setTimeout(() => pool.end(), 1000);
}
run();
