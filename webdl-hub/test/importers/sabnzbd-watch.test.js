'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  isMediaPath,
  findHistoryForFile,
  readSabnzbdConfig,
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
