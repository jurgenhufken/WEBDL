// WEBDL site-config — heavyfetish.com (zelfde patroon als footstockings, geen albums)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['heavyfetish.com'] = {
  label: 'heavyfetish',
  platform: 'heavyfetish',

  pageType(path) {
    if (/^\/videos\/\d+\/[^/]+\/?$/.test(path)) return 'single';
    const listingPrefixes = ['/search/', '/categories/', '/models/', '/channels/',
      '/playlists/', '/latest-updates', '/most-popular'];
    for (const p of listingPrefixes) if (path.startsWith(p)) return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/videos\/\d+\/[^/]+\/?$/.test(p),
      selector: 'div.list-videos a[href*="/videos/"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'heavyfetish', channel, title: '' }),
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
    },
  ],

  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      const pp = String(page).padStart(2, '0');
      u.searchParams.set('from_videos', pp);
      u.searchParams.set('from_albums', pp);
      return u.toString();
    } catch (_) { return baseHref; }
  },

  detectMaxPage(doc) {
    const root = doc || document;
    let max = 1;
    for (const a of root.querySelectorAll('a[data-parameters]')) {
      const m = (a.getAttribute('data-parameters') || '').match(/from_videos\+from_albums:(\d+)/);
      if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    }
    return max;
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      if (segs[0] === 'videos' && segs.length >= 3) return `videos_${segs[2]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'heavyfetish';
  },
};
