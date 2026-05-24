// WEBDL · site-engine.js — generieke download-UI voor alle ondersteunde sites.
//
// Werking:
//   1. content/sites/<host>.js scripts registreren config in window.WEBDL_SITES[host]
//   2. site-engine.js (laatst geladen) leest WEBDL_SITES[currentHost]
//   3. zo niet aanwezig → niets doen
//   4. zo wel → render paneel met juiste knoppen op basis van pageType
//
// Config-shape (window.WEBDL_SITES['<host>']):
//   {
//     label: 'erome',                       // header-text in paneel
//     platform: 'erome',                    // platform-string voor backend (optional)
//
//     pageType: (pathname, search) => 'single' | 'listing' | null,
//
//     itemTypes: [                          // 1 of meer item-types op deze site
//       {
//         name: 'video',                    // intern
//         match: (pathname) => boolean,     // is deze URL een single-item van dit type?
//         selector: 'CSS',                  // CSS-selector voor item-links in DOM
//         endpoint: '/download',            // POST-doel
//         buildBody: (url, channel) => ({...}),
//         singleLabel: '⬇ Download deze video',
//         listingNoun: 'videos',            // voor "Deze pagina (N videos)"
//       },
//       // optioneel meer types (bv. video+album op footstockings)
//     ],
//
//     paginationUrl: (baseHref, page) => string,
//     detectMaxPage: (doc) => number,       // optional; default Infinity (stop bij 2× leeg)
//
//     deriveChannel: (url) => string,
//   }
(function () {
  'use strict';

  const host = String(window?.location?.hostname || '').toLowerCase().replace(/^www\./, '');
  const SITES = window.WEBDL_SITES || {};
  let cfg = SITES[host];

  // Universal fallback: als geen specifieke config bestaat, probeer of dit
  // een tube/listing-site is via heuristiek (>= 5 video-link-kandidaten in
  // DOM, of een <video> element). Zo ja → gebruik generieke config zodat
  // user OOK op onbekende sites kan downloaden.
  if (!cfg) {
    const sample = document.querySelectorAll(
      'a[href*="/video/"], a[href*="/v/"], a[href*="/watch"], a[href*="/play/"], a[href*="/episode"], a[href*="/clip"]'
    ).length;
    const hasVideoEl = !!document.querySelector('video, source[src*=".mp4"]');
    if (sample < 5 && !hasVideoEl) return; // geen download-context

    cfg = {
      label: host + ' (universal)',
      platform: host.replace(/\./g, '_').replace(/[^a-z0-9_-]+/g, '').slice(0, 30),
      pageType: (path) => {
        if (hasVideoEl) return 'single';
        return 'listing';
      },
      itemTypes: [{
        name: 'video',
        match: () => true, // sample-genereer alle gevonden links
        selector: 'a[href*="/video/"], a[href*="/v/"], a[href*="/watch"], a[href*="/play/"], a[href*="/episode"], a[href*="/clip"]',
        endpoint: '/download',
        buildBody(url, channel) { return { url, channel, title: '' }; },
        singleLabel: '⬇ Download deze video',
        listingNoun: 'videos',
        color: '#9333ea', // paars = universal
      }],
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
          const q = (u.searchParams.get('q') || u.searchParams.get('s') || u.searchParams.get('search') || '').trim();
          if (q) return `search_${q.replace(/\s+/g, '-')}`;
          if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
          if (segs.length === 1) return segs[0];
        } catch (_) {}
        return host.replace(/\./g, '_');
      },
    };
  }

  const SERVER = 'http://localhost:35729';
  const STATE = { busy: false };

  // ─── Helpers ───────────────────────────────────────────────────────

  function pathnameOf(url) {
    try { return new URL(url, window.location.href).pathname; } catch (_) { return ''; }
  }

  function itemTypeForUrl(url) {
    const p = pathnameOf(url);
    for (const t of cfg.itemTypes) {
      if (t.match(p)) return t;
    }
    return null;
  }

  function pageType() {
    const path = String(window.location.pathname || '');
    const search = String(window.location.search || '');
    return cfg.pageType(path, search);
  }

  function collectItemsFromDoc(doc) {
    const root = doc || document;
    const baseHref = doc?.baseURI || window.location.href;
    const seen = new Set();
    const items = []; // {url, type}
    for (const t of cfg.itemTypes) {
      for (const a of root.querySelectorAll(t.selector)) {
        const href = a.getAttribute('href') || '';
        if (!href) continue;
        let abs;
        try { abs = new URL(href, baseHref).toString(); } catch (_) { continue; }
        // Optionele transformatie: bv. /feedback?ref=<URL> → <URL>, of
        // /ktm/view.cgi?u=<URL> → <URL>. resolveUrl returnt de echte
        // dispatchbare URL of null als deze href moet worden overgeslagen.
        if (t.resolveUrl) {
          abs = t.resolveUrl(abs, baseHref);
          if (!abs) continue;
        }
        const path = pathnameOf(abs);
        if (!t.match(path)) continue;
        if (seen.has(abs)) continue;
        seen.add(abs);
        items.push({ url: abs, type: t });
      }
    }
    return items;
  }

  function defaultDetectMaxPage() { return Infinity; }
  const detectMaxPage = cfg.detectMaxPage || defaultDetectMaxPage;

  async function fetchPageDoc(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  }

  async function collectAllPages(baseHref) {
    const maxPage = detectMaxPage(document) || Infinity;
    const allSeen = new Set();
    const allItems = [];
    let consecutiveEmpty = 0;
    let pagesScanned = 0;
    for (let page = 1; page <= maxPage; page++) {
      let doc;
      try {
        doc = page === 1 ? document : await fetchPageDoc(cfg.paginationUrl(baseHref, page));
      } catch (e) {
        if (e.status === 404) break;
        console.warn(`[WEBDL ${cfg.label}] page ${page}: ${e.message}`);
        continue;
      }
      pagesScanned = page;
      const found = collectItemsFromDoc(doc);
      if (found.length === 0) {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= 2) break;
        continue;
      }
      consecutiveEmpty = 0;
      for (const it of found) {
        if (!allSeen.has(it.url)) { allSeen.add(it.url); allItems.push(it); }
      }
    }
    return { items: allItems, pagesScanned, maxPage };
  }

  async function postOne(item, channel) {
    const t = item.type;
    const body = t.buildBody(item.url, channel);
    try {
      const res = await fetch(`${SERVER}${t.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) return { ok: res.ok, ...(await res.json()) };
      return { ok: res.ok, text: (await res.text()).slice(0, 200) };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  // ─── Knop-handlers ─────────────────────────────────────────────────

  async function handleSingle(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳ Bezig…';
    const url = window.location.href.split('#')[0];
    const t = itemTypeForUrl(url);
    if (!t) {
      btn.textContent = '✗ Onbekend item-type';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    const channel = cfg.deriveChannel(url);
    const res = await postOne({ url, type: t }, channel);
    btn.textContent = (res.ok && (res.success || res.pid))
      ? (res.duplicate ? '✓ Al gedownload' : '✓ In queue')
      : `✗ ${res.error || 'fout'}`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 4000);
  }

  async function handleThisPage(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const channel = cfg.deriveChannel(window.location.href);
    const items = collectItemsFromDoc(document);
    if (items.length === 0) {
      btn.textContent = '✗ Geen items op deze pagina';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    let nieuw = 0, dup = 0, fail = 0;
    for (let i = 0; i < items.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${items.length} → ${channel}`;
      const res = await postOne(items[i], channel);
      if (res.ok && (res.success || res.pid)) { if (res.duplicate) dup++; else nieuw++; }
      else fail++;
    }
    btn.textContent = `✓ ${nieuw} nieuw${dup ? `, ${dup} dup` : ''}, ${fail} fout (1 page)`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 8000);
  }

  async function handleAllPages(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const baseHref = window.location.href.split('#')[0];
    const channel = cfg.deriveChannel(baseHref);
    btn.textContent = '⏳ Pages scannen…';
    let items, pagesScanned, maxPage;
    try {
      ({ items, pagesScanned, maxPage } = await collectAllPages(baseHref));
    } catch (e) {
      btn.textContent = `✗ Scan fout: ${e.message}`;
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 5000);
      return;
    }
    if (items.length === 0) {
      btn.textContent = '✗ Geen items gevonden';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    const maxLabel = Number.isFinite(maxPage) ? `${pagesScanned}/${maxPage}p` : `${pagesScanned}p`;
    let nieuw = 0, dup = 0, fail = 0;
    for (let i = 0; i < items.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${items.length} (${maxLabel})`;
      const res = await postOne(items[i], channel);
      if (res.ok && (res.success || res.pid)) { if (res.duplicate) dup++; else nieuw++; }
      else fail++;
    }
    btn.textContent = `✓ ${nieuw} nieuw${dup ? `, ${dup} dup` : ''}, ${fail} fout (${maxLabel})`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 15000);
  }

  // ─── Render ────────────────────────────────────────────────────────

  function makeButton(text, color, onClick) {
    const btn = document.createElement('button');
    btn.style.cssText = `background:${color};color:#fff;border:0;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;width:100%;text-align:left;`;
    btn.textContent = text;
    btn.addEventListener('click', () => onClick(btn));
    return btn;
  }

  function renderPanel() {
    const existing = document.getElementById('webdl-site-panel');
    if (existing) existing.remove();
    const type = pageType();
    if (!type) return;

    const wrap = document.createElement('div');
    wrap.id = 'webdl-site-panel';
    Object.assign(wrap.style, {
      position: 'fixed', top: '12px', right: '12px',
      zIndex: '2147483646',
      background: 'rgba(20,20,30,0.94)', color: '#fff',
      padding: '8px', borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      minWidth: '280px',
      display: 'flex', flexDirection: 'column', gap: '4px',
    });

    const header = document.createElement('div');
    header.textContent = `⚡ WEBDL · ${cfg.label}`;
    Object.assign(header.style, {
      fontSize: '11px', opacity: '0.7', padding: '2px 4px',
      textTransform: 'uppercase', letterSpacing: '0.5px',
    });
    wrap.appendChild(header);

    if (type === 'single') {
      const url = window.location.href.split('#')[0];
      const t = itemTypeForUrl(url);
      const label = t ? (t.singleLabel || '⬇ Download') : '✗ Onbekend item-type';
      const color = t && t.color || '#2196F3';
      wrap.appendChild(makeButton(label, color, handleSingle));
    } else {
      const items = collectItemsFromDoc(document);
      const byType = {};
      for (const it of items) {
        const n = it.type.listingNoun || it.type.name || 'items';
        byType[n] = (byType[n] || 0) + 1;
      }
      const counts = Object.entries(byType).map(([n, c]) => `${c} ${n}`).join(' + ');
      const onPageLabel = counts || 'leeg';
      const maxP = detectMaxPage(document);
      const maxLabel = Number.isFinite(maxP) && maxP > 1 ? ` (${maxP} totaal)` : '';
      wrap.appendChild(makeButton(`📄 Deze pagina (${onPageLabel})`, '#1565C0', handleThisPage));
      wrap.appendChild(makeButton(`🧵 Alle pages${maxLabel}`, '#0ea5e9', handleAllPages));
      const hint = document.createElement('div');
      hint.textContent = `→ channel: ${cfg.deriveChannel(window.location.href)}`;
      Object.assign(hint.style, { fontSize: '10px', opacity: '0.6', padding: '2px 4px' });
      wrap.appendChild(hint);
    }

    document.body.appendChild(wrap);
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderPanel, { once: true });
    } else {
      renderPanel();
    }
    setTimeout(renderPanel, 1500);
    setTimeout(renderPanel, 4000);
  }

  init();
})();
