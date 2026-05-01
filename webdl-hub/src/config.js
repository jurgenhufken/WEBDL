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

const DOWNLOAD_ROOT_RAW = required('DOWNLOAD_ROOT', './data/downloads');
const DOWNLOAD_ROOT = path.isAbsolute(DOWNLOAD_ROOT_RAW)
  ? DOWNLOAD_ROOT_RAW
  : path.resolve(process.cwd(), DOWNLOAD_ROOT_RAW);

const SABNZBD_COMPLETED_DIR_RAW = required(
  'WEBDL_SABNZBD_COMPLETED_DIR',
  '/Volumes/HDD - One Touch/WEBDL/_SABNZBD/Completed',
);
const SABNZBD_COMPLETED_DIR = path.isAbsolute(SABNZBD_COMPLETED_DIR_RAW)
  ? SABNZBD_COMPLETED_DIR_RAW
  : path.resolve(process.cwd(), SABNZBD_COMPLETED_DIR_RAW);

const config = Object.freeze({
  port: intEnv('PORT', 35730),
  databaseUrl: required('DATABASE_URL', 'postgres://localhost/webdl'),
  dbSchema: required('DB_SCHEMA', 'public'),
  downloadRoot: DOWNLOAD_ROOT,
  workerConcurrency: intEnv('WORKER_CONCURRENCY', 2),
  logLevel: required('LOG_LEVEL', 'info'),
  avfCookie: process.env.AVF_COOKIE || '',
  sabnzbdWatchEnabled: boolEnv('WEBDL_SABNZBD_WATCH', true),
  sabnzbdCompletedDir: SABNZBD_COMPLETED_DIR,
  sabnzbdPollMs: intEnv('WEBDL_SABNZBD_POLL_MS', 30_000),
  sabnzbdMinFileAgeMs: intEnv('WEBDL_SABNZBD_MIN_FILE_AGE_MS', 15_000),
  sabnzbdConfigPath: process.env.WEBDL_SABNZBD_CONFIG || '',
  sabnzbdUrl: process.env.WEBDL_SABNZBD_URL || '',
  sabnzbdApiKey: process.env.WEBDL_SABNZBD_API_KEY || '',
});

module.exports = config;
