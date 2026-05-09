'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isImportableMedia } = require('../../src/queue/worker');

test('isImportableMedia slaat gallery-dl site-shell afbeeldingen over', () => {
  assert.equal(isImportableMedia('/tmp/hub/37477/vipergirls_37477.jpg'), false);
  assert.equal(isImportableMedia('/tmp/hub/37477/viper-37477.png'), false);
  assert.equal(isImportableMedia('/tmp/hub/37485/newnudecity.com_statusicon.png'), false);
  assert.equal(isImportableMedia('/tmp/hub/37486/newnudecity.com_reputation.png'), false);
});

test('isImportableMedia slaat tijdelijke en fragmentbestanden over', () => {
  assert.equal(isImportableMedia('/tmp/hub/2817/Sauberkeit an den Fusssohlen ablesen.temp.mkv'), false);
  assert.equal(isImportableMedia('/tmp/hub/2817/video.part.mp4'), false);
  assert.equal(isImportableMedia('/tmp/hub/2817/video.f137.mp4'), false);
});

test('isImportableMedia laat echte media-bestanden door', () => {
  assert.equal(isImportableMedia('/tmp/hub/37477/abc123_full.jpg'), true);
  assert.equal(isImportableMedia('/tmp/hub/37477/video.mp4'), true);
});
