#!/usr/bin/env node

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/webdl';
const TAG_NAME = process.env.TAG_NAME || 'sandals';
const WATCH = process.env.WATCH === '1' || process.env.WATCH === 'true';
const WATCH_INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS || 10000);

const CHANNELS = (process.env.TARGET_REDDIT_CHANNELS || [
  'thong sandals',
  'thongsandals',
  'womeningladiators',
  'sandalsnsfw',
  'sandalsfetish',
].join(','))
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const JOB_IDS = (process.env.TARGET_REDDIT_JOB_IDS || '42358,42359,42361,42362,42363')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter(Number.isFinite);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureTag(pool) {
  const existing = await pool.query(
    `SELECT id
       FROM tags
      WHERE lower(name) = lower($1)
      ORDER BY id
      LIMIT 1`,
    [TAG_NAME]
  );
  if (existing.rows[0]) {
    const id = existing.rows[0].id;
    await pool.query('UPDATE tags SET is_user=true, last_used_at=now() WHERE id=$1', [id]);
    return id;
  }

  const inserted = await pool.query(
    `INSERT INTO tags (name, is_user, last_used_at, user_use_count)
     VALUES ($1, true, now(), 0)
     RETURNING id`,
    [TAG_NAME]
  );
  return inserted.rows[0].id;
}

function metadataPatterns(jobIds) {
  return jobIds.flatMap((id) => [
    `%"hub_job_id": "${id}"%`,
    `%"hub_job_id":"${id}"%`,
  ]);
}

async function tagOnce(pool, tagId) {
  const result = await pool.query(
    `WITH target AS (
       SELECT d.id AS download_id
         FROM downloads d
        WHERE d.platform = 'reddit'
          AND (
            lower(d.channel) = ANY($2::text[])
            OR d.metadata LIKE ANY($3::text[])
          )
     ), inserted AS (
       INSERT INTO item_user_tags (download_id, tag_id)
       SELECT download_id, $1
         FROM target
       ON CONFLICT DO NOTHING
       RETURNING download_id
     ), refreshed AS (
       UPDATE tags
          SET user_use_count = (
                SELECT COUNT(*)
                  FROM item_user_tags
                 WHERE tag_id = $1
              ),
              last_used_at = now(),
              is_user = true
        WHERE id = $1
       RETURNING user_use_count
     )
     SELECT (SELECT COUNT(*) FROM target)::int AS target_items,
            (SELECT COUNT(*) FROM inserted)::int AS newly_tagged,
            (SELECT user_use_count FROM refreshed)::int AS total_tagged`,
    [tagId, CHANNELS, metadataPatterns(JOB_IDS)]
  );
  return result.rows[0];
}

async function runningJobs(pool) {
  if (JOB_IDS.length === 0) return 0;
  const result = await pool.query(
    `SELECT COUNT(*)::int AS running
       FROM webdl.jobs
      WHERE id = ANY($1::bigint[])
        AND status = 'running'`,
    [JOB_IDS]
  );
  return result.rows[0].running;
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    const tagId = await ensureTag(pool);
    do {
      const tagged = await tagOnce(pool, tagId);
      const running = await runningJobs(pool);
      console.log(
        `${new Date().toISOString()} tag=${TAG_NAME} target=${tagged.target_items} newly=${tagged.newly_tagged} total=${tagged.total_tagged} running_jobs=${running}`
      );
      if (!WATCH || running === 0) break;
      await sleep(WATCH_INTERVAL_MS);
    } while (true);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
