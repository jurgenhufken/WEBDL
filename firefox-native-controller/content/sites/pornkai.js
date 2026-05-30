// WEBDL site-config — pornkai.com (best-guess: tube met /watch/<id> of /v/<id>)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['pornkai.com'] = {
  label: 'pornkai',
  platform: 'pornkai',

  pageType(path, search) {
    if (/^\/(watch|video|v)\/?/.test(path) && (path !== '/videos' && path !== '/videos/')) return 'single';
    if (path === '/videos' || path === '/videos/' || /^\/(search|category|categories|tag|tags|pornstar)\//i.test(path)) return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/(watch|video|v)\//.test(p),
      selector: 'a[href*="/watch"], a[href*="/video/"], a[href*="/v/"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'pornkai', channel, title: '' }),
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
      if ((segs[0] === 'category' || segs[0] === 'categories') && segs[1]) return `category_${segs[1]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'pornkai';
  },
};
