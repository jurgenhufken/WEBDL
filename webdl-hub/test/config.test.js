// test/config.test.js — env-parsing van src/config.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

function loadConfig(env) {
  for (const k of [
    'PORT','DATABASE_URL','DB_SCHEMA','DOWNLOAD_ROOT','WORKER_CONCURRENCY','LOG_LEVEL',
    'WEBDL_SABNZBD_COMPLETED_DIR','WEBDL_SABNZBD_COMPLETED_DIRS','WEBDL_STORAGE_ROOTS',
    'WEBDL_SABNZBD_STARTUP_LOOKBACK_MS','WEBDL_SABNZBD_MAX_FILES_PER_SCAN',
  ]) {
    delete process.env[k];
  }
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../src/config')];
  return require('../src/config');
}

test('defaults als env leeg is', () => {
  const c = loadConfig({});
  assert.equal(c.port, 35730);
  assert.equal(c.dbSchema, 'webdl');
  assert.equal(c.workerConcurrency, 2);
  assert.equal(c.logLevel, 'info');
  assert.ok(path.isAbsolute(c.downloadRoot));
  assert.ok(Array.isArray(c.sabnzbdCompletedDirs));
  assert.ok(c.sabnzbdCompletedDirs.length >= 1);
  assert.equal(c.sabnzbdStartupLookbackMs, 86400000);
  assert.equal(c.sabnzbdMaxFilesPerScan, 500);
});

test('env override wordt gelezen', () => {
  const c = loadConfig({
    PORT: '40000', DB_SCHEMA: 'webdl_test', WORKER_CONCURRENCY: '4', LOG_LEVEL: 'debug',
    DOWNLOAD_ROOT: '/tmp/dl',
  });
  assert.equal(c.port, 40000);
  assert.equal(c.dbSchema, 'webdl_test');
  assert.equal(c.workerConcurrency, 4);
  assert.equal(c.logLevel, 'debug');
  assert.equal(c.downloadRoot, '/tmp/dl');
});

test('SABNZBD completed dirs ondersteunen meerdere roots', () => {
  const c = loadConfig({
    WEBDL_SABNZBD_COMPLETED_DIRS: '/old/Completed;/new/Completed',
    WEBDL_STORAGE_ROOTS: '/old;/new',
  });
  assert.deepEqual(c.sabnzbdCompletedDirs, ['/old/Completed', '/new/Completed']);
  assert.equal(c.sabnzbdCompletedDir, '/old/Completed');
  assert.deepEqual(c.storageRoots, ['/old', '/new']);
});

test('ongeldige integer gooit fout', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }), /Ongeldige integer/);
});
