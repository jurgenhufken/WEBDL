// WEBDL site-config — xfree.com (best-guess; 403 vanuit terminal, vergt browser-session)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['xfree.com'] = {
  label: 'xfree',
  platform: 'xfree',

  pageType(path) {
    if (/^\/video\//.test(path) || /^\/v\//.test(path) || /^\/watch\//.test(path)) return 'single';
    return 'listing';
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/(video|v|watch)\//.test(p),
      selector: 'a[href*="/video/"], a[href*="/v/"], a[href*="/watch"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'xfree', channel, title: '' }),
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
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
      const q = (u.searchParams.get('q') || '').trim();
      if (q) return `search_${q.replace(/\s+/g, '-')}`;
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      if (segs[0] === 'search' && segs[1]) return `search_${segs[1]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'xfree';
  },
};
