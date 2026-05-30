#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const THREAD_URL = 'https://vipergirls.to/threads/3746955-ClubSeventeen-Models-(Complete-Model-Sets-for-each-Model-HC-SC-GG)';
const THREAD_TITLE = 'ClubSeventeen Models (Complete Model Sets for each Model HC SC GG)';
const CHANNEL = 'clubseventeen models (complete model sets for each model hc sc gg)';
const JOB_DIR = '/Volumes/WEBDL Extra/WEBDL/_4KDownloader/hub/38453';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/webdl';
const DB_SCHEMA = process.env.DB_SCHEMA || 'webdl';
const START_PAGE = Math.max(1, Number.parseInt(process.env.CLUB17_START_PAGE || '2', 10) || 2);
const END_PAGE = Math.max(START_PAGE, Number.parseInt(process.env.CLUB17_END_PAGE || String(START_PAGE), 10) || START_PAGE);
const LIMIT = Math.max(1, Number.parseInt(process.env.CLUB17_LIMIT || '500', 10) || 500);
const REVERSE_WITHIN_PAGE = String(process.env.CLUB17_REVERSE_WITHIN_PAGE || '1') !== '0';

function threadPageUrl(page) {
  return page <= 1 ? THREAD_URL : `${THREAD_URL}/page${page}`;
}

function existingTokensFromSidecars() {
  const tokens = new Set();
  let names = [];
  try {
    names = fs.readdirSync(JOB_DIR);
  } catch {
    return tokens;
  }
  for (const name of names) {
    if (!name.endsWith('.jpg.json') && !name.endsWith('.jpeg.json') && !name.endsWith('.png.json') && !name.endsWith('.webp.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(JOB_DIR, name), 'utf8'));
      if (data && data.token) tokens.add(String(data.token).trim());
      if (data && data.post_url) {
        const m = String(data.post_url).match(/\/i\/([A-Za-z0-9]+)/);
        if (m) tokens.add(m[1]);
      }
    } catch {}
  }
  return tokens;
}

async function fetchPage(page) {
  const res = await fetch(threadPageUrl(page), {
    headers: {
      'user-agent': 'Mozilla/5.0',
      'accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`page ${page} HTTP ${res.status}`);
  return res.text();
}

function extractImxLinks(html) {
  const links = new Map();
  const re = /https?:\/\/(?:www\.)?imx\.to\/i\/([A-Za-z0-9]+)/g;
  let m;
  while ((m = re.exec(html))) {
    links.set(m[1], `https://imx.to/i/${m[1]}`);
  }
  return links;
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  const existingTokens = existingTokensFromSidecars();
  const candidates = new Map();
  try {
    for (let page = START_PAGE; page <= END_PAGE; page += 1) {
      const html = await fetchPage(page);
      const links = extractImxLinks(html);
      const pageLinks = Array.from(links.entries());
      if (REVERSE_WITHIN_PAGE) pageLinks.reverse();
      for (const [token, url] of pageLinks) {
        if (!existingTokens.has(token)) candidates.set(token, { token, url, page });
      }
      console.log(`page ${page}: ${links.size} imx links, candidates=${candidates.size}`);
    }

    const selected = Array.from(candidates.values()).slice(0, LIMIT);
    let inserted = 0;
    for (const item of selected) {
      const options = {
        platform: 'vipergirls',
        channel: CHANNEL,
        title: THREAD_TITLE,
        contextUrl: THREAD_URL,
        sourceContext: {
          platform: 'vipergirls',
          channel: CHANNEL,
          title: THREAD_TITLE,
          url: THREAD_URL,
          thread_id: '3746955',
          page: item.page,
        },
        clubseventeenSplitFromThread: true,
        parent_hub_job_id: '38453',
        source_thread_id: '3746955',
        source_thread_title: THREAD_TITLE,
        source_page: item.page,
        imx_token: item.token,
      };
      const { rowCount } = await pool.query(
        `INSERT INTO ${DB_SCHEMA}.jobs (url, adapter, status, priority, options, max_attempts, lane)
         SELECT $1, 'gallerydl', 'queued', 1000, $2::jsonb, 3, 'image'
          WHERE NOT EXISTS (
            SELECT 1 FROM ${DB_SCHEMA}.jobs
             WHERE url = $1
               AND status IN ('queued', 'running', 'done', 'cancelled')
          )`,
        [item.url, JSON.stringify(options)],
      );
      inserted += rowCount || 0;
    }
    console.log(`inserted=${inserted} selected=${selected.length} pages=${START_PAGE}-${END_PAGE}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
