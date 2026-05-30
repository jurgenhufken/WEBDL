// WEBDL darknessporn.com helper.
//
// Site is achter Cloudflare anti-bot. Vanuit Firefox (waar user is
// ingelogd / heeft de challenge gepasseerd) is de page wel leesbaar.
// Mijn extensie scrape DOM en stuurt video-URLs naar simple-server.
// Simple-server downloadt met --cookies-from-browser firefox (bestaande
// yt-dlp generic flow die voor #412944 al werkte).
//
// URL-types:
//   /<id>-<slug>/                     → single video (bv. /186797-joi-fr-...feet.../)
//   /tag/<id>-<slug>/[page/N/]        → tag-listing met pagination /page/N/
//   /search/<query>/[page/N/]         → search-listing
//   /category/<slug>/[page/N/]        → category-listing
//
// Knoppen:
//   single video page → ⬇ Download deze video
//   listing page      → 📄 Deze pagina + 🧵 Alle pages (max 30)
(function () {
  'use strict';

  const host = String(window?.location?.hostname || '').toLowerCase().replace(/^www\./, '');
  if (host !== 'darknessporn.com') return;

  const SERVER = 'http://localhost:35729';
  // Geen cap. Stop alleen bij 404 of 2× lege pages.
  const SINGLE_URL_RE = /^\/\d+-[a-z0-9-]+\/?$/i;
  // Pagination /page/N/ kan op het EIND of in midden
  const PAGE_PATH_RE = /\/page\/\d+\/?$/i;
  const VIDEO_LINK_RE = /\/\d+-[a-z0-9-]+\/?$/i;
  const STATE = { busy: false };

  function pathWithoutPage() {
    return String(window.location.pathname || '').replace(/\/page\/\d+\/?$/i, '/');
  }

  function pageType() {
    const path = String(window.location.pathname || '');
    if (SINGLE_URL_RE.test(path)) return 'single';
    // Listing: tag/, search/, category/, of root met page-deel
    if (/^\/(tag|search|category|categories)\//i.test(path)) return 'listing';
    if (PAGE_PATH_RE.test(path)) return 'listing';
    return null;
  }

  function deriveChannel() {
    const path = pathWithoutPage();
    const segs = path.split('/').filter(Boolean);
    // /tag/596-foot-fetish/ → tag_596-foot-fetish
    // /search/<q>/         → search_<q>
    // /category/<slug>/    → category_<slug>
    if (segs.length >= 2) return `${segs[0]}_${segs[1]}`;
    if (segs.length === 1) return segs[0];
    return 'darknessporn';
  }

  function videoUrlsFromDoc(doc) {
    const seen = new Set();
    const urls = [];
    const root = doc || document;
    for (const a of root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (!href) continue;
      let abs;
      try { abs = new URL(href, doc?.baseURI || window.location.href).toString(); }
      catch (_) { continue; }
      let pp;
      try {
        const pu = new URL(abs);
        if (!pu.hostname.toLowerCase().endsWith('darknessporn.com')) continue;
        pp = pu.pathname;
      } catch (_) { continue; }
      if (!VIDEO_LINK_RE.test(pp)) continue;
      // Skip pagination paths zelf (die kunnen ook de pattern matchen)
      if (PAGE_PATH_RE.test(pp)) continue;
      // Skip non-video paths zoals /tag/ , /category/
      if (/^\/(tag|search|category|categories|page)\//i.test(pp)) continue;
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
      // Strip bestaande /page/N/ en append /page/<page>/
      u.pathname = u.pathname.replace(/\/page\/\d+\/?$/i, '/').replace(/\/?$/, '/') + `page/${page}/`;
      return u.toString();
    } catch (_) { return baseHref; }
  }

  async function fetchPageDoc(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  async function collectAllPages(baseHref) {
    // Strip /page/N/ uit baseHref voor consistent page-1 start
    let cleanBase;
    try {
      const u = new URL(baseHref, window.location.href);
      u.pathname = u.pathname.replace(/\/page\/\d+\/?$/i, '/');
      cleanBase = u.toString();
    } catch (_) { cleanBase = baseHref; }

    const allSeen = new Set();
    const allUrls = [];
    let consecutiveEmpty = 0;
    let pagesScanned = 0;
    for (let page = 1; ; page++) {
      let doc;
      try {
        if (page === 1 && cleanBase.replace(/\/$/, '') === window.location.href.split('?')[0].replace(/\/page\/\d+\/?$/, '').replace(/\/$/, '')) {
          doc = document;
        } else {
          doc = await fetchPageDoc(paginationUrl(cleanBase, page));
        }
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
      // Gebruik bestaande /download endpoint (yt-dlp generic flow, gebruikt
      // --cookies-from-browser firefox dus Cloudflare-cookie is mee).
      const res = await fetch(`${SERVER}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, platform: 'darknessporn', channel, title: '' }),
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
    const res = await postVideo(url, channel);
    btn.textContent = (res.ok && res.success)
      ? (res.duplicate ? '✓ Al gedownload' : '✓ In queue')
      : `✗ ${res.error || 'fout'}`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 4000);
  }

  async function handleThisPage(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const channel = deriveChannel();
    const urls = videoUrlsFromDoc(document);
    if (urls.length === 0) {
      btn.textContent = '✗ Geen videos op deze pagina';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      return;
    }
    let nieuw = 0, dup = 0, fail = 0;
    for (let i = 0; i < urls.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${urls.length} → ${channel}`;
      const res = await postVideo(urls[i], channel);
      if (res.ok && res.success) {
        if (res.duplicate) dup++; else nieuw++;
      } else fail++;
    }
    btn.textContent = `✓ ${nieuw} nieuw, ${dup} dup, ${fail} fout`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 8000);
  }

  async function handleAllPages(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const channel = deriveChannel();
    btn.textContent = '⏳ Pages scannen…';
    let urls, pagesScanned;
    try {
      ({ urls, pagesScanned } = await collectAllPages(window.location.href));
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
    let nieuw = 0, dup = 0, fail = 0;
    for (let i = 0; i < urls.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${urls.length} (${pagesScanned}p) → ${channel}`;
      const res = await postVideo(urls[i], channel);
      if (res.ok && res.success) {
        if (res.duplicate) dup++; else nieuw++;
      } else fail++;
    }
    btn.textContent = `✓ ${nieuw} nieuw, ${dup} dup, ${fail} fout (${pagesScanned}p)`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 12000);
  }

  function makeButton(text, color, onClick) {
    const btn = document.createElement('button');
    btn.style.cssText = `background:${color};color:#fff;border:0;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;width:100%;text-align:left;`;
    btn.textContent = text;
    btn.addEventListener('click', () => onClick(btn));
    return btn;
  }

  function renderPanel() {
    const existing = document.getElementById('webdl-darkness-panel');
    if (existing) existing.remove();
    const type = pageType();
    if (!type) return;

    const wrap = document.createElement('div');
    wrap.id = 'webdl-darkness-panel';
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
    header.textContent = '⚡ WEBDL · darknessporn';
    Object.assign(header.style, {
      fontSize: '11px', opacity: '0.7', padding: '2px 4px',
      textTransform: 'uppercase', letterSpacing: '0.5px',
    });
    wrap.appendChild(header);

    if (type === 'single') {
      wrap.appendChild(makeButton('⬇ Download deze video', '#2196F3', handleSingle));
    } else {
      const n = videoUrlsFromDoc(document).length;
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
