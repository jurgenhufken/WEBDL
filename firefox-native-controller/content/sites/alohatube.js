// WEBDL site-config — alohatube.com
//
// Alohatube is een redirect-aggregator: GEEN eigen video-pages, alle
// items zijn /ktm/view.cgi?gid=N&u=<external-host-URL>. yt-dlp doet de
// echte download op de externe host (bravotube, videotxxx, etc.).
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['alohatube.com'] = {
  label: 'alohatube',
  platform: 'alohatube',

  pageType(path) {
    // Geen eigen single-pages. Behandel alles als listing (panel verschijnt overal).
    return 'listing';
  },

  itemTypes: [
    {
      name: 'video',
      match: () => true, // resolveUrl filtert al
      selector: 'a[href*="/ktm/view.cgi"][href*="u="]',
      resolveUrl(rawHref) {
        try {
          const u = new URL(rawHref, window.location.href);
          if (!/^\/ktm\/view\.cgi/.test(u.pathname)) return null;
          const ext = u.searchParams.get('u');
          if (!ext) return null;
          // Strip aloha-promo querystring suffixen (utm_source=aloha, promoid, etc.)
          // door alleen de URL te accepteren zonder bewerking — yt-dlp negeert extra params.
          if (!/^https?:\/\//i.test(ext)) return null;
          return ext;
        } catch (_) { return null; }
      },
      endpoint: '/download',
      // Geef GEEN platform mee → server detecteert echte host (bravotube etc.)
      buildBody: (url, channel) => ({ url, channel, title: '' }),
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
    },
  ],

  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      // alohatube paginatie: <category>/<page>.html of ?page=N
      if (/\.html$/.test(u.pathname)) {
        u.pathname = u.pathname.replace(/\.html$/, `/${page}.html`);
        return u.toString();
      }
      u.searchParams.set('page', String(page));
      return u.toString();
    } catch (_) { return baseHref; }
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      // /voyeur.html → category_voyeur
      if (segs.length >= 1 && /\.html$/.test(segs[0])) return `category_${segs[0].replace(/\.html$/, '')}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'alohatube';
  },
};
