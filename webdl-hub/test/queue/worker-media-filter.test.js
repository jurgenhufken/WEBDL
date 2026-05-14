'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isImportableMedia, _test } = require('../../src/queue/worker');

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
  assert.equal(isImportableMedia('/tmp/hub/46518/Mandy Candy Worships Sunshine [0rv8oxu1221h1].fhls-1378.mp4'), false);
  assert.equal(isImportableMedia('/tmp/hub/46521/Aiden and Emma [om7rhc9nxz0h1].ffallback.mp4'), false);
});

test('isImportableMedia laat echte media-bestanden door', () => {
  assert.equal(isImportableMedia('/tmp/hub/37477/abc123_full.jpg'), true);
  assert.equal(isImportableMedia('/tmp/hub/37477/video.mp4'), true);
});

test('Twitter source info houdt 64-bit tweet IDs exact als string', () => {
  const exact = '2054202118156771794';
  const rounded = Number(exact);
  const info = _test.galleryDlSourceInfo({
    category: 'twitter',
    tweet_id: rounded,
    __webdl_filename_tweet_id: _test.twitterIdFromMediaFilename(`/tmp/${exact}_1.mp4`),
    author: { name: 'elambilir', id: '1067854261554462700' },
    fullname: 'elambilir',
  });

  assert.equal(info.sourcePostId, exact);
  assert.equal(info.sourcePostUrl, `https://x.com/elambilir/status/${exact}`);
});
