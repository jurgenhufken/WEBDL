// WEBDL site-config — darknessporn.com
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['darknessporn.com'] = {
  label: 'darknessporn',
  platform: 'darknessporn',

  pageType(path) {
    if (/^\/\d+-[a-z0-9-]+\/?$/i.test(path)) return 'single';
    if (/^\/(tag|search|category|categories)\//i.test(path)) return 'listing';
    if (/\/page\/\d+\/?$/i.test(path)) return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      // single video path: /<digits>-<slug>/
      match: (p) => /^\/\d+-[a-z0-9-]+\/?$/i.test(p) &&
                    !/\/page\/\d+\/?$/i.test(p) &&
                    !/^\/(tag|search|category|categories|page)\//i.test(p),
      // listing-page: alle a's met video-pattern in href
      selector: 'a[href]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'darknessporn', channel, title: '' }),
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
    },
  ],

  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      u.pathname = u.pathname.replace(/\/page\/\d+\/?$/i, '/').replace(/\/?$/, '/') + `page/${page}/`;
      return u.toString();
    } catch (_) { return baseHref; }
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const path = String(u.pathname || '').replace(/\/page\/\d+\/?$/i, '/');
      const segs = path.split('/').filter(Boolean);
      // /<id>-<slug>/ single video → video_<id>
      if (segs.length === 1 && /^\d+-/.test(segs[0])) {
        const m = segs[0].match(/^(\d+)-/);
        return m ? `video_${m[1]}` : segs[0];
      }
      // /tag/<X>/ etc
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'darknessporn';
  },
};
