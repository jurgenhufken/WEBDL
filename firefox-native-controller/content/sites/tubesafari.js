// WEBDL site-config — tubesafari.com (aggregator, eigen video-pages)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['tubesafari.com'] = {
  label: 'tubesafari',
  platform: 'tubesafari',

  pageType(path, search) {
    if (path === '/video' && /[?&]id=/.test(search)) return 'single';
    if (/^\/(search|category|tag|tags|categories)\//i.test(path) || path === '/') return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => p === '/video',
      selector: 'a[href*="/video?id="]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'tubesafari', channel, title: '' }),
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
      if ((segs[0] === 'category' || segs[0] === 'categories') && segs[1]) return `category_${segs[1]}`;
      if ((segs[0] === 'tag' || segs[0] === 'tags') && segs[1]) return `tag_${segs[1]}`;
      if (u.pathname === '/video') {
        const id = u.searchParams.get('id') || '';
        if (id) return `video_${id}`;
      }
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'tubesafari';
  },
};
