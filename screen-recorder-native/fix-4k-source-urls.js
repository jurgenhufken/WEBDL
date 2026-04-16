#!/usr/bin/env node
/**
 * Back-fill source URLs and real platforms for 4K Video Downloader items.
 * Also triggers thumbnail generation for items missing thumbs.
 */
const path = require('path');
const fs = require('fs');

async function main() {
  const Database = require('better-sqlite3');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: 'postgres://localhost/webdl' });

  const FOURK_DB_PATH = path.join(
    process.env.HOME || '/Users/jurgen',
    'Library/Application Support/4kdownload.com/4K Video Downloader+/4K Video Downloader+/704ce5ed-b79a-488e-ab46-e282931f50d0.sqlite'
  );

  if (!fs.existsSync(FOURK_DB_PATH)) {
    console.error('❌ 4K VD database niet gevonden:', FOURK_DB_PATH);
    process.exit(1);
  }

  const fourKDb = new Database(FOURK_DB_PATH, { readonly: true });
  console.log('📂 4K VD DB geopend');

  // Build lookup maps
  const fourKItems = fourKDb.prepare(`
    SELECT d.filename, u.url, m.title
    FROM download_item d
    JOIN media_item_description m ON m.download_item_id = d.id
    JOIN url_description u ON u.media_item_description_id = m.id
    WHERE u.url IS NOT NULL AND u.url != ''
  `).all();

  console.log(`📊 ${fourKItems.length} items met source URL in 4K VD DB`);

  const urlByPath = new Map();
  const urlByBasename = new Map();
  for (const item of fourKItems) {
    if (!item.filename || !item.url) continue;
    urlByPath.set(item.filename, item.url);
    urlByBasename.set(path.basename(item.filename), item.url);
  }

  function detectPlatform(url) {
    if (!url) return null;
    const u = url.toLowerCase();
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.includes('tiktok.com')) return 'tiktok';
    if (u.includes('instagram.com')) return 'instagram';
    if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
    if (u.includes('reddit.com')) return 'reddit';
    if (u.includes('vimeo.com')) return 'vimeo';
    return null;
  }

  // Get all 4kdownloader items
  const { rows: webdlItems } = await pool.query(`
    SELECT id, filepath, url, source_url, platform
    FROM downloads
    WHERE platform = '4kdownloader'
    ORDER BY id
  `);
  console.log(`📊 ${webdlItems.length} WEBDL items met platform=4kdownloader`);

  let sourceLinked = 0, platformUpdated = 0, noMatch = 0;
  for (const item of webdlItems) {
    const fp = String(item.filepath || '').trim();
    if (!fp) continue;

    // Try multiple match strategies
    let sourceUrl = urlByPath.get(fp);
    if (!sourceUrl) {
      const alt = fp.startsWith('/Volumes/')
        ? fp.replace('/Volumes/HDD - One Touch/WEBDL/', '/Users/jurgen/Downloads/WEBDL/')
        : fp.replace('/Users/jurgen/Downloads/WEBDL/', '/Volumes/HDD - One Touch/WEBDL/');
      sourceUrl = urlByPath.get(alt);
    }
    if (!sourceUrl) sourceUrl = urlByBasename.get(path.basename(fp));

    if (!sourceUrl) { noMatch++; continue; }

    const realPlatform = detectPlatform(sourceUrl);

    // Update source_url
    if (!item.source_url || item.source_url === '') {
      await pool.query('UPDATE downloads SET source_url = $1 WHERE id = $2', [sourceUrl, item.id]);
      sourceLinked++;
    }

    // Update platform
    if (realPlatform && item.platform === '4kdownloader') {
      await pool.query('UPDATE downloads SET platform = $1 WHERE id = $2', [realPlatform, item.id]);
      platformUpdated++;
    }
  }
  console.log(`✅ Source URLs gekoppeld: ${sourceLinked}`);
  console.log(`✅ Platform updated: ${platformUpdated}`);
  console.log(`⚠️  Geen match: ${noMatch} (4K VD DB heeft maar ${fourKItems.length} items)`);

  // Trigger thumb generation for ALL 4K files missing thumbs
  console.log('\n🖼️  Thumbnail check voor alle 4K kanalen...');
  const { rows: allItems } = await pool.query(`
    SELECT id, filepath FROM downloads
    WHERE platform IN ('4kdownloader','youtube','tiktok')
    AND status = 'completed'
    ORDER BY id DESC
  `);

  let thumbsTriggered = 0, thumbsExist = 0, filesMissing = 0;
  for (const item of allItems) {
    const fp = String(item.filepath || '').trim();
    if (!fp || !fs.existsSync(fp)) { filesMissing++; continue; }

    const dir = path.dirname(fp);
    const base = path.basename(fp, path.extname(fp));
    if (fs.existsSync(path.join(dir, base + '_thumb_v3.jpg'))) { thumbsExist++; continue; }
    if (fs.existsSync(path.join(dir, '.thumb', base + '.jpg'))) { thumbsExist++; continue; }

    try {
      await fetch(`http://localhost:35729/media/thumb?kind=d&id=${item.id}`);
      thumbsTriggered++;
      if (thumbsTriggered % 50 === 0) {
        console.log(`  🖼️  ${thumbsTriggered} thumbs getriggerd...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e) {}
  }
  console.log(`\n📊 Thumbs: aanwezig=${thumbsExist} | getriggerd=${thumbsTriggered} | file missing=${filesMissing}`);

  fourKDb.close();
  await pool.end();
  console.log('\n✅ Klaar!');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
