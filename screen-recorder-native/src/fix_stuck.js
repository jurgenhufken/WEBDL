const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  // These are old recordings that never completed - mark them as error
  await client.query(`UPDATE downloads SET status = 'error', progress = 0 WHERE id IN (113376, 97084) AND status = 'pending';`);
  console.log('Fixed 2 stuck pending recordings → error');
  client.end();
})();
