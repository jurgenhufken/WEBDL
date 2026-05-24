// WEBDL site-config — darknetvideos.com
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['darknetvideos.com'] = {
  label: 'darknetvideos',
  platform: 'darknetvideos',

  pageType(path, search) {
    if (path === '/video.php' && /[?&]id=\d+/.test(search)) return 'single';
    if (path === '/index.php' || path === '/') return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => p === '/video.php',
      selector: 'div.videobox a[href*="video.php?id="]',
      endpoint: '/api/darknetvideos/video',
      buildBody: (url, channel) => ({ url, channel }),
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
    },
  ],

  // Darknetvideos: ?side=N (N=page-1)
  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      u.searchParams.set('side', String(page - 1));
      return u.toString();
    } catch (_) { return baseHref; }
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const qs = u.searchParams;
      const search = qs.get('search');
      if (search) return `search_${search.replace(/\s+/g, '-')}`;
      const id = qs.get('id');
      if (id) return `video_${id}`;
    } catch (_) {}
    return 'darknetvideos';
  },
};
