// WEBDL site-config — pornzog.com (aggregator, eigen video-pages via /feedback?ref=URL)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['pornzog.com'] = {
  label: 'pornzog',
  platform: 'pornzog',

  pageType(path) {
    if (/^\/video\/\d+\/[^/]+\/?$/.test(path)) return 'single';
    if (/^\/(search|tag|tags|category|categories)\//i.test(path) || path === '/') return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/video\/\d+\/[^/]+\/?$/.test(p),
      // Listings tonen alleen /feedback?ref=<echte video-URL>; extract die.
      selector: 'a[href*="/feedback"][href*="ref=https"]',
      resolveUrl(rawHref) {
        try {
          const u = new URL(rawHref, window.location.href);
          const ref = u.searchParams.get('ref');
          if (!ref) return null;
          // Alleen pornzog-eigen video-URLs (geen externe redirects)
          const pu = new URL(ref);
          if (!pu.hostname.toLowerCase().endsWith('pornzog.com')) return null;
          if (!/^\/video\/\d+\/[^/]+\/?$/.test(pu.pathname)) return null;
          return ref;
        } catch (_) { return null; }
      },
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'pornzog', channel, title: '' }),
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
      const q = (u.searchParams.get('s') || '').trim();
      if (q) return `search_${q.replace(/\s+/g, '-')}`;
      if (segs[0] === 'search' && segs[1]) return `search_${segs[1]}`;
      if ((segs[0] === 'tag' || segs[0] === 'tags') && segs[1]) return `tag_${segs[1]}`;
      if ((segs[0] === 'category' || segs[0] === 'categories') && segs[1]) return `category_${segs[1]}`;
      if (segs[0] === 'video' && segs[1]) return `video_${segs[1]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'pornzog';
  },
};
