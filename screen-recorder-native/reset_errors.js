const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });
  try {
    await client.connect();
    const res = await client.query("UPDATE downloads SET status = 'queued', error = NULL WHERE status = 'error' AND error LIKE '%jobLane is not defined%';");
    console.log('Reset rows affected:', res.rowCount);
  } catch (e) {
    console.error(e);
  } finally {
    client.end();
    process.exit(0);
  }
}

run();
