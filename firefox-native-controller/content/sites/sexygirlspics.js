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
      // 2026-05-30 v2: revert naar ?page=N. Eerdere /page/N/ pad-based wijziging
      // werkte niet zoals verwacht (sexygirlspics serveert mogelijk via een
      // andere route op pad-based). Querystring is robuust gebleken.
      u.searchParams.set('page', String(page));
      return u.toString();
    } catch (_) { return baseHref; }
  },

  // 2026-05-30: detectMaxPage ontbrak — defaultDetectMaxPage gaf Infinity,
  // counter toonde geen "/N" + stream-mode brak vroeg bij consecutiveEmpty.
  // Strategie: Last-link href + tekstuele page-numbers in pagination-zone.
  detectMaxPage(doc) {
    const root = doc || document;
    let max = 1;
    for (const a of root.querySelectorAll('a')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/page\/(\d+)\/?(?:[?#]|$)/) || href.match(/[?&]page=(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > max && n < 100000) max = n;
      }
    }
    const containers = root.querySelectorAll('.pagination, .pages, .pagi, nav.pagination, ul.pagination, div[class*="pagi"]');
    const seedRoots = containers.length ? containers : [root];
    for (const cont of seedRoots) {
      for (const el of cont.querySelectorAll('a, span')) {
        const txt = (el.textContent || '').trim();
        const m = txt.match(/^0?(\d{1,5})$/);
        if (m) { const n = parseInt(m[1], 10); if (n > max && n < 100000) max = n; }
      }
    }
    return max;
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
