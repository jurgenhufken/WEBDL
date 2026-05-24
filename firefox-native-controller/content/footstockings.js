// WEBDL footstockings.com helper — v4
//
// LOGICA: één knop, contextueel. Op single-item pages: download dat
// ene item. Op listing-pages (search/models/categories/etc.): download
// ALLES wat bij dat thema hoort — alle videos én alle albums over alle
// pagination-pages, allemaal onder ÉÉN channel (de listing-context)
// zodat ze als 1 groep in de gallery verschijnen.
//
// Pagination: footstockings doet ?from_videos=N&from_albums=N waarbij
// elke "page" 36 videos + albums teruggeeft tot er geen meer zijn.
//
// Routing:
//   /videos/<id>/<slug>/ (single)  → POST /download  (yt-dlp via hub)
//   /albums/<id>/<slug>/ (single)  → POST /api/footstockings/album
//                                    (spawnt scripts/foot_album_dl.py
//                                     server-side)
//
// Channel-strategie (= groepering in gallery):
//   single-item     → listing-context als hij bekend is, anders slug
//   listing-batch   → listing-context (ALLE items in 1 groep)
//
// Listing-context-naming:
//   /search/<q>/                 → 'search_<q>'
//   /models/<naam>/              → 'models_<naam>'
//   /categories/<cat>/           → 'categories_<cat>'
//   /channels/<chan>/            → 'channels_<chan>'
//   /playlists/<id>/             → 'playlists_<id>'
//   /albums/                     → 'albums_index'
//   /albums/categories/<cat>/    → 'albums_categories_<cat>'
//   /latest-updates/             → 'latest-updates'
//   /most-popular/               → 'most-popular'
(function () {
  'use strict';

  const host = String(window?.location?.hostname || '').toLowerCase().replace(/^www\./, '');
  if (host !== 'footstockings.com') return;

  const SERVER = 'http://localhost:35729';
  const MAX_PAGES = 50;                          // hard cap multi-page
  const SINGLE_VIDEO_RE = /^\/videos\/\d+\/[^/]+\/?$/;
  const SINGLE_ALBUM_RE = /^\/albums\/\d+\/[^/]+\/?$/;
  const LISTING_PREFIXES = [
    '/search/', '/categories/', '/models/', '/channels/',
    '/playlists/', '/latest-updates', '/most-popular',
    '/albums/categories/', '/albums/',
  ];
  // Hoofdcontainers met de echte resultaten — geen related/sidebar.
  const MEDIA_LINK_SEL = [
    'div.list-videos a[href*="/videos/"]',
    'div.list-albums a[href*="/albums/"]',
  ].join(', ');
  const STATE = { busy: false };

  // ─── Page-type detectie ────────────────────────────────────────────
  function pageType() {
    const path = String(window.location.pathname || '');
    if (SINGLE_VIDEO_RE.test(path)) return 'single_video';
    if (SINGLE_ALBUM_RE.test(path)) return 'single_album';
    for (const p of LISTING_PREFIXES) {
      if (path.startsWith(p)) return 'listing';
    }
    return null;
  }

  function isVideoPath(p) { return /^\/videos\/\d+\/[^/]+\/?$/.test(p); }
  function isAlbumPath(p) { return /^\/albums\/\d+\/[^/]+\/?$/.test(p); }

  // ─── Channel-derivation ────────────────────────────────────────────
  function deriveChannel(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      // /videos/<id>/<slug>/  →  videos_<slug>
      // /albums/<id>/<slug>/  →  albums_<slug>
      if ((segs[0] === 'videos' || segs[0] === 'albums') && segs.length >= 3) {
        return `${segs[0]}_${segs[2]}`;
      }
      // /albums/categories/<cat>/  →  albums_categories_<cat>
      if (segs[0] === 'albums' && segs[1] === 'categories' && segs[2]) {
        return `albums_categories_${segs[2]}`;
      }
      // /<type>/<value>/  →  <type>_<value>   (search, models, etc.)
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'footstockings';
  }

  // ─── URL scraping ──────────────────────────────────────────────────
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
      if (!isVideoPath(p) && !isAlbumPath(p)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      urls.push(abs);
    }
    return urls;
  }

  // Footstockings pagination: ?from_videos=N&from_albums=N geeft de
  // N-de page van resultaten terug. Pages zijn 2-cijferig (02, 03, …).
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
    let lastAdded = -1;
    for (let page = 1; page <= MAX_PAGES; page++) {
      let doc;
      try {
        doc = page === 1 ? document : await fetchPageDoc(paginationUrl(baseHref, page));
      } catch (e) {
        if (e.status === 404) break;
        throw e;
      }
      const found = mediaUrlsFromDoc(doc);
      if (found.length === 0) break;
      let added = 0;
      for (const u of found) {
        if (!allSeen.has(u)) { allSeen.add(u); allUrls.push(u); added++; }
      }
      // Geen nieuwe content meer = einde (footstockings herhaalt soms page 1).
      if (added === 0) break;
      lastAdded = page;
    }
    return { urls: allUrls, pagesScanned: lastAdded };
  }

  // ─── HTTP naar simple-server ───────────────────────────────────────
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
    return postJson('/download', { url, platform: 'footstockings', channel, title });
  }
  function postAlbum(url, channel) {
    return postJson('/api/footstockings/album', { url, channel });
  }

  async function dispatchOne(url, channel) {
    let p;
    try { p = new URL(url).pathname; } catch (_) { p = ''; }
    if (isAlbumPath(p)) return postAlbum(url, channel);
    if (isVideoPath(p)) return postVideo(url, channel, '');
    return { ok: false, error: 'onbekend URL-type' };
  }

  // ─── Knop-handlers ─────────────────────────────────────────────────
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

  async function handleBatch(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const baseHref = window.location.href.split('#')[0].split('?')[0];
    const channel = deriveChannel(baseHref);
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
      btn.textContent = '✗ Geen items gevonden';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    const videoCount = urls.filter((u) => isVideoPath(new URL(u).pathname)).length;
    const albumCount = urls.filter((u) => isAlbumPath(new URL(u).pathname)).length;
    let nieuw = 0, dup = 0, fail = 0;
    for (let i = 0; i < urls.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${urls.length} (${pagesScanned}p, ${videoCount}v+${albumCount}a → ${channel})`;
      const res = await dispatchOne(urls[i], channel);
      if (res.ok && (res.success || res.pid)) {
        if (res.duplicate) dup++; else nieuw++;
      } else {
        fail++;
      }
    }
    btn.textContent = `✓ ${nieuw} nieuw, ${dup} dup, ${fail} fout (${pagesScanned}p)`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 10000);
  }

  // ─── UI render ─────────────────────────────────────────────────────
  function makeButton(text, color, onClick) {
    const btn = document.createElement('button');
    btn.style.cssText = `background:${color};color:#fff;border:0;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;width:100%;text-align:left;`;
    btn.textContent = text;
    btn.addEventListener('click', () => onClick(btn));
    return btn;
  }

  function renderPanel() {
    const existing = document.getElementById('webdl-foot-panel');
    if (existing) existing.remove();
    const type = pageType();
    if (!type) return;

    const wrap = document.createElement('div');
    wrap.id = 'webdl-foot-panel';
    Object.assign(wrap.style, {
      position: 'fixed', top: '12px', right: '12px',
      zIndex: '2147483646',
      background: 'rgba(20,20,30,0.94)', color: '#fff',
      padding: '8px', borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      minWidth: '260px',
      display: 'flex', flexDirection: 'column', gap: '4px',
    });

    const header = document.createElement('div');
    header.textContent = '⚡ WEBDL · footstockings';
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
      // Listing: één grote knop voor "alles in dit thema".
      const onPage = mediaUrlsFromDoc(document);
      const v = onPage.filter((u) => isVideoPath(new URL(u).pathname)).length;
      const a = onPage.filter((u) => isAlbumPath(new URL(u).pathname)).length;
      const onPageLabel = (v && a) ? `${v}v + ${a}a` : v ? `${v} videos` : a ? `${a} albums` : 'leeg';
      wrap.appendChild(makeButton(
        `⬇ Download ALLES van dit thema (${onPageLabel} op page 1, multi-page)`,
        '#0ea5e9',
        handleBatch,
      ));
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
