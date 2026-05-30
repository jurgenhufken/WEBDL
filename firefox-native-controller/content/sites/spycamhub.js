// WEBDL site-config — spycamhub.net (voyeur, best-guess)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['spycamhub.net'] = {
  label: 'spycamhub',
  platform: 'spycamhub',

  pageType(path) {
    if (/^\/(video|v|watch)\//.test(path)) return 'single';
    return 'listing';
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/(video|v|watch)\//.test(p),
      selector: 'a[href*="/video/"], a[href*="/v/"], a[href*="/watch"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'spycamhub', channel, title: '' }),
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
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      if (segs[0] === 'search' && segs[1]) return `search_${segs[1]}`;
      if ((segs[0] === 'category' || segs[0] === 'categories') && segs[1]) return `category_${segs[1]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'spycamhub';
  },
};
