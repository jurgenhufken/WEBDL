const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });

const missing = ['milaclark7', 'sunny.bunny.xx', 'zoerhode'];
const now = Date.now();

async function run() {
  for (const channel of missing) {
    const p = '/Volumes/HDD - One Touch/WEBDL/onlyfans/' + channel;
    const { rowCount } = await pool.query("SELECT id FROM downloads WHERE platform = 'onlyfans' AND channel = $1", [channel]);
    if (rowCount > 0) {
      console.log('Already exists in DB (maybe not completed?):', channel);
      await pool.query("UPDATE downloads SET status = 'completed', finished_at = $1 WHERE platform = 'onlyfans' AND channel = $2", [now, channel]);
      continue;
    }
    
    await pool.query(`
      INSERT INTO downloads (type, status, platform, channel, title, filepath, created_at, updated_at, finished_at)
      VALUES ('ofscraper', 'completed', 'onlyfans', $1, $1, $2, $3, $3, $3)
    `, [channel, p, now]);
    console.log('Imported:', channel);
  }
  process.exit();
}
run();
