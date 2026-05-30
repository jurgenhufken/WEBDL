// WEBDL site-config — redtube.com (yt-dlp native)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['redtube.com'] = {
  label: 'redtube',
  platform: 'redtube',

  pageType(path, search) {
    // single: /<digits>
    if (/^\/\d+\/?$/.test(path)) return 'single';
    // listing: root met ?search= of /category/... /pornstar/... /tag/...
    if (path === '/' && /[?&]search=/.test(search)) return 'listing';
    if (/^\/(category|tag|tags|pornstar|categories|channel|search)\b/i.test(path)) return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/\d+\/?$/.test(p),
      selector: 'a[href^="/"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'redtube', channel, title: '' }),
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
      const q = (u.searchParams.get('search') || '').trim();
      if (q) return `search_${q.replace(/\s+/g, '-')}`;
      if (segs[0] === 'category' && segs[1]) return `category_${segs[1]}`;
      if ((segs[0] === 'tag' || segs[0] === 'tags') && segs[1]) return `tag_${segs[1]}`;
      if (segs[0] === 'pornstar' && segs[1]) return `pornstar_${segs[1]}`;
      // single /<digits>
      if (segs.length === 1 && /^\d+$/.test(segs[0])) return `video_${segs[0]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'redtube';
  },
};
