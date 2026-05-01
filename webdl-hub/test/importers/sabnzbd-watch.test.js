'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  isMediaPath,
  findHistoryForFile,
  normalizeRootDirs,
  readSabnzbdConfig,
  scanSabnzbdCompleted,
} = require('../../src/importers/sabnzbd-watch');

test('SABNZBD watcher herkent media en negeert tijdelijke bestanden', () => {
  assert.equal(isMediaPath('/tmp/Show/video.wmv'), true);
  assert.equal(isMediaPath('/tmp/Show/poster.jpg'), true);
  assert.equal(isMediaPath('/tmp/_UNPACK_Show/video.mp4'), false);
  assert.equal(isMediaPath('/tmp/Show/video.wmv.part'), false);
  assert.equal(isMediaPath('/tmp/Show/video_thumb.jpg'), false);
  assert.equal(isMediaPath('/tmp/Show/.DS_Store'), false);
});

test('SABNZBD history matcht op storage of release/foldernaam', () => {
  const filePath = '/Volumes/HDD - One Touch/WEBDL/_SABNZBD/Completed/POVHumiliation.com.Carli.Banks.Dirty.Feet/movie.wmv';
  const history = [
    { name: 'other release', storage: '/tmp/other' },
    {
      name: 'POVHumiliation.com.Carli.Banks.Dirty.Feet',
      storage: '/Volumes/HDD - One Touch/WEBDL/_SABNZBD/Completed/POVHumiliation.com.Carli.Banks.Dirty.Feet',
      category: 'povhumiliation',
    },
  ];
  assert.equal(findHistoryForFile(filePath, history), history[1]);
});

test('SABNZBD config leest host uit misc en niet uit news-server sectie', (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sabnzbd-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sabnzbd.ini');
  fs.writeFileSync(file, [
    '[misc]',
    'host = 127.0.0.1',
    'port = 8080',
    'api_key = local-key',
    '[servers]',
    '[[news.example.test]]',
    'host = news.example.test',
    'port = 119',
    '',
  ].join('\n'));

  const cfg = readSabnzbdConfig(file);
  assert.equal(cfg.host, '127.0.0.1');
  assert.equal(cfg.port, '8080');
  assert.equal(cfg.api_key, 'local-key');
});

test('SABNZBD roots worden genormaliseerd en gededuped', () => {
  assert.deepEqual(
    normalizeRootDirs({ rootDir: '/old/Completed', rootDirs: ['/old/Completed', '/new/Completed'] }),
    ['/old/Completed', '/new/Completed'],
  );
});

test('SABNZBD scan kan stoppen voordat DB-imports starten', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sabnzbd-stop-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'video.mp4'), Buffer.alloc(1024));

  const repo = {
    schema: 'webdl',
    pool: {
      query() {
        throw new Error('DB should not be touched after stop');
      },
    },
  };
  const result = await scanSabnzbdCompleted({
    repo,
    rootDir: dir,
    minFileAgeMs: 0,
    shouldStop: () => true,
  });
  assert.equal(result.success, true);
  assert.equal(result.files, 1);
  assert.equal(result.imported, 0);
  assert.equal(result.skipped, 0);
});

test('SABNZBD scan kan oude bestanden overslaan met mtime cutoff', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sabnzbd-cutoff-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'old-video.mp4');
  fs.writeFileSync(file, Buffer.alloc(1024));
  const oldDate = new Date(Date.now() - 60_000);
  fs.utimesSync(file, oldDate, oldDate);

  const repo = {
    schema: 'webdl',
    pool: {
      query() {
        throw new Error('DB should not be touched for old files outside cutoff');
      },
    },
  };
  const result = await scanSabnzbdCompleted({
    repo,
    rootDir: dir,
    minFileAgeMs: 0,
    sinceMtimeMs: Date.now() - 1_000,
  });
  assert.equal(result.success, true);
  assert.equal(result.files, 0);
});
