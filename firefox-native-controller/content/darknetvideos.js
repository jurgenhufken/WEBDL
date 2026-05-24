// WEBDL darknetvideos.com helper.
//
// Andere structuur dan tube-engine (footstockings/heavyfetish):
//   - container: <div class="videobox"> (geen .list-videos)
//   - video page URL: /video.php?id=<id>&...
//   - directe MP4 URL zit in <script type="application/ld+json">
//     {"@type":"VideoObject","contentUrl":"https://cdn5.../<id>.mp4"}
//
// Server-side handler: POST /api/darknetvideos/video spawnt
// scripts/darknet_dl.py die de mp4 fetch'd en in DB registreert.
//
// Knoppen:
//   /video.php?id=N        →  ⬇ Download deze video
//   listing/search page    →  📄 Deze pagina (N videos)
//                             (geen multi-page voor nu; site heeft
//                              geen duidelijke pagination in HTML)
(function () {
  'use strict';

  const host = String(window?.location?.hostname || '').toLowerCase().replace(/^www\./, '');
  if (host !== 'darknetvideos.com') return;

  const SERVER = 'http://localhost:35729';
  // Geen cap. Stop alleen bij 404 of 2× lege pages.
  const VIDEO_LINK_SEL = 'div.videobox a[href*="video.php?id="]';
  const STATE = { busy: false };

  async function fetchPageDoc(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function pageType() {
    const path = String(window.location.pathname || '');
    const q = String(window.location.search || '');
    if (path === '/video.php' && /[?&]id=\d+/.test(q)) return 'single';
    // index.php met search-param of root → listing
    if (path === '/index.php' || path === '/') return 'listing';
    return null;
  }

  function deriveChannel() {
    try {
      const q = new URLSearchParams(window.location.search);
      const search = q.get('search');
      if (search) return `search_${search.replace(/\s+/g, '-')}`;
      const id = q.get('id');
      if (id) return `video_${id}`;
    } catch (_) {}
    return 'darknetvideos';
  }

  function videoUrlsFromDoc(doc) {
    const seen = new Set();
    const urls = [];
    const root = doc || document;
    for (const a of root.querySelectorAll(VIDEO_LINK_SEL)) {
      let href = a.getAttribute('href') || '';
      if (!href) continue;
      let abs;
      try { abs = new URL(href, doc?.baseURI || window.location.href).toString(); }
      catch (_) { continue; }
      const m = abs.match(/[?&]id=(\d+)/);
      if (!m) continue;
      const key = m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(abs);
    }
    return urls;
  }
  function videoUrlsFromPage() { return videoUrlsFromDoc(document); }

  // Darknetvideos pagination: ?side=N (Next-page link). side=0 of geen
  // param = page 1, side=1 = page 2, enz.
  function paginationUrl(baseHref, page) {
    if (page <= 1) return baseHref;
    try {
      const u = new URL(baseHref, window.location.href);
      u.searchParams.set('side', String(page - 1));
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
      const found = videoUrlsFromDoc(doc);
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

  async function postVideo(url, channel) {
    try {
      const res = await fetch(`${SERVER}/api/darknetvideos/video`, {
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
    const url = window.location.href.split('#')[0];
    const channel = deriveChannel();
    const res = await postVideo(url, channel);
    btn.textContent = (res.ok && (res.success || res.pid)) ? '✓ In queue' : `✗ ${res.error || 'fout'}`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 4000);
  }

  async function handleThisPage(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const channel = deriveChannel();
    const urls = videoUrlsFromPage();
    if (urls.length === 0) {
      btn.textContent = '✗ Geen videos op deze pagina';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    let nieuw = 0, fail = 0;
    for (let i = 0; i < urls.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${urls.length} → ${channel}`;
      const res = await postVideo(urls[i], channel);
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
      btn.textContent = '✗ Geen videos gevonden';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    let nieuw = 0, fail = 0;
    for (let i = 0; i < urls.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${urls.length} (${pagesScanned}p) → ${channel}`;
      const res = await postVideo(urls[i], channel);
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
    const existing = document.getElementById('webdl-dark-panel');
    if (existing) existing.remove();
    const type = pageType();
    if (!type) return;

    const wrap = document.createElement('div');
    wrap.id = 'webdl-dark-panel';
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
    header.textContent = '⚡ WEBDL · darknetvideos';
    Object.assign(header.style, {
      fontSize: '11px', opacity: '0.7', padding: '2px 4px',
      textTransform: 'uppercase', letterSpacing: '0.5px',
    });
    wrap.appendChild(header);

    if (type === 'single') {
      wrap.appendChild(makeButton('⬇ Download deze video', '#2196F3', handleSingle));
    } else {
      const n = videoUrlsFromPage().length;
      wrap.appendChild(makeButton(`📄 Deze pagina (${n} videos)`, '#1565C0', handleThisPage));
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
