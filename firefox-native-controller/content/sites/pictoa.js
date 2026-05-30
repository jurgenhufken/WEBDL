// WEBDL site-config — pictoa.com (image-galleries)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['pictoa.com'] = {
  label: 'pictoa',
  platform: 'pictoa',

  pageType(path) {
    // /albums/<slug>-<id>.html single album
    if (/^\/albums\/[^/]+-\d+\.html$/.test(path)) return 'single';
    // /albums/<slug>-<id>/<photo>.html → behandel ook als single (download het volledige album)
    if (/^\/albums\/[^/]+-\d+\/\d+\.html$/.test(path)) return 'single';
    // Listings
    if (/^\/(s|search|category|categories|tag|tags|pornstar)\//i.test(path)) return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'album',
      match: (p) => /^\/albums\/[^/]+-\d+\.html$/.test(p),
      selector: 'a[href*="/albums/"][href$=".html"]',
      endpoint: '/api/pictoa/album',
      buildBody: (url, channel) => ({ url, channel }),
      singleLabel: '⬇ Download dit album',
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
      if (segs[0] === 'albums' && segs[segs.length - 1].endsWith('.html')) {
        const m = segs[segs.length - 1].match(/-(\d+)\.html$/);
        if (m) return `album_${m[1]}`;
      }
      if (segs[0] === 's' && segs[1]) return `search_${segs[1]}`;
      if (segs[0] === 'pornstar' && segs[1]) return `pornstar_${segs[1]}`;
      if ((segs[0] === 'category' || segs[0] === 'categories') && segs[1]) return `category_${segs[1]}`;
      if ((segs[0] === 'tag' || segs[0] === 'tags') && segs[1]) return `tag_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'pictoa';
  },
};
