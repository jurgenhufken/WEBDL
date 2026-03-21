#!/usr/bin/env node

const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://jurgen@localhost:5432/webdl';

async function migrate() {
  const client = new Client({ connectionString: DATABASE_URL });
  
  try {
    await client.connect();
    console.log('✓ Connected to database');
    
    // Lijst van mappen die verplaatst zijn naar CAM-GIRLS
    const movedDirs = [
      'Chatroulette',
      'motherless',
      'omegleporn',
      'rutube',
      'test-examples',
      'videodownloadhelper',
      'xvideos',
      '_Downloads te importeren'
    ];
    
    // Update downloads
    for (const dir of movedDirs) {
      const downloadResult = await client.query(
        `UPDATE downloads 
         SET relpath = 'CAM-GIRLS/' || relpath
         WHERE relpath LIKE $1 || '/%'
           AND relpath NOT LIKE 'CAM-GIRLS/%'`,
        [dir]
      );
      console.log(`  Downloads ${dir}: ${downloadResult.rowCount} rows updated`);
      
      const screenshotResult = await client.query(
        `UPDATE screenshots
         SET relpath = 'CAM-GIRLS/' || relpath
         WHERE relpath LIKE $1 || '/%'
           AND relpath NOT LIKE 'CAM-GIRLS/%'`,
        [dir]
      );
      console.log(`  Screenshots ${dir}: ${screenshotResult.rowCount} rows updated`);
    }
    
    // Toon totalen
    const downloadTotal = await client.query(
      `SELECT COUNT(*) as count FROM downloads WHERE relpath LIKE 'CAM-GIRLS/%'`
    );
    const screenshotTotal = await client.query(
      `SELECT COUNT(*) as count FROM screenshots WHERE relpath LIKE 'CAM-GIRLS/%'`
    );
    
    console.log('\n📊 Totalen:');
    console.log(`  Downloads in CAM-GIRLS: ${downloadTotal.rows[0].count}`);
    console.log(`  Screenshots in CAM-GIRLS: ${screenshotTotal.rows[0].count}`);
    console.log('\n✅ Migration complete!');
    
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
