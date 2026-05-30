// src/adapters/gallerydl.js — gallery-dl adapter (imgur, twitter, pixiv, danbooru, etc.).
'use strict';

const fs = require('node:fs');
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
  'instagram.com', 'vipergirls.to', 'viper.to',
];

function galleryDlCommand() {
  const configured = String(process.env.WEBDL_GALLERYDL || '').trim();
  if (configured) return configured;
  const userLocal = '/Users/jurgen/.local/bin/gallery-dl';
  if (fs.existsSync(userLocal)) return userLocal;
  return 'gallery-dl';
}

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

function isTwitterUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com';
  } catch {
    return false;
  }
}

function normalizeGalleryDlUrl(url) {
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'viper.to' || host.endsWith('.viper.to')) {
      u.hostname = 'vipergirls.to';
    }
    if (u.hostname.toLowerCase().replace(/^www\./, '') === 'vipergirls.to') {
      const m = u.pathname.match(/^\/threads\/(\d+)(-[^/?#]+)?(?:\/page\d+)?\/?$/i);
      if (m) {
        u.pathname = `/threads/${m[1]}${m[2] || ''}`;
        u.search = '';
        u.hash = '';
      }
    }
    const twitterHost = u.hostname.toLowerCase().replace(/^www\./, '');
    if ((twitterHost === 'x.com' || twitterHost === 'twitter.com' || twitterHost === 'mobile.twitter.com') && /^\/hashtag\/[^/?#]+\/?$/i.test(u.pathname)) {
      u.hostname = 'x.com';
      u.search = '';
      u.hash = '';
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString();
  } catch {}
  return url;
}

function plan(url, opts = {}) {
  const targetUrl = normalizeGalleryDlUrl(url);
  // -D <cwd> zet álle files direct in onze jobdir (geen sub-mappen per site).
  // -q = quiet, -v geeft één regel per bestand voor progress.
  const args = [
    '--no-colors',
    '-D', opts.cwd,
    '--cookies-from-browser', process.env.WEBDL_GALLERYDL_BROWSER_COOKIES || 'firefox',
    '-o', 'output.progress=true',
    '--write-metadata',
    '--write-info-json',
  ];
  if (isTwitterUrl(targetUrl)) {
    args.push(
      '-o', 'conversations=true',
      '-o', 'replies=true',
      '-o', 'retweets=true',
      '-o', 'quoted=true',
      '-o', 'pinned=true',
      '-o', 'videos=true',
    );
  }
  args.push(targetUrl);
  return {
    cmd: galleryDlCommand(),
    args,
    cwd: opts.cwd,
    env: {},
    timeoutMs: Number.parseInt(process.env.WEBDL_GALLERYDL_TIMEOUT_MS || String(20 * 60 * 1000), 10),
    idleTimeoutMs: Number.parseInt(process.env.WEBDL_GALLERYDL_IDLE_TIMEOUT_MS || String(120 * 1000), 10),
  };
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
