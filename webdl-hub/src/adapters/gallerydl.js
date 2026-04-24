// src/adapters/gallerydl.js — gallery-dl adapter (imgur, twitter, pixiv, danbooru, etc.).
'use strict';

const { defineAdapter } = require('./base');
const { collectOutputsRecursive } = require('./_fs');

// gallery-dl ondersteunt honderden sites; lijst van extractor-hosts is te
// groot. We kiezen voor de bekendste image/board sites waar we gallery-dl
// expliciet willen gebruiken i.p.v. yt-dlp. Voor de rest is yt-dlp de default.
const HOSTS = [
  'imgur.com', 'flickr.com', 'deviantart.com', 'pixiv.net',
  'danbooru.donmai.us', 'gelbooru.com', 'rule34.xxx', 'e621.net',
  '4chan.org', 'kemono.su', 'coomer.su', 'tumblr.com',
  'pinterest.com', 'bsky.app', 'twitter.com', 'x.com', 'mastodon.social',
];

function hostMatches(hostname) {
  const h = hostname.toLowerCase();
  return HOSTS.some((d) => h === d || h.endsWith('.' + d));
}

function matches(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return hostMatches(u.hostname);
  } catch { return false; }
}

function plan(url, opts = {}) {
  // -D <cwd> zet álle files direct in onze jobdir (geen sub-mappen per site).
  // -q = quiet, -v geeft één regel per bestand voor progress.
  const args = [
    '--no-colors',
    '-D', opts.cwd,
    '-o', 'output.progress=true',
    url,
  ];
  return { cmd: 'gallery-dl', args, cwd: opts.cwd, env: {} };
}

// gallery-dl schrijft per file een regel "./pad/naar/bestand.ext" op stdout
// bij succes. Geen globale %-progress beschikbaar, dus we tellen files.
// parseProgress levert null (UI blijft op 0% maar files verschijnen wel).
function parseProgress(_line) { return null; }

module.exports = defineAdapter({
  name: 'gallerydl',
  priority: 70,
  matches,
  plan,
  parseProgress,
  collectOutputs: collectOutputsRecursive,
});
