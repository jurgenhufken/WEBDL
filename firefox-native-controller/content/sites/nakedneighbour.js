// WEBDL site-config — nakedneighbour.com (best-guess, generic tube)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['nakedneighbour.com'] = {
  label: 'nakedneighbour',
  platform: 'nakedneighbour',

  pageType(path) {
    // Best-guess: slug-style URLs als single (zoals /amateur-bitches-having-fun)
    // Listings op root + category-paths
    if (/^\/[a-z0-9-]+\/?$/i.test(path) && path !== '/' && !/^\/(category|categories|tag|tags|search|page)\//i.test(path)) return 'single';
    return 'listing';
  },

  itemTypes: [
    {
      name: 'video',
      // Match alle slug-paths uitgezonderd listing-paths
      match: (p) => /^\/[a-z0-9-]+\/?$/i.test(p) && !/^\/(category|categories|tag|tags|search|page|videos|video)\//i.test(p),
      selector: 'a[href^="/"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'nakedneighbour', channel, title: '' }),
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
      if ((segs[0] === 'category' || segs[0] === 'categories') && segs[1]) return `category_${segs[1]}`;
      if ((segs[0] === 'tag' || segs[0] === 'tags') && segs[1]) return `tag_${segs[1]}`;
      if (segs[0] === 'search' && segs[1]) return `search_${segs[1]}`;
      if (segs.length === 1) return segs[0];
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
    } catch (_) {}
    return 'nakedneighbour';
  },
};
