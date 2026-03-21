const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://jurgen@localhost:5432/webdl'
  });
  await client.connect();
  const res = await client.query(`
    SELECT id, title, filepath, format
    FROM downloads 
    ORDER BY "downloadedAt" DESC 
    LIMIT 15;
  `);
  console.log(res.rows);
  await client.end();
}
main();
