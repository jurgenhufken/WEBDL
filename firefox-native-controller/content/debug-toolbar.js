// WEBDL Toolbar - Video downloader & screenshot tool
(function() {
  try {
    const host = String((window && window.location && window.location.hostname) || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return;
  } catch (e) {}

  const WEBDL_BUILD = 'debug-toolbar-2026-04-16-23-10';
  console.log("WEBDL toolbar script geladen!", WEBDL_BUILD);
  const SERVER = 'http://localhost:35729';
  const SERVER_FALLBACK = 'http://127.0.0.1:35729';
  const REQUEST_TIMEOUT_MS = 15000;

  function summarizeUrlsByHost(urls) {
    const counts = new Map();
    for (const raw of (Array.isArray(urls) ? urls : [])) {
      try {
        const u = new URL(String(raw || ''), window.location.href);
        const host = String(u.hostname || '').toLowerCase();
        if (!host) continue;
        counts.set(host, (counts.get(host) || 0) + 1);
      } catch (e) {}
    }
    const rows = Array.from(counts.entries()).sort((a, b) => (b[1] || 0) - (a[1] || 0));
    return rows.slice(0, 25);
  }

  function shouldDebugBatch(meta, clickEvent) {
    try {
      const forced = !!(clickEvent && (clickEvent.altKey || clickEvent.shiftKey || clickEvent.metaKey));
      if (forced) return true;
    } catch (e) {}
    try {
      if (isFootFetishForumThreadPage() || isFootFetishForumForumPage()) return true;
    } catch (e) {}
    try {
      if (isAmateurVoyeurForumThreadPage()) return true;
    } catch (e) {}
    try {
      const flag = String(localStorage.getItem('WEBDL_DEBUG_BATCH_URLS') || '').trim();
      return flag === '1' || flag.toLowerCase() === 'true';
    } catch (e) {}
    return false;
  }

  function debugLogBatchUrls(label, urls, meta) {
    try {
      const list = Array.isArray(urls) ? urls : [];
      const hostSummary = summarizeUrlsByHost(list);

      try {
        window.__WEBDL_LAST_BATCH_URLS = list;
        window.__WEBDL_LAST_BATCH_META = meta || null;
        window.__WEBDL_LAST_BATCH_HOSTS = hostSummary;
      } catch (e) {}

      try { console.log(`[WEBDL][batch] ${label}.hosts`, hostSummary); } catch (e) {}
      try { console.log(`[WEBDL][batch] ${label}.urls`, list); } catch (e) {}

      console.groupCollapsed(`[WEBDL][batch] ${label}: ${list.length} urls`);
      try { console.log('meta', meta); } catch (e) {}
      try { console.log('hosts', hostSummary); } catch (e) {}
      try { console.log('urls', list); } catch (e) {}
      console.groupEnd();
    } catch (e) {}
  }

  function pickFirstMatchingText(selectorList) {
    try {
      const raw = String(selectorList || '');
      const parts = raw.split(',').map((s) => String(s || '').trim()).filter(Boolean);
      for (const sel of parts) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const text = String(el.textContent || '').trim();
        if (!text) continue;
        const href = String(el.getAttribute && el.getAttribute('href') ? el.getAttribute('href') : '').trim();
        return { text, selector: sel, href };
      }
    } catch (e) {}
    return { text: '', selector: '', href: '' };
  }

  const ONLYFANS_RESERVED_SEGMENTS = new Set(['posts', 'my', 'home', 'notifications', 'messages', 'bookmarks', 'lists', 'subscriptions', 'settings', 'chats', 'chat', 'discover', 'vault', 'stories']);

  function normalizeOnlyFansUsername(value) {
    try {
      const raw = String(value || '').trim().replace(/^@+/, '').replace(/^\/+|\/+$/g, '');
      if (!raw) return '';
      const first = raw.split(/[\/?#]/)[0];
      if (!first) return '';
      if (/^\d+$/.test(first)) return '';
      if (!/^[a-z0-9._-]{2,80}$/i.test(first)) return '';
      if (ONLYFANS_RESERVED_SEGMENTS.has(first.toLowerCase())) return '';
      return first;
    } catch (e) {}
    return '';
  }

  function extractOnlyFansUsernameFromUrl(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl || ''), window.location.href);
      const host = String(parsed.hostname || '').toLowerCase();
      if (!(host === 'onlyfans.com' || host.endsWith('.onlyfans.com'))) return '';
      const parts = String(parsed.pathname || '').split('/').filter(Boolean);
      for (const part of parts) {
        const user = normalizeOnlyFansUsername(part);
        if (user) return user;
      }
    } catch (e) {}
    return '';
  }

  function findOnlyFansPageUsername() {
    try {
      const direct = extractOnlyFansUsernameFromUrl(window.location.href);
      if (direct) return direct;
    } catch (e) {}

    const scores = new Map();
    const bump = (candidate, weight = 1) => {
      const user = normalizeOnlyFansUsername(candidate);
      if (!user) return;
      scores.set(user, (scores.get(user) || 0) + weight);
    };
    const bumpUrl = (candidateUrl, weight = 1) => {
      const user = extractOnlyFansUsernameFromUrl(candidateUrl);
      if (user) bump(user, weight);
    };

    try {
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) bumpUrl(canonical.href || canonical.getAttribute('href') || '', 8);
    } catch (e) {}
    try {
      const ogUrl = document.querySelector('meta[property="og:url"], meta[name="twitter:url"]');
      if (ogUrl) bumpUrl(ogUrl.content || ogUrl.getAttribute('content') || '', 7);
    } catch (e) {}

    try {
      const anchors = Array.from(document.querySelectorAll('a[href]')).slice(0, 600);
      for (const a of anchors) {
        try {
          const href = String(a.getAttribute('href') || '').trim();
          if (!href) continue;
          const fromHref = extractOnlyFansUsernameFromUrl(href);
          if (!fromHref) continue;
          let weight = 1;
          if (a.closest && a.closest('header')) weight += 4;
          const textUser = normalizeOnlyFansUsername(String(a.textContent || '').trim());
          if (textUser && textUser.toLowerCase() === fromHref.toLowerCase()) weight += 4;
          bump(fromHref, weight);
        } catch (e) {}
      }
    } catch (e) {}

    let best = '';
    let bestScore = 0;
    for (const [user, score] of scores.entries()) {
      if (score > bestScore) {
        best = user;
        bestScore = score;
      }
    }
    if (best) return best;

    try {
      const title = String(document.title || '').trim();
      const atMatch = title.match(/@([a-z0-9._-]{2,80})/i);
      if (atMatch && atMatch[1]) return normalizeOnlyFansUsername(atMatch[1]);
    } catch (e) {}

    return '';
  }

  function isFootFetishForumAttachmentUrl(rawUrl, baseHref) {
    try {
      const u = new URL(String(rawUrl || ''), baseHref || window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return false;
      return /\/(attachments?|attach)\//i.test(String(u.pathname || ''));
    } catch (e) {}
    return false;
  }

  function isKnownExternalMediaWrapperHost(hostname) {
    try {
      const host = String(hostname || '').toLowerCase();
      if (!host) return false;
      if (/^(?:www\.)?(?:pixhost\.to|postimages\.org|postimg\.cc|imagebam\.com|imgvb\.com|ibb\.co|imgbox\.com|imagevenue\.com|imgchest\.com|turboimagehost\.com|imx\.to|vipr\.im|pixeldrain\.com|cyberfile\.me|jpg\.pet|gofile\.io|erome\.com|img\.kiwi)$/.test(host)) return true;
      if (/^(?:www\.)?bunkr\.(?:si|ru|is|ph)$/.test(host)) return true;
    } catch (e) {}
    return false;
  }

  function getServerCandidates() {
    const seen = new Set();
    const out = [];
    for (const base of [SERVER, SERVER_FALLBACK]) {
      const s = String(base || '').trim().replace(/\/+$/, '');
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function collectFootFetishForumCandidatesFromDocument(doc, baseHref, maxItems = 2000) {
    const out = [];
    const seen = new Set();

    const push = (raw, kind) => {
      try {
        const s = String(raw || '').trim();
        if (!s) return;
        if (/^(data:|blob:|javascript:|mailto:)/i.test(s)) return;
        let u = new URL(s, baseHref);
        u.hash = '';
        let host = String(u.hostname || '').toLowerCase();
        let p = String(u.pathname || '').toLowerCase();
        if (!/^https?:$/i.test(String(u.protocol || ''))) return;

        if (p.includes('/data/avatars/')) return;
        if (host === 'cdn.jsdelivr.net' && p.includes('/joypixels/')) return;
        if (/\b(twemoji|emoji)\b/i.test(p)) return;
        if (/\b(graemlins|smilies|smilies\b)\b/i.test(p)) return;
        if (/apple-touch-icon|favicon|site-logo|logo\.\w+$|\/icons?\//i.test(p)) return;
        if (p === '/attachments/upload') return;
        if (p === '/proxy.php') {
          try {
            const img = u.searchParams ? (u.searchParams.get('image') || '') : '';
            const low = String(img || '').toLowerCase();
            if (low.includes('joypixels') || low.includes('twemoji') || low.includes('graemlins') || low.includes('smilies') || low.includes('smilies/')) return;
            if (/^https?:\/\//i.test(low)) {
              const u2 = new URL(img);
              u2.hash = '';
              u = u2;
              host = String(u.hostname || '').toLowerCase();
              p = String(u.pathname || '').toLowerCase();
            }
          } catch (e) {}
        }

        if ((host === 'pixhost.to' || host.endsWith('.pixhost.to')) && p.includes('/thumbs/')) {
          try {
            const rawPath = String(u.pathname || '');
            const m = rawPath.match(/^\/thumbs\/([^\/]+)\/([^\/]+)$/i);
            if (m && m[1] && m[2]) {
              const u2 = new URL(`https://pixhost.to/show/${m[1]}/${m[2]}`);
              u2.hash = '';
              u = u2;
            } else {
              return;
            }
          } catch (e) {
            return;
          }
        }

        const final = u.toString();
        if (seen.has(final)) return;
        seen.add(final);
        out.push({ url: final, el: null, kind: kind || '' });
      } catch (e) {}
    };

    const contentRoots = Array.from(doc.querySelectorAll(
      'article, .message, .message-main, .message-body, .message-content, .message-userContent, .message-attachments, .bbWrapper, .post-body'
    )).filter(Boolean);

    const roots = contentRoots.length ? contentRoots : [doc.body || doc.documentElement];
    for (const root of roots) {
      if (!root) continue;
      try {
        for (const img of Array.from(root.querySelectorAll('img'))) {
          if (out.length >= maxItems) return out;
          try {
            const cls = String(img.className || '').toLowerCase();
            if (/\b(avatar|emoji|emote|smilie|reaction|logo|icon)\b/i.test(cls)) continue;
          } catch (e) {}

          let hadParentLink = false;
          try {
            const parentLink = img.closest ? img.closest('a[href], a[data-href], a[data-url]') : null;
            if (parentLink && parentLink.getAttribute) {
              const href = parentLink.getAttribute('href') || parentLink.getAttribute('data-href') || parentLink.getAttribute('data-url');
              if (href) {
                try {
                  const linkUrl = new URL(href, baseHref);
                  const linkHost = String(linkUrl.hostname || '').toLowerCase();
                  const isFffAttachment = isFootFetishForumAttachmentUrl(href, baseHref);
                  const isFile = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv)(\?|$)/i.test(href);
                  const isExternalMedia = !(linkHost === 'footfetishforum.com' || linkHost.endsWith('.footfetishforum.com')) && looksLikeExternalMediaPageUrl(linkUrl.toString(), parentLink.textContent || '');
                  const isUploadSite = linkHost === 'upload.footfetishforum.com' || linkHost.endsWith('.upload.footfetishforum.com') || isKnownExternalMediaWrapperHost(linkHost) || /pixhost|postimg|imgur|redgifs|gfycat/i.test(linkHost);
                  if (isFffAttachment || isFile || isExternalMedia || isUploadSite) {
                    // For upload.footfetishforum.com/image/ wrapper, use <img> src (direct URL)
                    if ((linkHost === 'upload.footfetishforum.com' || linkHost.endsWith('.upload.footfetishforum.com')) && /^\/image\//i.test(String(linkUrl.pathname || ''))) {
                      const imgSrc = img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || '';
                      if (imgSrc && /upload\.footfetishforum\.com\/images\//i.test(imgSrc)) {
                        push(imgSrc, 'fff_upload_direct');
                      } else {
                        push(href, 'thumb_link');
                      }
                    } else {
                      push(href, 'thumb_link');
                    }
                    hadParentLink = true;
                  }
                } catch (e) {
                  push(href, 'thumb_link');
                  hadParentLink = true;
                }
              }
            }
          } catch (e) {}

          if (hadParentLink) continue;

          push(img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-url'), 'img');
          const srcset = String(img.getAttribute('srcset') || '').trim();
          if (srcset) {
            const parts = srcset.split(',').map(s => String(s || '').trim()).filter(Boolean);
            for (const part of parts) {
              const first = part.split(/\s+/)[0];
              if (first) push(first, 'img_srcset');
              if (out.length >= maxItems) return out;
            }
          }
        }
      } catch (e) {}

      try {
        for (const v of Array.from(root.querySelectorAll('video'))) {
          if (out.length >= maxItems) return out;
          push(v.currentSrc || v.src || v.getAttribute('src'), 'video');
          try {
            for (const s of Array.from(v.querySelectorAll('source'))) {
              push(s.src || s.getAttribute('src'), 'video_source');
              if (out.length >= maxItems) return out;
            }
          } catch (e) {}
        }
      } catch (e) {}

      try {
        for (const a of Array.from(root.querySelectorAll('a[href], a[data-href], a[data-url]'))) {
          if (out.length >= maxItems) return out;
          const href = a.getAttribute('href') || a.getAttribute('data-href') || a.getAttribute('data-url');
          if (!href) continue;
          try {
            const abs = new URL(href, baseHref);
            abs.hash = '';
            const s = abs.toString();
            const host = String(abs.hostname || '').toLowerCase();
            const path = String(abs.pathname || '').toLowerCase();

            const text = String(a.textContent || '').trim().toLowerCase();
            const cls = String(a.className || '').toLowerCase();
            const looksLikeFile = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv|mp3|m4a|zip|rar|7z)(\?|$)/i.test(s);
            const looksLikeAttachment = /\battachment\b|\battachments\b|\/attachments\//i.test(path) || /attachment|download|full\s*size/i.test(text) || /attachment|download/i.test(cls);
            let looksLikeExternalMedia = looksLikeExternalMediaPageUrl(s, text);
            if (looksLikeExternalMedia && (host === 'twitter.com' || host === 'x.com') && !/\/status\//i.test(path)) {
              looksLikeExternalMedia = false;
            }
            if (looksLikeFile || looksLikeAttachment || looksLikeExternalMedia) push(s, 'a');
          } catch (e) {}
        }
      } catch (e) {}

      try {
        const raw = String(root && root.textContent ? root.textContent : '');
        if (raw) {
          const re = /(https?:\/\/[^\s)\]"']+)/g;
          let m;
          while ((m = re.exec(raw)) && out.length < maxItems) {
            const s = String(m[1] || '').replace(/[),\]."']+$/g, '').trim();
            if (!s) continue;
            try {
              const parsed = new URL(s);
              const host = String(parsed.hostname || '').toLowerCase();
              const looksLikeFile = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv|mp3|m4a)(\?|$)/i.test(s);
              const looksLikeExternalMedia = looksLikeExternalMediaPageUrl(s, '');
              if (looksLikeFile || looksLikeExternalMedia || host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com')) {
                push(s, 'text');
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    return out;
  }

  function findNextFootFetishForumThreadPageUrl(doc, baseHref) {
    try {
      const selectors = [
        'link[rel="next"][href]',
        'a[rel="next"][href]',
        'a.pageNav-jump--next[href]',
        '.pageNav-jump--next a[href]',
        '.pageNav a[rel="next"][href]'
      ];
      for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (!el) continue;
        const href = el.getAttribute('href');
        if (!href) continue;
        const abs = new URL(href, baseHref);
        abs.hash = '';
        return abs.toString();
      }
    } catch (e) {}
    return '';
  }

  function collectFootFetishForumThreadLinksFromForumDocument(doc, baseHref, maxThreads = 200) {
    const out = [];
    const seen = new Set();
    const push = (raw) => {
      try {
        if (out.length >= maxThreads) return;
        const u = new URL(String(raw || ''), baseHref);
        u.hash = '';
        const host = String(u.hostname || '').toLowerCase();
        if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return;
        const m = String(u.pathname || '').match(/\/threads\/[^\/\?#]*\.(\d+)(?:\/|\?|#|$)/i);
        if (!m || !m[1]) return;
        u.search = '';
        const final = u.toString();
        const key = m[1];
        if (seen.has(key)) return;
        seen.add(key);
        out.push(final);
      } catch (e) {}
    };

    try {
      const roots = Array.from(doc.querySelectorAll(
        '.structItemContainer, .discussionList, .block-container, .block-body, main, body'
      )).filter(Boolean);
      for (const root of (roots.length ? roots : [doc.body || doc.documentElement])) {
        if (!root) continue;
        for (const a of Array.from(root.querySelectorAll('a[href]'))) {
          push(a.getAttribute('href'));
          if (out.length >= maxThreads) break;
        }
        if (out.length >= maxThreads) break;
      }
    } catch (e) {}
    return out;
  }

  function findNextFootFetishForumForumPageUrl(doc, baseHref) {
    return findNextFootFetishForumThreadPageUrl(doc, baseHref);
  }

  function sameFootFetishForumPageUrl(a, b) {
    try {
      const ua = new URL(String(a || ''), window.location.href);
      const ub = new URL(String(b || ''), window.location.href);
      ua.hash = '';
      ub.hash = '';
      return ua.toString() === ub.toString();
    } catch (e) {
      return false;
    }
  }

  async function fetchFootFetishForumForumCandidates(startUrl, options = {}) {
    const opt = options && typeof options === 'object' ? options : {};
    const maxForumPages = Math.max(1, Math.min(100, parseInt(opt.maxForumPages || '5', 10) || 5));
    const maxThreadPages = Math.max(1, Math.min(250, parseInt(opt.maxThreadPages || opt.maxPages || '30', 10) || 30));
    const maxThreads = Math.max(1, Math.min(1000, parseInt(opt.maxThreads || '100', 10) || 100));
    const maxItems = Math.max(1, Math.min(12000, parseInt(opt.maxItems || '8000', 10) || 8000));
    const delayMs = Math.max(0, Math.min(3000, parseInt(opt.delayMs || '250', 10) || 250));
    const timeoutMs = Math.max(3000, Math.min(60000, parseInt(opt.timeoutMs || '20000', 10) || 20000));

    const fetchHtml = async (url) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => {
        try { ctrl.abort(); } catch (e) {}
      }, timeoutMs);
      try {
        const resp = await fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store', signal: ctrl.signal });
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, text };
      } finally {
        clearTimeout(t);
      }
    };

    const threadLinks = [];
    const seenThreads = new Set();
    let forumUrl = String(startUrl || '').trim();
    try {
      const u0 = new URL(forumUrl, window.location.href);
      u0.hash = '';
      forumUrl = u0.toString();
    } catch (e) {}

    let forumPages = 0;
    while (forumUrl && forumPages < maxForumPages && threadLinks.length < maxThreads) {
      forumPages++;
      let doc = null;
      try {
        if (forumPages === 1 && sameFootFetishForumPageUrl(forumUrl, window.location.href)) {
          doc = document;
        } else {
          const r = await fetchHtml(forumUrl);
          if (!r || !r.ok || !r.text) break;
          doc = new DOMParser().parseFromString(r.text, 'text/html');
        }
      } catch (e) {
        break;
      }
      if (!doc) break;

      const links = collectFootFetishForumThreadLinksFromForumDocument(doc, forumUrl, maxThreads - threadLinks.length);
      for (const link of links) {
        try {
          const m = String(link || '').match(/\/threads\/[^\/\?#]*\.(\d+)(?:\/|\?|#|$)/i);
          const key = m && m[1] ? m[1] : link;
          if (seenThreads.has(key)) continue;
          seenThreads.add(key);
          threadLinks.push(link);
        } catch (e) {}
      }

      const nextUrl = findNextFootFetishForumForumPageUrl(doc, forumUrl);
      if (!nextUrl || nextUrl === forumUrl) break;
      forumUrl = nextUrl;
      if (delayMs > 0) {
        try { await delay(delayMs); } catch (e) {}
      }
    }

    const seenItems = new Set();
    const out = [];
    let threadPages = 0;
    for (const threadUrl of threadLinks) {
      if (out.length >= maxItems) break;
      const remaining = Math.max(0, maxItems - out.length);
      const res = await fetchFootFetishForumThreadCandidates(threadUrl, {
        maxPages: maxThreadPages,
        maxItems: remaining,
        delayMs,
        timeoutMs,
      });
      threadPages += Number(res && res.pages) || 0;
      for (const c of (res && Array.isArray(res.candidates) ? res.candidates : [])) {
        if (!c || !c.url) continue;
        const s = String(c.url || '').trim();
        if (!s || seenItems.has(s)) continue;
        seenItems.add(s);
        out.push(c);
        if (out.length >= maxItems) break;
      }
      if (delayMs > 0) {
        try { await delay(delayMs); } catch (e) {}
      }
    }

    return { candidates: out, pages: threadPages, forumPages, threads: threadLinks.length };
  }

  async function fetchFootFetishForumThreadCandidates(startUrl, options = {}) {
    const opt = options && typeof options === 'object' ? options : {};
    const maxPages = Math.max(1, Math.min(250, parseInt(opt.maxPages || '60', 10) || 60));
    const maxItems = Math.max(1, Math.min(8000, parseInt(opt.maxItems || '5000', 10) || 5000));
    const delayMs = Math.max(0, Math.min(3000, parseInt(opt.delayMs || '250', 10) || 250));
    const timeoutMs = Math.max(3000, Math.min(60000, parseInt(opt.timeoutMs || '20000', 10) || 20000));

    const seen = new Set();
    const out = [];

    const fetchHtml = async (url) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => {
        try { ctrl.abort(); } catch (e) {}
      }, timeoutMs);
      try {
        const resp = await fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store', signal: ctrl.signal });
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, text };
      } finally {
        clearTimeout(t);
      }
    };

    let url = String(startUrl || '').trim();
    try {
      const u0 = new URL(url, window.location.href);
      u0.hash = '';
      url = u0.toString();
    } catch (e) {}

    let pages = 0;
    while (url && pages < maxPages && out.length < maxItems) {
      pages++;
      let html = '';
      let doc = null;
      try {
        if (pages === 1 && sameFootFetishForumPageUrl(url, window.location.href)) {
          doc = document;
        } else {
          const r = await fetchHtml(url);
          if (!r || !r.ok || !r.text) break;
          html = r.text;
        }
      } catch (e) {
        break;
      }

      if (!doc) {
        try {
          doc = new DOMParser().parseFromString(html, 'text/html');
        } catch (e) {
          doc = null;
        }
      }
      if (!doc) break;

      const remaining = Math.max(0, maxItems - out.length);
      const candidates = collectFootFetishForumCandidatesFromDocument(doc, url, remaining);
      for (const c of (Array.isArray(candidates) ? candidates : [])) {
        if (!c || !c.url) continue;
        const s = String(c.url || '').trim();
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push({ url: s, el: null, kind: c.kind || '' });
        if (out.length >= maxItems) break;
      }

      const nextUrl = findNextFootFetishForumThreadPageUrl(doc, url);
      if (!nextUrl || nextUrl === url) break;
      url = nextUrl;

      if (delayMs > 0) {
        try { await delay(delayMs); } catch (e) {}
      }
    }

    return { candidates: out, pages };
  }

  function getAmateurVoyeurForumPageInfo(inputUrl) {
    try {
      const u = new URL(String(inputUrl || window.location.href), window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      if (!(host === 'amateurvoyeurforum.com' || host === 'www.amateurvoyeurforum.com' || host.endsWith('.amateurvoyeurforum.com'))) return null;
      const path = String(u.pathname || '').toLowerCase();
      const clean = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (path === '/showthread.php') {
        const id = String(u.searchParams.get('t') || u.searchParams.get('p') || '').trim();
        if (!id) return null;
        return { kind: 'thread', id, channel: `thread_${id}` };
      }
      if (path === '/forumdisplay.php') {
        const id = String(u.searchParams.get('f') || '').trim();
        if (!id) return null;
        return { kind: 'forum', id, channel: `forum_${id}` };
      }
      if (path === '/video.php') {
        const userId = String(u.searchParams.get('u') || '').trim();
        if (userId) return { kind: 'member_video_list', id: userId, channel: `member_${userId}` };
        const tag = String(u.searchParams.get('tag') || '').trim();
        if (tag) {
          const safeTag = clean(tag);
          return { kind: 'tag_video_list', id: tag, channel: safeTag ? `tag_${safeTag}` : 'videos' };
        }
        return { kind: 'video_list', id: 'videos', channel: 'videos' };
      }
      if (path === '/member.php') {
        const userId = String(u.searchParams.get('u') || '').trim();
        if (!userId) return null;
        return { kind: 'member', id: userId, channel: `member_${userId}` };
      }
      if (path === '/attachment.php') {
        const attachmentId = String(u.searchParams.get('attachmentid') || '').trim();
        if (!attachmentId) return null;
        return { kind: 'attachment', id: attachmentId, channel: `attachment_${attachmentId}` };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  const BATCH_DOMAIN_SUFFIXES = [
    'motherless.com',
    'pornzog.com',
    'txxx.com',
    'omegleporn.to',
    'tnaflix.com',
    'thisvid.com',
    'pornone.com',
    'pornhex.com',
    'xxxi.porn',
    'cums.net',
    'gig.sex',
    'aznudefeet.com'
  ];

  function hostMatchesAnySuffix(host, suffixes) {
    const h = String(host || '').toLowerCase();
    if (!h) return false;
    return (Array.isArray(suffixes) ? suffixes : []).some((s) => {
      const suf = String(s || '').toLowerCase();
      return !!suf && (h === suf || h.endsWith(`.${suf}`));
    });
  }

  function isKnownBatchListingDomain(host) {
    return hostMatchesAnySuffix(host, BATCH_DOMAIN_SUFFIXES);
  }

  function isLikelyListingPath(pathname) {
    const p = String(pathname || '').toLowerCase();
    if (!p || p === '/') return false;
    return /\/(search|term|tags?|categories?|channels?|models?|pornstars?|playlists?|results?|latest|new|trending)\b/.test(p);
  }

  function isLikelyVideoDetailUrl(urlObj, anchorEl) {
    try {
      const u = (urlObj instanceof URL) ? urlObj : new URL(String(urlObj || ''), window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      const p = String(u.pathname || '');
      const lowerPath = p.toLowerCase();
      const segments = lowerPath.split('/').filter(Boolean);
      if (!segments.length) return false;

      if (/\/(search|term|tags?|categories?|channels?|models?|pornstars?|playlists?|results?|login|signup|register|upload|community|forum|blog|dmca|privacy|terms)\b/.test(lowerPath)) return false;
      if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|json|xml)(\?|$)/i.test(lowerPath)) return false;

      if (/\/(video|videos|watch|v|clip|movie|embed|view)\b/.test(lowerPath)) return true;

      const last = segments[segments.length - 1] || '';
      if (/^[a-z0-9_-]{6,}$/.test(last)) {
        if (isKnownBatchListingDomain(host)) return true;
      }

      const a = anchorEl || null;
      if (a && (a.querySelector('img, picture, video, source') || /\b\d{1,2}:\d{2}\b/.test(String(a.textContent || '')))) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function looksLikeExternalMediaPageUrl(rawUrl, anchorText) {
    try {
      const u = new URL(String(rawUrl || ''), window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      const p = String(u.pathname || '').toLowerCase();
      const text = String(anchorText || '').trim().toLowerCase();
      if (!/^https?:$/i.test(String(u.protocol || ''))) return false;
      if (!host) return false;
      if (host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com')) return false;
      if (host === 'upload.footfetishforum.com' || host.endsWith('.upload.footfetishforum.com')) return false;
      if (/\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv|mp3|m4a|zip|rar|7z)(\?|$)/i.test(p)) return true;
      if (isKnownExternalMediaWrapperHost(host)) return true;
      if (/(youtube\.com|youtu\.be|vimeo\.com|redgifs\.com|gfycat\.com|imgur\.com|instagram\.com|tiktok\.com|reddit\.com|redd\.it|t\.me|telegram\.me)/i.test(host)) return true;
      if (/\/(video|videos|gallery|galleries|album|albums|watch|view|clip|movie|media|embed|post|posts|photo|photos|set|sets|show|download|file)\b/i.test(p)) return true;
      if (/\b(video|videos|gallery|galleries|album|albums|clip|movie|download|teaser|trailer|watch|part\s*\d+)\b/i.test(text)) return true;
      if (text && text.length >= 6 && /[a-z]/i.test(text) && !/^(like|quote|reply|report|bookmark|share|profile|member|click to expand|last edited)/i.test(text)) return true;
    } catch (e) {}
    return false;
  }

  function isRedditBatchSeedUrl(input) {
    const s = String(input || '');
    if (!s) return false;
    if (/reddit\.com\/(?:r\/[^\/\?#]+\/)?comments\/[a-z0-9]+(?:\/[^\/\?#]+)?/i.test(s)) return true;
    if (/reddit\.com\/(?:user|u)\/[^\/\?#]+(?:\/)?$/i.test(s)) return true;
    if (/reddit\.com\/r\/[^\/\?#]+(?:\/)?$/i.test(s)) return true;
    if (/redd\.it\/[a-z0-9]+/i.test(s)) return true;
    return false;
  }

  // ========================
  // METADATA SCRAPING
  // ========================
  function scrapeMetadata() {
    const url = window.location.href;
    const meta = { url, platform: 'unknown', channel: 'unknown', title: document.title, description: '' };

    // YouTube (regulier + Shorts)
    if (/youtube\.com|youtu\.be/i.test(url)) {
      meta.platform = 'youtube';
      // Titel: regulier + Shorts selectors
      const titleEl = document.querySelector(
        'h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, ' +
        'ytd-reel-video-renderer[is-active] h2 yt-formatted-string, ' +
        'h2.ytd-reel-player-header-renderer yt-formatted-string, ' +
        '#shorts-title, yt-formatted-string.ytd-shorts'
      );
      if (titleEl) meta.title = titleEl.textContent.trim();
      // Kanaal: regulier + Shorts selectors
      const ytChannelSelector =
        'ytd-video-owner-renderer ytd-channel-name a, ytd-video-owner-renderer #channel-name a, #owner ytd-channel-name a, #owner #channel-name a, #owner a[href^="/@"], #owner a[href^="/channel/"], #owner-name a, #upload-info a[href^="/@"], #upload-info a[href^="/channel/"], ytd-reel-player-header-renderer a[href^="/@"], ytd-reel-player-header-renderer a[href^="/channel/"], .ytd-reel-player-header-renderer a[href^="/@"], .ytd-reel-player-header-renderer a[href^="/channel/"], a[href^="/@"], a[href^="/channel/"], a[href^="https://www.youtube.com/@"], a[href^="https://www.youtube.com/channel/"]';
      const picked = pickFirstMatchingText(ytChannelSelector);
      meta._channelSelector = picked.selector;
      meta._channelHref = picked.href;
      if (picked.text) meta.channel = picked.text;
      // Fallback: haal kanaal uit pagina tekst
      if (meta.channel === 'unknown' || !meta.channel) {
        const allLinks = document.querySelectorAll('a[href^="/@"], a[href^="/channel/"], a[href^="https://www.youtube.com/@"], a[href^="https://www.youtube.com/channel/"]');
        for (const link of allLinks) {
          const text = link.textContent.trim();
          if (text && text.length > 1 && text.length < 60 && !text.includes('http')) {
            meta.channel = text;
            meta._channelSelector = 'fallback-links';
            meta._channelHref = String(link.getAttribute('href') || '').trim();
            break;
          }
        }
      }
      const descEl = document.querySelector('#description-text, ytd-text-inline-expander');
      if (descEl) meta.description = descEl.textContent.trim().substring(0, 300);
    }
    // Vimeo
    else if (/vimeo\.com/i.test(url)) {
      meta.platform = 'vimeo';
      const titleEl = document.querySelector('h1, [class*="title"]');
      if (titleEl) meta.title = titleEl.textContent.trim();
    }
    // Twitch
    else if (/twitch\.tv/i.test(url)) {
      meta.platform = 'twitch';
      const titleEl = document.querySelector('h2[data-a-target="stream-title"], [data-a-target="stream-title"]');
      if (titleEl) meta.title = titleEl.textContent.trim();
      const channelEl = document.querySelector('h1.tw-title, [data-a-target="hosted-by-a"]');
      if (channelEl) meta.channel = channelEl.textContent.trim();
    }

    else if (/instagram\.com/i.test(url)) {
      meta.platform = 'instagram';
      const m = url.match(/instagram\.com\/(stories\/)?([^\/\?#]+)/i);
      if (m) {
        const user = m[2];
        if (user && !['p', 'reel', 'tv', 'explore', 'accounts', 'stories'].includes(user.toLowerCase())) {
          meta.channel = user;
        }
      }
    }

    else if (/reddit\.com|redd\.it/i.test(url)) {
      meta.platform = 'reddit';
      const m = url.match(/reddit\.com\/r\/([^\/\?#]+)/i);
      if (m) meta.channel = `r_${m[1]}`;
      const um = url.match(/reddit\.com\/(?:user|u)\/([^\/\?#]+)/i);
      if (um) meta.channel = `u_${um[1]}`;
    }

    else if (/facebook\.com|fb\.watch/i.test(url)) {
      meta.platform = 'facebook';
      const m = url.match(/facebook\.com\/([^\/\?#]+)/i);
      if (m) {
        const page = m[1];
        if (page && !['watch', 'reel', 'share', 'videos', 'photo', 'groups', 'stories', 'marketplace'].includes(page.toLowerCase())) {
          meta.channel = page;
        }
      }
      if (meta.channel === 'unknown' && /fb\.watch/i.test(url)) {
        meta.channel = 'fb_watch';
      }
    }

    else if (/onlyfans\.com/i.test(url)) {
      meta.platform = 'onlyfans';
      const user = findOnlyFansPageUsername();
      if (user) meta.channel = user;
    }

    else if (/rutube\.ru/i.test(url)) {
      meta.platform = 'rutube';
    }

    else if (/wikifeet\.com/i.test(url)) {
      meta.platform = 'wikifeet';
      const m = url.match(/wikifeet\.com\/([^\/\?#]+)/i);
      if (m) meta.channel = m[1];
    }

    else if (/kinky\.nl/i.test(url)) {
      meta.platform = 'kinky';
      const m = url.match(/kinky\.nl\/([^\/\?#]+)/i);
      if (m) meta.channel = m[1];
    }

    else if (/aznudefeet\.com/i.test(url)) {
      meta.platform = 'aznudefeet';
      const heading = pickFirstMatchingText('h1, .page-title, .headline, .title');
      if (heading && heading.text) {
        meta.title = heading.text;
        meta.channel = heading.text;
      } else {
        const m = url.match(/aznudefeet\.com\/view\/[^\/]+\/[^\/]+\/\d+\/([^\/\?#.]+)\.html/i);
        if (m) meta.channel = m[1];
      }
    }

    else if (/tiktok\.com|tiktokv\.com/i.test(url)) {
      meta.platform = 'tiktok';
      const m = url.match(/tiktok\.com\/@([^\/\?#]+)/i);
      if (m) meta.channel = `@${m[1]}`;
    }

    else if (/footfetishforum\.com/i.test(url)) {
      meta.platform = 'footfetishforum';
      const tm = url.match(/footfetishforum\.com\/threads\/[^\/\?#]*\.(\d+)(?:\/|\?|#|$)/i);
      if (tm && tm[1]) meta.channel = `thread_${tm[1]}`;
      const fm = url.match(/footfetishforum\.com\/forums\/[^\/\?#]*\.(\d+)(?:\/|\?|#|$)/i);
      if (fm && fm[1]) meta.channel = `forum_${fm[1]}`;
    }

    else if (/amateurvoyeurforum\.com/i.test(url)) {
      meta.platform = 'amateurvoyeurforum';
      const info = getAmateurVoyeurForumPageInfo(url);
      if (info && info.channel) meta.channel = info.channel;
      const heading = pickFirstMatchingText('h1, .page-title, .headline, td.navbar strong, .navbar strong, .tcat + table td.navbar strong');
      const cleanedTitle = String((heading && heading.text) || document.title || '').replace(/\s*-\s*Amateur Voyeur Forum\s*$/i, '').trim();
      if (cleanedTitle) meta.title = cleanedTitle;
    }

    // Pornpics
    else if (/pornpics\.com/i.test(url)) {
      meta.platform = 'pornpics';
      // Gallery page: pornpics.com/galleries/slug-12345/
      const gm = url.match(/pornpics\.com\/galleries\/([^\/?#]+)/i);
      if (gm) {
        let slug = String(gm[1] || '');
        slug = slug.replace(/-\d{6,}$/, '');
        let name = slug.replace(/[-_]+/g, ' ').trim();
        name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
        if (name) meta.channel = name;
        // Clean title
        const rawTitle = (document.title || '').replace(/\s*[-–—|]\s*PornPics\.com\s*$/i, '').trim();
        if (rawTitle) meta.title = rawTitle;
      }
      // Pornstar page: pornpics.com/pornstars/name/
      const pm = url.match(/pornpics\.com\/pornstars\/([^\/?#]+)/i);
      if (pm) {
        let name = String(pm[1] || '').replace(/[-_]+/g, ' ').trim();
        name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
        if (name) meta.channel = name;
      }
      // CDN image URL: cdni.pornpics.com/1280/...
      if (/cdni\.pornpics\.com/i.test(url)) {
        // Try to find gallery link on the page to use as download URL instead
        const galleryLink = document.querySelector('a[href*="pornpics.com/galleries/"]');
        if (galleryLink) {
          meta._pornpicsGalleryUrl = galleryLink.href;
        }
      }
    }

    // Elitebabes
    else if (/elitebabes\.com/i.test(url)) {
      meta.platform = 'elitebabes';
      // Model page: /model/evita-lima/
      const mm = url.match(/elitebabes\.com\/model\/([^\/?#]+)/i);
      if (mm) {
        let name = String(mm[1] || '').replace(/[-_]+/g, ' ').trim();
        name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
        if (name) meta.channel = name;
      }
      // Gallery page title
      const rawTitle = (document.title || '').replace(/\s*[-–—|]\s*Elite\s*Babes?\s*$/i, '').trim();
      if (rawTitle) meta.title = rawTitle;
      // Try to extract model name from the page
      if (meta.channel === 'unknown') {
        const modelLink = document.querySelector('a[href*="/model/"]');
        if (modelLink) {
          const ml = String(modelLink.getAttribute('href') || '').match(/\/model\/([^\/?#]+)/i);
          if (ml) {
            let name = String(ml[1] || '').replace(/[-_]+/g, ' ').trim();
            name = name.split(/\s+/g).filter(Boolean).map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
            if (name) meta.channel = name;
          }
        }
      }
    }

    if (!meta.platform || meta.platform === 'unknown') {
      try {
        const host = String(window.location.hostname || '').toLowerCase();
        const cleaned = host.replace(/^www\./, '').replace(/^m\./, '').replace(/^mobile\./, '');
        const parts = cleaned.split('.').filter(Boolean);
        if (parts.length >= 2) meta.platform = parts[parts.length - 2];
        else if (parts.length === 1) meta.platform = parts[0];
      } catch (e) {}
    }

    return meta;
  }

  function isFootFetishForumThreadPage() {
    try {
      const u = new URL(window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return false;
      return /\/threads\//i.test(String(u.pathname || ''));
    } catch (e) {
      return false;
    }
  }

  function isFootFetishForumForumPage() {
    try {
      const u = new URL(window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return false;
      return /\/forums\/[^\/\?#]*\.\d+(?:\/|\?|#|$)/i.test(String(u.pathname || '') + String(u.search || '') + String(u.hash || ''));
    } catch (e) {
      return false;
    }
  }

  function isAmateurVoyeurForumPage() {
    return !!getAmateurVoyeurForumPageInfo(window.location.href);
  }

  function isAmateurVoyeurForumThreadPage() {
    const info = getAmateurVoyeurForumPageInfo(window.location.href);
    return !!(info && info.kind === 'thread');
  }

  function collectFootFetishForumCandidates(maxItems = 2000) {
    const out = [];
    const seen = new Set();

    const push = (raw, el, kind) => {
      try {
        const s = String(raw || '').trim();
        if (!s) return;
        if (/^(data:|blob:|javascript:|mailto:)/i.test(s)) return;
        let u = new URL(s, window.location.href);
        u.hash = '';
        let host = String(u.hostname || '').toLowerCase();
        let path = String(u.pathname || '').toLowerCase();
        if (!/^https?:$/i.test(String(u.protocol || ''))) return;

        if (path.includes('/data/avatars/')) return;
        if (host === 'cdn.jsdelivr.net' && path.includes('/joypixels/')) return;
        if (/\b(twemoji|emoji)\b/i.test(path)) return;
        if (/\b(graemlins|smilies|smilies\b)\b/i.test(path)) return;
        if (path === '/attachments/upload') return;
        if (path === '/proxy.php') {
          try {
            const img = u.searchParams ? (u.searchParams.get('image') || '') : '';
            const low = String(img || '').toLowerCase();
            if (low.includes('joypixels') || low.includes('twemoji') || low.includes('graemlins') || low.includes('smilies') || low.includes('smilies/')) return;

            if (/^https?:\/\//i.test(low)) {
              const u2 = new URL(img);
              u2.hash = '';
              u = u2;
              host = String(u.hostname || '').toLowerCase();
              path = String(u.pathname || '').toLowerCase();
            }
          } catch (e) {}
        }

        if ((host === 'pixhost.to' || host.endsWith('.pixhost.to')) && path.includes('/thumbs/')) {
          try {
            const rawPath = String(u.pathname || '');
            const m = rawPath.match(/^\/thumbs\/([^\/]+)\/([^\/]+)$/i);
            if (m && m[1] && m[2]) {
              const u2 = new URL(`https://pixhost.to/show/${m[1]}/${m[2]}`);
              u2.hash = '';
              u = u2;
              host = String(u.hostname || '').toLowerCase();
              path = String(u.pathname || '').toLowerCase();
            } else {
              return;
            }
          } catch (e) {
            return;
          }
        }

        const final = u.toString();
        if (seen.has(final)) return;
        seen.add(final);
        out.push({ url: final, el: el || null, kind: kind || '' });
      } catch (e) {}
    };

    const contentRoots = Array.from(document.querySelectorAll(
      'article, .message, .message-main, .message-body, .message-content, .message-userContent, .message-attachments, .bbWrapper, .post-body'
    )).filter(Boolean);

    const scanImgs = [];
    const scanVideos = [];
    const scanSources = [];
    for (const root of (contentRoots.length ? contentRoots : [document.body])) {
      try {
        for (const img of Array.from(root.querySelectorAll('img'))) scanImgs.push(img);
        for (const v of Array.from(root.querySelectorAll('video'))) scanVideos.push(v);
        for (const s of Array.from(root.querySelectorAll('source'))) scanSources.push(s);
      } catch (e) {}
    }

    for (const img of scanImgs) {
      if (out.length >= maxItems) return out;
      try {
        const cls = String(img.className || '').toLowerCase();
        if (/\b(avatar|emoji|emote|smilie|reaction|logo|icon)\b/i.test(cls)) continue;
        try {
          if (img.closest && img.closest('.message-avatar, .avatar, .avatarHolder, .message-user, .message-cell--user')) continue;
        } catch (e) {}

        let hadParentLink = false;
        try {
          const parentLink = img.closest ? img.closest('a[href], a[data-href], a[data-url]') : null;
          if (parentLink) {
            const href = parentLink.getAttribute('href') || parentLink.getAttribute('data-href') || parentLink.getAttribute('data-url');
            if (href) {
              try {
                const linkUrl = new URL(href, window.location.href);
                const linkHost = String(linkUrl.hostname || '').toLowerCase();
                const isFffAttachment = isFootFetishForumAttachmentUrl(href, window.location.href);
                const isFile = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv)(\?|$)/i.test(href);
                const isExternalMedia = !(linkHost === 'footfetishforum.com' || linkHost.endsWith('.footfetishforum.com')) && looksLikeExternalMediaPageUrl(linkUrl.toString(), parentLink.textContent || '');
                const isUploadSite = linkHost === 'upload.footfetishforum.com' || linkHost.endsWith('.upload.footfetishforum.com') || isKnownExternalMediaWrapperHost(linkHost) || /pixhost|postimg|imgur|redgifs|gfycat/i.test(linkHost);

                if (isFffAttachment || isFile || isExternalMedia || isUploadSite) {
                  // For upload.footfetishforum.com/image/ wrapper, use <img> src (direct URL)
                  if ((linkHost === 'upload.footfetishforum.com' || linkHost.endsWith('.upload.footfetishforum.com')) && /^\/image\//i.test(String(linkUrl.pathname || ''))) {
                    const imgSrc = img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || '';
                    if (imgSrc && /upload\.footfetishforum\.com\/images\//i.test(imgSrc)) {
                      push(imgSrc, parentLink, 'fff_upload_direct');
                    } else {
                      push(href, parentLink, 'thumb_link');
                    }
                  } else {
                    push(href, parentLink, 'thumb_link');
                  }
                  hadParentLink = true;
                }
              } catch (e) {}
            }
          }
        } catch (e) {}

        // Skip tiny images UNLESS they have a parent link (which we already captured above)
        if (!hadParentLink) {
          const nw = Number(img.naturalWidth || 0);
          const nh = Number(img.naturalHeight || 0);
          if (Number.isFinite(nw) && Number.isFinite(nh) && nw > 0 && nh > 0) {
            if ((nw * nh) < 6400) continue;
          }
        }

        if (!hadParentLink) {
          push(
            img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-url'),
            img,
            'img'
          );
          const srcset = String(img.getAttribute('srcset') || '').trim();
          if (srcset) {
            const parts = srcset.split(',').map(s => String(s || '').trim()).filter(Boolean);
            for (const part of parts) {
              const first = part.split(/\s+/)[0];
              if (first) push(first, img, 'img_srcset');
              if (out.length >= maxItems) return out;
            }
          }
        }
      } catch (e) {}
    }

    for (const v of scanVideos) {
      if (out.length >= maxItems) return out;
      try {
        push(v.currentSrc || v.src || v.getAttribute('src'), v, 'video');
      } catch (e) {}
      try {
        for (const s of Array.from(v.querySelectorAll('source'))) {
          push(s.src || s.getAttribute('src'), s, 'video_source');
          if (out.length >= maxItems) return out;
        }
      } catch (e) {}
    }

    for (const s of scanSources) {
      if (out.length >= maxItems) return out;
      try { push(s.src || s.getAttribute('src'), s, 'source'); } catch (e) {}
    }

    try {
      const styleEls = Array.from((contentRoots.length ? contentRoots : [document.body]).flatMap((r) => {
        try { return Array.from((r || document.body).querySelectorAll('[style]')); } catch (e) { return []; }
      }));
      for (const el of styleEls.slice(0, 2500)) {
        if (out.length >= maxItems) return out;
        try {
          const style = String(el.getAttribute('style') || '');
          if (!/background-image\s*:/i.test(style)) continue;
          const m = style.match(/url\(([^)]+)\)/i);
          if (!m || !m[1]) continue;
          const raw = String(m[1] || '').trim().replace(/^['\"]/, '').replace(/['\"]$/, '');
          if (!raw) continue;
          let hadParentLink = false;
          try {
            const parentLink = el.closest ? el.closest('a[href], a[data-href], a[data-url]') : null;
            if (parentLink) {
              const href = parentLink.getAttribute('href') || parentLink.getAttribute('data-href') || parentLink.getAttribute('data-url');
              if (href) {
                push(href, parentLink, 'bg_link');
                hadParentLink = true;
              }
            }
          } catch (e) {}

          push(raw, el, hadParentLink ? 'bg_under_link' : 'bg');
        } catch (e) {}
      }
    } catch (e) {}

    for (const fr of Array.from((contentRoots.length ? contentRoots : [document]).flatMap(r => {
      try { return Array.from((r || document).querySelectorAll('iframe[src]')); } catch (e) { return []; }
    }))) {
      if (out.length >= maxItems) return out;
      try {
        const src = fr.getAttribute('src');
        if (!src) continue;
        const abs = new URL(src, window.location.href);
        abs.hash = '';
        const s = abs.toString();
        if (/(youtube\.com|youtu\.be|vimeo\.com|redgifs\.com|gfycat\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com|reddit\.com|redd\.it)/i.test(s)) {
          push(s, fr, 'iframe');
        }
      } catch (e) {}
    }

    const anchorRoots = contentRoots.length ? contentRoots : [document];
    const anchors = [];
    for (const r of anchorRoots) {
      try {
        for (const a of Array.from(r.querySelectorAll('a[href], a[data-href], a[data-url]'))) anchors.push(a);
      } catch (e) {}
    }
    for (const a of anchors) {
      if (out.length >= maxItems) return out;
      try {
        const href = a.getAttribute('href') || a.getAttribute('data-href') || a.getAttribute('data-url');
        if (!href) continue;
        const abs = new URL(href, window.location.href);
        abs.hash = '';
        const s = abs.toString();

        const host = String(abs.hostname || '').toLowerCase();
        const path = String(abs.pathname || '').toLowerCase();
        if (path === '/attachments/upload') continue;

        const text = String(a.textContent || '').trim().toLowerCase();
        const cls = String(a.className || '').toLowerCase();

        const looksLikeFile = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv|mp3|m4a|zip|rar|7z)(\?|$)/i.test(s);
        const looksLikeAttachment = /\battachment\b|\battachments\b|\/attachments\//i.test(path) || /attachment|download|full\s*size/i.test(text) || /attachment|download/i.test(cls);
        let looksLikeExternalMedia = looksLikeExternalMediaPageUrl(s, text);
        if (looksLikeExternalMedia && (host === 'twitter.com' || host === 'x.com')) {
          if (!/\/status\//i.test(path)) looksLikeExternalMedia = false;
        }

        if (looksLikeFile || looksLikeAttachment || looksLikeExternalMedia) push(s, a, 'a');
      } catch (e) {}
    }

    try {
      const texts = Array.from(document.querySelectorAll('article, .message, .message-body, .bbWrapper, .content, .message-content, .post-body'));
      for (const el of texts.slice(0, 120)) {
        if (out.length >= maxItems) return out;
        const raw = String(el && el.textContent ? el.textContent : '');
        if (!raw) continue;
        const re = /(https?:\/\/[^\s)\]"']+)/g;
        let m;
        while ((m = re.exec(raw)) && out.length < maxItems) {
          const u = String(m[1] || '').replace(/[),\]."']+$/g, '').trim();
          if (!u) continue;
          try {
            const pu = new URL(u);
            const host = String(pu.hostname || '').toLowerCase();
            const s = pu.toString();
            const looksLikeFile = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv|mp3|m4a)(\?|$)/i.test(s);
            const looksLikeExternalMedia = looksLikeExternalMediaPageUrl(s, '');
            if (looksLikeFile || looksLikeExternalMedia || host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com')) {
              push(s, el, 'text');
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    return out;
  }

  function collectFootFetishForumUrls(maxItems = 2000) {
    return collectFootFetishForumCandidates(maxItems).map((c) => c.url);
  }

  function collectAmateurVoyeurForumCandidatesFromDocument(doc, baseHref, maxItems = 2000) {
    const out = [];
    const seen = new Set();
    const pageInfo = getAmateurVoyeurForumPageInfo(baseHref) || {};
    const isThreadPage = pageInfo.kind === 'thread';
    const isForumPage = pageInfo.kind === 'forum';
    const isVideoPage = pageInfo.kind === 'video_list' || pageInfo.kind === 'member_video_list' || pageInfo.kind === 'tag_video_list';

    const push = (raw, kind) => {
      try {
        const s = String(raw || '').trim();
        if (!s || /^(data:|blob:|javascript:|mailto:)/i.test(s)) return;
        const u = new URL(s, baseHref);
        u.hash = '';
        const host = String(u.hostname || '').toLowerCase();
        const path = String(u.pathname || '').toLowerCase();
        if (!/^https?:$/i.test(String(u.protocol || ''))) return;
        const isAvfHost = host === 'amateurvoyeurforum.com' || host === 'www.amateurvoyeurforum.com' || host.endsWith('.amateurvoyeurforum.com');
        if (isAvfHost) {
          if (/\/(image|avatar)\.php$/i.test(path) && (u.searchParams.get('u') || u.searchParams.get('userid'))) return;
          if (/\b(clear|spacer|logo|banner|icon|avatar|smil|emoji)\b/i.test(path)) return;
        }
        const final = u.toString();
        if (seen.has(final)) return;
        seen.add(final);
        out.push({ url: final, el: null, kind: kind || '' });
      } catch (e) {}
    };

    const roots = Array.from(doc.querySelectorAll(
      'article, .message, .message-main, .message-body, .message-content, .message-userContent, .message-attachments, .bbWrapper, .postbody, .post_message, .content'
    )).filter(Boolean);
    const scanRoots = roots.length ? roots : [doc.body || doc.documentElement];

    if (!isForumPage) {
      for (const root of scanRoots) {
        if (!root) continue;
        try {
          for (const img of Array.from(root.querySelectorAll('img'))) {
            if (out.length >= maxItems) return out;
            const cls = String(img.className || '').toLowerCase();
            if (/\b(avatar|emoji|emote|smilie|reaction|logo|icon)\b/i.test(cls)) continue;
            push(img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-url'), 'img');
          }
        } catch (e) {}
        try {
          for (const video of Array.from(root.querySelectorAll('video, source'))) {
            if (out.length >= maxItems) return out;
            push(video.currentSrc || video.src || video.getAttribute('src'), 'video');
          }
        } catch (e) {}
      }
    }

    for (const root of scanRoots.length ? scanRoots : [doc]) {
      if (!root) continue;
      let anchors = [];
      try { anchors = Array.from(root.querySelectorAll('a[href], a[data-href], a[data-url]')); } catch (e) { anchors = []; }
      for (const a of anchors) {
        if (out.length >= maxItems) return out;
        try {
          const href = a.getAttribute('href') || a.getAttribute('data-href') || a.getAttribute('data-url');
          if (!href) continue;
          const abs = new URL(href, baseHref);
          abs.hash = '';
          const s = abs.toString();
          const host = String(abs.hostname || '').toLowerCase();
          const path = String(abs.pathname || '').toLowerCase();
          const text = String(a.textContent || '').trim().toLowerCase();
          const cls = String(a.className || '').toLowerCase();
          const isAvfHost = host === 'amateurvoyeurforum.com' || host === 'www.amateurvoyeurforum.com' || host.endsWith('.amateurvoyeurforum.com');
          const isAttachment = isAvfHost && path === '/attachment.php' && !!String(abs.searchParams.get('attachmentid') || '').trim();
          const isThreadLink = isAvfHost && path === '/showthread.php' && !!String(abs.searchParams.get('t') || abs.searchParams.get('p') || '').trim();
          const looksLikeFile = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv|mp3|m4a|zip|rar|7z)(\?|$)/i.test(s);
          let looksLikeExternalMedia = !isAvfHost && looksLikeExternalMediaPageUrl(s, text);
          if (looksLikeExternalMedia && (host === 'twitter.com' || host === 'x.com') && !/\/status\//i.test(path)) looksLikeExternalMedia = false;

          if (isAttachment || looksLikeFile || looksLikeExternalMedia) {
            push(s, isAttachment ? 'attachment' : 'a');
            continue;
          }
          if ((isForumPage || isVideoPage) && isThreadLink) push(s, 'thread_link');
          if (isThreadPage && /attachment|download|full\s*size/i.test(text) && /attachment|download/i.test(cls)) push(s, 'download_link');
        } catch (e) {}
      }
    }

    if (isThreadPage) {
      try {
        for (const root of scanRoots.slice(0, 120)) {
          if (out.length >= maxItems) return out;
          const raw = String(root && root.textContent ? root.textContent : '');
          if (!raw) continue;
          const re = /(https?:\/\/[^\s)\]"']+)/g;
          let m;
          while ((m = re.exec(raw)) && out.length < maxItems) {
            const found = String(m[1] || '').replace(/[),\]."']+$/g, '').trim();
            if (!found) continue;
            try {
              const parsed = new URL(found);
              const foundHost = String(parsed.hostname || '').toLowerCase();
              const looksLikeFile = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv|mp3|m4a)(\?|$)/i.test(found);
              const looksLikeExternalMedia = looksLikeExternalMediaPageUrl(found, '');
              if (looksLikeFile || looksLikeExternalMedia || foundHost.includes('amateurvoyeurforum.com')) push(found, 'text');
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    return out;
  }

  function uniqueCandidates(candidates) {
    const out = [];
    const seen = new Set();
    for (const c of (Array.isArray(candidates) ? candidates : [])) {
      try {
        const u = String((c && c.url) || '').trim();
        if (!u) continue;
        if (seen.has(u)) continue;
        seen.add(u);
        out.push({ url: u, el: (c && c.el) ? c.el : null, kind: (c && c.kind) ? c.kind : '' });
      } catch (e) {}
    }
    return out;
  }

  function isAznudeFeetViewPage() {
    try {
      const u = new URL(window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      if (!(host === 'www.aznudefeet.com' || host.endsWith('.aznudefeet.com'))) return false;
      return /\/view\//i.test(String(u.pathname || ''));
    } catch (e) {
      return false;
    }
  }

  function collectAznudeFeetCandidates(maxItems = 600) {
    const out = [];
    const seen = new Set();

    const push = (raw, el, kind) => {
      try {
        const s = String(raw || '').trim();
        if (!s || /^(data:|blob:|javascript:|mailto:)/i.test(s)) return;
        const u = new URL(s, window.location.href);
        u.hash = '';
        const host = String(u.hostname || '').toLowerCase();
        const path = String(u.pathname || '').toLowerCase();
        if (!/^https?:$/i.test(String(u.protocol || ''))) return;
        if (host.includes('aznudelive.com')) return;
        if (!(host.includes('aznudefeet.com') || host.includes('aznude.com') || host.includes('azncdn.com'))) return;
        if (/\b(logo|avatar|icon|sprite|banner|ad[sx]?|promo)\b/i.test(path)) return;
        const final = u.toString();
        if (seen.has(final)) return;
        seen.add(final);
        out.push({ url: final, el: el || null, kind: kind || '' });
      } catch (e) {}
    };

    const pushSrcset = (raw, el, kind) => {
      try {
        const srcset = String(raw || '').trim();
        if (!srcset) return;
        for (const part of srcset.split(',').map((s) => String(s || '').trim()).filter(Boolean)) {
          const first = part.split(/\s+/)[0];
          if (first) push(first, el, kind);
          if (out.length >= maxItems) return;
        }
      } catch (e) {}
    };

    for (const img of Array.from(document.querySelectorAll('img'))) {
      if (out.length >= maxItems) break;
      try {
        const r = img.getBoundingClientRect();
        if (r && (r.width < 80 || r.height < 80)) continue;
        const cls = String(img.className || '').toLowerCase();
        if (/\b(avatar|icon|emoji|logo)\b/i.test(cls)) continue;
      } catch (e) {}
      let hadParentDirect = false;
      try {
        const parentLink = img.closest ? img.closest('a[href]') : null;
        const href = parentLink && parentLink.getAttribute ? parentLink.getAttribute('href') : '';
        if (href && /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif)(\?|$)/i.test(String(href))) {
          push(href, parentLink, 'direct_link');
          hadParentDirect = true;
        }
      } catch (e) {}
      push(img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src'), img, hadParentDirect ? 'img_under_direct_link' : 'img');
      try { pushSrcset(img.getAttribute('srcset'), img, 'img_srcset'); } catch (e) {}
    }

    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      if (out.length >= maxItems) break;
      try {
        const href = a.getAttribute('href');
        if (!href) continue;
        if (/\.(jpe?g|png|gif|webp|bmp|avif|heic|heif)(\?|$)/i.test(href)) {
          push(href, a, 'a_direct');
        }
      } catch (e) {}
    }

    return uniqueCandidates(out);
  }

  function isEliteBabesPage() {
    try {
      const host = window.location.hostname.toLowerCase();
      return host === 'www.elitebabes.com' || host === 'elitebabes.com';
    } catch (e) { return false; }
  }

  function isEliteBabesGalleryPage() {
    if (!isEliteBabesPage()) return false;
    // Gallery pages have CDN image links; model/listing pages don't
    return document.querySelectorAll('a[href*="cdn.elitebabes.com/content/"]').length > 0;
  }

  function isEliteBabesModelPage() {
    if (!isEliteBabesPage()) return false;
    return /\/model\//i.test(window.location.pathname);
  }

  function collectEliteBabesCandidates(maxItems = 600) {
    const out = [];
    const seen = new Set();
    const push = (raw, el, kind) => {
      try {
        const s = String(raw || '').trim();
        if (!s || /^(data:|blob:|javascript:)/i.test(s)) return;
        const u = new URL(s, window.location.href);
        u.hash = '';
        const final = u.toString();
        if (seen.has(final)) return;
        seen.add(final);
        out.push({ url: final, el: el || null, kind: kind || '' });
      } catch (e) {}
    };

    if (isEliteBabesGalleryPage()) {
      // Collect all full-size CDN images from gallery page
      for (const a of document.querySelectorAll('a[href*="cdn.elitebabes.com/content/"]')) {
        if (out.length >= maxItems) break;
        const href = a.getAttribute('href');
        if (href && /\.(jpe?g|png|gif|webp)([\?#]|$)/i.test(href)) {
          push(href, a, 'gallery_image');
        }
      }
    } else if (isEliteBabesModelPage()) {
      // Collect all gallery page links from model page
      for (const a of document.querySelectorAll('a[href*="elitebabes.com/"]')) {
        if (out.length >= maxItems) break;
        const href = a.getAttribute('href');
        if (!href) continue;
        try {
          const u = new URL(href, window.location.href);
          const host = u.hostname.toLowerCase();
          if (!(host === 'www.elitebabes.com' || host === 'elitebabes.com')) continue;
          const path = u.pathname;
          // Skip nav/utility pages, model tags, other models
          if (/^\/(model|model-tag|tag|category|search|random|explore|faves|history|watch-later|collections|pinboards|erotic-art-channels|updates|leaderboard|community|contribute|advertisers|18usc2257|privacy-policy|contact|dmca)\b/i.test(path)) continue;
          // Gallery pages have a slug like /evita-lima-bares-her.../
          if (/^\/[a-z0-9][a-z0-9-]+\/?$/i.test(path)) {
            push(u.toString(), a, 'sub_gallery');
          }
        } catch (e) {}
      }
    } else {
      // Generic elitebabes page — collect any CDN images and gallery links
      for (const a of document.querySelectorAll('a[href*="cdn.elitebabes.com/content/"]')) {
        if (out.length >= maxItems) break;
        const href = a.getAttribute('href');
        if (href && /\.(jpe?g|png|gif|webp)([\?#]|$)/i.test(href)) {
          push(href, a, 'gallery_image');
        }
      }
      if (out.length === 0) {
        // No CDN links — treat as listing page
        for (const a of document.querySelectorAll('a[href*="elitebabes.com/"]')) {
          if (out.length >= maxItems) break;
          const href = a.getAttribute('href');
          if (!href) continue;
          try {
            const u = new URL(href, window.location.href);
            const host = u.hostname.toLowerCase();
            if (!(host === 'www.elitebabes.com' || host === 'elitebabes.com')) continue;
            const path = u.pathname;
            if (/^\/(model|model-tag|tag|category|search|random|explore|faves|history|watch-later|collections|pinboards|erotic-art-channels|updates|leaderboard|community|contribute|advertisers|18usc2257|privacy-policy|contact|dmca)\b/i.test(path)) continue;
            if (/^\/[a-z0-9][a-z0-9-]+\/?$/i.test(path)) {
              push(u.toString(), a, 'sub_gallery');
            }
          } catch (e) {}
        }
      }
    }
    return uniqueCandidates(out);
  }

  function collectBatchCandidates(meta) {
    if (isFootFetishForumThreadPage()) {
      const candidates = uniqueCandidates(collectFootFetishForumCandidates(2000));
      return { candidates, urls: candidates.map((c) => c.url) };
    }
    if (meta && meta.platform === 'aznudefeet' && isAznudeFeetViewPage()) {
      const candidates = collectAznudeFeetCandidates(600);
      return { candidates, urls: candidates.map((c) => c.url) };
    }
    if (isEliteBabesPage()) {
      const candidates = collectEliteBabesCandidates(600);
      return { candidates, urls: candidates.map((c) => c.url) };
    }
    const urls = collectBatchUrls(meta);
    const candidates = uniqueCandidates(urls.map((u) => ({ url: u, el: null, kind: '' })));
    return { candidates, urls: candidates.map((c) => c.url) };
  }

  function ensureBatchPreviewCss() {
    try {
      if (document.getElementById('webdl-batch-preview-css')) return;
      const css = document.createElement('style');
      css.id = 'webdl-batch-preview-css';
      css.textContent = `
        #webdl-batch-preview-overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,0.55); display: flex; align-items: flex-end; justify-content: flex-end; }
        #webdl-batch-preview-panel { width: min(560px, 92vw); max-height: min(78vh, 720px); margin: 16px; background: #0b1220; color: #e5e7eb; border: 1px solid rgba(255,255,255,0.10); border-radius: 10px; box-shadow: 0 10px 32px rgba(0,0,0,0.55); display: flex; flex-direction: column; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        #webdl-batch-preview-head { padding: 10px 12px; background: #111827; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        #webdl-batch-preview-title { font-weight: 700; font-size: 13px; color: #93c5fd; }
        #webdl-batch-preview-sub { font-size: 11px; color: #9ca3af; margin-top: 2px; }
        #webdl-batch-preview-controls { display: flex; gap: 6px; }
        .webdl-batch-preview-btn { padding: 7px 10px; border-radius: 6px; border: none; cursor: pointer; font-weight: 700; font-size: 12px; }
        .webdl-batch-preview-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        #webdl-batch-preview-list { padding: 8px 10px; overflow: auto; flex: 1 1 auto; }
        .webdl-batch-row { display: flex; gap: 8px; align-items: flex-start; padding: 6px 6px; border-radius: 6px; }
        .webdl-batch-row:hover { background: rgba(255,255,255,0.06); }
        .webdl-batch-url { font-size: 11px; color: #e5e7eb; word-break: break-all; line-height: 1.35; }
        .webdl-batch-kind { font-size: 10px; color: #6b7280; margin-top: 2px; }
        .webdl-batch-preview-footer { padding: 10px 12px; background: #0f172a; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .webdl-batch-preview-count { font-size: 11px; color: #9ca3af; }
        [data-webdl-batch-hl='1'] { outline: 3px solid rgba(34, 211, 238, 0.9) !important; outline-offset: 2px !important; border-radius: 4px !important; }
        [data-webdl-batch-hl-focus='1'] { outline: 4px solid rgba(253, 224, 71, 0.95) !important; outline-offset: 2px !important; }
      `;
      (document.head || document.documentElement || document.body).appendChild(css);
    } catch (e) {}
  }

  function applyBatchHighlights(candidates) {
    try {
      for (const c of (Array.isArray(candidates) ? candidates : [])) {
        try {
          const el = c && c.el;
          if (!el || !el.setAttribute) continue;
          el.setAttribute('data-webdl-batch-hl', '1');
        } catch (e) {}
      }
    } catch (e) {}
  }

  function clearBatchHighlights() {
    try {
      for (const el of Array.from(document.querySelectorAll('[data-webdl-batch-hl], [data-webdl-batch-hl-focus]'))) {
        try { el.removeAttribute('data-webdl-batch-hl'); } catch (e) {}
        try { el.removeAttribute('data-webdl-batch-hl-focus'); } catch (e) {}
      }
    } catch (e) {}
  }

  function focusBatchHighlight(candidate) {
    try {
      for (const el of Array.from(document.querySelectorAll('[data-webdl-batch-hl-focus]'))) {
        try { el.removeAttribute('data-webdl-batch-hl-focus'); } catch (e) {}
      }
    } catch (e) {}
    try {
      const el = candidate && candidate.el;
      if (!el || !el.setAttribute) return;
      el.setAttribute('data-webdl-batch-hl-focus', '1');
      try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch (e) {}
    } catch (e) {}
  }

  function showBatchPreviewModal(candidates, meta, force) {
    return new Promise((resolve) => {
      try {
        ensureBatchPreviewCss();
        clearBatchHighlights();
        applyBatchHighlights(candidates);

        const looksLikeMediaFileUrl = (rawUrl) => {
          try {
            const s = String(rawUrl || '').trim();
            if (!s) return false;
            return /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv|mp3|m4a)(\?|$)/i.test(s);
          } catch (e) {
            return false;
          }
        };

        const looksLikeIndirectPageUrl = (rawUrl) => {
          try {
            const u = new URL(String(rawUrl || ''), window.location.href);
            const host = String(u.hostname || '').toLowerCase();
            const p = String(u.pathname || '');

            if ((host === 'upload.footfetishforum.com' || host.endsWith('.upload.footfetishforum.com')) && /^\/image\//i.test(p)) return true;
            if (isFootFetishForumAttachmentUrl(rawUrl, window.location.href)) return true;
            if (isKnownExternalMediaWrapperHost(host)) return true;
            return false;
          } catch (e) {
            return false;
          }
        };

        const looksLikeFffAttachmentPage = (rawUrl) => {
          try {
            const u = new URL(String(rawUrl || ''), window.location.href);
            const host = String(u.hostname || '').toLowerCase();
            const p = String(u.pathname || '');
            if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return false;
            return /^\/attachments\//i.test(p);
          } catch (e) {
            return false;
          }
        };

        const normalizeUrl = (rawUrl) => {
          try {
            const u = new URL(String(rawUrl || ''), window.location.href);
            u.hash = '';
            return u.toString();
          } catch (e) {
            return String(rawUrl || '').trim();
          }
        };

        const candidateUrlSet = new Set((Array.isArray(candidates) ? candidates : []).map((c) => {
          try { return normalizeUrl((c && c.url) ? c.url : ''); } catch (e) { return ''; }
        }).filter(Boolean));

        const thumbLinkToDirectSet = (() => {
          const map = new Map();
          try {
            for (const c2 of (Array.isArray(candidates) ? candidates : [])) {
              try {
                const kind2 = String((c2 && c2.kind) ? c2.kind : '');
                if (!/(?:img|img_srcset|bg)_under_link/i.test(kind2)) continue;
                const direct2 = normalizeUrl((c2 && c2.url) ? c2.url : '');
                if (!direct2 || !looksLikeMediaFileUrl(direct2)) continue;
                const el2 = c2 && c2.el ? c2.el : null;
                if (!el2 || !el2.closest) continue;
                const parentLink = el2.closest('a[href], a[data-href], a[data-url]');
                if (!parentLink || !parentLink.getAttribute) continue;
                const href2 = parentLink.getAttribute('href') || parentLink.getAttribute('data-href') || parentLink.getAttribute('data-url');
                if (!href2) continue;
                const thumb2 = normalizeUrl(href2);
                if (!thumb2) continue;
                if (!map.has(thumb2)) map.set(thumb2, new Set());
                map.get(thumb2).add(direct2);
              } catch (e2) {}
            }
          } catch (e) {}
          return map;
        })();

        const inferDirectMediaUrlFromLink = (linkEl) => {
          try {
            if (!linkEl) return '';
            const isImgEl = (() => {
              try { return String(linkEl && linkEl.tagName ? linkEl.tagName : '').toLowerCase() === 'img'; } catch (e) { return false; }
            })();
            const root = (!isImgEl && linkEl.querySelector) ? linkEl : null;
            const img = isImgEl
              ? linkEl
              : (root ? root.querySelector('img') : null);
            if (!img) return '';
            const raw = img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
            if (!raw) return '';
            return normalizeUrl(raw);
          } catch (e) {
            return '';
          }
        };

        try {
          const stats = {
            total: candidates.length,
            thumb_link: 0,
            thumb_link_direct_inferred: 0,
            thumb_link_direct_in_set: 0,
            thumb_link_direct_via_map: 0,
            thumb_link_direct_in_set_via_map: 0
          };
          for (const c0 of (Array.isArray(candidates) ? candidates : [])) {
            const kind0 = String((c0 && c0.kind) ? c0.kind : '');
            if (!/thumb_link/i.test(kind0)) continue;
            stats.thumb_link += 1;
            const url0 = normalizeUrl((c0 && c0.url) ? c0.url : '');
            const mappedSet = thumbLinkToDirectSet.get(url0);
            if (mappedSet && mappedSet.size) {
              stats.thumb_link_direct_via_map += 1;
              for (const d0 of mappedSet) {
                if (candidateUrlSet.has(d0)) {
                  stats.thumb_link_direct_in_set_via_map += 1;
                  break;
                }
              }
            }

            const direct0 = inferDirectMediaUrlFromLink(c0 && c0.el ? c0.el : null);
            if (direct0 && looksLikeMediaFileUrl(direct0)) {
              stats.thumb_link_direct_inferred += 1;
              if (candidateUrlSet.has(direct0)) stats.thumb_link_direct_in_set += 1;
            }
          }
          window.__WEBDL_LAST_THUMB_DEDUPE_STATS = stats;
          console.log('[WEBDL][batch] thumb_link.dedupe', stats);
        } catch (e) {}

        const defaultCheckedForCandidate = (c) => {
          try {
            const url = c && c.url ? normalizeUrl(c.url) : '';
            const kind = String((c && c.kind) ? c.kind : '');
            if (!url) return false;
            const candidateText = String(
              c && c.el && c.el.textContent ? c.el.textContent :
              ''
            ).trim();
            const isLikelyExternalPage = looksLikeExternalMediaPageUrl(url, candidateText);
            if (/_under_link/i.test(kind)) return false;
            if (looksLikeMediaFileUrl(url)) return true;
            if (/^text$/i.test(kind)) return isLikelyExternalPage;

            let host = '';
            let pathname = '';
            try {
              const u = new URL(String(url || ''), window.location.href);
              host = String(u.hostname || '').toLowerCase();
              pathname = String(u.pathname || '');
            } catch (e) {
              host = '';
              pathname = '';
            }

            const isFffUploadHost = host === 'upload.footfetishforum.com' || host.endsWith('.upload.footfetishforum.com');
            const isFffForumHost = host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com');

            if (isFffForumHost && !isFffUploadHost) {
              if (looksLikeFffAttachmentPage(url)) {
                if (/thumb_link/i.test(kind)) {
                  try {
                    const mappedSet = thumbLinkToDirectSet.get(url);
                    if (mappedSet && mappedSet.size) {
                      for (const d of mappedSet) {
                        if (d && looksLikeMediaFileUrl(d) && candidateUrlSet.has(d)) return false;
                      }
                    }
                  } catch (e) {}
                  const direct = inferDirectMediaUrlFromLink(c && c.el ? c.el : null);
                  if (direct && looksLikeMediaFileUrl(direct) && candidateUrlSet.has(direct)) return false;
                }
                return true;
              }
              return false;
            }

            const isKnownHostWrapper = (() => {
              try {
                if (!host) return false;
                if (isFffUploadHost) return /^\/image\//i.test(pathname);
                if (isFootFetishForumAttachmentUrl(url, window.location.href)) return true;
                if (host === 'jpg.pet') return /^\/img\//i.test(pathname);
                if (host === 'pixeldrain.com') return /^\/u\//i.test(pathname);
                if (host === 'cyberfile.me') return true;
                if (host === 'pixhost.to') return true;
                if (isKnownExternalMediaWrapperHost(host)) return true;
                return false;
              } catch (e) {
                return false;
              }
            })();

            if (/thumb_link/i.test(kind)) {
              try {
                const mappedSet = thumbLinkToDirectSet.get(url);
                if (mappedSet && mappedSet.size) {
                  for (const d of mappedSet) {
                    if (d && looksLikeMediaFileUrl(d) && candidateUrlSet.has(d)) return false;
                  }
                }
              } catch (e) {}

              const direct = inferDirectMediaUrlFromLink(c && c.el ? c.el : null);
              if (direct && looksLikeMediaFileUrl(direct) && candidateUrlSet.has(direct)) return false;
              return isKnownHostWrapper || looksLikeIndirectPageUrl(url);
            }

            if (isKnownHostWrapper || looksLikeIndirectPageUrl(url) || isLikelyExternalPage) return true;

            return false;
          } catch (e) {
            return false;
          }
        };

        const getDirectHintForCandidate = (c) => {
          try {
            const url = c && c.url ? normalizeUrl(c.url) : '';
            if (!url || looksLikeMediaFileUrl(url)) return '';
            try {
              const mappedSet = thumbLinkToDirectSet.get(url);
              if (mappedSet && mappedSet.size) {
                for (const d of mappedSet) {
                  if (d && looksLikeMediaFileUrl(d)) return normalizeUrl(d);
                }
              }
            } catch (e) {}
            const direct = inferDirectMediaUrlFromLink(c && c.el ? c.el : null);
            if (direct && looksLikeMediaFileUrl(direct)) return normalizeUrl(direct);
            return '';
          } catch (e) {
            return '';
          }
        };

        const overlay = document.createElement('div');
        overlay.id = 'webdl-batch-preview-overlay';
        try {
          Object.assign(overlay.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            right: '0',
            bottom: '0',
            zIndex: '2147483647',
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end'
          });
        } catch (e) {}

        const panel = document.createElement('div');
        panel.id = 'webdl-batch-preview-panel';
        try {
          Object.assign(panel.style, {
            width: 'min(560px, 92vw)',
            maxHeight: 'min(78vh, 720px)',
            margin: '16px',
            background: '#0b1220',
            color: '#e5e7eb',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '10px',
            boxShadow: '0 10px 32px rgba(0,0,0,0.55)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
          });
        } catch (e) {}
        overlay.appendChild(panel);

      const head = document.createElement('div');
      head.id = 'webdl-batch-preview-head';
      panel.appendChild(head);

      const headLeft = document.createElement('div');
      head.appendChild(headLeft);

      const title = document.createElement('div');
      title.id = 'webdl-batch-preview-title';
      title.textContent = force ? '🔥 Force Batch preview' : '⏬ Batch preview';
      headLeft.appendChild(title);

      const sub = document.createElement('div');
      sub.id = 'webdl-batch-preview-sub';
      sub.textContent = `${(meta && meta.platform) ? meta.platform : 'unknown'} | ${(meta && meta.channel) ? meta.channel : 'unknown'} | ${candidates.length} items`;
      headLeft.appendChild(sub);

      const controls = document.createElement('div');
      controls.id = 'webdl-batch-preview-controls';
      head.appendChild(controls);

      const btnAll = document.createElement('button');
      btnAll.className = 'webdl-batch-preview-btn';
      btnAll.style.background = '#1f2937';
      btnAll.style.color = '#e5e7eb';
      btnAll.textContent = 'Alles';
      controls.appendChild(btnAll);

      const btnNone = document.createElement('button');
      btnNone.className = 'webdl-batch-preview-btn';
      btnNone.style.background = '#1f2937';
      btnNone.style.color = '#e5e7eb';
      btnNone.textContent = 'Niets';
      controls.appendChild(btnNone);

      const btnCancel = document.createElement('button');
      btnCancel.className = 'webdl-batch-preview-btn';
      btnCancel.style.background = '#374151';
      btnCancel.style.color = '#e5e7eb';
      btnCancel.textContent = 'Annuleer';
      controls.appendChild(btnCancel);

      const list = document.createElement('div');
      list.id = 'webdl-batch-preview-list';
      panel.appendChild(list);

      const footer = document.createElement('div');
      footer.className = 'webdl-batch-preview-footer';
      panel.appendChild(footer);

      const count = document.createElement('div');
      count.className = 'webdl-batch-preview-count';
      footer.appendChild(count);

      const btnStart = document.createElement('button');
      btnStart.className = 'webdl-batch-preview-btn';
      btnStart.style.background = force ? '#b91c1c' : '#2563eb';
      btnStart.style.color = 'white';
      btnStart.textContent = force ? 'Force starten' : 'Starten';
      footer.appendChild(btnStart);

      const rows = [];
      const renderCount = () => {
        try {
          const selected = rows.filter((r) => r.cb && r.cb.checked).length;
          count.textContent = `Geselecteerd: ${selected} / ${rows.length}`;
          btnStart.disabled = selected === 0;
        } catch (e) {}
      };

      for (const c of candidates) {
        const row = document.createElement('div');
        row.className = 'webdl-batch-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = defaultCheckedForCandidate(c);
        cb.style.marginTop = '2px';
        row.appendChild(cb);

        const body = document.createElement('div');
        body.style.flex = '1 1 auto';
        row.appendChild(body);

        const u = document.createElement('div');
        u.className = 'webdl-batch-url';
        u.textContent = c.url;
        body.appendChild(u);

        const k = document.createElement('div');
        k.className = 'webdl-batch-kind';
        k.textContent = c.kind ? c.kind : '';
        body.appendChild(k);

        row.addEventListener('mouseenter', () => {
          try { focusBatchHighlight(c); } catch (e) {}
        });

        cb.addEventListener('change', renderCount);
        list.appendChild(row);
        rows.push({ cb, c });
      }

      renderCount();

      const cleanup = () => {
        try { overlay.remove(); } catch (e) {}
        clearBatchHighlights();
      };

      const finish = (value) => {
        cleanup();
        resolve(value);
      };

      btnAll.addEventListener('click', () => {
        for (const r of rows) { try { r.cb.checked = true; } catch (e) {} }
        renderCount();
      });

      btnNone.addEventListener('click', () => {
        for (const r of rows) { try { r.cb.checked = false; } catch (e) {} }
        renderCount();
      });

      btnCancel.addEventListener('click', () => finish(null));
      overlay.addEventListener('click', (e) => {
        try { if (e.target === overlay) finish(null); } catch (e2) {}
      });

      btnStart.addEventListener('click', () => {
        const selectedRows = rows.filter((r) => r.cb && r.cb.checked);
        const selected = selectedRows.map((r) => r.c.url);
        const directHints = {};
        for (const r of selectedRows) {
          try {
            const key = normalizeUrl(r && r.c && r.c.url ? r.c.url : '');
            const hint = getDirectHintForCandidate(r && r.c ? r.c : null);
            if (key && hint && hint !== key) directHints[key] = hint;
          } catch (e) {}
        }
        finish({ urls: selected, directHints });
      });

        try {
          const mount = document.body || document.documentElement;
          if (!mount || !mount.appendChild) throw new Error('mount ontbreekt');
          mount.appendChild(overlay);
        } catch (e) {
          resolve(null);
        }
      } catch (e) {
        try { console.warn('[WEBDL][batch] preview failed', e && e.message ? e.message : e); } catch (e2) {}
        resolve(null);
      }
    });
  }

  // ========================
  // UI OPBOUWEN
  // ========================
  const toolbar = document.createElement('div');
  toolbar.id = 'webdl-toolbar';
  Object.assign(toolbar.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647',
    backgroundColor: '#1a1a2e', color: 'white', padding: '12px', borderRadius: '8px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.6)', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    fontSize: '13px', minWidth: '280px', maxWidth: '350px',
    height: '380px', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column'
  });

  const title = document.createElement('div');
  title.textContent = "\u283f WEBDL";
  try { title.title = String(WEBDL_BUILD || ''); } catch (e) {}
  try {
    const b = String(WEBDL_BUILD || '');
    const short = b ? b.replace(/^debug-toolbar-/, '').slice(0, 24) : '';
    if (short) title.textContent = "\u283f WEBDL " + short;
  } catch (e) {}
  Object.assign(title.style, {
    fontWeight: 'bold', marginBottom: '8px', textAlign: 'center',
    cursor: 'grab', userSelect: 'none', padding: '4px',
    borderBottom: '1px solid #333', color: '#00d4ff', fontSize: '14px'
  });
  toolbar.appendChild(title);

  let isDragging = false, dragX = 0, dragY = 0;
  title.addEventListener('mousedown', (e) => {
    isDragging = true; title.style.cursor = 'grabbing';
    const r = toolbar.getBoundingClientRect();
    dragX = e.clientX - r.left; dragY = e.clientY - r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    toolbar.style.left = (e.clientX - dragX) + 'px';
    toolbar.style.top = (e.clientY - dragY) + 'px';
    toolbar.style.bottom = 'auto'; toolbar.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) { isDragging = false; title.style.cursor = 'grab'; }
  });

  // Meta info
  const metaInfo = document.createElement('div');
  Object.assign(metaInfo.style, {
    fontSize: '11px', color: '#888', marginBottom: '8px',
    padding: '4px 6px', backgroundColor: '#16213e', borderRadius: '4px',
    maxHeight: '40px', overflow: 'hidden', textOverflow: 'ellipsis'
  });
  toolbar.appendChild(metaInfo);

  async function checkUrlStatus(url) {
    try {
      const resp = await getServerJson(`api/media/check?url=${encodeURIComponent(url)}`, 3000);
      const el = document.getElementById('webdl-url-status');
      if (el && resp && resp.success) {
        if (resp.exists) {
          el.innerHTML = '✅ <span style="font-size:10px;">In Library</span>';
          el.style.color = '#4CAF50';
        } else {
          el.innerHTML = '🆕 <span style="font-size:10px;">Nieuw</span>';
          el.style.color = '#2196F3';
        }
      }
    } catch (e) {}
  }

  function updateMetaDisplay() {
    const m = scrapeMetadata();
    metaInfo.innerHTML = `<span style="color:#00d4ff">${m.platform}</span> | ${m.channel}<br><span style="color:#ccc">${m.title.substring(0, 60)}${m.title.length > 60 ? '...' : ''}</span>`;
    if (m.url) checkUrlStatus(m.url);
    try {
      if (threadBatchDownloadBtn) {
        const ok = isFootFetishForumThreadPage() || isFootFetishForumForumPage();
        try { threadBatchDownloadBtn.disabled = !ok; } catch (e) {}
        try { threadBatchDownloadBtn.style.opacity = ok ? '1' : '0.55'; } catch (e) {}
        try { threadBatchDownloadBtn.style.cursor = ok ? 'pointer' : 'not-allowed'; } catch (e) {}
      }
    } catch (e) {}
  }

  // Knoppen
  const btnStyle = { padding: '8px 12px', cursor: 'pointer', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', flex: '1' };

  const btnContainer = document.createElement('div');
  Object.assign(btnContainer.style, { display: 'flex', gap: '6px', marginBottom: '8px' });
  toolbar.appendChild(btnContainer);

  const extraBtnContainer = document.createElement('div');
  Object.assign(extraBtnContainer.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' });
  toolbar.appendChild(extraBtnContainer);

  function makeBtn(text, bg) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, btnStyle, { backgroundColor: bg });
    btnContainer.appendChild(btn);
    return btn;
  }

  function makeBtnIn(container, text, bg) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, btnStyle, { backgroundColor: bg });
    container.appendChild(btn);
    return btn;
  }

  const screenshotBtn = makeBtn('📷 Screenshot', '#4CAF50');
  const downloadBtn = makeBtn('⬇️ Download', '#2196F3');
  const batchDownloadBtn = makeBtn('⏬ Batch', '#1565C0');
  const dashboardBtn = makeBtn('📊 Dashboard', '#0f3460');
  const mediaDownloadBtn = makeBtnIn(extraBtnContainer, '🖼 Media', '#6d28d9');
  const forceBatchDownloadBtn = makeBtnIn(extraBtnContainer, '🔥 Force', '#b91c1c');
  const threadBatchDownloadBtn = makeBtnIn(extraBtnContainer, '🧵 Hele thread', '#0ea5e9');
  const vdhHintBtn = makeBtnIn(extraBtnContainer, '🧩 VDH hint', '#2e7d32');
  const redditAllBtn = makeBtnIn(extraBtnContainer, '🧵 Reddit all', '#ff4500');
  const ytShortsBtn = makeBtnIn(extraBtnContainer, '⏬ Shorts', '#7c3aed');
  const ytVideosBtn = makeBtnIn(extraBtnContainer, '⏬ Videos', '#5b21b6');
  const openAllBtn = makeBtnIn(extraBtnContainer, 'Open alle', '#03A9F4');

  // Tweede rij: REC knoppen
  const recContainer = document.createElement('div');
  Object.assign(recContainer.style, { display: 'flex', gap: '6px', marginBottom: '8px' });
  toolbar.appendChild(recContainer);

  function makeRecBtn(text, bg) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, btnStyle, { backgroundColor: bg });
    recContainer.appendChild(btn);
    return btn;
  }

  const recStartBtn = makeRecBtn('\u23fa REC Start', '#e74c3c');
  const recStopBtn = makeRecBtn('\u23f9 REC Stop', '#555');
  recStopBtn.style.opacity = '0.5'; recStopBtn.style.cursor = 'not-allowed';

  // Status balk
  const statusBar = document.createElement('div');
  Object.assign(statusBar.style, {
    fontSize: '11px', padding: '4px 6px', backgroundColor: '#16213e',
    borderRadius: '4px', marginBottom: '6px', display: 'flex',
    justifyContent: 'space-between', alignItems: 'center'
  });
  statusBar.innerHTML = '<span id="webdl-conn" style="color:#F44336">Verbinden...</span><span id="webdl-url-status" style="margin-left:8px;font-weight:bold;color:#888;">🔍 Checken...</span><span id="webdl-prio-toggle" style="margin-left:8px;cursor:pointer;padding:2px 6px;border-radius:3px;background:#333;border:1px solid #555;font-size:10px;font-weight:bold;color:#888;" title="Nieuwe downloads vooraan in wachtrij">⚡ Prio</span><span id="webdl-dl-count" style="color:#888;margin-left:auto;">0 downloads</span>';
  toolbar.appendChild(statusBar);

  // Priority toggle handler
  (async function initPrioToggle() {
    const prioBtn = statusBar.querySelector('#webdl-prio-toggle');
    if (!prioBtn) return;
    let prioState = false;

    function applyPrioUI(on) {
      prioState = !!on;
      prioBtn.dataset.active = on ? '1' : '0';
      prioBtn.style.background = on ? '#b22222' : '#333';
      prioBtn.style.borderColor = on ? '#ff4444' : '#555';
      prioBtn.style.color = on ? '#fff' : '#888';
      prioBtn.textContent = on ? '🔥 PRIO' : '⚡ Prio';
    }

    // Load initial state
    try {
      const r = await getServerJson('api/settings/priority', 3000);
      if (r && r.priority) applyPrioUI(true);
    } catch (e) {}

    prioBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        const r = await postServerJson('api/settings/priority', { enabled: !prioState }, 3000);
        if (r && r.success) {
          applyPrioUI(r.priority);
          showNotification(r.priority ? 'Prioriteit AAN — nieuwe downloads gaan vooraan' : 'Prioriteit UIT');
        } else {
          showNotification('Prioriteit toggle mislukt: ' + (r && r.error ? r.error : 'onbekend'), true);
        }
      } catch (e) {
        showNotification('Prioriteit toggle fout: ' + (e && e.message ? e.message : String(e)), true);
      }
    });
  })();

  // Notificatie area
  const notifArea = document.createElement('div');
  Object.assign(notifArea.style, {
    flex: '1 1 auto',
    minHeight: '84px',
    overflowY: 'auto',
    overflowX: 'hidden',
    paddingRight: '2px'
  });
  toolbar.appendChild(notifArea);

  // Log container (collapsed)
  const logContainer = document.createElement('div');
  Object.assign(logContainer.style, {
    fontSize: '11px', maxHeight: '0', overflow: 'hidden', transition: 'max-height 0.3s',
    backgroundColor: '#111', marginTop: '4px', borderRadius: '3px'
  });
  toolbar.appendChild(logContainer);

  const logToggle = document.createElement('button');
  logToggle.textContent = 'Log tonen';
  Object.assign(logToggle.style, {
    width: '100%', padding: '3px', marginTop: '4px', backgroundColor: '#333',
    color: '#888', border: 'none', borderRadius: '3px', fontSize: '10px', cursor: 'pointer'
  });
  toolbar.appendChild(logToggle);

  document.body.appendChild(toolbar);

  const captureFrame = document.createElement('div');
  captureFrame.id = 'webdl-capture-frame';
  Object.assign(captureFrame.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '0px',
    height: '0px',
    boxShadow: '0 0 0 3px #00d4ff',
    borderRadius: '6px',
    boxSizing: 'border-box',
    zIndex: '2147483646',
    pointerEvents: 'none',
    display: 'none'
  });
  document.body.appendChild(captureFrame);

  // ========================
  // LOG & NOTIFICATIE
  // ========================
  const logEntries = [];

  function addLog(msg, type = 'info') {
    const ts = new Date().toLocaleTimeString();
    logEntries.push({ ts, msg, type });
    if (logEntries.length > 30) logEntries.shift();
    if (logContainer.style.maxHeight !== '0px') renderLog();
  }

  function renderLog() {
    logContainer.innerHTML = logEntries.map(e =>
      `<div style="padding:2px 5px;border-bottom:1px solid #222"><span style="color:#555">${e.ts}</span> <span style="color:${e.type === 'error' ? '#F44336' : '#4CAF50'}">${e.msg}</span></div>`
    ).join('');
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  logToggle.addEventListener('click', () => {
    if (logContainer.style.maxHeight === '0px' || logContainer.style.maxHeight === '0') {
      logContainer.style.maxHeight = '120px'; logContainer.style.padding = '4px';
      logToggle.textContent = 'Log verbergen'; renderLog();
    } else {
      logContainer.style.maxHeight = '0'; logContainer.style.padding = '0';
      logToggle.textContent = 'Log tonen';
    }
  });

  ytShortsBtn.addEventListener('click', async function() {
    await runYouTubeBatch('shorts');
  });

  ytVideosBtn.addEventListener('click', async function() {
    await runYouTubeBatch('videos');
  });

  openAllBtn.addEventListener('click', async function() {
    if (!(await ensureServerReachable(true))) return;
    const meta = scrapeMetadata();
    const urls = collectBatchUrls(meta);
    if (!urls.length) {
      showNotification('Geen links gevonden op deze pagina', true);
      return;
    }
    openAllBtn.textContent = '⏳ Openen...';
    openAllBtn.style.opacity = '0.5';
    const unique = Array.from(new Set(urls));
    let ok = 0;
    for (let i = 0; i < unique.length; i++) {
      const url = unique[i];
      try {
        await fetch(`${SERVER}/open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        ok++;
      } catch (e) {}
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    showNotification(`Openen afgerond (${ok}/${unique.length})`);
    openAllBtn.textContent = 'Open alle';
    openAllBtn.style.opacity = '1';
  });

  vdhHintBtn.addEventListener('click', async function() {
    if (!(await ensureServerReachable(true))) return;
    try {
      vdhHintBtn.textContent = '⏳ Hint...';
      vdhHintBtn.style.opacity = '0.6';
      const meta = scrapeMetadata();
      const payload = { url: meta.url, metadata: meta };
      const viaHttp = await postServerJson('vdh/hint', payload, 8000);
      if (viaHttp && viaHttp.success) {
        const dbg = meta && meta._channelSelector ? ` (sel: ${meta._channelSelector})` : '';
        showNotification(`VDH hint opgeslagen: ${meta.channel}${dbg}`);
      } else {
        showNotification(`VDH hint fout: ${(viaHttp && viaHttp.error) ? viaHttp.error : 'unknown'}`, true);
      }
    } catch (e) {
      showNotification(`VDH hint fout: ${e && e.message ? e.message : String(e)}`, true);
    } finally {
      vdhHintBtn.textContent = '🧩 VDH hint';
      vdhHintBtn.style.opacity = '1';
    }
  });

  function showNotification(msg, isError = false) {
    const n = document.createElement('div');
    Object.assign(n.style, {
      padding: '6px 8px', borderRadius: '4px', marginBottom: '4px', fontSize: '11px',
      wordBreak: 'break-all', backgroundColor: isError ? '#c0392b' : '#27ae60', color: 'white'
    });
    n.textContent = msg;
    notifArea.appendChild(n);
    try { addLog(msg, isError ? 'error' : 'info'); } catch (e) {}
    setTimeout(() => n.remove(), isError ? 20000 : 6000);
  }

  let lastPickedMediaUrl = '';
  let lastPickedMediaAt = 0;
  function setLastPickedMediaUrl(u) {
    const s = String(u || '').trim();
    if (!s) return;
    if (/^(data:|blob:|javascript:|mailto:)/i.test(s)) return;
    lastPickedMediaUrl = s;
    lastPickedMediaAt = Date.now();
  }

  document.addEventListener('click', (ev) => {
    try {
      if (!isFootFetishForumThreadPage()) return;
      const t = ev && ev.target ? ev.target : null;
      if (!t) return;
      if (t.closest && t.closest('#webdl-toolbar')) return;

      const a = t.closest ? t.closest('a[href]') : null;
      const img = t.closest ? t.closest('img') : null;
      const video = t.closest ? t.closest('video') : null;
      const source = t.closest ? t.closest('source') : null;

      let candidate = '';
      if (a) candidate = a.getAttribute('href') || '';
      if (!candidate && img) candidate = img.currentSrc || img.src || img.getAttribute('src') || '';
      if (!candidate && video) candidate = video.currentSrc || video.src || video.getAttribute('src') || '';
      if (!candidate && source) candidate = source.src || source.getAttribute('src') || '';
      if (!candidate) return;

      const abs = new URL(candidate, window.location.href);
      abs.hash = '';
      const final = abs.toString();
      const path = String(abs.pathname || '').toLowerCase();
      const looksMedia = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv)(\?|$)/i.test(final) || /\/attachments\//i.test(path);
      if (!looksMedia) return;
      setLastPickedMediaUrl(final);
      showNotification(`Geselecteerd: ${final.slice(0, 90)}${final.length > 90 ? '…' : ''}`);
    } catch (e) {}
  }, true);

  // ========================
  // SERVER COMMUNICATIE
  // ========================
  let isConnected = null;

  function applyConnectionState(nextConnected) {
    const next = !!nextConnected;
    const changed = isConnected !== next;
    isConnected = next;
    document.getElementById('webdl-conn').textContent = next ? 'Verbonden' : 'Niet verbonden';
    document.getElementById('webdl-conn').style.color = next ? '#4CAF50' : '#F44336';
    if (changed) {
      addLog(next ? 'Verbonden met WEBDL server' : 'Verbinding verbroken', next ? 'info' : 'error');
    }
  }

  async function getBackgroundStatus() {
    try {
      const status = await browser.runtime.sendMessage({ action: 'getStatus' });
      if (!status || typeof status !== 'object') return null;
      return status;
    } catch (e) {
      return null;
    }
  }

  async function sendBackgroundAction(action, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
    try {
      const timeout = new Promise((resolve) => {
        setTimeout(() => resolve({ success: false, error: `Timeout bij ${action}` }), Math.max(500, Number(timeoutMs) || REQUEST_TIMEOUT_MS));
      });
      const request = browser.runtime.sendMessage({ action, payload: payload || {} })
        .catch((e) => ({ success: false, error: e && e.message ? e.message : String(e) }));
      const result = await Promise.race([request, timeout]);
      return (result && typeof result === 'object') ? result : { success: false, error: `Leeg antwoord op ${action}` };
    } catch (e) {
      return { success: false, error: e && e.message ? e.message : String(e) };
    }
  }

  async function postServerJson(endpoint, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
    let lastError = null;
    for (const base of getServerCandidates()) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || REQUEST_TIMEOUT_MS));
      try {
        const resp = await fetch(`${base}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}),
          signal: controller.signal
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          lastError = (data && data.error) ? data.error : `Server fout: ${resp.status}`;
          continue;
        }
        return data;
      } catch (e) {
        lastError = e && e.message ? e.message : String(e);
      } finally {
        clearTimeout(t);
      }
    }
    return { success: false, error: lastError || 'Server niet bereikbaar' };
  }

  async function getServerJson(endpoint, timeoutMs = REQUEST_TIMEOUT_MS) {
    let lastError = null;
    for (const base of getServerCandidates()) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || REQUEST_TIMEOUT_MS));
      try {
        const resp = await fetch(`${base}/${endpoint}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          lastError = (data && data.error) ? data.error : `Server fout: ${resp.status}`;
          continue;
        }
        return data;
      } catch (e) {
        lastError = e && e.message ? e.message : String(e);
      } finally {
        clearTimeout(t);
      }
    }
    return { success: false, error: lastError || 'Server niet bereikbaar' };
  }

  async function getStatusViaHttp(timeoutMs = 5000) {
    let lastError = null;
    for (const base of getServerCandidates()) {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), Math.max(500, Number(timeoutMs) || 5000));
      try {
        const resp = await fetch(`${base}/status`, { cache: 'no-store', signal: ctrl.signal });
        const data = await resp.json();
        if (!resp.ok) {
          lastError = (data && data.error) ? data.error : `HTTP ${resp.status}`;
          continue;
        }
        return { success: true, data };
      } catch (e) {
        lastError = e && e.message ? e.message : String(e);
      } finally {
        clearTimeout(timeout);
      }
    }
    return { success: false, error: lastError || 'Status endpoint niet bereikbaar' };
  }

  async function queueDownloadRequest(meta) {
    let url = meta.url;
    try {
      if (/web\.telegram\.org/i.test(url)) {
        const match = url.match(/#(-?\d+)/);
        if (match && match[1]) {
          const chatId = match[1].replace(/^-/, '');
          url = `https://t.me/c/${chatId}`;
          console.log(`[WEBDL] Telegram Web URL geconverteerd: ${meta.url} -> ${url}`);
        }
      }
      if (meta && meta.platform === 'onlyfans') {
        const user = normalizeOnlyFansUsername(meta.channel);
        if (user) {
          url = `https://onlyfans.com/${user}`;
        }
      }
    } catch (e) {}
    const payload = { url, metadata: meta };
    const viaBg = await sendBackgroundAction('queueDownload', payload, 12000);
    if (viaBg && viaBg.success) return viaBg;
    const viaHttp = await postServerJson('download', payload, 12000);
    if (viaHttp && viaHttp.success) return viaHttp;
    return viaBg && viaBg.error ? viaBg : viaHttp;
  }

  async function queueDownloadRequestWithOverride(meta, urlOverride) {
    const target = String(urlOverride || '').trim();
    if (!target) return queueDownloadRequest(meta);
    const payload = { url: target, metadata: meta };
    const viaBg = await sendBackgroundAction('queueDownload', payload, 12000);
    if (viaBg && viaBg.success) return viaBg;
    const viaHttp = await postServerJson('download', payload, 12000);
    if (viaHttp && viaHttp.success) return viaHttp;
    return viaBg && viaBg.error ? viaBg : viaHttp;
  }

  async function queueBatchDownloadRequest(urls, meta, options) {
    const opt = options && typeof options === 'object' ? options : {};
    const payloadMeta = meta && typeof meta === 'object' ? { ...meta } : {};
    if (opt.directHints && typeof opt.directHints === 'object' && Object.keys(opt.directHints).length) {
      payloadMeta.webdl_direct_hints = { ...opt.directHints };
    }
    const payload = { urls, metadata: payloadMeta };
    if (opt.force === true) payload.force = true;
    const viaBg = await sendBackgroundAction('queueBatchDownload', payload, 20000);
    if (viaBg && viaBg.success) return viaBg;
    const viaHttp = await postServerJson('download/batch', payload, 20000);
    if (viaHttp && viaHttp.success) return viaHttp;
    return viaBg && viaBg.error ? viaBg : viaHttp;
  }

  function confirmBatchStart({ count, force, label, redditHint }) {
    const total = Math.max(0, parseInt(count || 0, 10) || 0);
    const title = String(label || 'Batch download');
    const extraRedditHint = redditHint ? String(redditHint) : '';
    const forceHint = force ? '\nFORCE: duplicates opnieuw downloaden' : '';
    return window.confirm(`${title} starten voor ${total} items?${extraRedditHint}${forceHint}`);
  }

  async function requestRedditIndex(seedUrl) {
    const payload = { url: seedUrl, maxItems: 5000, maxPages: 120 };
    const viaBg = await sendBackgroundAction('redditIndex', payload, 15000);
    if (viaBg && viaBg.success) return viaBg;
    const viaHttp = await postServerJson('reddit/index', payload, 15000);
    if (viaHttp && viaHttp.success) return viaHttp;
    return viaBg && viaBg.error ? viaBg : viaHttp;
  }

  async function startRecordingRequest(payload) {
    const viaBg = await sendBackgroundAction('startRecording', payload, 20000);
    if (viaBg && viaBg.success) return viaBg;
    const viaHttp = await postServerJson('start-recording', payload, 20000);
    if (viaHttp && viaHttp.success) return viaHttp;
    return viaBg && viaBg.error ? viaBg : viaHttp;
  }

  async function stopRecordingRequest(payload) {
    const viaBg = await sendBackgroundAction('stopRecording', payload, 20000);
    if (viaBg && viaBg.success) return viaBg;
    const viaHttp = await postServerJson('stop-recording', payload, 20000);
    if (viaHttp && viaHttp.success) return viaHttp;
    return viaBg && viaBg.error ? viaBg : viaHttp;
  }

  function syncStatusSnapshot(data) {
    try {
      if (!data || typeof data !== 'object') return;
      if (Number.isFinite(Number(data.activeDownloads))) {
        document.getElementById('webdl-dl-count').textContent = `${Number(data.activeDownloads) || 0} actief`;
      }
      if (typeof data.isRecording !== 'undefined') {
        updateRecUI(!!data.isRecording, data.activeRecordingUrls);
      }
    } catch (e) {}
  }

  async function ensureServerReachable(showError = false) {
    const bg = await getBackgroundStatus();
    if (bg && typeof bg.isConnected === 'boolean') {
      applyConnectionState(bg.isConnected);
      syncStatusSnapshot(bg);
      if (bg.isConnected) return true;
    }

    try {
      const statusResp = await getStatusViaHttp(5000);
      if (!statusResp || !statusResp.success) throw new Error(statusResp && statusResp.error ? statusResp.error : 'Status endpoint niet bereikbaar');
      const data = statusResp.data || {};
      applyConnectionState(true);
      syncStatusSnapshot(data);
      return true;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      applyConnectionState(false);
      if (showError) {
        showNotification(`Niet verbonden met server: ${msg}`, true);
        addLog(`Status-check mislukt: ${msg}`, 'error');
      }
      return false;
    }
  }

  async function checkServer() {
    await ensureServerReachable(false);
  }

  setInterval(checkServer, 3000);
  checkServer();

  // ========================
  // SCREENSHOT (video canvas → server)
  // ========================
  const MIN_SCREENSHOT_BYTES = 12000;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForNextVideoFrame(video) {
    if (video && typeof video.requestVideoFrameCallback === 'function' && !video.paused && !video.ended) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        try {
          video.requestVideoFrameCallback(() => finish());
        } catch (e) {
          finish();
          return;
        }
        setTimeout(finish, 250);
      });
      return;
    }
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function pickBestVideoTarget() {
    const best = { score: -1, rect: null, video: null };

    const scoreVideo = (v, rect) => {
      const area = rect.width * rect.height;
      const playingBonus = (!v.paused && !v.ended && v.readyState >= 2) ? 1000000 : 0;
      const dimensionBonus = (v.videoWidth && v.videoHeight) ? Math.min(1000000, v.videoWidth * v.videoHeight) : 0;
      return area + playingBonus + dimensionBonus;
    };

    const considerVideo = (v, rect) => {
      if (!rect.width || !rect.height) return;
      if (rect.width < 80 || rect.height < 60) return;
      const s = scoreVideo(v, rect);
      if (s > best.score) {
        best.score = s;
        best.rect = rect;
        best.video = v;
      }
    };

    const visit = (doc, offsetX, offsetY, depth) => {
      if (!doc || depth > 2) return;

      const vids = Array.from(doc.querySelectorAll('video'));
      for (const v of vids) {
        try {
          const r = v.getBoundingClientRect();
          const rect = {
            left: offsetX + r.left,
            top: offsetY + r.top,
            width: r.width,
            height: r.height
          };
          considerVideo(v, rect);
        } catch (e) {}
      }

      const iframes = Array.from(doc.querySelectorAll('iframe'));
      for (const f of iframes) {
        try {
          const fr = f.getBoundingClientRect();
          if (!fr.width || !fr.height) continue;
          if (fr.width < 120 || fr.height < 90) continue;

          const nextOffsetX = offsetX + fr.left;
          const nextOffsetY = offsetY + fr.top;
          let childDoc = null;
          try {
            childDoc = f.contentDocument;
          } catch (e) {
            childDoc = null;
          }
          if (childDoc) visit(childDoc, nextOffsetX, nextOffsetY, depth + 1);
        } catch (e) {}
      }
    };

    visit(document, 0, 0, 0);
    if (best.rect) return { rect: best.rect, video: best.video };

    let bestFrame = null;
    let bestArea = -1;
    for (const f of Array.from(document.querySelectorAll('iframe'))) {
      try {
        const r = f.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.width < 160 || r.height < 120) continue;
        const area = r.width * r.height;
        if (area > bestArea) {
          bestArea = area;
          bestFrame = r;
        }
      } catch (e) {}
    }
    if (bestFrame) return { rect: bestFrame, video: null };

    return null;
  }

  async function captureJpegBlobFromVideo(video) {
    const width = video.videoWidth || video.clientWidth;
    const height = video.videoHeight || video.clientHeight;
    if (!width || !height) throw new Error('Video heeft geen zichtbare afmeting');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 1.0));
  }

  async function captureReliableJpegBlob(video, maxAttempts = 3) {
    let lastSize = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await waitForNextVideoFrame(video);
      const blob = await captureJpegBlobFromVideo(video);
      lastSize = blob ? blob.size : 0;
      if (blob && blob.size >= MIN_SCREENSHOT_BYTES) return blob;
      await delay(80);
    }
    throw new Error(`Screenshot te klein (${lastSize} bytes)`);
  }

  async function runScreenshotFlow() {
    showNotification('Screenshot gestart...');
    addLog('Screenshot...');
    const meta = scrapeMetadata();
    const target = pickBestVideoTarget();
    const video = target ? target.video : null;

    const localOnly = !isConnected;
    if (localOnly) {
      showNotification('Niet verbonden met server (screenshot kan niet naar WEBDL)', true);
      addLog('Niet verbonden met server (screenshot)', 'error');
      const okLocal = window.confirm('Niet verbonden met WEBDL server. Screenshot lokaal opslaan in Firefox Downloads?\n\nLet op: dit komt NIET in WEBDL/DB.');
      if (!okLocal) return { success: false, error: 'Niet verbonden met server' };
    }

    if (!video) {
      showNotification('Geen video gevonden op pagina', true);
      addLog('Geen video gevonden', 'error');
      return { success: false, error: 'Geen video gevonden op pagina' };
    }

    let jpegBlob = null;
    try {
      jpegBlob = await captureReliableJpegBlob(video, 3);
      if (!jpegBlob) throw new Error('Kan screenshot niet maken');

      if (localOnly) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(jpegBlob);
        a.download = `screenshot_${Date.now()}.jpg`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        showNotification(`Screenshot lokaal gedownload`);
        return { success: true, local: true };
      }

      const formData = new FormData();
      formData.append('image', jpegBlob, `screenshot_${Date.now()}.jpg`);
      formData.append('url', meta.url || '');
      formData.append('metadata', JSON.stringify(meta));

      // Stuur naar server voor opslag in juiste map
      const resp = await fetch(`${SERVER}/screenshot`, {
        method: 'POST',
        body: formData
      });
      const rawText = await resp.text();
      let result = null;
      try { result = JSON.parse(rawText); } catch (e) { result = null; }

      if (!resp.ok) {
        const msg = (result && result.error) ? result.error : rawText;
        throw new Error(`HTTP ${resp.status}: ${String(msg || '').slice(0, 240)}`);
      }

      if (!result || !result.success) {
        throw new Error((result && result.error) ? result.error : 'Screenshot mislukt');
      }

      showNotification(`Screenshot opgeslagen: ${result.file}`);
      addLog(`Screenshot: ${result.path}`);
      return { success: true, path: result.path, file: result.file };
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      showNotification(`Server screenshot mislukt: ${msg}`, true);
      addLog(`Server screenshot mislukt: ${msg}`, 'error');

      const okLocal = window.confirm(`Server screenshot mislukt. Lokaal opslaan in Firefox Downloads?\n\nLet op: dit komt NIET in WEBDL/DB.\n\n${msg}`);
      if (!okLocal) return { success: false, error: msg };

      try {
        if (!jpegBlob) {
          jpegBlob = await captureReliableJpegBlob(video, 3);
        }
        if (!jpegBlob) { showNotification('Kan video niet capturen', true); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(jpegBlob);
        a.download = `screenshot_${Date.now()}.jpg`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        showNotification(`Screenshot lokaal gedownload`);
        return { success: true, local: true };
      } catch (e2) {
        showNotification('Screenshot mislukt (beveiligd?)', true);
        return { success: false, error: (e2 && e2.message) ? e2.message : 'Screenshot mislukt (beveiligd?)' };
      }
    }
  }

  screenshotBtn.addEventListener('click', async function() {
    try {
      screenshotBtn.textContent = '📷 Bezig...';
      screenshotBtn.style.opacity = '0.65';
      showNotification('Screenshot knop ingedrukt');
      console.warn('[WEBDL] Screenshot button clicked');
      await runScreenshotFlow();
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      console.error('[WEBDL] Screenshot flow failed:', msg);
      showNotification(`Screenshot fout: ${msg}`, true);
    } finally {
      screenshotBtn.textContent = '📷 Screenshot';
      screenshotBtn.style.opacity = '1';
    }
  });

  // ========================
  // DOWNLOAD VIDEO (yt-dlp via server)
  // ========================
  downloadBtn.addEventListener('click', async function() {
    if (!(await ensureServerReachable(true))) return;
    const meta = scrapeMetadata();

    if (isFootFetishForumThreadPage()) {
      const picked = String(lastPickedMediaUrl || '').trim();
      const fresh = picked && (Date.now() - (lastPickedMediaAt || 0)) < (12 * 60 * 60 * 1000);
      if (!fresh) {
        showNotification('Klik eerst op een foto/video/attachment en druk dan Download (of gebruik ⏬ Batch / 🖼 Media).', true);
        return;
      }
      addLog(`Download selected media: ${picked}`);
      try {
        const result = await queueDownloadRequestWithOverride(meta, picked);
        if (result && result.success) {
          const id = result.downloadId;
          const title = result.title || meta.title;
          const status = (result && typeof result.status === 'string') ? result.status : '';
          if (result.duplicate) {
            const statusHint = status ? ` (${status})` : '';
            showNotification(`Bestaat al: #${id}${statusHint} — ${title}`);
            addLog(`Bestaat al #${id}${statusHint}`);
            if (status && status !== 'completed' && status !== 'error' && status !== 'cancelled') {
              pollDownload(id);
            }
          } else {
            showNotification(`Download #${id} gestart: ${title}`);
            addLog(`Download #${id} gestart`);
            pollDownload(id);
          }
        } else {
          showNotification(`Download fout: ${result && result.error ? result.error : 'unknown'}`, true);
        }
      } catch (e) {
        showNotification(`Download fout: ${e.message}`, true);
        addLog(`Download fout: ${e.message}`, 'error');
      }
      return;
    }

    if (meta.platform === 'aznudefeet' && isAznudeFeetViewPage()) {
      const urls = collectAznudeFeetCandidates(600).map((c) => c.url);
      if (!urls.length) {
        showNotification('Geen AZNudeFeet media gevonden op deze pagina', true);
        return;
      }
      const ok = window.confirm(`AZNudeFeet: download alle media op deze pagina? (${urls.length} items)`);
      if (!ok) return;
      addLog(`AZNudeFeet media: ${urls.length} items`);
      try {
        const result = await queueBatchDownloadRequest(urls, meta);
        if (result && result.success) {
          const stats = summarizeBatchResult(result);
          showNotification(`AZNudeFeet: ${stats.queued} nieuw, ${stats.duplicates} bestaand (${stats.total} totaal)`);
          addLog(`AZNudeFeet gestart: nieuw=${stats.queued}, bestaand=${stats.duplicates}, totaal=${stats.total}`);
        } else {
          showNotification(`AZNudeFeet fout: ${(result && result.error) ? result.error : 'unknown'}`, true);
          addLog(`AZNudeFeet fout: ${(result && result.error) ? result.error : 'unknown'}`, 'error');
        }
      } catch (e) {
        showNotification(`AZNudeFeet fout: ${e.message}`, true);
        addLog(`AZNudeFeet fout: ${e.message}`, 'error');
      }
      return;
    }

    // Pornpics: if on a CDN image page, try to download the full gallery instead
    if (meta.platform === 'pornpics' && meta._pornpicsGalleryUrl) {
      const galleryUrl = meta._pornpicsGalleryUrl;
      addLog(`Pornpics: CDN afbeelding → gallery download: ${galleryUrl}`);
      try {
        const result = await queueDownloadRequestWithOverride(meta, galleryUrl);
        if (result && result.success) {
          const id = result.downloadId;
          const title = result.title || meta.title;
          if (result.duplicate) {
            showNotification(`Bestaat al: #${id} — ${title}`);
          } else {
            showNotification(`Gallery download #${id} gestart: ${title}`);
            pollDownload(id);
          }
        } else {
          showNotification(`Download fout: ${result && result.error ? result.error : 'unknown'}`, true);
        }
      } catch (e) {
        showNotification(`Download fout: ${e.message}`, true);
      }
      return;
    }

    addLog(`Download starten: ${meta.title}`);
    const originalText = downloadBtn.textContent;
    downloadBtn.textContent = '\u23f3 Start...';
    downloadBtn.style.opacity = '0.7';
    setTimeout(() => {
      try {
        downloadBtn.textContent = originalText;
        downloadBtn.style.opacity = '1';
      } catch (e) {}
    }, 900);

    try {
      const result = await queueDownloadRequest(meta);
      console.log('[WEBDL] Download result:', result);

      if (result && result.success) {
        const id = result.downloadId;
        const title = result.title || meta.title;
        const status = (result && typeof result.status === 'string') ? result.status : '';
        const msg = result.message || '';
        
        console.log('[WEBDL] Download success:', { id, duplicate: result.duplicate, status, msg });
        
        if (result.duplicate) {
          const statusHint = status ? ` (${status})` : '';
          const displayMsg = msg || `Bestaat al: #${id}${statusHint} — ${title}`;
          showNotification(displayMsg);
          addLog(`Bestaat al #${id}${statusHint}`);
          if (status && status !== 'completed' && status !== 'error' && status !== 'cancelled') {
            pollDownload(id);
          }
        } else {
          showNotification(`Download #${id} gestart: ${title}`);
          addLog(`Download #${id} gestart`);
          pollDownload(id);
        }
      } else {
        const err = (result && result.error) ? result.error : 'unknown';
        console.error('[WEBDL] Download failed:', err);
        showNotification(`Download fout: ${err}`, true);
      }
    } catch (e) {
      console.error('[WEBDL] Download exception:', e);
      showNotification(`Download fout: ${e.message}`, true);
      addLog(`Download fout: ${e.message}`, 'error');
    }
  });

  function collectBatchUrls(meta) {
    if (isFootFetishForumThreadPage()) {
      return collectFootFetishForumUrls(2000);
    }

    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const out = [];
    const seen = new Set();

    const push = (u) => {
      try {
        const parsed = new URL(u, window.location.href);
        parsed.hash = '';
        const final = parsed.toString();
        if (!seen.has(final)) {
          seen.add(final);
          out.push(final);
        }
      } catch (e) {}
    };

    const pageHost = (new URL(window.location.href)).host.toLowerCase();
    const pageHostName = (new URL(window.location.href)).hostname.toLowerCase();
    const pagePathname = (new URL(window.location.href)).pathname || '/';
    const useKnownListingHeuristics = isKnownBatchListingDomain(pageHostName) && isLikelyListingPath(pagePathname);

    const isAllowedHost = (u) => {
      const targetHost = String((u && u.host) || '').toLowerCase();
      if (!targetHost) return false;
      return targetHost === pageHost;
    };

    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      try {
        const u = new URL(href, window.location.href);
        if (!isAllowedHost(u)) continue;

        const s = u.toString();
        if (meta.platform === 'instagram') {
          if (/instagram\.com\/(p|reel|tv)\//i.test(s)) push(s);
        } else if (useKnownListingHeuristics) {
          if (isLikelyVideoDetailUrl(u, a)) push(s);
        } else if (meta.platform === 'facebook') {
          if (/facebook\.com\/(watch|reel|share|videos?)\b/i.test(s) || /facebook\.com\/[^\/\?#]+\/videos\//i.test(s) || /fb\.watch\//i.test(s)) push(s);
        } else if (meta.platform === 'wikifeet') {
          push(s);
        } else if (meta.platform === 'kinky') {
          push(s);
        } else if (meta.platform === 'aznudefeet') {
          if (/aznudefeet\.com\/view\/[^\/]+\/[^\/]+\/\d+\/[^\/\?#]+\.html/i.test(s)) push(s);
        }
      } catch (e) {}
    }

    if (meta.platform === 'onlyfans') {
      const user = normalizeOnlyFansUsername(meta.channel);
      push(user ? `https://onlyfans.com/${user}` : window.location.href);
    }

    if (out.length === 0) {
      if (useKnownListingHeuristics) {
        for (const a of anchors) {
          const href = a.getAttribute('href');
          if (!href) continue;
          try {
            const u = new URL(href, window.location.href);
            if (!isAllowedHost(u)) continue;
            if (isLikelyVideoDetailUrl(u, a)) push(u.toString());
          } catch (e) {}
        }
      } else {
        push(window.location.href);
      }
    }

    return out;
  }

  function summarizeBatchResult(result) {
    const rows = Array.isArray(result && result.downloads) ? result.downloads : [];
    if (!rows.length && result && (result.queued != null || result.duplicates != null || result.errors != null)) {
      const queued = Number(result.queued) || 0;
      const duplicates = Number(result.duplicates) || 0;
      const errors = Number(result.errors) || 0;
      return { total: queued + duplicates + errors, queued, duplicates };
    }
    if (result && result.expanded) {
      return {
        total: Number(result.total) || 0,
        queued: Number(result.queued) || 0,
        duplicates: Number(result.duplicates) || 0
      };
    }
    if (!rows.length && result && Array.isArray(result.jobs)) {
      return {
        total: Number(result.total) || result.jobs.length,
        queued: Number(result.queued) || result.jobs.length,
        duplicates: Number(result.duplicates) || 0
      };
    }
    const duplicates = rows.filter((d) => !!(d && d.duplicate)).length;
    const queued = Math.max(0, rows.length - duplicates);
    return { total: rows.length, queued, duplicates };
  }

  async function expandRedditBatchUrlsViaApi(seedUrl) {
    const data = await requestRedditIndex(seedUrl);
    if (!data || !data.success) {
      throw new Error((data && data.error) ? data.error : 'reddit index fout');
    }
    const urls = Array.isArray(data.urls) ? data.urls : [];
    return {
      urls,
      mode: data.mode || 'unknown',
      scannedPages: Number(data.scannedPages) || 0,
      scannedPosts: Number(data.scannedPosts) || 0,
      reachedEnd: !!data.reachedEnd
    };
  }

  async function runRedditAllBatchFromCurrentPage(triggerBtn) {
    if (!(await ensureServerReachable(true))) return;

    const meta = scrapeMetadata();
    if (meta.platform !== 'reddit' || !isRedditBatchSeedUrl(meta.url)) {
      showNotification('Gebruik deze knop op een Reddit post, subreddit of user pagina', true);
      return;
    }

    const original = triggerBtn ? triggerBtn.textContent : '🧵 Reddit all';
    if (triggerBtn) {
      triggerBtn.textContent = '⏳ Reddit...';
      triggerBtn.style.opacity = '0.6';
    }

    let urls = [];
    let redditIndexInfo = null;
    try {
      try {
        redditIndexInfo = await expandRedditBatchUrlsViaApi(meta.url);
        urls = redditIndexInfo.urls;
      } catch (e) {
        addLog(`Reddit index fout: ${e.message} — fallback naar server reddit-dl target`, 'error');
        urls = [meta.url];
        redditIndexInfo = { mode: 'fallback_target', scannedPages: 0, scannedPosts: 0, reachedEnd: false };
        showNotification('Reddit index geblokkeerd; fallback naar server reddit-dl target', true);
      }

      if (!urls.length) {
        showNotification('Geen Reddit media-posts gevonden via API index', true);
        return;
      }

      const hint = `\nMode: ${redditIndexInfo && redditIndexInfo.mode ? redditIndexInfo.mode : 'unknown'}, pagina's: ${redditIndexInfo && Number.isFinite(redditIndexInfo.scannedPages) ? redditIndexInfo.scannedPages : 0}, posts gescand: ${redditIndexInfo && Number.isFinite(redditIndexInfo.scannedPosts) ? redditIndexInfo.scannedPosts : 0}`;
      const ok = window.confirm(`Download all - Reddit: ${urls.length} items?${hint}`);
      if (!ok) return;

      const result = await queueBatchDownloadRequest(urls, meta);
      if (result.success) {
        const stats = summarizeBatchResult(result);
        showNotification(`Reddit all: ${stats.queued} nieuw, ${stats.duplicates} bestaand (${stats.total} totaal)`);
        addLog(`Reddit all gestart: nieuw=${stats.queued}, bestaand=${stats.duplicates}, totaal=${stats.total}`);
      } else {
        showNotification(`Reddit all fout: ${result.error}`, true);
        addLog(`Reddit all fout: ${result.error}`, 'error');
      }
    } catch (e) {
      showNotification(`Reddit all fout: ${e.message}`, true);
      addLog(`Reddit all fout: ${e.message}`, 'error');
    } finally {
      if (triggerBtn) {
        triggerBtn.textContent = original;
        triggerBtn.style.opacity = '1';
      }
    }
  }

  function collectYouTubeUrls(mode, maxItems = 600) {
    const out = [];
    const seen = new Set();

    const push = (u) => {
      if (!u) return;
      try {
        const parsed = new URL(u, window.location.href);
        parsed.hash = '';

        const host = String(parsed.host || '').toLowerCase();
        const isYt = host.endsWith('youtube.com') || host === 'youtu.be';
        if (!isYt) return;

        if (mode === 'shorts') {
          if (host === 'youtu.be') return;
          const m = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{6,})/);
          if (!m) return;
          const id = m[1];
          const canon = `https://www.youtube.com/shorts/${id}`;
          if (!seen.has(canon)) { seen.add(canon); out.push(canon); }
          return;
        }

        // videos
        if (host === 'youtu.be') {
          const id = parsed.pathname.replace(/^\//, '').split('/')[0];
          if (!id) return;
          const canon = `https://www.youtube.com/watch?v=${id}`;
          if (!seen.has(canon)) { seen.add(canon); out.push(canon); }
          return;
        }

        if (parsed.pathname !== '/watch') return;
        const v = parsed.searchParams.get('v');
        if (!v) return;
        const canon = `https://www.youtube.com/watch?v=${v}`;
        if (!seen.has(canon)) { seen.add(canon); out.push(canon); }
      } catch (e) {}
    };

    push(window.location.href);
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      try {
        const href = a.getAttribute('href');
        if (!href) continue;
        push(href);
        if (out.length >= maxItems) break;
      } catch (e) {}
    }

    return out;
  }

  async function runYouTubeBatch(mode) {
    if (!(await ensureServerReachable(true))) return;

    const meta = scrapeMetadata();
    if (meta.platform !== 'youtube') {
      showNotification('Dit werkt alleen op YouTube pagina\'s', true);
      return;
    }

    const urls = collectYouTubeUrls(mode, 600);
    if (!urls.length) {
      showNotification('Geen YouTube URLs gevonden (scroll eerst verder naar beneden)', true);
      return;
    }

    const label = (mode === 'shorts') ? 'Shorts' : 'Videos';
    const ok = window.confirm(`YouTube: Download all ${label}: ${urls.length} items?`);
    if (!ok) return;

    addLog(`YouTube ${label}: ${urls.length} items`);
    const btn = (mode === 'shorts') ? ytShortsBtn : ytVideosBtn;
    const original = btn.textContent;
    btn.textContent = '⏳ YT...';
    btn.style.opacity = '0.6';

    try {
      const result = await queueBatchDownloadRequest(urls, meta);
      if (result.success) {
        showNotification(`YouTube ${label}: gestart (${result.downloads.length})`);
        addLog(`YouTube ${label}: gestart (${result.downloads.length})`);
      } else {
        showNotification(`YouTube ${label} fout: ${result.error}`, true);
        addLog(`YouTube ${label} fout: ${result.error}`, 'error');
      }
    } catch (e) {
      showNotification(`YouTube ${label} fout: ${e.message}`, true);
      addLog(`YouTube ${label} fout: ${e.message}`, 'error');
    } finally {
      btn.textContent = original;
      btn.style.opacity = '1';
    }
  }

  function collectVisibleMediaUrls(maxItems = 60) {
    const out = [];
    const seen = new Set();

    const push = (u) => {
      if (!u) return;
      const raw = String(u).trim();
      if (!raw) return;
      if (/^(data:|blob:)/i.test(raw)) return;
      try {
        const parsed = new URL(raw, window.location.href);
        parsed.hash = '';
        const final = parsed.toString();
        if (!/^https?:/i.test(final)) return;
        if (!seen.has(final)) {
          seen.add(final);
          out.push(final);
        }
      } catch (e) {}
    };

    const inViewport = (r) => r && r.width > 30 && r.height > 30 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;

    for (const img of Array.from(document.querySelectorAll('img'))) {
      try {
        const r = img.getBoundingClientRect();
        if (!inViewport(r)) continue;
        if (r.width < 90 || r.height < 60) continue;
        push(img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src'));
        if (out.length >= maxItems) return out;
      } catch (e) {}
    }

    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      try {
        const r = a.getBoundingClientRect();
        if (!inViewport(r)) continue;
        const href = a.getAttribute('href');
        if (!href) continue;
        if (/\.(zip|rar|7z|jpg|jpeg|png|gif|webp|mp4|mov|m4v|webm|mkv|mp3|m4a|pdf)(\?|$)/i.test(href)) {
          push(href);
          if (out.length >= maxItems) return out;
        }
      } catch (e) {}
    }

    return out;
  }

  mediaDownloadBtn.addEventListener('click', async function() {
    if (!(await ensureServerReachable(true))) return;

    const meta = scrapeMetadata();
    const urls = collectVisibleMediaUrls(60);
    if (!urls.length) {
      showNotification('Geen zichtbare media/thumbnail URLs gevonden', true);
      return;
    }

    const ok = window.confirm(`Zichtbare media downloaden: ${urls.length} items?`);
    if (!ok) return;

    addLog(`Media download: ${urls.length} items`);
    mediaDownloadBtn.textContent = '⏳ Media...';
    mediaDownloadBtn.style.opacity = '0.6';

    try {
      const result = await queueBatchDownloadRequest(urls, meta);
      if (result.success) {
        const stats = summarizeBatchResult(result);
        const expandHint = (result.expanding && Number(result.expanding) > 0) ? ` | 🔄 ${result.expanding} pagina's uitbreiden...` : '';
        showNotification(`Media: ${stats.queued} nieuw, ${stats.duplicates} bestaand (${stats.total} totaal)${expandHint}`);
        addLog(`Media gestart: nieuw=${stats.queued}, bestaand=${stats.duplicates}, totaal=${stats.total}`);
      } else {
        showNotification(`Media fout: ${result.error}`, true);
        addLog(`Media fout: ${result.error}`, 'error');
      }
    } catch (e) {
      showNotification(`Media fout: ${e.message}`, true);
      addLog(`Media fout: ${e.message}`, 'error');
    } finally {
      mediaDownloadBtn.textContent = '🖼 Media';
      mediaDownloadBtn.style.opacity = '1';
    }
  });

  redditAllBtn.addEventListener('click', async function() {
    await runRedditAllBatchFromCurrentPage(redditAllBtn);
  });

  async function runBatchFromCurrentPage(triggerBtn, opts, clickEvent) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const force = options.force === true;

    if (!(await ensureServerReachable(true))) return;

    const meta = scrapeMetadata();
    let urls = [];
    let redditIndexInfo = null;

    let batchCandidates = null;

    if (meta.platform === 'reddit' && isRedditBatchSeedUrl(meta.url)) {
      try {
        redditIndexInfo = await expandRedditBatchUrlsViaApi(meta.url);
        urls = redditIndexInfo.urls;
      } catch (e) {
        addLog(`Reddit index fout: ${e.message} — fallback naar server reddit-dl target`, 'error');
        urls = [meta.url];
        redditIndexInfo = {
          mode: 'fallback_target',
          scannedPages: 0,
          scannedPosts: 0,
          reachedEnd: false
        };
        showNotification('Reddit index geblokkeerd; fallback: direct server reddit-dl target', true);
      }
    } else {
      const batch = collectBatchCandidates(meta);
      batchCandidates = batch.candidates;
      urls = batch.urls;
    }

    try {
      if (shouldDebugBatch(meta, clickEvent)) {
        debugLogBatchUrls('collected', urls, meta);
      }
    } catch (e2) {}

    if (!urls.length) {
      showNotification(meta.platform === 'reddit' ? 'Geen media-posts gevonden via Reddit API index' : 'Geen URLs gevonden voor batch', true);
      return;
    }

    const redditHint = (redditIndexInfo && meta.platform === 'reddit')
      ? `\nMode: ${redditIndexInfo.mode}, pagina's: ${redditIndexInfo.scannedPages}, posts gescand: ${redditIndexInfo.scannedPosts}`
      : '';
    let selectedDirectHints = null;
    if (isFootFetishForumThreadPage()) {
      let selected = null;
      try {
        const candidates = Array.isArray(batchCandidates) && batchCandidates.length
          ? batchCandidates
          : urls.map((u) => ({ url: u, el: null, kind: '' }));
        try { addLog(`Preview: ${candidates.length} items`); } catch (e) {}
        try { showNotification(`Preview: ${candidates.length} items`, false); } catch (e) {}
        try { console.log('[WEBDL][batch] preview.open', { force: !!force, items: candidates.length }); } catch (e) {}
        selected = await showBatchPreviewModal(candidates, meta, force);
      } catch (e) {
        selected = null;
      }

      if (selected && Array.isArray(selected.urls) && selected.urls.length) {
        urls = selected.urls;
        selectedDirectHints = selected.directHints && typeof selected.directHints === 'object' ? selected.directHints : null;
      } else if (Array.isArray(selected) && selected.length) {
        urls = selected;
      } else {
        try { addLog('Preview niet getoond; fallback confirm', 'error'); } catch (e) {}
        try { showNotification('Preview niet getoond; fallback confirm', true); } catch (e) {}
      }
    }
    // For pornpics/elitebabes listing pages: send just the page URL for server-side expansion
    const isPornpicsListing = meta.platform === 'pornpics' && /pornpics\.com/i.test(meta.url) && !/\/galleries\//i.test(meta.url) && !/cdni\.pornpics\.com/i.test(meta.url);
    const isElitebabesListing = meta.platform === 'elitebabes' && /elitebabes\.com/i.test(meta.url) && !/cdn\.elitebabes\.com/i.test(meta.url);
    const isZishyAlbum = meta.platform === 'zishy' && /zishy\.com/i.test(meta.url);
    const isGalleryExpansion = isPornpicsListing || isElitebabesListing;
    if (isGalleryExpansion) {
      // Override scraped URLs: send just the page URL for server-side crawl
      urls = [meta.url];
    }
    // Zishy: collect ALL full-res images + videos from browser DOM (logged-in session)
    if (isZishyAlbum) {
      const zishyUrls = [];
      // Full-res images: <a href="/uploads/full/...">
      document.querySelectorAll('a[href*="/uploads/full/"]').forEach(a => {
        const h = a.href || '';
        if (/\.(jpe?g|png|gif|webp)/i.test(h)) zishyUrls.push(h);
      });
      // Videos: <video src>, <source src>, Download MP4 links
      document.querySelectorAll('video[src], video source[src]').forEach(el => {
        const s = el.src || el.getAttribute('src') || '';
        if (s && /\.(mp4|webm|m4v)/i.test(s)) zishyUrls.push(s);
      });
      document.querySelectorAll('a[href]').forEach(a => {
        const h = a.href || '';
        if (/\.(mp4|webm|m4v)/i.test(h)) zishyUrls.push(h);
      });
      urls = [...new Set(zishyUrls)];
      try { addLog(`Zishy: ${urls.length} items uit DOM (${zishyUrls.filter(u => /\.(mp4|webm)/i.test(u)).length} video's)`); } catch(e) {}
    }
    const confirmLabel = (isGalleryExpansion || isZishyAlbum)
      ? `${urls.length} foto's en video's downloaden van deze pagina?`
      : null;
    const ok = confirmLabel
      ? window.confirm(confirmLabel)
      : confirmBatchStart({ count: urls.length, force, label: 'Batch download', redditHint });
    if (!ok) return;

    // Resolve upload.footfetishforum.com/image/ wrapper URLs in-browser
    // The browser has Cloudflare cookies, so fetch() works where the server can't
    const wrapperPattern = /^https?:\/\/upload\.footfetishforum\.com\/image\//i;
    const wrapperUrls = urls.filter(u => wrapperPattern.test(u));
    if (wrapperUrls.length > 0) {
      try { addLog(`Resolving ${wrapperUrls.length} Chevereto wrapper URLs...`); } catch (e) {}
      try { showNotification(`Resolving ${wrapperUrls.length} wrapper URLs...`, false); } catch (e) {}
      const resolveOne = async (wrapperUrl) => {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 12000);
          const resp = await fetch(wrapperUrl, { credentials: 'include', cache: 'no-store', signal: ctrl.signal });
          clearTimeout(t);
          if (!resp.ok) return wrapperUrl;
          const html = await resp.text();
          // Try og:image meta tag first
          const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
          if (ogMatch && ogMatch[1] && /upload\.footfetishforum\.com\/images\//i.test(ogMatch[1])) {
            return ogMatch[1];
          }
          // Try finding direct image link in HTML
          const imgMatch = html.match(/https?:\/\/upload\.footfetishforum\.com\/images\/[^\s"'<>]+\.(jpe?g|png|gif|webp)/i);
          if (imgMatch && imgMatch[0]) {
            return imgMatch[0];
          }
          return wrapperUrl;
        } catch (e) {
          return wrapperUrl;
        }
      };
      // Resolve in batches of 3 to avoid hammering
      const resolved = new Map();
      for (let i = 0; i < wrapperUrls.length; i += 3) {
        const batch = wrapperUrls.slice(i, i + 3);
        const results = await Promise.all(batch.map(u => resolveOne(u)));
        for (let j = 0; j < batch.length; j++) {
          resolved.set(batch[j], results[j]);
        }
        if (i + 3 < wrapperUrls.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
      let resolvedCount = 0;
      urls = urls.map(u => {
        if (resolved.has(u) && resolved.get(u) !== u) {
          resolvedCount++;
          return resolved.get(u);
        }
        return u;
      });
      try { addLog(`Resolved ${resolvedCount}/${wrapperUrls.length} wrapper URLs`); } catch (e) {}
    }

    const modeLabel = force ? 'Force' : 'Batch';
    addLog(`${modeLabel} batch download: ${urls.length} items`);
    const oldLabel = String((triggerBtn && triggerBtn.textContent) || '').trim();
    if (triggerBtn) {
      triggerBtn.textContent = `⏳ ${modeLabel}...`;
      triggerBtn.style.opacity = '0.6';
    }

    try {
      const result = await queueBatchDownloadRequest(urls, meta, { force, directHints: selectedDirectHints });
      if (result.success) {
        const stats = summarizeBatchResult(result);
        const estGal = Number(result.estimatedGalleries) || 0;
        const expandHint = (result.expanding && Number(result.expanding) > 0)
          ? estGal > 0
            ? ` | 🔄 ~${estGal} galleries worden op achtergrond gedownload`
            : ` | 🔄 Pagina's worden op achtergrond uitgebreid`
          : '';
        showNotification(`${modeLabel}: ${stats.queued} nieuw, ${stats.duplicates} bestaand (${stats.total} totaal)${expandHint}`);
        addLog(`${modeLabel} gestart: nieuw=${stats.queued}, bestaand=${stats.duplicates}, totaal=${stats.total}`);
      } else {
        showNotification(`Batch fout: ${result.error}`, true);
        addLog(`Batch fout: ${result.error}`, 'error');
      }
    } catch (e) {
      showNotification(`Batch fout: ${e.message}`, true);
      addLog(`Batch fout: ${e.message}`, 'error');
    } finally {
      if (triggerBtn) {
        triggerBtn.textContent = oldLabel;
        triggerBtn.style.opacity = '1';
      }
    }
  }

  batchDownloadBtn.addEventListener('click', async function(e) {
    await runBatchFromCurrentPage(batchDownloadBtn, { force: false }, e);
  });

  forceBatchDownloadBtn.addEventListener('click', async function(e) {
    await runBatchFromCurrentPage(forceBatchDownloadBtn, { force: true }, e);
  });

  async function runBatchFromWholeThread(triggerBtn, opts, clickEvent) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const force = options.force === true;

    if (!(await ensureServerReachable(true))) return;

    const isForumPage = isFootFetishForumForumPage();
    const isThreadPage = isFootFetishForumThreadPage();
    if (!isThreadPage && !isForumPage) {
      showNotification('Hele thread: alleen voor FootFetishForum thread/forum pagina\'s', true);
      return;
    }

    const meta = scrapeMetadata();
    const oldLabel = String((triggerBtn && triggerBtn.textContent) || '').trim();

    try {
      if (triggerBtn) {
        triggerBtn.textContent = force ? '⏳ Thread (force)...' : '⏳ Thread...';
        triggerBtn.style.opacity = '0.6';
      }

      let maxPages = 60;
      let maxItems = 5000;
      let maxForumPages = 5;
      try {
        maxPages = parseInt(localStorage.getItem(isForumPage ? 'WEBDL_FFF_FORUM_MAX_THREAD_PAGES' : 'WEBDL_FFF_THREAD_MAX_PAGES') || (isForumPage ? '30' : '60'), 10) || (isForumPage ? 30 : 60);
      } catch (e) {}
      try {
        maxForumPages = parseInt(localStorage.getItem('WEBDL_FFF_FORUM_MAX_PAGES') || '5', 10) || 5;
      } catch (e) {}
      try {
        maxItems = parseInt(localStorage.getItem('WEBDL_FFF_THREAD_MAX_ITEMS') || '5000', 10) || 5000;
      } catch (e) {}

      const wantsSettings = !!(clickEvent && (clickEvent.metaKey || clickEvent.ctrlKey));
      if (wantsSettings) {
        if (isForumPage) {
          try {
            const fIn = window.prompt('Forum: max forum-pagina\'s scannen? (1-100)', String(maxForumPages));
            if (fIn === null) return;
            const n = parseInt(String(fIn || '').trim(), 10);
            if (Number.isFinite(n) && n > 0) maxForumPages = n;
          } catch (e) {}
        }
        try {
          const pIn = window.prompt(isForumPage ? 'Forum: max pagina\'s per thread scannen? (1-250)' : 'Hele thread: max pagina\'s scannen? (1-250)', String(maxPages));
          if (pIn === null) return;
          const n = parseInt(String(pIn || '').trim(), 10);
          if (Number.isFinite(n) && n > 0) maxPages = n;
        } catch (e) {}
        try {
          const iIn = window.prompt('Hele thread: max items (URLs) verzamelen? (1-8000)', String(maxItems));
          if (iIn === null) return;
          const n = parseInt(String(iIn || '').trim(), 10);
          if (Number.isFinite(n) && n > 0) maxItems = n;
        } catch (e) {}
      }

      try { if (isForumPage) localStorage.setItem('WEBDL_FFF_FORUM_MAX_PAGES', String(maxForumPages)); } catch (e) {}
      try { localStorage.setItem(isForumPage ? 'WEBDL_FFF_FORUM_MAX_THREAD_PAGES' : 'WEBDL_FFF_THREAD_MAX_PAGES', String(maxPages)); } catch (e) {}
      try { localStorage.setItem('WEBDL_FFF_THREAD_MAX_ITEMS', String(maxItems)); } catch (e) {}

      try {
        const hint = wantsSettings ? '' : ' (Cmd/Ctrl-klik om limieten te wijzigen)';
        showNotification(`${isForumPage ? `Forum scannen: max ${maxForumPages} forum-pagina's, ` : 'Thread scannen: '}max ${maxPages} pagina's/thread, max ${maxItems} items${hint}`, false);
      } catch (e) {}

      const startUrl = String(window.location.href || '').replace(/#.*$/, '');
      const res = isForumPage
        ? await fetchFootFetishForumForumCandidates(startUrl, { maxForumPages, maxThreadPages: maxPages, maxItems })
        : await fetchFootFetishForumThreadCandidates(startUrl, { maxPages, maxItems });
      const candidates = uniqueCandidates(res && res.candidates ? res.candidates : []);

      try {
        if (shouldDebugBatch(meta, clickEvent)) {
          debugLogBatchUrls('thread.collected', candidates.map((c) => c.url), meta);
        }
      } catch (e2) {}

      if (!candidates.length) {
        showNotification(`${isForumPage ? 'Forum' : 'Hele thread'}: geen URLs gevonden`, true);
        return;
      }

      try {
        const extra = isForumPage ? ` | forum=${res && res.forumPages ? res.forumPages : '?'} | threads=${res && res.threads ? res.threads : '?'}` : '';
        addLog(`${isForumPage ? 'Forum' : 'Thread'} pages: ${res && Number.isFinite(Number(res.pages)) ? res.pages : '?'}${extra} | items: ${candidates.length}`);
      } catch (e) {}
      try { showNotification(`${isForumPage ? 'Forum' : 'Thread'}: ${candidates.length} items (${res && Number.isFinite(Number(res.pages)) ? res.pages : '?'} threadpagina's)`, false); } catch (e) {}

      let selected = null;
      let selectedDirectHints = null;
      try {
        selected = await showBatchPreviewModal(candidates, meta, force);
      } catch (e) {
        selected = null;
      }

      let urls = candidates.map((c) => c.url);
      if (selected && Array.isArray(selected.urls) && selected.urls.length) {
        urls = selected.urls;
        selectedDirectHints = selected.directHints && typeof selected.directHints === 'object' ? selected.directHints : null;
      } else if (Array.isArray(selected) && selected.length) urls = selected;
      else {
      }

      const ok = confirmBatchStart({ count: urls.length, force, label: isForumPage ? 'Forum download' : 'Hele thread download' });
      if (!ok) return;

      addLog(force ? `Force ${isForumPage ? 'forum' : 'thread'} batch: ${urls.length} items` : `${isForumPage ? 'Forum' : 'Thread'} batch: ${urls.length} items`);
      const result = await queueBatchDownloadRequest(urls, meta, { force, directHints: selectedDirectHints });
      if (result && result.success) {
        const stats = summarizeBatchResult(result);
        const label = force ? `Force ${isForumPage ? 'forum' : 'thread'}` : (isForumPage ? 'Forum' : 'Thread');
        showNotification(`${label}: ${stats.queued} nieuw, ${stats.duplicates} bestaand (${stats.total} totaal)`);
        addLog(`${label} gestart: nieuw=${stats.queued}, bestaand=${stats.duplicates}, totaal=${stats.total}`);
      } else {
        showNotification(`Thread batch fout: ${(result && result.error) ? result.error : 'unknown'}`, true);
        addLog(`Thread batch fout: ${(result && result.error) ? result.error : 'unknown'}`, 'error');
      }
    } catch (e) {
      showNotification(`Thread batch fout: ${e && e.message ? e.message : String(e)}`, true);
      addLog(`Thread batch fout: ${e && e.message ? e.message : String(e)}`, 'error');
    } finally {
      if (triggerBtn) {
        triggerBtn.textContent = oldLabel || '🧵 Hele thread';
        triggerBtn.style.opacity = '1';
      }
    }
  }

  threadBatchDownloadBtn.addEventListener('click', async function(e) {
    const force = !!(e && (e.shiftKey || e.altKey));
    await runBatchFromWholeThread(threadBatchDownloadBtn, { force }, e);
  });

  async function pollDownload(id) {
    const progressBar = document.createElement('div');
    Object.assign(progressBar.style, {
      height: '4px', backgroundColor: '#333', borderRadius: '2px',
      marginBottom: '4px', overflow: 'hidden'
    });
    const fill = document.createElement('div');
    Object.assign(fill.style, {
      height: '100%', backgroundColor: '#00d4ff', width: '0%',
      transition: 'width 0.5s', borderRadius: '2px'
    });
    progressBar.appendChild(fill);
    notifArea.appendChild(progressBar);

    const label = document.createElement('div');
    Object.assign(label.style, { fontSize: '10px', color: '#888', marginBottom: '4px' });
    label.textContent = `#${id}: 0%`;
    notifArea.appendChild(label);

    const interval = setInterval(async () => {
      try {
        const resp = await fetch(`${SERVER}/download/${id}`);
        const data = await resp.json();
        if (data.success) {
          const dl = data.download;
          const statusLabel = dl.status === 'queued' ? 'wachtrij' : (dl.status === 'postprocessing' ? 'afwerken' : dl.status);

          if (dl.status === 'queued') {
            fill.style.backgroundColor = '#aaa';
            fill.style.width = '100%';
            fill.style.opacity = '0.35';
            label.textContent = `#${id}: ${statusLabel}`;
          } else if (dl.platform === 'onlyfans' && dl.status === 'downloading' && Number(dl.progress || 0) <= 0) {
            fill.style.backgroundColor = '#aaa';
            fill.style.width = '100%';
            fill.style.opacity = '0.35';
            label.textContent = `#${id}: bezig (inventariseren...)`;
          } else {
            fill.style.opacity = '1';
            fill.style.backgroundColor = '#00d4ff';
            fill.style.width = dl.progress + '%';
            label.textContent = `#${id}: ${statusLabel} ${dl.progress}%`;
          }

          if (dl.status === 'postprocessing') {
            fill.style.backgroundColor = '#c084fc';
            fill.style.width = '100%';
          }

          if (dl.status === 'completed') {
            clearInterval(interval);
            fill.style.backgroundColor = '#4CAF50';
            fill.style.width = '100%';
            label.textContent = `#${id}: Voltooid!`;
            let countHint = '';
            try {
              const metaObj = (dl && dl.metadata) ? JSON.parse(String(dl.metadata)) : null;
              const n = Number(metaObj && metaObj.media_count);
              if (Number.isFinite(n) && n > 0) countHint = ` (${n} bestanden)`;
            } catch (e) {}
            if (!countHint) {
              const fm = String(dl && dl.filename ? dl.filename : '').match(/\(multiple:\s*(\d+)\s+files\)/i);
              if (fm && fm[1]) countHint = ` (${fm[1]} bestanden)`;
            }
            showNotification(`Download voltooid: ${dl.title}${countHint}`);
            setTimeout(() => { progressBar.remove(); label.remove(); }, 5000);
          } else if (dl.status === 'cancelled') {
            clearInterval(interval);
            fill.style.backgroundColor = '#999';
            fill.style.width = '100%';
            label.textContent = `#${id}: Gestopt`;
            setTimeout(() => { progressBar.remove(); label.remove(); }, 5000);
          } else if (dl.status === 'error') {
            clearInterval(interval);
            fill.style.backgroundColor = '#F44336';
            label.textContent = `#${id}: Fout - ${dl.error}`;
            showNotification(`Download mislukt: ${dl.error}`, true);
            setTimeout(() => { progressBar.remove(); label.remove(); }, 8000);
          }
        }
      } catch (e) { /* server niet bereikbaar, probeer opnieuw */ }
    }, 2000);
  }

  // ========================
  // SCREEN RECORDING (server ffmpeg - OBS-stijl)
  // ========================
  let isRecording = false;
  let cropUpdateTimer = null;
  let frameUpdateTimer = null;

  function updateRecUI(recording, activeUrls) {
    // Per-tab check: is THIS tab's URL in the activeRecordingUrls array?
    const myUrl = window.location.href;
    const myRecording = Array.isArray(activeUrls) && activeUrls.length
      ? activeUrls.some(u => myUrl.startsWith(u) || u.startsWith(myUrl.split('?')[0]))
      : !!recording;
    isRecording = myRecording;
    if (!myRecording && cropUpdateTimer) {
      clearInterval(cropUpdateTimer);
      cropUpdateTimer = null;
    }
    if (myRecording) {
      captureFrame.style.display = 'none';
    }
    if (myRecording) {
      recStartBtn.textContent = '\u23fa REC...';
      recStartBtn.style.opacity = '0.5'; recStartBtn.style.cursor = 'not-allowed';
      recStopBtn.style.opacity = '1'; recStopBtn.style.cursor = 'pointer';
      recStopBtn.style.backgroundColor = '#e74c3c';
    } else {
      recStartBtn.textContent = '\u23fa REC Start';
      recStartBtn.style.opacity = '1'; recStartBtn.style.cursor = 'pointer';
      recStopBtn.style.opacity = '0.5'; recStopBtn.style.cursor = 'not-allowed';
      recStopBtn.style.backgroundColor = '#555';
    }
  }

  function getVideoCropRect() {
    const target = pickBestVideoTarget();
    if (!target || !target.rect) return { error: 'Geen video gevonden op pagina' };

    const rect = target.rect;
    if (!rect.width || !rect.height) return { error: 'Video heeft geen zichtbare afmeting' };

    const scale = window.devicePixelRatio || 1;

    const borderX = (window.outerWidth - window.innerWidth) / 2;
    const borderY = window.outerHeight - window.innerHeight;
    const screenX = typeof window.screenX === 'number' ? window.screenX : (window.screenLeft || 0);
    const screenY = typeof window.screenY === 'number' ? window.screenY : (window.screenTop || 0);

    const innerScreenX = (typeof window.mozInnerScreenX === 'number')
      ? window.mozInnerScreenX
      : (screenX + borderX);

    const innerScreenY = (typeof window.mozInnerScreenY === 'number')
      ? window.mozInnerScreenY
      : (screenY + borderY);

    let x = Math.round((innerScreenX + rect.left) * scale);
    let y = Math.round((innerScreenY + rect.top) * scale);
    let width = Math.round(rect.width * scale);
    let height = Math.round(rect.height * scale);

    width = Math.max(2, width - (width % 2));
    height = Math.max(2, height - (height % 2));
    x = Math.max(0, x - (x % 2));
    y = Math.max(0, y - (y % 2));

    return { x, y, width, height, scale };
  }

  function updateCaptureFrame() {
    if (isRecording) {
      captureFrame.style.display = 'none';
      return;
    }

    const target = pickBestVideoTarget();
    if (!target || !target.rect) {
      captureFrame.style.display = 'none';
      return;
    }

    const rect = target.rect;
    if (!rect.width || !rect.height) {
      captureFrame.style.display = 'none';
      return;
    }

    captureFrame.style.display = 'block';
    captureFrame.style.left = `${Math.round(rect.left)}px`;
    captureFrame.style.top = `${Math.round(rect.top)}px`;
    captureFrame.style.width = `${Math.round(rect.width)}px`;
    captureFrame.style.height = `${Math.round(rect.height)}px`;
  }

  function ensureFrameUpdatesRunning() {
    if (frameUpdateTimer) return;
    frameUpdateTimer = setInterval(updateCaptureFrame, 200);
    updateCaptureFrame();
  }

  async function sendCropUpdate(crop) {
    try {
      await fetch(`${SERVER}/recording/crop-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crop })
      });
    } catch (e) {
      // ignore
    }
  }

  recStartBtn.addEventListener('click', async () => {
    if (isRecording) return;
    const meta = scrapeMetadata();
    const crop = getVideoCropRect();
    if (crop.error) {
      showNotification(crop.error, true);
      addLog(crop.error, 'error');
      return;
    }

    addLog(`Opname starten (crop ${crop.width}x${crop.height} @ ${crop.x},${crop.y})`);
    try {
      const result = await startRecordingRequest({ metadata: meta, crop, lock: true });
      if (result.success) {
        applyConnectionState(true);
        updateRecUI(true);
        showNotification(`Opname gestart: ${result.file}`);
        addLog(`REC gestart: ${result.file}`);

        if (!cropUpdateTimer) {
          cropUpdateTimer = setInterval(() => {
            if (!isRecording) return;
            const next = getVideoCropRect();
            if (next && !next.error) sendCropUpdate(next);
          }, 250);
        }
      } else if (result && result.needsToggle) {
        addLog('START geklikt op tabblad met actieve opname. Dit tabblad was al aan het opnemen, de opname wordt nu netjes afgesloten...');
        const toggleResult = await stopRecordingRequest({});
        if (toggleResult.success) {
          applyConnectionState(true);
          updateRecUI(false);
          showNotification('Opname succesvol afgesloten.');
          addLog('Opname afgesloten (toggle)');
        } else {
          showNotification(`Fout bij afsluiten opname: ${toggleResult.error}`, true);
        }
      } else if (result && result.needsForce) {
        if (confirm("Er loopt al een opname op de achtergrond. Wil je deze geforceerd beëindigen en een nieuwe starten?")) {
          const forceResult = await startRecordingRequest({ metadata: meta, crop, lock: true, force: true });
          if (forceResult.success) {
            applyConnectionState(true);
            updateRecUI(true);
            showNotification(`Opname geforceerd herstart: ${forceResult.file}`);
            addLog(`REC geforceerd herstart: ${forceResult.file}`);
            if (!cropUpdateTimer) {
              cropUpdateTimer = setInterval(() => {
                if (!isRecording) return;
                const next = getVideoCropRect();
                if (next && !next.error) sendCropUpdate(next);
              }, 250);
            }
          } else {
            showNotification(forceResult.error, true);
          }
        }
      } else {
        if (result && result.error) addLog(`REC start geweigerd: ${result.error}`, 'error');
        showNotification(result.error, true);
      }
    } catch (e) {
      showNotification(`REC fout: ${e.message}`, true);
      addLog(`REC fout: ${e.message}`, 'error');
    }
  });

  recStopBtn.addEventListener('click', async () => {
    if (!isRecording) return;
    addLog('Opname stoppen...');
    const meta = scrapeMetadata();
    try {
      const result = await stopRecordingRequest({ metadata: meta });
      if (result.success) {
        applyConnectionState(true);
        updateRecUI(false);
        ensureFrameUpdatesRunning();
        if (result.processing) {
          const rawName = result.rawFile ? String(result.rawFile).split('/').pop() : (result.file ? String(result.file).split('/').pop() : '');
          const finalName = result.finalFile ? String(result.finalFile).split('/').pop() : '';
          showNotification(`Opname gestopt. Afwerken bezig... (raw: ${rawName}${finalName ? `, final: ${finalName}` : ''})`);
          addLog(`REC gestopt (afwerken bezig). raw=${result.rawFile || result.file} final=${result.finalFile || ''}`);
        } else {
          showNotification(`Opname opgeslagen: ${result.file}`);
          addLog(`REC gestopt: ${result.file}`);
        }
      } else {
        if (result && result.error) addLog(`REC stop geweigerd: ${result.error}`, 'error');
        showNotification(result.error, true);
      }
    } catch (e) {
      showNotification(`Stop fout: ${e.message}`, true);
      addLog(`Stop fout: ${e.message}`, 'error');
    }
  });

  // ========================
  // DASHBOARD OPENEN
  // ========================
  dashboardBtn.addEventListener('click', () => {
    window.open(`${SERVER}/dashboard`, '_blank');
  });

  // ========================
  // INIT
  // ========================
  updateMetaDisplay();
  setInterval(updateMetaDisplay, 5000);
  addLog('WEBDL toolbar geladen');
  ensureFrameUpdatesRunning();

  // Communicatie met background script
  browser.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'getPageMetadata') {
      try {
        return Promise.resolve(scrapeMetadata());
      } catch (e) {
        return Promise.resolve({ url: window.location.href, platform: 'unknown', channel: 'unknown', title: document.title, description: '' });
      }
    }

    if (message && message.action === 'webdlDownloadQueued') {
      if (message.success && message.duplicate) {
        showNotification(`Download geskipt: bestand bestaat al (#${message.downloadId})`, true);
        if (confirm(`${message.serverMessage || 'Dit bestand is al gedownload.'}\n\nWil je dit bestand geforceerd opnieuw downloaden?`)) {
          showNotification('Geforceerde download in wachtrij gezet...');
          addLog(`Geforceerde rechtsklik download: ${message.url}`);
          const meta = scrapeMetadata();
          meta.url = message.url;
          browser.runtime.sendMessage({ action: 'queueDownload', payload: { url: message.url, force: true, metadata: meta } });
        }
      } else if (message.success && message.downloadId) {
        showNotification(`Download #${message.downloadId} in wachtrij`);
        try { addLog(`Rechtsklik download gestart #${message.downloadId}`); } catch (e) {}
        pollDownload(message.downloadId);
      } else {
        showNotification(`Download fout: ${message.error || 'onbekend'}`, true);
        try { addLog(`Rechtsklik download fout: ${message.error || 'onbekend'}`, 'error'); } catch (e) {}
      }
      return true;
    }

    if (message && message.action === 'takeScreenshotNow') {
      return runScreenshotFlow();
    }

    if (message.action === "connectionStateChanged") {
      applyConnectionState(!!message.isConnected);
      if (message.isConnected) checkServer();
    }
    if (message.action === 'recordingStateChanged') {
      updateRecUI(!!message.isRecording, message.activeRecordingUrls);
    }
    return true;
  });

  browser.runtime.sendMessage({ action: "contentScriptLoaded" })
    .then((status) => {
      if (status && typeof status.isConnected === 'boolean') {
        applyConnectionState(!!status.isConnected);
      }
      if (status && typeof status.isRecording !== 'undefined') {
        updateRecUI(!!status.isRecording, status.activeRecordingUrls);
      }
      if (status && Number.isFinite(Number(status.activeDownloads))) {
        document.getElementById('webdl-dl-count').textContent = `${Number(status.activeDownloads) || 0} actief`;
      }
    })
    .catch(() => {});
})();
