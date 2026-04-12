'use strict';
/**
 * Utils: Platform Detection — Pijler: Ingest
 * 
 * Detecteert platform uit URL. Pure functie, geen state.
 */

const PLATFORM_PATTERNS = [
  { pattern: /youtube\.com|youtu\.be/i, platform: 'youtube' },
  { pattern: /vimeo\.com/i, platform: 'vimeo' },
  { pattern: /twitch\.tv/i, platform: 'twitch' },
  { pattern: /twitter\.com|x\.com/i, platform: 'twitter' },
  { pattern: /reddit\.com|redd\.it/i, platform: 'reddit' },
  { pattern: /instagram\.com/i, platform: 'instagram' },
  { pattern: /tiktok\.com/i, platform: 'tiktok' },
  { pattern: /onlyfans\.com/i, platform: 'onlyfans' },
  { pattern: /patreon\.com/i, platform: 'patreon' },
  { pattern: /telegram\.org|t\.me/i, platform: 'telegram' },
  { pattern: /pornhub\.com/i, platform: 'pornhub' },
  { pattern: /xvideos\.com/i, platform: 'xvideos' },
  { pattern: /xhamster\.com/i, platform: 'xhamster' },
  { pattern: /imgur\.com/i, platform: 'imgur' },
  { pattern: /wikifeet\.com/i, platform: 'wikifeet' },
  { pattern: /wikifeetx\.com/i, platform: 'wikifeetx' },
  { pattern: /footfetishforum\.com/i, platform: 'footfetishforum' },
  { pattern: /kinky\.nl/i, platform: 'kinky' },
  { pattern: /aznudefeet\.com/i, platform: 'aznudefeet' },
];

function detectPlatform(url) {
  if (!url) return 'other';
  const u = String(url);
  for (const { pattern, platform } of PLATFORM_PATTERNS) {
    if (pattern.test(u)) return platform;
  }
  return 'other';
}

function deriveChannel(platform, url) {
  if (!url) return 'unknown';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);

    switch (platform) {
      case 'youtube':
        if (parts[0] === 'channel' || parts[0] === 'c' || parts[0] === '@') return parts[0] === '@' ? parts[0] : parts[1] || 'unknown';
        if (parts[0] && parts[0].startsWith('@')) return parts[0];
        return parts[1] || 'unknown';
      case 'twitter':
        return parts[0] ? `@${parts[0]}` : 'unknown';
      case 'reddit':
        if (parts[0] === 'r' || parts[0] === 'u') return `${parts[0]}/${parts[1] || ''}`;
        return parts[0] || 'unknown';
      case 'instagram':
        return parts[0] || 'unknown';
      case 'tiktok':
        return parts[0] && parts[0].startsWith('@') ? parts[0] : 'unknown';
      case 'onlyfans':
        return parts[0] || 'unknown';
      case 'patreon':
        return parts[0] === 'c' ? parts[1] || 'unknown' : parts[0] || 'unknown';
      default:
        return u.hostname.replace('www.', '') || 'unknown';
    }
  } catch (e) {
    return 'unknown';
  }
}

function deriveTitle(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || '').replace(/[-_]/g, ' ').slice(0, 120);
  } catch (e) {
    return '';
  }
}

module.exports = { detectPlatform, deriveChannel, deriveTitle, PLATFORM_PATTERNS };
