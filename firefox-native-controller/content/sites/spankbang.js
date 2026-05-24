// WEBDL site-config — spankbang.com (yt-dlp native)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['spankbang.com'] = {
  label: 'spankbang',
  platform: 'spankbang',

  pageType(path) {
    // /<id>/video/<slug> single
    if (/^\/[a-z0-9]+\/video\/[^/]+\/?$/i.test(path)) return 'single';
    if (/^\/(s|tag|category|categories|pornstar|model)\//i.test(path)) return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/[a-z0-9]+\/video\/[^/]+\/?$/i.test(p),
      selector: 'a[href*="/video/"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'spankbang', channel, title: '' }),
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
    },
  ],

  // spankbang pagination: /s/<q>/<page>/  of  /<listing-path>?p=<page>
  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      // Probeer pad-style /s/<q>/<page>/ als 'search'-pattern
      const segs = u.pathname.split('/').filter(Boolean);
      if (segs[0] === 's' && segs[1]) {
        u.pathname = `/s/${segs[1]}/${page}/`;
        return u.toString();
      }
      // Fallback: querystring ?p=N
      u.searchParams.set('p', String(page));
      return u.toString();
    } catch (_) { return baseHref; }
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      if (segs[0] === 's' && segs[1]) return `search_${segs[1]}`;
      if (segs[0] === 'tag' && segs[1]) return `tag_${segs[1]}`;
      if (segs[0] === 'pornstar' && segs[1]) return `pornstar_${segs[1]}`;
      if (segs[0] === 'category' && segs[1]) return `category_${segs[1]}`;
      // single /<id>/video/<slug> → video_<id>
      if (segs.length >= 3 && segs[1] === 'video') return `video_${segs[0]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'spankbang';
  },
};
