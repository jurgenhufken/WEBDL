#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');

const envPath = '/Users/jurgen/WEBDL/webdl-hub/.env';
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://jurgen@localhost:5432/webdl',
  max: 1,
});

function galleryDlRunning() {
  try {
    execFileSync('pgrep', ['-f', 'gallery-dl .*_4KDownloader/hub/37'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function releaseNext() {
  const { rows } = await pool.query(`
    UPDATE webdl.jobs
       SET lane='image', priority=95, locked_by=NULL, locked_at=NULL
     WHERE id = (
       SELECT id FROM webdl.jobs
        WHERE status='queued' AND adapter='gallerydl' AND lane='gallery'
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
     )
     RETURNING id, url
  `);
  if (rows.length) {
    console.log(new Date().toISOString(), 'released', rows[0].id, rows[0].url);
  }
  return rows.length > 0;
}

async function remaining() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status='queued' AND adapter='gallerydl' AND lane='gallery')::int AS gallery_waiting,
      COUNT(*) FILTER (WHERE status='queued' AND adapter='gallerydl' AND lane='image')::int AS image_waiting
    FROM webdl.jobs
  `);
  return rows[0] || { gallery_waiting: 0, image_waiting: 0 };
}

(async () => {
  while (true) {
    if (!galleryDlRunning()) {
      const released = await releaseNext();
      const rem = await remaining();
      if (!released && rem.gallery_waiting === 0 && rem.image_waiting === 0) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
})()
  .catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
