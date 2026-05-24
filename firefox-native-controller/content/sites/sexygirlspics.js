// WEBDL site-config — sexygirlspics.com (image-galleries, best-guess)
// Site lijkt op pictoa-stijl gallery aggregator. Pattern onbekend zonder
// browser-DOM; gebruik permissive selectors die we live finetunen.
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['sexygirlspics.com'] = {
  label: 'sexygirlspics',
  platform: 'sexygirlspics',

  pageType(path) {
    // /albums/<X>, /pics/<X>, /gallery/<X>, /<id>/<slug>/ = single album
    if (/^\/(albums?|pics?|gallery|galleries)\//i.test(path)) return 'single';
    if (/^\/\d+\/[a-z0-9-]+\/?$/i.test(path)) return 'single';
    return 'listing';
  },

  itemTypes: [
    {
      name: 'album',
      match: (p) => /^\/(albums?|pics?|gallery|galleries)\//i.test(p) || /^\/\d+\/[a-z0-9-]+\/?$/i.test(p),
      selector: 'a[href*="/album"], a[href*="/pics/"], a[href*="/gallery"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'sexygirlspics', channel, title: '' }),
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
      if (segs[0] === 'search' && segs[1]) return `search_${segs[1]}`;
      if (segs[0] === 'pornstars' && segs[1]) return `pornstar_${segs[1]}`;
      if ((segs[0] === 'category' || segs[0] === 'categories') && segs[1]) return `category_${segs[1]}`;
      if ((segs[0] === 'tag' || segs[0] === 'tags') && segs[1]) return `tag_${segs[1]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'sexygirlspics';
  },
};
