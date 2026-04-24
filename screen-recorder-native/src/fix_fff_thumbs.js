const { Client } = require('pg');
(async () => {
  const client = new Client('postgresql://jurgen@localhost:5432/webdl');
  await client.connect();
  
  // Fix all completed footfetishforum items that are images (jpg/png/gif/webp) - they ARE their own thumbnail
  const res = await client.query(`
    UPDATE downloads SET is_thumb_ready = true 
    WHERE status = 'completed' 
      AND is_thumb_ready = false
      AND (filename ILIKE '%.jpg' OR filename ILIKE '%.jpeg' OR filename ILIKE '%.png' 
           OR filename ILIKE '%.gif' OR filename ILIKE '%.webp')
    RETURNING id
  `);
  console.log(`Fixed is_thumb_ready for ${res.rowCount} image downloads`);
  
  client.end();
})();
