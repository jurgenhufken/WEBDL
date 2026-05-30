// test/router/detect.test.js — priority-regels en hinting.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { detect } = require('../../src/router/detect');

const adapters = [
  require('../../src/adapters/tdl'),
  require('../../src/adapters/ofscraper'),
  require('../../src/adapters/instaloader'),
  require('../../src/adapters/reddit'),
  require('../../src/adapters/redgifs'),
  require('../../src/adapters/gallerydl'),
  require('../../src/adapters/ytdlp'),
];
const instaloader = adapters.find((a) => a.name === 'instaloader');

const cases = [
  ['https://www.youtube.com/watch?v=abc',      'ytdlp'],
  ['https://www.instagram.com/p/ABCDE/',       instaloader._instaloaderAvailable ? 'instaloader' : 'gallerydl'],
  ['https://t.me/channelname/123',             'tdl'],
  ['https://telegram.me/x/1',                  'tdl'],
  ['https://imgur.com/gallery/xyz',            'gallerydl'],
  ['https://x.com/user/status/1',              'gallerydl'],
  ['https://x.com/hashtag/FEETJOI?src=hashtag_click', 'gallerydl'],
  ['https://x.com/FeetOmegle43663?t=7k1bLwYzJ5aqMlyuHvk8QQ&s=09', 'gallerydl'],
  ['https://www.reddit.com/r/test/comments/abc/title/', 'reddit'],
  ['https://redd.it/abc',                      'reddit'],
  ['https://www.redgifs.com/watch/SomeClipId', 'redgifs'],
  ['https://www.redgifs.com/users/somecreator', 'redgifs'],
  ['https://vipergirls.to/threads/6777850-MyFav-Czechcasting-Model-Collection-Sets', 'gallerydl'],
  ['https://vipergirls.to/forum.php',          'gallerydl'],
  ['https://onlyfans.com/johndoe',             'ofscraper'],
  ['https://example.com/video.mp4',            'ytdlp'],
  ['ftp://example.com/foo',                    null],
  ['not a url',                                null],
];

for (const [url, expected] of cases) {
  test(`detect(${url}) → ${expected}`, () => {
    const a = detect(url, adapters);
    assert.equal(a ? a.name : null, expected);
  });
}

test('hint overschrijft priority', () => {
  const a = detect('https://imgur.com/gallery/xyz', adapters, { hint: 'ytdlp' });
  assert.equal(a.name, 'ytdlp');
});

test('hint die niet matcht gooit fout', () => {
  assert.throws(() => detect('ftp://x', adapters, { hint: 'ytdlp' }), /matcht deze URL niet/);
});

test('onbekende hint gooit fout', () => {
  assert.throws(() => detect('https://x', adapters, { hint: 'nope' }), /Onbekende adapter-hint/);
});
