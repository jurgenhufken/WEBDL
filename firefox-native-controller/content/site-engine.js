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

  async function collectAllPages(baseHref, onProgress, onPageItems) {
    // 2026-05-30 stream-mode: optionele 3e arg `onPageItems(newItems[])` callback
    // wordt per page aangeroepen met items die NET zijn gevonden + nog niet eerder
    // gezien. Caller kan dispatchen-tijdens-scan zonder eerst alle pages te wachten.
    // Backwards compatible — als niet meegegeven blijft oude batch-flow werken.
    const maxPage = detectMaxPage(document) || Infinity;
    const allSeen = new Set();
    const allItems = [];
    let consecutiveEmpty = 0;
    let pagesScanned = 0;
    for (let page = 1; page <= maxPage; page++) {
      if (typeof onProgress === 'function') {
        try { onProgress({ page, maxPage, items: allItems.length, phase: 'fetching' }); } catch (_) {}
      }
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
      let added = 0;
      const freshThisPage = [];
      for (const it of found) {
        if (!allSeen.has(it.url)) { allSeen.add(it.url); allItems.push(it); freshThisPage.push(it); added++; }
      }
      if (typeof onPageItems === 'function' && freshThisPage.length) {
        try { await onPageItems(freshThisPage, { page, maxPage }); } catch (e) {
          console.warn(`[WEBDL ${cfg.label}] onPageItems page ${page}: ${e.message}`);
        }
      }
      if (typeof onProgress === 'function') {
        try { onProgress({ page, maxPage, items: allItems.length, phase: 'collected', added }); } catch (_) {}
      }
      // Geen nieuwe items op deze pagina = pagination werkt niet (zelfde page
      // returned). 2× achter elkaar = stoppen, anders oneindig loop op sites
      // zonder werkende ?page=N pagination.
      if (added === 0) {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= 2) break;
      }
    }
    return { items: allItems, pagesScanned, maxPage };
  }

  // ─── Batch preview modal ──────────────────────────────────────────
  // Toont alle gevonden items met checkboxes vóór queue. User kan
  // filteren, deselecteren, en bevestigen. Default: alles geselecteerd.
  // Returnt array van geselecteerde items, of [] bij annuleren.
  function showBatchPreview(items, channel, contextLabel) {
    return new Promise((resolve) => {
      const existing = document.getElementById('webdl-batch-preview');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'webdl-batch-preview';
      Object.assign(overlay.style, {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.7)', zIndex: '2147483647',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      });

      const panel = document.createElement('div');
      Object.assign(panel.style, {
        background: '#1e293b', color: '#e2e8f0',
        borderRadius: '8px', width: '720px', maxWidth: '90vw',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      });
      overlay.appendChild(panel);

      // Header
      const header = document.createElement('div');
      header.style.cssText = 'padding:14px 16px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;';
      const title = document.createElement('div');
      title.innerHTML = `<div style="font-weight:600;font-size:14px;">📥 Preview · ${items.length} items klaar voor download</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${contextLabel} → channel: <b>${channel}</b></div>`;
      header.appendChild(title);
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'background:transparent;border:0;color:#94a3b8;font-size:20px;cursor:pointer;padding:0 8px;';
      closeBtn.onclick = () => { overlay.remove(); resolve([]); };
      header.appendChild(closeBtn);
      panel.appendChild(header);

      // Bulk-acties
      const bulk = document.createElement('div');
      bulk.style.cssText = 'padding:8px 16px;border-bottom:1px solid #334155;display:flex;gap:6px;flex-wrap:wrap;align-items:center;';
      const mkBulk = (label, fn) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'background:#334155;color:#e2e8f0;border:0;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;';
        b.onclick = fn;
        return b;
      };
      // Filter-input
      const search = document.createElement('input');
      search.placeholder = 'Filter URL...';
      search.style.cssText = 'background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:4px 8px;border-radius:4px;font-size:12px;width:160px;margin-left:auto;';
      bulk.appendChild(mkBulk('☑ Alles', () => updateChecks(() => true)));
      bulk.appendChild(mkBulk('☐ Niets', () => updateChecks(() => false)));
      // Per type
      const types = [...new Set(items.map((it) => it.type.name))];
      for (const t of types) {
        bulk.appendChild(mkBulk(`Alleen ${t}`, () => updateChecks((it) => it.type.name === t)));
      }
      bulk.appendChild(search);
      panel.appendChild(bulk);

      // Lijst (scrollable)
      const listWrap = document.createElement('div');
      listWrap.style.cssText = 'flex:1;overflow:auto;padding:8px 16px;font-size:12px;';
      const list = document.createElement('div');
      listWrap.appendChild(list);
      panel.appendChild(listWrap);

      const rows = items.map((it, idx) => {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #2d3b53;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.dataset.idx = String(idx);
        const tag = document.createElement('span');
        tag.textContent = it.type.name;
        tag.style.cssText = 'background:#334155;padding:1px 6px;border-radius:3px;font-size:10px;color:#94a3b8;flex-shrink:0;';
        const url = document.createElement('span');
        url.textContent = it.url;
        url.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cbd5e1;font-family:monospace;';
        url.title = it.url;
        row.appendChild(cb);
        row.appendChild(tag);
        row.appendChild(url);
        list.appendChild(row);
        return { row, cb, item: it };
      });

      const counter = document.createElement('div');
      counter.style.cssText = 'padding:8px 16px;border-top:1px solid #334155;font-size:12px;color:#94a3b8;';
      panel.appendChild(counter);
      const updateCounter = () => {
        const sel = rows.filter((r) => r.cb.checked).length;
        counter.textContent = `${sel} van ${items.length} geselecteerd`;
      };
      const updateChecks = (predicate) => {
        for (const r of rows) r.cb.checked = predicate(r.item);
        updateCounter();
        applyFilter();
      };
      const applyFilter = () => {
        const q = search.value.toLowerCase();
        for (const r of rows) r.row.style.display = (!q || r.item.url.toLowerCase().includes(q)) ? '' : 'none';
      };
      search.addEventListener('input', applyFilter);
      list.addEventListener('change', updateCounter);
      updateCounter();

      // Footer met Start/Cancel
      const footer = document.createElement('div');
      footer.style.cssText = 'padding:12px 16px;border-top:1px solid #334155;display:flex;gap:8px;justify-content:flex-end;';
      const cancel = document.createElement('button');
      cancel.textContent = 'Annuleer';
      cancel.style.cssText = 'background:#475569;color:#e2e8f0;border:0;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;';
      cancel.onclick = () => { overlay.remove(); resolve([]); };
      const start = document.createElement('button');
      start.textContent = '⬇ Start downloads';
      start.style.cssText = 'background:#2196F3;color:#fff;border:0;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;';
      start.onclick = () => {
        const selected = rows.filter((r) => r.cb.checked).map((r) => r.item);
        overlay.remove();
        resolve(selected);
      };
      footer.appendChild(cancel);
      footer.appendChild(start);
      panel.appendChild(footer);

      document.body.appendChild(overlay);
    });
  }

  async function postOne(item, channel) {
    const t = item.type;
    const body = t.buildBody(item.url, channel);
    // 2026-05-24: voor sites achter Cloudflare (recu.me) gebruikt de itemType
    // useBrowserDownload:true — extension downloadt zelf via background.
    if (t.useBrowserDownload === true && body && body.url) {
      try {
        const result = await browser.runtime.sendMessage({
          action: 'browserDownload',
          payload: {
            url: body.url,
            filename: body.filename || null,
            metadata: body.metadata || {},
          },
        });
        return { ok: !!(result && result.success), ...result };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }
    // Body kan een sentinel-error object terugsturen
    if (body && body.__webdlError) {
      return { ok: false, error: body.__webdlError };
    }
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
    // Preview-modal: user moet expliciet bevestigen voordat queue start
    btn.textContent = '👁 Preview...';
    const selected = await showBatchPreview(items, channel, 'Deze pagina');
    if (selected.length === 0) {
      btn.textContent = '✗ Geannuleerd';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 2000);
      return;
    }
    let nieuw = 0, dup = 0, fail = 0;
    for (let i = 0; i < selected.length; i++) {
      btn.textContent = `⏳ ${i + 1}/${selected.length} → ${channel}`;
      const res = await postOne(selected[i], channel);
      if (res.ok && (res.success || res.pid)) { if (res.duplicate) dup++; else nieuw++; }
      else fail++;
    }
    btn.textContent = `✓ ${nieuw} nieuw${dup ? `, ${dup} dup` : ''}, ${fail} fout`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 8000);
    // tab mag weer ge-discard na korte tijd zodra resultaat zichtbaar is
    try { browser.runtime.sendMessage({ action: 'allowAutoDiscard' }).catch(() => {}); } catch (_) {}
  }

  async function handleAllPages(btn) {
    if (STATE.busy) return;
    STATE.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    const baseHref = window.location.href.split('#')[0];
    const channel = cfg.deriveChannel(baseHref);
    btn.textContent = '⏳ Start streamen…';
    // 2026-05-30 Jürgen: voorkom dat Firefox deze tab tijdens scan unloadt
    try { browser.runtime.sendMessage({ action: 'preventAutoDiscard' }).catch(() => {}); } catch (_) {}

    // 2026-05-30 Jürgen: stream-mode — items direct queuen per page i.p.v.
    // eerst alle pages scannen + preview-modal. Voor grote scans (3000+ pages)
    // begint download al na ~5s i.p.v. minuten/uren wachten. Geen preview want
    // bij "Alle pages" is dat sowieso onpraktisch (1M+ items).
    let nieuw = 0, dup = 0, fail = 0, total = 0;
    const byType = {};  // { video: N, album: N, image: N } per type-naam
    let lastQueued = '';  // korte hint voor user — wat werd net gequeued
    let pagesScanned, maxPage;
    function typeBreakdown() {
      const parts = Object.entries(byType).map(([n, c]) => {
        const ic = n === 'video' ? '🎬' : n === 'album' ? '📚' : n === 'image' ? '🖼' : '📄';
        return `${ic}${c}`;
      });
      return parts.length ? ` (${parts.join(' ')})` : '';
    }
    try {
      ({ pagesScanned, maxPage } = await collectAllPages(
        baseHref,
        (p) => {
          const totLabel = Number.isFinite(p.maxPage) ? `/${p.maxPage}` : '';
          btn.textContent = `⏳ p${p.page}${totLabel} · ${total}q${typeBreakdown()} · ${nieuw}n ${dup}d ${fail}f${lastQueued ? ' · ' + lastQueued : ''}`;
        },
        async (newItems, info) => {
          for (const it of newItems) {
            total += 1;
            const tname = (it.type && it.type.name) || 'item';
            byType[tname] = (byType[tname] || 0) + 1;
            const lbl = String(it.url || '').split('/').filter(Boolean).pop() || '';
            lastQueued = `→ ${tname}: ${lbl.slice(0, 30)}`;
            btn.textContent = `⏳ p${pagesScanned || 1}${Number.isFinite(maxPage) ? '/' + maxPage : ''} · ${total}q${typeBreakdown()} · ${nieuw}n ${dup}d ${fail}f · ${lastQueued}`;
            const res = await postOne(it, channel);
            if (res && res.ok && (res.success || res.pid)) {
              if (res.duplicate) dup += 1; else nieuw += 1;
            } else {
              fail += 1;
              // 2026-05-30: laatste-fout zichtbaar in counter zodat user weet WAAROM.
              // Duplicates komen NIET hier — die zitten in res.duplicate met res.ok=true.
              const errSrc = (res && (res.error || res.text || res.message)) || 'unknown';
              lastQueued = `⚠ ${String(errSrc).slice(0, 50)}`;
            }
          }
        }
      ));
    } catch (e) {
      btn.textContent = `✗ Scan fout: ${e.message}`;
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 5000);
      try { browser.runtime.sendMessage({ action: 'allowAutoDiscard' }).catch(() => {}); } catch (_) {}
      return;
    }
    const maxLabel = Number.isFinite(maxPage) ? `${pagesScanned}/${maxPage}p` : `${pagesScanned}p`;
    if (total === 0) {
      btn.textContent = '✗ Geen items gevonden';
      setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 3000);
      try { browser.runtime.sendMessage({ action: 'allowAutoDiscard' }).catch(() => {}); } catch (_) {}
      return;
    }
    btn.textContent = `✓ ${nieuw} nieuw${typeBreakdown()}${dup ? `, ${dup} dup` : ''}${fail ? `, ${fail} fout` : ''} (${maxLabel})`;
    setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 15000);
    try { browser.runtime.sendMessage({ action: 'allowAutoDiscard' }).catch(() => {}); } catch (_) {}
  }

  // ─── Render ────────────────────────────────────────────────────────

  function makeButton(text, color, onClick) {
    const btn = document.createElement('button');
    btn.style.cssText = `background:${color};color:#fff;border:0;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;width:100%;text-align:left;`;
    btn.textContent = text;
    btn.addEventListener('click', () => onClick(btn));
    return btn;
  }

  // ───────────────────────────────────────────────────────────────────
  // JOBS-MODE — voor sites die ARCHITECTURE.md nieuwe stack gebruiken
  // (cfg.useJobsApi === true). POSTt naar /api/jobs server-side, polt
  // /api/jobs/:id voor live progress. Geen per-item POST /download.
  // ───────────────────────────────────────────────────────────────────

  async function startJob(intent) {
    const url = window.location.href.split('#')[0];
    try {
      const res = await fetch(`${SERVER}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) return { ok: false, error: data.error || `HTTP ${res.status}` };
      return { ok: true, jobId: data.jobId, channel: data.channel };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  async function pollJob(jobId) {
    try {
      const res = await fetch(`${SERVER}/api/jobs/${jobId}`);
      const data = await res.json();
      if (!data.success) return null;
      return data.job;
    } catch (_) { return null; }
  }

  function makeJobsHandler(intent, label) {
    return async (btn) => {
      if (STATE.busy) return;
      STATE.busy = true;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = `⏳ Job starten...`;

      const start = await startJob(intent);
      if (!start.ok) {
        btn.textContent = `✗ ${start.error}`;
        setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 5000);
        return;
      }

      btn.textContent = `▶ Job #${start.jobId} loopt...`;
      const channelHint = panel.querySelector('.webdl-job-channel');
      if (channelHint) channelHint.textContent = `→ channel: ${start.channel}`;

      // Polling loop — elke 2s status updaten in panel
      const startTs = Date.now();
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        const j = await pollJob(start.jobId);
        if (!j) {
          btn.textContent = `? job verloren`;
          setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 5000);
          stopped = true;
          return;
        }
        const elapsed = Math.round((Date.now() - startTs) / 1000);
        const pages = j.pagesTotal > 1 ? ` · page ${j.pagesScanned}/${j.pagesTotal}` : '';
        if (j.status === 'running' || j.status === 'queued') {
          btn.textContent = `⏳ ${j.itemsDispatched}/${j.itemsTotal}${pages} · ${elapsed}s`;
          setTimeout(tick, 2000);
        } else if (j.status === 'done') {
          btn.textContent = `✓ ${j.itemsDispatched}/${j.itemsTotal} klaar (${elapsed}s${pages})`;
          setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 12000);
          stopped = true;
        } else if (j.status === 'error') {
          btn.textContent = `✗ ${j.error || 'fout'}`;
          setTimeout(() => { btn.disabled = false; btn.textContent = original; STATE.busy = false; }, 8000);
          stopped = true;
        } else {
          setTimeout(tick, 2000);
        }
      };
      setTimeout(tick, 500);
    };
  }

  let panel = null; // referentie zodat handlers status-elementen kunnen vinden

  function renderJobsPanel(type) {
    panel = document.createElement('div');
    panel.id = 'webdl-site-panel';
    Object.assign(panel.style, {
      position: 'fixed', top: '12px', right: '12px',
      zIndex: '2147483646',
      background: 'rgba(20,20,30,0.94)', color: '#fff',
      padding: '8px', borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      minWidth: '300px',
      display: 'flex', flexDirection: 'column', gap: '4px',
    });

    const header = document.createElement('div');
    const _ver = (() => { try { return (browser.runtime.getManifest() || {}).version || ''; } catch (_) { return ''; } })();
    header.textContent = `⚡ WEBDL${_ver ? ' v' + _ver : ''} · ${cfg.label} · jobs-mode`;
    Object.assign(header.style, {
      fontSize: '11px', opacity: '0.7', padding: '2px 4px',
      textTransform: 'uppercase', letterSpacing: '0.5px',
    });
    panel.appendChild(header);

    if (type === 'single') {
      panel.appendChild(makeButton('⬇ Download dit item', '#2196F3', makeJobsHandler('single', 'single')));
    } else if (type === 'listing') {
      panel.appendChild(makeButton('📄 Deze pagina', '#1565C0', makeJobsHandler('page', 'page')));
      panel.appendChild(makeButton('🧵 Hele thread (alle pages)', '#0ea5e9', makeJobsHandler('whole-thread', 'whole-thread')));
    } else if (type === 'forum') {
      panel.appendChild(makeButton('📚 Forum-scan (alle threads)', '#7c3aed', makeJobsHandler('forum-scan', 'forum-scan')));
    }

    const hint = document.createElement('div');
    hint.className = 'webdl-job-channel';
    hint.textContent = `→ channel: ${cfg.deriveChannel(window.location.href)}`;
    Object.assign(hint.style, { fontSize: '10px', opacity: '0.6', padding: '2px 4px' });
    panel.appendChild(hint);

    document.body.appendChild(panel);
  }

  // ───────────────────────────────────────────────────────────────────

  // 2026-05-25: persist panel-state (collapsed + custom positie) per host
  // zodat refresh hetzelfde resultaat geeft. User-klacht: "panel staat altijd
  // in de weg en springt terug bij refresh".
  const PANEL_STATE_KEY = `webdl_panel_state_${window.location.hostname}`;
  function loadPanelState() {
    try { return JSON.parse(localStorage.getItem(PANEL_STATE_KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function savePanelState(patch) {
    try {
      const cur = loadPanelState();
      const next = { ...cur, ...patch };
      localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(next));
    } catch (_) {}
  }

  // Wikkel een panel-element in collapse + drag-functionaliteit.
  // Drukt panel terug naar een tiny ⚡ badge bij collapse. State per host
  // bewaard zodat refresh dezelfde toestand geeft.
  function wrapPanelControls(panel, label) {
    const state = loadPanelState();
    // Positie restore
    if (state.left != null && state.top != null) {
      panel.style.left = state.left + 'px';
      panel.style.top = state.top + 'px';
      panel.style.right = 'auto';
    }

    // Collapse-knop in header
    const ctrl = document.createElement('div');
    Object.assign(ctrl.style, {
      position: 'absolute', top: '4px', right: '4px',
      display: 'flex', gap: '4px', fontSize: '12px',
    });
    const collapseBtn = document.createElement('span');
    collapseBtn.textContent = '−';
    collapseBtn.title = 'Inklappen (klik op badge om weer te tonen)';
    Object.assign(collapseBtn.style, {
      cursor: 'pointer', padding: '0 6px', borderRadius: '3px',
      background: 'rgba(255,255,255,0.1)', userSelect: 'none',
    });
    collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); collapse(); });
    ctrl.appendChild(collapseBtn);
    panel.style.position = 'fixed';
    panel.style.paddingTop = '20px';
    panel.appendChild(ctrl);

    // Drag-handle: het panel zelf is sleepbaar
    let dragStart = null;
    panel.addEventListener('mousedown', (e) => {
      // 2026-05-30: was `=== 'SPAN'` blokkeerde ALLE drag — paneel-header bevat
      // span-elementen voor label/icoon (niet-interactief). Skip alleen echt
      // interactieve elementen zodat drag werkt op header + tussen-knoppen-witruimte.
      const tag = e.target.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A') return;
      const r = panel.getBoundingClientRect();
      dragStart = { x: e.clientX, y: e.clientY, l: r.left, t: r.top };
      panel.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragStart) return;
      const newL = dragStart.l + (e.clientX - dragStart.x);
      const newT = dragStart.t + (e.clientY - dragStart.y);
      panel.style.left = newL + 'px';
      panel.style.top = newT + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (dragStart) {
        const r = panel.getBoundingClientRect();
        savePanelState({ left: r.left, top: r.top });
        panel.style.cursor = '';
      }
      dragStart = null;
    });

    function collapse() {
      panel.style.display = 'none';
      const badge = document.createElement('div');
      badge.id = 'webdl-site-badge';
      badge.title = `WEBDL · ${label} (klik om uit te klappen)`;
      Object.assign(badge.style, {
        position: 'fixed', top: '8px', right: '8px',
        zIndex: '2147483646',
        width: '28px', height: '28px',
        borderRadius: '50%',
        background: 'rgba(20,20,30,0.85)', color: '#0ea5e9',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '14px', cursor: 'pointer',
        boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
      });
      const st = loadPanelState();
      if (st.badgeLeft != null && st.badgeTop != null) {
        badge.style.left = st.badgeLeft + 'px';
        badge.style.top = st.badgeTop + 'px';
        badge.style.right = 'auto';
      }
      badge.textContent = '⚡';
      badge.addEventListener('click', () => {
        badge.remove();
        panel.style.display = 'flex';
        savePanelState({ collapsed: false });
      });
      document.body.appendChild(badge);
      savePanelState({ collapsed: true });
    }

    if (state.collapsed) {
      // Wacht 1 tick zodat panel in DOM zit
      setTimeout(collapse, 0);
    }
  }

  function renderPanel() {
    const existing = document.getElementById('webdl-site-panel');
    if (existing) existing.remove();
    const existingBadge = document.getElementById('webdl-site-badge');
    if (existingBadge) existingBadge.remove();
    const type = pageType();
    if (!type) return;

    // Jobs-mode: nieuwe stack
    if (cfg.useJobsApi) {
      renderJobsPanel(type);
      const p = document.getElementById('webdl-site-panel');
      if (p) wrapPanelControls(p, `${cfg.label} · jobs`);
      return;
    }

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
    const _ver = (() => { try { return (browser.runtime.getManifest() || {}).version || ''; } catch (_) { return ''; } })();
    header.textContent = `⚡ WEBDL${_ver ? ' v' + _ver : ''} · ${cfg.label}`;
    Object.assign(header.style, {
      fontSize: '11px', opacity: '0.7', padding: '2px 4px',
      textTransform: 'uppercase', letterSpacing: '0.5px',
    });
    wrap.appendChild(header);

    // 2026-05-30: sites met itemTypes:[] (chaturbate, sexygirlspics-quarantaine)
    // tonen GEEN download-/scan-knoppen — die zijn verwarrend en doen niets.
    // extraButtons (recu.me/stripchat etc.) komen later toch wel.
    const hasItemTypes = Array.isArray(cfg.itemTypes) && cfg.itemTypes.length > 0;
    if (type === 'single' && hasItemTypes) {
      const url = window.location.href.split('#')[0];
      const t = itemTypeForUrl(url);
      const label = t ? (t.singleLabel || '⬇ Download') : '✗ Onbekend item-type';
      const color = t && t.color || '#2196F3';
      wrap.appendChild(makeButton(label, color, handleSingle));
    } else if (hasItemTypes) {
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
    }
    // Channel-hint altijd tonen (ook voor sites met alleen extraButtons)
    if (hasItemTypes || (Array.isArray(cfg.extraButtons) && cfg.extraButtons.length > 0)) {
      const hint = document.createElement('div');
      hint.textContent = `→ channel: ${cfg.deriveChannel(window.location.href)}`;
      Object.assign(hint.style, { fontSize: '10px', opacity: '0.6', padding: '2px 4px' });
      wrap.appendChild(hint);
    }

    // 2026-05-30 (Jürgen "geen debug toolbar"): vaste globale knoppen onderaan
    // — overal hetzelfde, vervangt Screenshot/REC die voorheen alleen in de
    // (nu verborgen) debug-toolbar zaten.
    function callBg(action, payload = {}) {
      return new Promise((resolve) => {
        try {
          const send = (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage)
            ? browser.runtime.sendMessage.bind(browser.runtime)
            : (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage
              ? chrome.runtime.sendMessage.bind(chrome.runtime) : null);
          if (!send) return resolve({ success: false, error: 'no-runtime' });
          const cb = (resp) => resolve(resp || { success: true });
          const ret = send({ action, payload });
          if (ret && typeof ret.then === 'function') ret.then(cb, (e) => resolve({ success: false, error: String(e) }));
        } catch (e) { resolve({ success: false, error: String(e.message || e) }); }
      });
    }
    const sigil = document.createElement('div');
    Object.assign(sigil.style, { display: 'flex', gap: '4px', flexWrap: 'wrap', padding: '6px 0 2px', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '4px' });
    const mkGlobal = (label, color, action, payload) => {
      const b = makeButton(label, color, async (btn) => {
        if (STATE.busy) return;
        STATE.busy = true; btn.disabled = true;
        const orig = btn.textContent;
        try {
          const r = await callBg(action, payload || {});
          btn.textContent = (r && r.success !== false) ? '✓' : ('✗ ' + (r && r.error || 'fout'));
        } finally {
          setTimeout(() => { btn.disabled = false; btn.textContent = orig; STATE.busy = false; }, 2000);
        }
      });
      Object.assign(b.style, { flex: '1 1 auto', minWidth: '90px', fontSize: '12px' });
      sigil.appendChild(b);
    };
    mkGlobal('📸 Screenshot', '#4CAF50', 'takeScreenshot', { videoOnly: false });
    mkGlobal('🔴 REC start', '#dc2626', 'startRecording', { url: window.location.href });
    mkGlobal('■ REC stop', '#475569', 'stopRecording', {});
    wrap.appendChild(sigil);


    // 2026-05-30: extraButtons support — site-config kan custom action-knoppen
    // declareren die geen download zijn (bv. "open elders", "open dashboard").
    // Pattern: cfg.extraButtons = [{ label, color, onClick(ctx) }]
    // waar ctx = { url, channel, pageType, type }.
    if (Array.isArray(cfg.extraButtons)) {
      for (const xb of cfg.extraButtons) {
        if (!xb || !xb.label || typeof xb.onClick !== 'function') continue;
        if (xb.match && typeof xb.match === 'function') {
          try { if (!xb.match(type, window.location.href)) continue; } catch (_) { continue; }
        }
        const btn = makeButton(xb.label, xb.color || '#7c3aed', async (b) => {
          if (STATE.busy) return;
          STATE.busy = true; b.disabled = true;
          const orig = b.textContent;
          try {
            const ctx = {
              url: window.location.href.split('#')[0],
              channel: cfg.deriveChannel(window.location.href),
              pageType: type,
            };
            const r = await xb.onClick(ctx);
            b.textContent = (r && r.text) || '✓';
          } catch (e) {
            b.textContent = '✗ ' + (e && e.message || 'fout');
          } finally {
            setTimeout(() => { b.disabled = false; b.textContent = orig; STATE.busy = false; }, 2500);
          }
        });
        wrap.appendChild(btn);
      }
    }

    // 2026-05-30 (Jürgen "1 addon"-merge): site-specifieke knoppen-blok IN
    // de bestaande debug-toolbar plaatsen, niet een tweede paneel. Wacht
    // tot debug-toolbar bestaat (kort polling), dan injecteren als child
    // van #webdl-toolbar. Fallback naar document.body (geen debug-toolbar
    // bv. wegens iframe of error).
    // 2026-05-30 (Jürgen "geen debug toolbar"): site-engine paneel is nu de
    // enige zichtbare UI — debug-toolbar staat op display:none. Wrap rendert
    // dus drijvend op document.body zoals voorheen.
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
