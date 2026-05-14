'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../../src/queue/slave-poller');

test('slave-poller accepteert media en archive outputs van simple-server', () => {
  assert.equal(_test.isMediaPath('/tmp/download/video.mp4'), true);
  assert.equal(_test.isMediaPath('/tmp/download/image.jpg'), true);
  assert.equal(_test.isMediaPath('/tmp/download/archive.rar'), true);
  assert.equal(_test.isMediaPath('/tmp/download/archive.zip'), true);
  assert.equal(_test.isMediaPath('/tmp/download/k2s-archive-without-extension'), true);
  assert.equal(_test.isMediaPath('/tmp/download/readme.txt'), false);
});

test('slave-poller slaat thumbnails en previews over', () => {
  assert.equal(_test.isMediaPath('/tmp/download/video_thumb.jpg'), false);
  assert.equal(_test.isMediaPath('/tmp/download/video_preview.webp'), false);
});
