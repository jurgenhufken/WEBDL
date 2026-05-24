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
  const VIDEO_LINK_SEL = 'div.videobox a[href*="video.php?id="]';
  const STATE = { busy: false };

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

  function videoUrlsFromPage() {
    const seen = new Set();
    const urls = [];
    for (const a of document.querySelectorAll(VIDEO_LINK_SEL)) {
      let href = a.getAttribute('href') || '';
      if (!href) continue;
      let abs;
      try { abs = new URL(href, window.location.href).toString(); }
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
    btn.textContent = `✓ ${nieuw} ingeschoten, ${fail} fout`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 10000);
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
