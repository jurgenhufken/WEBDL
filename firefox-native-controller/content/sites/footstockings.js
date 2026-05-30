// WEBDL site-config — footstockings.com
window.WEBDL_SITES = window.WEBDL_SITES || {};
window.WEBDL_SITES['footstockings.com'] = {
  label: 'footstockings',
  platform: 'footstockings',

  pageType(path /*, search */) {
    if (/^\/videos\/\d+\/[^/]+\/?$/.test(path)) return 'single';
    if (/^\/albums\/\d+\/[^/]+\/?$/.test(path)) return 'single';
    // 2026-05-30: /members/<page>/<username> toegevoegd — gebruiker-pagina
    // met videos + albums + channels + playlists secties tegelijk.
    const listingPrefixes = ['/search/', '/categories/', '/models/', '/channels/',
      '/playlists/', '/latest-updates', '/most-popular', '/albums/categories/',
      '/albums/', '/members/'];
    for (const p of listingPrefixes) if (path.startsWith(p)) return 'listing';
    return null;
  },

  itemTypes: [
    {
      name: 'video',
      match: (p) => /^\/videos\/\d+\/[^/]+\/?$/.test(p),
      selector: 'div.list-videos a[href*="/videos/"]',
      endpoint: '/download',
      buildBody: (url, channel) => ({ url, platform: 'footstockings', channel, title: '' }),
      singleLabel: '⬇ Download deze video',
      listingNoun: 'videos',
      color: '#2196F3',
    },
    {
      name: 'album',
      match: (p) => /^\/albums\/\d+\/[^/]+\/?$/.test(p),
      selector: 'div.list-albums a[href*="/albums/"]',
      endpoint: '/api/footstockings/album',
      buildBody: (url, channel) => ({ url, channel }),
      singleLabel: '⬇ Download dit album',
      listingNoun: 'albums',
      color: '#7c3aed',
    },
  ],

  paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      const pp = String(page).padStart(2, '0');
      u.searchParams.set('from_videos', pp);
      u.searchParams.set('from_albums', pp);
      return u.toString();
    } catch (_) { return baseHref; }
  },

  detectMaxPage(doc) {
    const root = doc || document;
    let max = 1;
    // Variant 1 (oud): data-parameters="from_videos+from_albums:N"
    for (const a of root.querySelectorAll('a[data-parameters]')) {
      const m = (a.getAttribute('data-parameters') || '').match(/from_videos\+from_albums:(\d+)/);
      if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    }
    // Variant 2: <a href> met ?from_videos=NN of ?from_albums=NN
    for (const a of root.querySelectorAll('a[href*="from_videos="], a[href*="from_albums="]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/from_(?:videos|albums)=(\d+)/);
      if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    }
    // Variant 3: footstockings huidige stijl — <a href="#videos">02</a>, <a>03</a>...
    // page-nummer staat in textContent. JS-driven pagination, geen page in URL.
    // Scope: alleen <a>'s in een pagination-container om random "08" cijfers
    // op de page te vermijden.
    const paginationContainers = root.querySelectorAll(
      '.pagination, .pages, .pagi, nav.pagination, ul.pagination, div[class*="pagi"]'
    );
    const seedRoots = paginationContainers.length ? paginationContainers : [root];
    for (const cont of seedRoots) {
      for (const a of cont.querySelectorAll('a')) {
        const txt = (a.textContent || '').trim();
        const m = txt.match(/^0?(\d{1,4})$/);
        if (m) { const n = parseInt(m[1], 10); if (n > max && n < 10000) max = n; }
      }
    }
    // 2026-05-30: fallback via "Last"-link tekst — footstockings pagination
    // toont "First ... 09 10 11 ... Last" en "Last" heeft soms href met page.
    for (const a of root.querySelectorAll('a')) {
      const txt = (a.textContent || '').trim().toLowerCase();
      if (txt !== 'last' && txt !== '»' && txt !== '>>') continue;
      const href = a.getAttribute('href') || '';
      const m = href.match(/(?:from_videos|from_albums|page)=(\d+)/i);
      if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    }
    // 2026-05-30 NIEUW: heuristic via pagina-titel "X's Videos (N)" — N is totaal
    // items, gedeeld door ~30 per page = geschatte max. Pakt het echte aantal
    // ipv alleen zichtbare pagination-window. Werkt voor /members/ + listings.
    const bodyText = (root.body?.textContent || root.textContent || '');
    const itemsPerPage = 30; // footstockings standaard
    let estMax = 0;
    for (const m of bodyText.matchAll(/(?:Videos|Albums)\s*\((\d+(?:[\s,]\d+)*)\)/gi)) {
      const total = parseInt(String(m[1]).replace(/[\s,]/g, ''), 10);
      if (Number.isFinite(total) && total > 0) {
        const pages = Math.ceil(total / itemsPerPage);
        if (pages > estMax) estMax = pages;
      }
    }
    if (estMax > max) max = estMax;
    return max;
  },

  deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      // 2026-05-30: /members/<page>/<username> → channel = member_<username>
      // zodat downloads gegroepeerd worden onder de member, niet de
      // pagina-volgorde.
      if (segs[0] === 'members' && segs.length >= 3 && segs[2]) {
        return `member_${segs[2]}`;
      }
      if (segs[0] === 'members' && segs.length >= 2 && segs[1]) {
        // Soms /members/<username> direct zonder page-nummer
        return `member_${segs[1]}`;
      }
      if ((segs[0] === 'videos' || segs[0] === 'albums') && segs.length >= 3) return `${segs[0]}_${segs[2]}`;
      if (segs[0] === 'albums' && segs[1] === 'categories' && segs[2]) return `albums_categories_${segs[2]}`;
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'footstockings';
  },
};
