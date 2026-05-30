// WEBDL site-config — tnaflix.com (yt-dlp native)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['tnaflix.com'] = {
  label: 'tnaflix',
  platform: 'tnaflix',

  pageType(path) {
    // /<category>/<slug>/video<id> single
    if (/\/video\d+\/?$/i.test(path)) return 'single';
    if (/^\/(search|category|tag|categories|tags|popular|new|recent)\//i.test(path) ||
        /^\/search/i.test(path)) return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /\/video\d+\/?$/i.test(p),
      selector: 'a[href*="/video"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'tnaflix', channel, title: '' }),
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
    },
  ],

  // tnaflix pagination: ?page=N
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
      // /search?what=<q>
      if (segs[0] === 'search' || u.pathname === '/search') {
        const q = (u.searchParams.get('what') || u.searchParams.get('q') || '').trim();
        return q ? `search_${q.replace(/\s+/g, '-')}` : 'tnaflix_search';
      }
      // single /<cat>/<slug>/video<id> → video_<id>
      const last = segs[segs.length - 1] || '';
      const vm = last.match(/^video(\d+)$/i);
      if (vm) return `video_${vm[1]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'tnaflix';
  },
};
