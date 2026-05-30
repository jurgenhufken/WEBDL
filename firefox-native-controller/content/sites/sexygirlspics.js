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

  // 2026-05-30: tijdelijk lege itemTypes — sexygirlspics albums (/pics/<slug>/)
  // zijn aggregator-pages die via yt-dlp 'Unsupported URL' geven. Wacht op
  // dedicated album-resolver (scripts/sexygirlspics_album_dl.py + /api/sexygirlspics/album
  // endpoint). Tot dan: geen queue om error-stream te voorkomen.
  // Site-engine zal "Deze pagina (leeg)" / "Alle pages" tonen zonder items.
  itemTypes: [],

  // 2026-05-30: extraButtons als tussenoplossing zodat panel niet leeg is.
  // Quarantaine blijft (itemTypes:[]) maar gebruiker krijgt scannen + inzicht.
  extraButtons: [
    {
      label: '🔍 Toon items op pagina',
      color: '#1565C0',
      match() { return true; },
      async onClick(ctx) {
        try {
          const links = Array.from(document.querySelectorAll('a[href*="/pics/"], a[href*="/pic/"], a[href*="/galleries/"], a[href*="/gallery/"]'))
            .map(a => a.href).filter(Boolean);
          const unique = Array.from(new Set(links)).filter(u => /sexygirlspics\.com/i.test(u));
          console.log(`[WEBDL sexygirlspics] ${unique.length} album-links op pagina:`, unique.slice(0, 10));
          if (unique.length === 0) return { text: '0 albums gevonden' };
          return { text: `${unique.length} albums (console)` };
        } catch (e) { return { text: '✗ Scan-fout' }; }
      },
    },
    {
      label: '🧵 Alle pages tellen',
      color: '#0ea5e9',
      match() { return true; },
      async onClick(ctx) {
        try {
          const cfg = window.WEBDL_SITES['sexygirlspics.com'];
          const maxP = cfg && cfg.detectMaxPage ? cfg.detectMaxPage(document) : 1;
          if (!maxP || maxP <= 1) return { text: 'Geen pagination gevonden' };
          return { text: `Site heeft ${maxP} pages` };
        } catch (e) { return { text: '✗ Pages-detect fout' }; }
      },
    },
    {
      label: '📥 Download dit album',
      color: '#d9272e',
      match() { return /\/pics\/[a-z0-9-]+-\d+\/?$/i.test(window.location.pathname); },
      async onClick() {
        try {
          const r = await fetch('http://localhost:35729/api/sexygirlspics/album', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: window.location.href.split('#')[0].split('?')[0] }),
          });
          const body = await r.json().catch(() => ({}));
          if (r.ok && body.success !== false) {
            return { text: `✓ album gequeued (pid ${body.pid || '?'})` };
          }
          return { text: `✗ ${body.error || ('HTTP ' + r.status)}` };
        } catch (e) {
          return { text: `✗ ${String(e.message || e).slice(0, 60)}` };
        }
      },
    },
    {
      label: '🧵 Walk hele search/category (alle albums)',
      color: '#0ea5e9',
      match() {
        // Listing-types: /search/<term>/, /category/<cat>/, /tag/<tag>/, /pornstars/<name>/
        return /^\/(search|category|categories|tag|tags|pornstars)\/[a-z0-9-]+/i.test(window.location.pathname);
      },
      async onClick() {
        try {
          const r = await fetch('http://localhost:35729/api/sexygirlspics/album', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: window.location.href.split('#')[0] }),
          });
          const body = await r.json().catch(() => ({}));
          if (r.ok && body.success !== false) {
            return { text: `✓ listing walk gestart (pid ${body.pid || '?'})` };
          }
          return { text: `✗ ${body.error || ('HTTP ' + r.status)}` };
        } catch (e) {
          return { text: `✗ ${String(e.message || e).slice(0, 60)}` };
        }
      },
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
