// src/db/repo.js — dunne data-access-laag. Geen business-logica hier.
'use strict';

const { Pool } = require('pg');
const config = require('../config');

const VALID_SCHEMA = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function createRepo({ databaseUrl = config.databaseUrl, schema = config.dbSchema } = {}) {
  if (!VALID_SCHEMA.test(schema)) {
    throw new Error(`Ongeldige schema-naam: "${schema}"`);
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const T = {
    jobs:  `"${schema}".jobs`,
    files: `"${schema}".files`,
    logs:  `"${schema}".logs`,
  };

  const query = (text, params) => pool.query(text, params);
  const close = () => pool.end();

  async function ping() {
    const { rows } = await query('SELECT 1 AS ok');
    return rows[0].ok === 1;
  }

  async function createJob({ url, adapter, priority = 0, options = {}, maxAttempts = 3 }) {
    const { rows } = await query(
      `INSERT INTO ${T.jobs} (url, adapter, status, priority, options, max_attempts)
       VALUES ($1, $2, 'queued', $3, $4::jsonb, $5)
       RETURNING *`,
      [url, adapter, priority, JSON.stringify(options), maxAttempts],
    );
    return rows[0];
  }

  async function getJob(id) {
    const { rows } = await query(`SELECT * FROM ${T.jobs} WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  async function findRecentJobByUrl(url, { statuses = ['queued', 'running', 'done'] } = {}) {
    const { rows } = await query(
      `SELECT * FROM ${T.jobs}
        WHERE url = $1 AND status = ANY($2::text[])
        ORDER BY id DESC
        LIMIT 1`,
      [url, statuses],
    );
    return rows[0] || null;
  }

  async function listJobs({ status, limit = 100, offset = 0 } = {}) {
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE status = $${params.length}`;
    }
    params.push(limit, offset);
    const { rows } = await query(
      `SELECT * FROM ${T.jobs} ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows;
  }

  async function claimNextJob(workerId) {
    const { rows } = await query(
      `UPDATE ${T.jobs}
          SET status     = 'running',
              attempts   = attempts + 1,
              locked_by  = $1,
              locked_at  = now(),
              started_at = COALESCE(started_at, now())
        WHERE id = (
          SELECT id FROM ${T.jobs}
           WHERE status = 'queued'
           ORDER BY priority DESC, created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING *`,
      [workerId],
    );
    return rows[0] || null;
  }

  async function completeJob(id) {
    const { rows } = await query(
      `UPDATE ${T.jobs}
          SET status = 'done', progress_pct = 100, finished_at = now(),
              locked_by = NULL, locked_at = NULL, error = NULL
        WHERE id = $1
        RETURNING *`,
      [id],
    );
    return rows[0] || null;
  }

  async function failJob(id, errorMsg, { retry = false } = {}) {
    const nextStatus = retry ? 'queued' : 'failed';
    const { rows } = await query(
      `UPDATE ${T.jobs}
          SET status    = $2,
              error     = $3,
              locked_by = NULL,
              locked_at = NULL,
              finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE finished_at END
        WHERE id = $1
        RETURNING *`,
      [id, nextStatus, errorMsg],
    );
    return rows[0] || null;
  }

  async function cancelJob(id) {
    const { rows } = await query(
      `UPDATE ${T.jobs}
          SET status = 'cancelled', finished_at = now(),
              locked_by = NULL, locked_at = NULL
        WHERE id = $1 AND status IN ('queued','running')
        RETURNING *`,
      [id],
    );
    return rows[0] || null;
  }

  async function updateProgress(id, pct) {
    await query(`UPDATE ${T.jobs} SET progress_pct = $2 WHERE id = $1`, [id, pct]);
  }

  async function addFile(jobId, { path: filePath, size = null, mime = null, checksum = null }) {
    const { rows } = await query(
      `INSERT INTO ${T.files} (job_id, path, size, mime, checksum)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [jobId, filePath, size, mime, checksum],
    );
    return rows[0];
  }

  async function listFiles(jobId) {
    const { rows } = await query(
      `SELECT * FROM ${T.files} WHERE job_id = $1 ORDER BY id`,
      [jobId],
    );
    return rows;
  }

  async function appendLog(jobId, level, msg) {
    await query(`INSERT INTO ${T.logs} (job_id, level, msg) VALUES ($1, $2, $3)`, [jobId, level, msg]);
  }

  async function listLogs(jobId, { limit = 200 } = {}) {
    const { rows } = await query(
      `SELECT * FROM ${T.logs} WHERE job_id = $1 ORDER BY ts DESC LIMIT $2`,
      [jobId, limit],
    );
    return rows;
  }

  async function truncateAll() {
    await query(`TRUNCATE ${T.logs}, ${T.files}, ${T.jobs} RESTART IDENTITY CASCADE`);
  }

  return {
    pool, schema, close, ping,
    createJob, getJob, findRecentJobByUrl, listJobs,
    claimNextJob, completeJob, failJob, cancelJob, updateProgress,
    addFile, listFiles, appendLog, listLogs,
    truncateAll,
  };
}

module.exports = { createRepo };
