// WEBDL erome.com helper.
//
// Erome serveert ALBUMS (mix van videos + images) op /a/<ID>.
// Search/profile-pages tonen lijst van album-URLs.
//
// URL-types:
//   /a/<ID>                     → single album (videos + images)
//   /search?q=<X>&page=N        → search-listing
//   /<username>                 → user-profile (lijkt op listing)
//
// Server-side: POST /api/erome/album spawnt scripts/erome_dl.py die
// alle videos + images scrapet en in DB registreert.
//
// Knoppen:
//   /a/<ID>          → ⬇ Download album (videos + images)
//   listing          → 📄 Deze pagina (N albums) + 🧵 Alle pages
(function () {
  'use strict';

  const host = String(window?.location?.hostname || '').toLowerCase().replace(/^www\./, '');
  if (host !== 'erome.com') return;

  const SERVER = 'http://localhost:35729';
  const ALBUM_LINK_RE = /^\/a\/[A-Za-z0-9]+\/?$/;
  const STATE = { busy: false };

  function pageType() {
    const path = String(window.location.pathname || '');
    if (ALBUM_LINK_RE.test(path)) return 'single';
    // /search, /<username>, /, /popular, etc. behandelen we als listing
    return 'listing';
  }

  function deriveChannel() {
    const path = String(window.location.pathname || '');
    const qs = new URLSearchParams(window.location.search);
    const am = path.match(/^\/a\/([A-Za-z0-9]+)/);
    if (am) return `album_${am[1]}`;
    if (path.startsWith('/search')) {
      const q = (qs.get('q') || '').trim();
      return q ? `search_${q.replace(/\s+/g, '-')}` : 'erome_search';
    }
    const segs = path.split('/').filter(Boolean);
    if (segs.length === 1) return `user_${segs[0]}`;
    return 'erome';
  }

  function albumUrlsFromDoc(doc) {
    const seen = new Set();
    const urls = [];
    const root = doc || document;
    for (const a of root.querySelectorAll('a[href*="/a/"]')) {
      const href = a.getAttribute('href') || '';
      if (!href) continue;
      let abs;
      try { abs = new URL(href, doc?.baseURI || window.location.href).toString(); }
      catch (_) { continue; }
      try {
        const pu = new URL(abs);
        if (!pu.hostname.toLowerCase().endsWith('erome.com')) continue;
        if (!ALBUM_LINK_RE.test(pu.pathname)) continue;
      } catch (_) { continue; }
      if (seen.has(abs)) continue;
      seen.add(abs);
      urls.push(abs);
    }
    return urls;
  }

  async function fetchPageDoc(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      u.searchParams.set('page', String(page));
      return u.toString();
    } catch (_) { return baseHref; }
  }

  async function collectAllPages(baseHref) {
    const allSeen = new Set();
    const allUrls = [];
    let consecutiveEmpty = 0;
    let pagesScanned = 0;
    for (let page = 1; ; page++) {
      let doc;
      try {
        doc = page === 1 ? document : await fetchPageDoc(paginationUrl(baseHref, page));
      } catch (e) {
        if (e.status === 404) break;
        continue;
      }
      pagesScanned = page;
      const found = albumUrlsFromDoc(doc);
      if (found.length === 0) {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= 2) break;
        continue;
      }
      consecutiveEmpty = 0;
      let added = 0;
      for (const u of found) {
        if (!allSeen.has(u)) { allSeen.add(u); allUrls.push(u); added++; }
      }
      if (added === 0) {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= 2) break;
      }
    }
    return { urls: allUrls, pagesScanned };
  }

  async function postAlbum(url, channel) {
    try {
      const res = await fetch(`${SERVER}/api/erome/album`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, channel }),
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) return { ok: res.ok, ...(await res.json()) };
      return { ok: res.ok, text: (await res.text()).slice(0, 200) };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  async function handleSingle(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳ Bezig…';
    const url = window.location.href.split('#')[0].split('?')[0];
    const channel = deriveChannel();
    const res = await postAlbum(url, channel);
    btn.textContent = (res.ok && (res.success || res.pid)) ? '✓ In queue' : `✗ ${res.error || 'fout'}`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 4000);
  }

  async function handleThisPage(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const channel = deriveChannel();
    const urls = albumUrlsFromDoc(document);
    if (urls.length === 0) {
      btn.textContent = '✗ Geen albums op deze pagina';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    let nieuw = 0, fail = 0;
    for (let i = 0; i < urls.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${urls.length} → ${channel}`;
      const res = await postAlbum(urls[i], channel);
      if (res.ok && (res.success || res.pid)) nieuw++;
      else fail++;
    }
    btn.textContent = `✓ ${nieuw} ingeschoten, ${fail} fout (1 page)`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 10000);
  }

  async function handleAllPages(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const channel = deriveChannel();
    const baseHref = window.location.href.split('#')[0];
    btn.textContent = '⏳ Pages scannen…';
    let urls, pagesScanned;
    try {
      ({ urls, pagesScanned } = await collectAllPages(baseHref));
    } catch (e) {
      btn.textContent = `✗ Scan fout: ${e.message}`;
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 5000);
      return;
    }
    if (urls.length === 0) {
      btn.textContent = '✗ Geen albums gevonden';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    let nieuw = 0, fail = 0;
    for (let i = 0; i < urls.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${urls.length} (${pagesScanned}p) → ${channel}`;
      const res = await postAlbum(urls[i], channel);
      if (res.ok && (res.success || res.pid)) nieuw++;
      else fail++;
    }
    btn.textContent = `✓ ${nieuw} ingeschoten, ${fail} fout (${pagesScanned}p)`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 15000);
  }

  function makeButton(text, color, onClick) {
    const btn = document.createElement('button');
    btn.style.cssText = `background:${color};color:#fff;border:0;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;width:100%;text-align:left;`;
    btn.textContent = text;
    btn.addEventListener('click', () => onClick(btn));
    return btn;
  }

  function renderPanel() {
    const existing = document.getElementById('webdl-erome-panel');
    if (existing) existing.remove();
    const type = pageType();

    const wrap = document.createElement('div');
    wrap.id = 'webdl-erome-panel';
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
    header.textContent = '⚡ WEBDL · erome';
    Object.assign(header.style, {
      fontSize: '11px', opacity: '0.7', padding: '2px 4px',
      textTransform: 'uppercase', letterSpacing: '0.5px',
    });
    wrap.appendChild(header);

    if (type === 'single') {
      wrap.appendChild(makeButton('⬇ Download album (video+img)', '#2196F3', handleSingle));
    } else {
      const n = albumUrlsFromDoc(document).length;
      wrap.appendChild(makeButton(`📄 Deze pagina (${n} albums)`, '#1565C0', handleThisPage));
      wrap.appendChild(makeButton('🧵 Alle pages (tot einde)', '#0ea5e9', handleAllPages));
      const hint = document.createElement('div');
      hint.textContent = `→ channel: ${deriveChannel()}`;
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
