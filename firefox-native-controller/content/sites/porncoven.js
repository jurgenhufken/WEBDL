// WEBDL site-config — porncoven.com (vBulletin forum, zoals vipergirls/phun)
//
// Threads bevatten posts met links naar image-hosts (imagebam, imagetwist,
// imgbox, k2s, etc.). Engine extract die uit div.postbody en stuurt elke
// URL naar /download. Server detecteert host (imagebam/k2s/...) en routeert.
//
// Channel-strategie: thread_<id> zodat alle items van 1 thread bij elkaar
// in gallery groeperen.
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['porncoven.com'] = {
  label: 'porncoven',
  platform: 'porncoven',

  pageType(path) {
    if (/^\/threads\/\d+-/.test(path)) return 'listing';
    if (/^\/forumdisplay\.php/.test(path)) return 'listing';
    if (/^\/forums?\//.test(path)) return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'image',
      // Match alles wat eindigt op image/video/archive-extensie
      match: (p) => /\.(jpe?g|png|gif|webp|bmp|mp4|webm|mov|m4v|zip|rar|7z)$/i.test(p),
      // Alleen links binnen post-bodies (skip menu/sidebar/footer)
      selector: 'div.postbody a[href], blockquote.postcontent a[href], div.postcontent a[href]',
      endpoint: '/download',
      // platform leeg → server detectPlatform op image-host URL (imagebam etc.)
      buildBody: (url, channel) => ({ url, channel, title: '' }),
      singleLabel: '⬇ Download thread (alle media)',
      listingNoun: 'media',
      color: '#2196F3',
    },
    {
      name: 'fileshare',
      // K2S, keep2share, rapidgator, etc. (geen image-extensie, host-based)
      match: (p) => true,
      selector: 'div.postbody a[href*="k2s.cc"], div.postbody a[href*="keep2share.cc"], div.postbody a[href*="rapidgator.net"], blockquote.postcontent a[href*="k2s.cc"], blockquote.postcontent a[href*="keep2share.cc"], div.postcontent a[href*="k2s.cc"], div.postcontent a[href*="keep2share.cc"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, channel, title: '' }),
      singleLabel: '⬇ Download thread (file-shares)',
      listingNoun: 'files',
      color: '#10b981', // groen = K2S/rapidgator
    },
  ],

  // Pagination: /threads/<id>-<slug>/page<N>
  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      // Strip eventuele bestaande /page<N>
      const path = u.pathname.replace(/\/page\d+\/?$/, '');
      u.pathname = path.replace(/\/?$/, '') + `/page${page}`;
      return u.toString();
    } catch (_) { return baseHref; }
  },

  // Hoogste pagenum uit pagination-links lezen
  detectMaxPage(doc) {
    const root = doc || document;
    let max = 1;
    for (const a of root.querySelectorAll('a[href*="/page"]')) {
      const m = (a.getAttribute('href') || '').match(/\/page(\d+)/);
      if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    }
    return max;
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      // /threads/<id>-<slug>[/pageN]
      if (segs[0] === 'threads' && segs[1]) {
        const m = segs[1].match(/^(\d+)/);
        if (m) return `thread_${m[1]}`;
      }
      // /forums/<id>-<slug>
      if (segs[0] === 'forums' && segs[1]) {
        const m = segs[1].match(/^(\d+)/);
        if (m) return `forum_${m[1]}`;
      }
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'porncoven';
  },
};
