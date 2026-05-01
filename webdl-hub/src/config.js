// src/config.js — centrale configuratie uit .env, één keer geladen + gevalideerd.
'use strict';

const path = require('node:path');

try {
  require('dotenv').config();
} catch (_e) {
  /* geen .env — prima */
}

function required(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Ontbrekende env-variabele: ${name}`);
  }
  return v;
}

function intEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`Ongeldige integer voor ${name}: ${v}`);
  return n;
}

function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(v).trim());
}

function pathListEnv(name, fallback = []) {
  const raw = process.env[name];
  const values = raw === undefined || raw === ''
    ? fallback
    : String(raw).split(/[;\n]/).map((v) => v.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const resolved = path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

const DOWNLOAD_ROOT_RAW = required('DOWNLOAD_ROOT', './data/downloads');
const DOWNLOAD_ROOT = path.isAbsolute(DOWNLOAD_ROOT_RAW)
  ? DOWNLOAD_ROOT_RAW
  : path.resolve(process.cwd(), DOWNLOAD_ROOT_RAW);

const OLD_WEBDL_ROOT = '/Volumes/HDD - One Touch/WEBDL';
const NEW_WEBDL_ROOT = '/Volumes/WEBDL Extra/WEBDL';
const DEFAULT_SABNZBD_COMPLETED_DIR = `${OLD_WEBDL_ROOT}/_SABNZBD/Completed`;
const SABNZBD_COMPLETED_DIRS = pathListEnv('WEBDL_SABNZBD_COMPLETED_DIRS', [
  required('WEBDL_SABNZBD_COMPLETED_DIR', DEFAULT_SABNZBD_COMPLETED_DIR),
]);
const STORAGE_ROOTS = pathListEnv('WEBDL_STORAGE_ROOTS', [OLD_WEBDL_ROOT, NEW_WEBDL_ROOT]);

const config = Object.freeze({
  port: intEnv('PORT', 35730),
  databaseUrl: required('DATABASE_URL', 'postgres://localhost/webdl'),
  dbSchema: required('DB_SCHEMA', 'public'),
  downloadRoot: DOWNLOAD_ROOT,
  workerConcurrency: intEnv('WORKER_CONCURRENCY', 2),
  logLevel: required('LOG_LEVEL', 'info'),
  avfCookie: process.env.AVF_COOKIE || '',
  sabnzbdWatchEnabled: boolEnv('WEBDL_SABNZBD_WATCH', true),
  sabnzbdCompletedDir: SABNZBD_COMPLETED_DIRS[0] || DEFAULT_SABNZBD_COMPLETED_DIR,
  sabnzbdCompletedDirs: SABNZBD_COMPLETED_DIRS,
  sabnzbdPollMs: intEnv('WEBDL_SABNZBD_POLL_MS', 30_000),
  sabnzbdMinFileAgeMs: intEnv('WEBDL_SABNZBD_MIN_FILE_AGE_MS', 15_000),
  sabnzbdConfigPath: process.env.WEBDL_SABNZBD_CONFIG || '',
  sabnzbdUrl: process.env.WEBDL_SABNZBD_URL || '',
  sabnzbdApiKey: process.env.WEBDL_SABNZBD_API_KEY || '',
  storageRoots: STORAGE_ROOTS,
  preferredStorageRoot: process.env.WEBDL_PREFERRED_STORAGE_ROOT || NEW_WEBDL_ROOT,
  oldStorageRoot: OLD_WEBDL_ROOT,
  newStorageRoot: NEW_WEBDL_ROOT,
});

module.exports = config;
