// test/repair-fullscale-images.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  imageMagicOk,
  relpathForDatabase,
} = require('../scripts/repair-fullscale-images');

test('relpathForDatabase bewaart relatieve paden relatief', () => {
  assert.equal(
    relpathForDatabase('platform/a/foo_thumb.jpg', { root: '/media' }, '/media/platform/a/foo.jpg'),
    'platform/a/foo.jpg',
  );
});

test('relpathForDatabase bewaart absolute paden absoluut', () => {
  assert.equal(
    relpathForDatabase('/media/platform/a/foo_thumb.jpg', { root: '/media' }, '/media/platform/a/foo.jpg'),
    '/media/platform/a/foo.jpg',
  );
});

test('imageMagicOk accepteert bekende image signatures', () => {
  assert.equal(imageMagicOk(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0, 0, 0, 0, 0, 0, 0])), true);
  assert.equal(imageMagicOk(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), true);
  assert.equal(imageMagicOk(Buffer.from('not an image response')), false);
});
