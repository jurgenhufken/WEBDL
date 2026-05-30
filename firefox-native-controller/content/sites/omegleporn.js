// WEBDL site-config — omegleporn.to (KVS tube engine, vergelijkbaar met footstockings)
// Pagination via ?from_videos=NN (KVS-standaard). Single video = /videos/<id>/<slug>/.
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['omegleporn.to'] = {
  label: 'omegleporn',
  platform: 'omegleporn',

  pageType(path) {
    if (/^\/videos\/\d+\/[^/]+\/?$/.test(path)) return 'single';
    const listingPrefixes = [
      '/videos/', '/search/', '/categories/', '/models/', '/channels/',
      '/playlists/', '/latest-updates', '/most-popular', '/top-rated',
      '/upcoming', '/tags/',
    ];
    for (const p of listingPrefixes) if (path === p || path.startsWith(p)) return 'listing';
    if (path === '/' || path === '') return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/videos\/\d+\/[^/]+\/?$/.test(p),
      selector: 'div.list-videos a[href*="/videos/"], a.item[href*="/videos/"], a[href*="/videos/"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'omegleporn', channel, title: '' }),
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
    },
  ],

  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      const pp = String(page).padStart(2, '0');
      u.searchParams.set('from_videos', pp);
      return u.toString();
    } catch (_) { return baseHref; }
  },

  detectMaxPage(doc) {
    const root = doc || document;
    let max = 1;
    // Variant 1: data-parameters="from_videos:N" (KVS)
    for (const a of root.querySelectorAll('a[data-parameters]')) {
      const m = (a.getAttribute('data-parameters') || '').match(/from_videos:(\d+)/);
      if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    }
    // Variant 2: <a href> met ?from_videos=NN
    for (const a of root.querySelectorAll('a[href*="from_videos="]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/from_videos=(\d+)/);
      if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    }
    // Variant 3: pagination-container met genummerde anchor-text
    const containers = root.querySelectorAll(
      '.pagination, .pages, .pagi, nav.pagination, ul.pagination, div[class*="pagi"]'
    );
    const seedRoots = containers.length ? containers : [root];
    for (const cont of seedRoots) {
      for (const a of cont.querySelectorAll('a')) {
        const txt = (a.textContent || '').trim();
        const m = txt.match(/^0?(\d{1,5})$/);
        if (m) { const n = parseInt(m[1], 10); if (n > max && n < 100000) max = n; }
      }
    }
    // Variant 4: "Last"/"»" link met ?from_videos=NN
    for (const a of root.querySelectorAll('a')) {
      const txt = (a.textContent || '').trim().toLowerCase();
      if (txt !== 'last' && txt !== '»' && txt !== '>>') continue;
      const href = a.getAttribute('href') || '';
      const m = href.match(/from_videos=(\d+)/);
      if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    }
    // Variant 5: "Page X of Y" text fallback
    const bodyText = (root.body?.textContent || root.textContent || '');
    const m5 = bodyText.match(/Page\s+\d+\s+of\s+(\d+)/i);
    if (m5) { const n = parseInt(m5[1], 10); if (n > max) max = n; }
    return max;
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      if (segs[0] === 'videos' && segs.length >= 3) return `videos_${segs[2]}`;
      if (segs[0] === 'models' && segs[1]) return `model_${segs[1]}`;
      if (segs[0] === 'channels' && segs[1]) return `channel_${segs[1]}`;
      if (segs[0] === 'categories' && segs[1]) return `category_${segs[1]}`;
      if (segs[0] === 'tags' && segs[1]) return `tag_${segs[1]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'omegleporn';
  },
};
