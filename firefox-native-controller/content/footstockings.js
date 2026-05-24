// WEBDL footstockings.com helper — eigen knop-paneel rechtsboven met
// 3 actie-knoppen die qua logica spiegelen wat de hoofdtoolbar voor
// andere sites doet:
//
//   ⬇ Huidige media    : op /videos/<id>/<slug>/ of /albums/<id>/<slug>/
//                        → POST 1 URL naar /download
//   📄 Deze pagina      : op listing-page → scrape page 1
//                        .list-videos én .list-albums hoofdcontainers
//   🧵 Hele thread      : op listing-page → loop pages 1..N
//                        (auto stop bij 404 of leeg/herhalend resultaat)
//
// Listing-types: /search/, /categories/, /models/, /channels/,
// /playlists/, /latest-updates/, /most-popular/,
// /albums/, /albums/categories/
//
// Scope-bewust: pakt ALLEEN media-links uit de hoofdcontainers
// (.list-videos en .list-albums) — geen "related" / sidebar /
// footer-suggesties.
(function () {
  'use strict';

  const host = String(window?.location?.hostname || '').toLowerCase().replace(/^www\./, '');
  if (host !== 'footstockings.com') return;

  const SERVER = 'http://localhost:35729';
  const MAX_PAGES_HELE_THREAD = 50;        // hard cap voor "Hele thread"
  const SINGLE_MEDIA_RE = /^\/(videos|albums)\/\d+\/[^/]+\/?$/;
  const LISTING_PREFIXES = [
    '/search/', '/categories/', '/models/', '/channels/',
    '/playlists/', '/latest-updates', '/most-popular', '/albums',
  ];
  // Hoofdcontainers met de echte listing-resultaten.
  // Negeert "related" / sidebar / footer-suggesties zodat alleen de
  // content op het thema van de pagina opgepakt wordt.
  const MEDIA_LINK_SEL = [
    'div.list-videos a[href*="/videos/"]',
    'div.list-albums a[href*="/albums/"]',
  ].join(', ');
  const MEDIA_PATH_RE = /^\/(videos|albums)\/\d+\/[^/]+\/?$/;
  const STATE = { busy: false };

  function pageType() {
    const path = String(window.location.pathname || '');
    if (SINGLE_MEDIA_RE.test(path)) return 'single';
    if (LISTING_PREFIXES.some((p) => path.startsWith(p))) return 'listing';
    return null;
  }

  function deriveChannelFromUrl(url) {
    try {
      const u = new URL(url, window.location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      // /videos/<id>/<slug>/ of /albums/<id>/<slug>/ → '<type>_<slug>'
      if ((segs[0] === 'videos' || segs[0] === 'albums') && segs.length >= 3) {
        return `${segs[0]}_${segs[2]}`;
      }
      // /search/<q>/, /categories/<cat>/, /models/<name>/, /albums/categories/<cat>/
      if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
      if (segs.length === 1) return segs[0];
    } catch (_) {}
    return 'footstockings_listing';
  }

  function deriveTitleFromDoc(doc) {
    const t = (doc && doc.title) || document.title || '';
    return String(t).replace(/\s*-\s*footstockings\.com.*$/i, '').trim();
  }

  function mediaUrlsFromDoc(doc) {
    const seen = new Set();
    const urls = [];
    const root = (doc || document);
    for (const a of root.querySelectorAll(MEDIA_LINK_SEL)) {
      const href = a.getAttribute('href') || '';
      if (!href) continue;
      let abs;
      try { abs = new URL(href, doc?.baseURI || window.location.href).toString(); }
      catch (_) { continue; }
      try {
        const p = new URL(abs).pathname;
        if (!MEDIA_PATH_RE.test(p)) continue;
      } catch (_) { continue; }
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
      const path = u.pathname.replace(/\/+$/, '');
      u.pathname = `${path}/${page}/`;
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

  async function postDownload(url, channel, title) {
    const body = JSON.stringify({ url, platform: 'footstockings', channel, title });
    try {
      const res = await fetch(`${SERVER}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) {
        const j = await res.json();
        return { ok: res.ok, ...j };
      }
      const txt = await res.text();
      return { ok: res.ok, error: txt.slice(0, 200) };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  async function runBatch(btn, urls, channel) {
    let nieuw = 0, dup = 0, fail = 0;
    for (let i = 0; i < urls.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${urls.length}…`;
      const res = await postDownload(urls[i], channel, '');
      if (res.ok && res.success) {
        if (res.duplicate) dup++; else nieuw++;
      } else {
        fail++;
      }
    }
    return { nieuw, dup, fail };
  }

  async function handleSingle(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳ Bezig…';
    const url = window.location.href.split('#')[0].split('?')[0];
    const title = deriveTitleFromDoc(document);
    const channel = deriveChannelFromUrl(url);
    const res = await postDownload(url, channel, title);
    btn.textContent = (res.ok && res.success)
      ? (res.duplicate ? '✓ Al gedownload' : '✓ In queue')
      : `✗ ${res.error || 'fout'}`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 4000);
  }

  async function handleDezePagina(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const urls = mediaUrlsFromDoc(document);
    if (urls.length === 0) {
      btn.textContent = '✗ Geen videos gevonden';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    const channel = deriveChannelFromUrl(window.location.href);
    const { nieuw, dup, fail } = await runBatch(btn, urls, channel);
    btn.textContent = `✓ ${nieuw} nieuw, ${dup} dup, ${fail} fout`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 6000);
  }

  async function handleHeleThread(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const baseHref = window.location.href.split('#')[0].split('?')[0];
    const channel = deriveChannelFromUrl(baseHref);

    // Verzamel URLs over pages tot we 404 of een leeg/herhalend resultaat krijgen.
    const allSeen = new Set();
    const allUrls = [];
    for (let page = 1; page <= MAX_PAGES_HELE_THREAD; page++) {
      btn.textContent = `⏳ Page ${page} scannen…`;
      let doc;
      try {
        doc = page === 1 ? document : await fetchPageDoc(paginationUrl(baseHref, page));
      } catch (e) {
        if (e.status === 404) break;
        btn.textContent = `✗ Page ${page} fout (${e.message})`;
        await new Promise((r) => setTimeout(r, 1500));
        break;
      }
      const found = mediaUrlsFromDoc(doc);
      if (found.length === 0) break;
      let added = 0;
      for (const u of found) {
        if (!allSeen.has(u)) { allSeen.add(u); allUrls.push(u); added++; }
      }
      // Als deze page niets nieuws toevoegt → footstockings herhaalt page 1 (einde).
      if (added === 0) break;
    }

    if (allUrls.length === 0) {
      btn.textContent = '✗ Geen videos gevonden';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    btn.textContent = `⏳ ${allUrls.length} videos inschieten…`;
    const { nieuw, dup, fail } = await runBatch(btn, allUrls, channel);
    btn.textContent = `✓ ${nieuw} nieuw, ${dup} dup, ${fail} fout (${allUrls.length} totaal)`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 8000);
  }

  function makeButton(text, color, onClick) {
    const btn = document.createElement('button');
    btn.style.cssText = `background:${color};color:#fff;border:0;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;margin:2px 0;width:100%;text-align:left;`;
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
      minWidth: '220px',
      display: 'flex', flexDirection: 'column', gap: '4px',
    });

    const header = document.createElement('div');
    header.textContent = '⚡ WEBDL · footstockings';
    Object.assign(header.style, {
      fontSize: '11px', opacity: '0.7', padding: '2px 4px',
      textTransform: 'uppercase', letterSpacing: '0.5px',
    });
    wrap.appendChild(header);

    if (type === 'single') {
      // Detecteer of we op een video- of album-page zijn voor label-detail
      const path = String(window.location.pathname || '');
      const isAlbum = /^\/albums\//.test(path);
      const label = isAlbum ? '⬇ Huidige album' : '⬇ Huidige video';
      wrap.appendChild(makeButton(label, '#2196F3', handleSingle));
    } else {
      const urls = mediaUrlsFromDoc(document);
      const videoCount = urls.filter((u) => /\/videos\//.test(u)).length;
      const albumCount = urls.filter((u) => /\/albums\//.test(u)).length;
      let label = `📄 Deze pagina (${urls.length})`;
      if (videoCount > 0 && albumCount > 0) label = `📄 Deze pagina (${videoCount}v + ${albumCount}a)`;
      else if (videoCount > 0) label = `📄 Deze pagina (${videoCount} videos)`;
      else if (albumCount > 0) label = `📄 Deze pagina (${albumCount} albums)`;
      wrap.appendChild(makeButton(label, '#1565C0', handleDezePagina));
      wrap.appendChild(makeButton('🧵 Alle pages (multi-page)', '#0ea5e9', handleHeleThread));
    }

    document.body.appendChild(wrap);
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderPanel, { once: true });
    } else {
      renderPanel();
    }
    // Re-render later: site laadt .list-videos soms lazy.
    setTimeout(renderPanel, 1500);
    setTimeout(renderPanel, 4000);
  }

  init();
})();
