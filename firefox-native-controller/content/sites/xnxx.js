// WEBDL site-config — xnxx.com (yt-dlp native)
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['xnxx.com'] = {
  label: 'xnxx',
  platform: 'xnxx',

  pageType(path) {
    // /video-<id>/<slug> single, /search/<q>[/N] listing
    if (/^\/video-[a-z0-9]+\//i.test(path)) return 'single';
    if (/^\/(search|tags|porn|best|c|amateur-channels|pornstar-channels)\//i.test(path)) return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/video-[a-z0-9]+\//i.test(p),
      selector: 'a[href*="/video-"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'xnxx', channel, title: '' }),
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
    },
  ],

  // xnxx search-pagination: /search/<q>/<N> (N is 0-indexed, page1 = no suffix)
  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      const path = u.pathname.replace(/\/\d+\/?$/, '');
      u.pathname = path.replace(/\/?$/, '') + `/${page - 1}`;
      return u.toString();
    } catch (_) { return baseHref; }
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      // /search/<q>[/N] → search_<q>
      if (segs[0] === 'search' && segs[1]) return `search_${segs[1]}`;
      if (segs[0] === 'tags' && segs[1]) return `tag_${segs[1]}`;
      if (segs[0] === 'porn' && segs[1]) return `porn_${segs[1]}`;
      if (segs[0] === 'video-') {/* never */}
      // single video → video_<id> from /video-<id>/<slug>
      const m = segs[0] && segs[0].match(/^video-([a-z0-9]+)$/i);
      if (m) return `video_${m[1]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'xnxx';
  },
};
