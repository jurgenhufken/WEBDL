'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isSlaveUrl, delegateToSlave } = require('../../src/queue/slave-router');

test('slave-router delegeert Keep2Share/K2S naar simple-server', () => {
  assert.equal(isSlaveUrl('https://k2s.cc/file/12c6d4edd861e/video.mp4').platform, 'keep2share');
  assert.equal(isSlaveUrl('https://keep2share.cc/file/12c6d4edd861e/video.mp4').platform, 'keep2share');
});

test("slave-router delegeert imagehost-pagina's naar simple-server", () => {
  assert.equal(isSlaveUrl('https://vipr.im/abc123').platform, 'vipr');
  assert.equal(isSlaveUrl('https://imx.to/i/abc123').platform, 'imx');
  assert.equal(isSlaveUrl('https://imgbox.com/abc123').platform, 'imgbox');
});

test('delegateToSlave canoniseert K2S bronplatform naar keep2share', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, status FROM downloads')) return { rows: [] };
      if (sql.includes('INSERT INTO downloads')) return { rows: [{ id: 42 }] };
      return { rows: [] };
    },
  };

  const result = await delegateToSlave(pool, {
    url: 'https://k2s.cc/file/37acdcf53b0ed',
    platform: 'keep2share',
    metadata: {
      original_platform: 'k2s',
      source_site: 'k2s',
      source_context: {
        platform: 'k2s',
        url: 'https://k2s.cc/file/37acdcf53b0ed',
        channel: 'unknown',
        title: 'K2S file',
      },
    },
    priority: 70,
  });

  assert.equal(result.downloadId, 42);
  const insert = calls.find((call) => call.sql.includes('INSERT INTO downloads'));
  assert.equal(insert.params[1], 'keep2share');
  const metadata = JSON.parse(insert.params[4]);
  assert.equal(metadata.source_site, 'keep2share');
  assert.equal(metadata.source_context.platform, 'keep2share');
  assert.equal(metadata.origin_thread.platform, 'keep2share');
  assert.deepEqual(metadata.source_sites, ['keep2share']);
});
