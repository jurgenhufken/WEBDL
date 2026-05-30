// WEBDL site-config — erome.com
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['erome.com'] = {
  label: 'erome',
  platform: 'erome',

  pageType(path) {
    if (/^\/a\/[A-Za-z0-9]+\/?$/.test(path)) return 'single';
    return 'listing';
  },

  itemTypes: [
    {
      name: 'album',
      match: (p) => /^\/a\/[A-Za-z0-9]+\/?$/.test(p),
      selector: 'a[href*="/a/"]',
      endpoint: '/api/erome/album',
      buildBody: (url, channel) => ({ url, channel }),
      singleLabel: '⬇ Download album (video+img)',
      listingNoun: 'albums',
      color: '#7c3aed',
    },
  ],

  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      u.searchParams.set('page', String(page));
      return u.toString();
    } catch (_) { return baseHref; }
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      const am = segs[0] === 'a' && segs[1];
      if (am) return `album_${segs[1]}`;
      if (segs[0] === 'search') {
        const q = (u.searchParams.get('q') || '').trim();
        return q ? `search_${q.replace(/\s+/g, '-')}` : 'erome_search';
      }
      if (segs.length === 1) return `user_${segs[0]}`;
    } catch (_) {}
    return 'erome';
  },
};
