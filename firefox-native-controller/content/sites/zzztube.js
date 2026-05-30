// WEBDL site-config — zzztube.com (aggregator, best-guess)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['zzztube.com'] = {
  label: 'zzztube',
  platform: 'zzztube',

  pageType(path) {
    if (/^\/(watch|video|v)\//.test(path)) return 'single';
    return 'listing';
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/(watch|video|v)\//.test(p),
      selector: 'a[href*="/watch"], a[href*="/video/"], a[href*="/v/"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'zzztube', channel, title: '' }),
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
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'zzztube';
  },
};
