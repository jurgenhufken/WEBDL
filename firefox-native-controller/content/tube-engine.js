// WEBDL — generic tube-engine helper voor sites die de zelfde HTML-structuur
// gebruiken (list-videos / list-albums container, /videos/<id>/<slug>/
// URL-vorm, ?from_videos=NN&from_albums=NN pagination).
//
// Bekende sites die dit patroon gebruiken:
//   footstockings.com  — videos + albums
//   heavyfetish.com    — alleen videos
//
// Knoppen:
//   single video page  →  ⬇ Download deze video
//   single album page  →  ⬇ Download dit album
//   listing-page       →  📄 Deze pagina (N items)
//                         🧵 Alle pages van dit thema  (multi-page)
//
// Channel-strategie:
//   single-item        →  slug-based (videos_<slug> / albums_<slug>)
//   listing-batch      →  listing-context (search_<q>, models_<name>, …)
//   → alle items van 1 batch komen onder 1 channel in gallery
(function () {
  'use strict';

  const SITES = {
    'footstockings.com': {
      platform: 'footstockings',
      hasAlbums: true,
      albumEndpoint: '/api/footstockings/album',
      label: 'footstockings',
    },
    'heavyfetish.com': {
      platform: 'heavyfetish',
      hasAlbums: false,
      albumEndpoint: null,
      label: 'heavyfetish',
    },
  };

  const host = String(window?.location?.hostname || '').toLowerCase().replace(/^www\./, '');
  const SITE = SITES[host];
  if (!SITE) return;

  const SERVER = 'http://localhost:35729';
  // GEEN cap. Stop alleen bij:
  //   - detectMaxPage() bereikt (de echte LAST-page uit pagination-HTML)
  //   - 404
  //   - 2× achter elkaar lege pages
  // User-policy: 'ik wil geen maximum sowieso niet'.
  const SINGLE_VIDEO_RE = /^\/videos\/\d+\/[^/]+\/?$/;
  const SINGLE_ALBUM_RE = /^\/albums\/\d+\/[^/]+\/?$/;
  const LISTING_PREFIXES = [
    '/search/', '/categories/', '/models/', '/channels/',
    '/playlists/', '/latest-updates', '/most-popular',
    '/albums/categories/', '/albums/',
  ];
  const VIDEO_SEL = 'div.list-videos a[href*="/videos/"]';
  const ALBUM_SEL = 'div.list-albums a[href*="/albums/"]';
  const MEDIA_LINK_SEL = SITE.hasAlbums ? `${VIDEO_SEL}, ${ALBUM_SEL}` : VIDEO_SEL;
  const STATE = { busy: false };

  function pageType() {
    const p = String(window.location.pathname || '');
    if (SINGLE_VIDEO_RE.test(p)) return 'single_video';
    if (SITE.hasAlbums && SINGLE_ALBUM_RE.test(p)) return 'single_album';
    for (const pre of LISTING_PREFIXES) {
      if (p.startsWith(pre)) return 'listing';
    }
    return null;
  }

  function isVideoPath(p) { return /^\/videos\/\d+\/[^/]+\/?$/.test(p); }
  function isAlbumPath(p) { return /^\/albums\/\d+\/[^/]+\/?$/.test(p); }

  function deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      if ((segs[0] === 'videos' || segs[0] === 'albums') && segs.length >= 3) {
        return `${segs[0]}_${segs[2]}`;
      }
      if (segs[0] === 'albums' && segs[1] === 'categories' && segs[2]) {
        return `albums_categories_${segs[2]}`;
      }
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return SITE.label;
  }

  function mediaUrlsFromDoc(doc) {
    const seen = new Set();
    const urls = [];
    const root = doc || document;
    for (const a of root.querySelectorAll(MEDIA_LINK_SEL)) {
      const href = a.getAttribute('href') || '';
      if (!href) continue;
      let abs;
      try { abs = new URL(href, doc?.baseURI || window.location.href).toString(); }
      catch (_) { continue; }
      let p;
      try { p = new URL(abs).pathname; } catch (_) { continue; }
      if (!isVideoPath(p) && !(SITE.hasAlbums && isAlbumPath(p))) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      urls.push(abs);
    }
    return urls;
  }

  function paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      const pp = String(page).padStart(2, '0');
      u.searchParams.set('from_videos', pp);
      u.searchParams.set('from_albums', pp);
      return u.toString();
    } catch (_) { return baseHref; }
  }

  // Hoogste page-nummer uit pagination HTML.
  function detectMaxPage(doc) {
    const root = doc || document;
    let max = 1;
    for (const a of root.querySelectorAll('a[data-parameters]')) {
      const m = (a.getAttribute('data-parameters') || '').match(/from_videos\+from_albums:(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return max;
  }

  async function fetchPageDoc(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  async function collectAllPages(baseHref) {
    const allSeen = new Set();
    const allUrls = [];
    const maxPage = detectMaxPage(document) || Infinity;
    let consecutiveEmpty = 0;
    let pagesScanned = 0;
    for (let page = 1; page <= maxPage; page++) {
      let doc;
      try {
        doc = page === 1 ? document : await fetchPageDoc(paginationUrl(baseHref, page));
      } catch (e) {
        if (e.status === 404) break;
        console.warn(`[WEBDL ${SITE.label}] page ${page} fout: ${e.message}`);
        continue;
      }
      pagesScanned = page;
      const found = mediaUrlsFromDoc(doc);
      if (found.length === 0) {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= 2) break;
        continue;
      }
      consecutiveEmpty = 0;
      for (const u of found) {
        if (!allSeen.has(u)) { allSeen.add(u); allUrls.push(u); }
      }
      // GEEN early-exit op 0 nieuwe URLs — tube-sites geven soms pages
      // met (gedeeltelijk) overlap maar daarna weer fresh content. Pas
      // stoppen bij 2× achter elkaar LEEG.
    }
    return { urls: allUrls, pagesScanned, maxPage };
  }

  async function postJson(path, body) {
    try {
      const res = await fetch(`${SERVER}${path}`, {
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

  function postVideo(url, channel, title) {
    return postJson('/download', { url, platform: SITE.platform, channel, title });
  }
  function postAlbum(url, channel) {
    if (!SITE.albumEndpoint) {
      return Promise.resolve({ ok: false, error: `geen album-handler voor ${SITE.label}` });
    }
    return postJson(SITE.albumEndpoint, { url, channel });
  }

  async function dispatchOne(url, channel) {
    let p;
    try { p = new URL(url).pathname; } catch (_) { p = ''; }
    if (SITE.hasAlbums && isAlbumPath(p)) return postAlbum(url, channel);
    if (isVideoPath(p)) return postVideo(url, channel, '');
    return { ok: false, error: 'onbekend URL-type' };
  }

  async function handleSingle(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳ Bezig…';
    const url = window.location.href.split('#')[0].split('?')[0];
    const channel = deriveChannel(url);
    const res = await dispatchOne(url, channel);
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
    const channel = deriveChannel(window.location.href);
    const urls = mediaUrlsFromDoc(document);
    if (urls.length === 0) {
      btn.textContent = '✗ Geen items op deze pagina';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    let nieuw = 0, dup = 0, fail = 0;
    for (let i = 0; i < urls.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${urls.length} → ${channel}`;
      const res = await dispatchOne(urls[i], channel);
      if (res.ok && (res.success || res.pid)) {
        if (res.duplicate) dup++; else nieuw++;
      } else {
        fail++;
      }
    }
    btn.textContent = `✓ ${nieuw} nieuw, ${dup} dup, ${fail} fout (1 page)`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 8000);
  }

  async function handleAllPages(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const baseHref = window.location.href.split('#')[0].split('?')[0];
    const channel = deriveChannel(baseHref);
    btn.textContent = '⏳ Pages scannen…';
    let urls, pagesScanned, maxPage;
    try {
      ({ urls, pagesScanned, maxPage } = await collectAllPages(baseHref));
    } catch (e) {
      btn.textContent = `✗ Scan fout: ${e.message}`;
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 5000);
      return;
    }
    if (urls.length === 0) {
      btn.textContent = '✗ Geen items gevonden';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    const v = urls.filter((u) => isVideoPath(new URL(u).pathname)).length;
    const a = urls.filter((u) => isAlbumPath(new URL(u).pathname)).length;
    let nieuw = 0, dup = 0, fail = 0;
    for (let i = 0; i < urls.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${urls.length} (${pagesScanned}/${maxPage}p, ${v}v+${a}a)`;
      const res = await dispatchOne(urls[i], channel);
      if (res.ok && (res.success || res.pid)) {
        if (res.duplicate) dup++; else nieuw++;
      } else {
        fail++;
      }
    }
    btn.textContent = `✓ ${nieuw} nieuw, ${dup} dup, ${fail} fout (${pagesScanned}/${maxPage}p)`;
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
    const existing = document.getElementById('webdl-tube-panel');
    if (existing) existing.remove();
    const type = pageType();
    if (!type) return;

    const wrap = document.createElement('div');
    wrap.id = 'webdl-tube-panel';
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
    header.textContent = `⚡ WEBDL · ${SITE.label}`;
    Object.assign(header.style, {
      fontSize: '11px', opacity: '0.7', padding: '2px 4px',
      textTransform: 'uppercase', letterSpacing: '0.5px',
    });
    wrap.appendChild(header);

    if (type === 'single_video') {
      wrap.appendChild(makeButton('⬇ Download deze video', '#2196F3', handleSingle));
    } else if (type === 'single_album') {
      wrap.appendChild(makeButton('⬇ Download dit album', '#7c3aed', handleSingle));
    } else {
      const onPage = mediaUrlsFromDoc(document);
      const v = onPage.filter((u) => isVideoPath(new URL(u).pathname)).length;
      const a = onPage.filter((u) => isAlbumPath(new URL(u).pathname)).length;
      const maxP = detectMaxPage(document);
      const onPageLabel = (v && a) ? `${v}v + ${a}a` : v ? `${v} videos` : a ? `${a} albums` : 'leeg';
      wrap.appendChild(makeButton(`📄 Deze pagina (${onPageLabel})`, '#1565C0', handleThisPage));
      wrap.appendChild(makeButton(`🧵 Alle pages (${maxP} totaal)`, '#0ea5e9', handleAllPages));
      const hint = document.createElement('div');
      hint.textContent = `→ channel: ${deriveChannel(window.location.href)}`;
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
