'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isImportableBrowserMedia,
  safeFilename,
} = require('../../src/api/routes-browser-media');

test('browser-media accepteert fullscale image/video uploads', () => {
  assert.equal(isImportableBrowserMedia({
    filename: 'photo.jpg',
    contentType: 'image/jpeg',
    size: 1024,
  }), true);
  assert.equal(isImportableBrowserMedia({
    filename: 'clip.mp4',
    contentType: 'video/mp4',
    size: 2048,
  }), true);
});

test('browser-media weigert thumbnails, tijdelijke bestanden en niet-media', () => {
  assert.equal(isImportableBrowserMedia({
    filename: 'photo.md.jpg',
    contentType: 'image/jpeg',
    size: 1024,
  }), false);
  assert.equal(isImportableBrowserMedia({
    filename: 'clip.temp.mp4',
    contentType: 'video/mp4',
    size: 2048,
  }), false);
  assert.equal(isImportableBrowserMedia({
    filename: 'page.html',
    contentType: 'text/html',
    size: 4096,
  }), false);
});

test('browser-media maakt veilige bestandsnamen met extensie uit content-type', () => {
  assert.equal(safeFilename('../bad/name', 'image/jpeg'), 'name.jpg');
  assert.equal(safeFilename('attachment', 'video/mp4'), 'attachment.mp4');
});
