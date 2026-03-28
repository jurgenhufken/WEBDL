const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT id, title, channel, error 
      FROM downloads 
      WHERE platform = 'onlyfans' AND status = 'error' 
      ORDER BY id DESC LIMIT 5
    `);
    console.log(JSON.stringify(rows, null, 2));
  } catch(e) {
    console.error(e);
  } finally {
    await pool.end();
    process.exit(0);
  }
}
run();
