// test/image-quality.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  deriveFullscalePath,
  fullscaleCandidateUrl,
  looksThumbnailish,
} = require('../src/util/image-quality');

test('herkent thumbnail-achtige afbeeldingsnamen en URLs', () => {
  assert.equal(looksThumbnailish('photo.md.jpg'), true);
  assert.equal(looksThumbnailish('https://vipr.im/th/abc/foo.jpg'), true);
  assert.equal(looksThumbnailish('https://pixhost.to/thumbs/123/foo.jpg'), true);
  assert.equal(looksThumbnailish('https://example.com/images/full/photo.jpg'), false);
});

test('leidt bekende fullscale image URLs af', () => {
  assert.equal(
    fullscaleCandidateUrl('https://upload.forum-area.com/images/a.md.jpg'),
    'https://upload.forum-area.com/images/a.jpg',
  );
  assert.equal(
    fullscaleCandidateUrl('https://vipr.im/th/abc/foo.jpg'),
    'https://vipr.im/i/abc/foo.jpg/30.jpg',
  );
  assert.equal(
    fullscaleCandidateUrl('https://pixhost.to/thumbs/123/foo.jpg'),
    'https://pixhost.to/images/123/foo.jpg',
  );
});

test('leidt fullscale bestandsnaam af zonder thumbnail suffix', () => {
  assert.equal(deriveFullscalePath('/tmp/foo.md.jpg'), '/tmp/foo.jpg');
  assert.equal(deriveFullscalePath('/tmp/thumb_foo.jpg'), '/tmp/foo.jpg');
});
