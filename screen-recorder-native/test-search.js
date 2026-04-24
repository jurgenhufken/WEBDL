const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://jurgen@localhost:5432/webdl' });

async function run() {
  const searchQuery = "omegle, chatroulette";
  const limit = 120;
  const rowOffset = 0;
  
  const orGroups = searchQuery.split(',').map(g => g.trim()).filter(Boolean);
  if (orGroups.length === 0) orGroups.push(searchQuery.replace(/%/g, ''));

  const conditions = [];
  const bindings = [];

  for (const group of orGroups) {
    const andWords = group.split(/[\s*\-+]+/).filter(w => w.trim().length > 0);
    if (andWords.length === 0) continue;
    
    const andConditions = [];
    for (const w of andWords) {
      andConditions.push(`(d.channel ILIKE $${bindings.length + 1} OR d.title ILIKE $${bindings.length + 1} OR d.platform ILIKE $${bindings.length + 1})`);
      const likeTerm = '%' + w + '%';
      bindings.push(likeTerm);
    }
    if (andConditions.length > 0) {
      conditions.push(`(${andConditions.join(' AND ')})`);
    }
  }
  
  bindings.push(Math.max(limit * 50, 15000), rowOffset);
  const limitParam = `$${bindings.length - 1}`;
  const offsetParam = `$${bindings.length}`;

  const query = `
    WITH matched_downloads AS (
      SELECT * FROM downloads d
      WHERE d.status NOT IN ('pending', 'queued', 'downloading', 'postprocessing')
        AND d.filepath IS NOT NULL AND d.filepath != ''
        ${conditions.length > 0 ? 'AND (' + conditions.join(' OR ') + ')' : ''}
    )
    SELECT id FROM matched_downloads LIMIT ${limitParam} OFFSET ${offsetParam};
  `;
  
  console.log("SQL:");
  console.log(query);
  console.log("Bindings:", bindings);

  const res = await pool.query(query, bindings);
  console.log("ROWS:", res.rowCount);
  pool.end();
}
run().catch(console.error);
