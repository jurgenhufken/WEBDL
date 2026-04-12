'use strict';
/**
 * Downloaders: Dispatcher — Pijler: Ingest
 * 
 * Routeert een download naar de juiste downloader op basis van platform/URL.
 * Elke downloader is een apart bestand in downloaders/.
 */
const gallerydl = require('./gallery-dl');
const ytdlp = require('./ytdlp');
const direct = require('./direct');

function initDispatcher(ctx) {

  // Welke downloader voor welk platform?
  const PLATFORM_DRIVERS = {
    'twitter':          'gallery-dl',
    'wikifeet':         'gallery-dl',
    'wikifeetx':        'gallery-dl',
    'pornpics':         'gallery-dl',
    'aznudefeet':       'gallery-dl',
    'instagram':        'gallery-dl',
    'reddit':           'gallery-dl',
    'imgur':             'gallery-dl',
    'youtube':          'yt-dlp',
    'vimeo':            'yt-dlp',
    'twitch':           'yt-dlp',
    'pornhub':          'yt-dlp',
    'xvideos':          'yt-dlp',
    'xhamster':         'yt-dlp',
    'tiktok':           'yt-dlp',
  };

  async function dispatch(downloadId, url, platform, channel, title, metadata) {
    const driver = PLATFORM_DRIVERS[platform] || detectDriver(url);

    console.log(`[dispatch] #${downloadId} → ${driver} (${platform})`);

    switch (driver) {
      case 'gallery-dl':
        return gallerydl.download(ctx, downloadId, url, platform, channel, title, metadata);
      case 'yt-dlp':
        return ytdlp.download(ctx, downloadId, url, platform, channel, title, metadata);
      case 'direct':
        return direct.download(ctx, downloadId, url, platform, channel, title, metadata);
      default:
        // Fallback: probeer yt-dlp (die kan het meeste)
        return ytdlp.download(ctx, downloadId, url, platform, channel, title, metadata);
    }
  }

  function detectDriver(url) {
    if (!url) return 'yt-dlp';
    const u = String(url).toLowerCase();
    // Direct file URL?
    if (/\.(mp4|mov|webm|mkv|avi|jpg|jpeg|png|gif|webp|mp3|m4a)(\?|$)/i.test(u)) {
      return 'direct';
    }
    return 'yt-dlp';
  }

  return { dispatch };
}

module.exports = { initDispatcher };
