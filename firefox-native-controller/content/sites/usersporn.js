// WEBDL site-config — usersporn.com
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['usersporn.com'] = {
  label: 'usersporn',
  platform: 'usersporn',

  pageType(path) {
    if (/^\/video\/\d+\/?$/.test(path)) return 'single';
    if (/^\/(videocat|search|tag|tags|category|categories|pornstar|model)\//i.test(path) || path === '/') return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/video\/\d+\/?$/.test(p),
      selector: 'a[href*="/video/"]',
      resolveUrl(rawHref) {
        try {
          const u = new URL(rawHref, window.location.href);
          // Strip tracking-params (Li, Lii, Lt, Sn, tid, sid, etc.) — alleen pad behouden
          const stripped = new URL(`${u.protocol}//${u.hostname}${u.pathname}`);
          if (!/^\/video\/\d+\/?$/.test(stripped.pathname)) return null;
          return stripped.toString();
        } catch (_) { return null; }
      },
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'usersporn', channel, title: '' }),
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
    },
  ],

  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      // usersporn paginatie: /<path>/<page>/ of /<path>?page=N
      u.searchParams.set('page', String(page));
      return u.toString();
    } catch (_) { return baseHref; }
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      // /videocat/<cat>/<sort> → category_<cat>
      if (segs[0] === 'videocat' && segs[1]) return `category_${segs[1]}`;
      if (segs[0] === 'search' && segs[1]) return `search_${segs[1]}`;
      if ((segs[0] === 'tag' || segs[0] === 'tags') && segs[1]) return `tag_${segs[1]}`;
      if ((segs[0] === 'category' || segs[0] === 'categories') && segs[1]) return `category_${segs[1]}`;
      if (segs[0] === 'pornstar' && segs[1]) return `pornstar_${segs[1]}`;
      if (segs[0] === 'video' && segs[1]) return `video_${segs[1]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'usersporn';
  },
};
