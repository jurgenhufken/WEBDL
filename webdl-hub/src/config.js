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

const DOWNLOAD_ROOT_RAW = required('DOWNLOAD_ROOT', './data/downloads');
const DOWNLOAD_ROOT = path.isAbsolute(DOWNLOAD_ROOT_RAW)
  ? DOWNLOAD_ROOT_RAW
  : path.resolve(process.cwd(), DOWNLOAD_ROOT_RAW);

const config = Object.freeze({
  port: intEnv('PORT', 35730),
  databaseUrl: required('DATABASE_URL', 'postgres://localhost/webdl'),
  dbSchema: required('DB_SCHEMA', 'public'),
  downloadRoot: DOWNLOAD_ROOT,
  workerConcurrency: intEnv('WORKER_CONCURRENCY', 2),
  logLevel: required('LOG_LEVEL', 'info'),
  avfCookie: process.env.AVF_COOKIE || '',
});

module.exports = config;
