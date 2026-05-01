'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isSlaveUrl } = require('../../src/queue/slave-router');

test('slave-router delegeert Keep2Share/K2S naar simple-server', () => {
  assert.equal(isSlaveUrl('https://k2s.cc/file/12c6d4edd861e/video.mp4').platform, 'keep2share');
  assert.equal(isSlaveUrl('https://keep2share.cc/file/12c6d4edd861e/video.mp4').platform, 'keep2share');
});
