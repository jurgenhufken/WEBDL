// WEBDL Toolbar - Video downloader & screenshot tool
(function() {
  try {
    const host = String((window && window.location && window.location.hostname) || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return;
  } catch (e) {}

  const WEBDL_BUILD = 'debug-toolbar-2026-05-13-fff-archive-scan';
  console.log("WEBDL toolbar script geladen!", WEBDL_BUILD);
  const SERVER = 'http://localhost:35729';
  const SERVER_FALLBACK = 'http://127.0.0.1:35729';
  const HUB = 'http://localhost:35730';
  const HUB_FALLBACK = 'http://127.0.0.1:35730';
  const REQUEST_TIMEOUT_MS = 15000;
  const WEBDL_UNLIMITED = Number.POSITIVE_INFINITY;

  function parseScanLimit(value, fallback = WEBDL_UNLIMITED) {
    const raw = String(value == null ? '' : value).trim().toLowerCase();
    if (!raw || raw === '0' || raw === 'all' || raw === 'alles' || raw === 'unlimited' || raw === 'onbeperkt') return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function formatScanLimit(value) {
    return Number.isFinite(Number(value)) ? String(Number(value)) : 'alles';
  }

  function normalizeTranslatedProxyUrl(rawUrl) {
    try {
      const u = new URL(String(rawUrl || '').trim(), window.location.href);
      const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
      if (host !== 'translated.turbopages.org') return u.toString();
      const parts = String(u.pathname || '').split('/').filter(Boolean);
      const schemeIndex = parts.findIndex((p) => p === 'http' || p === 'https');
      if (schemeIndex < 0 || !parts[schemeIndex + 1]) return u.toString();
      const scheme = parts[schemeIndex];
      const targetHost = parts[schemeIndex + 1];
      const targetPath = '/' + parts.slice(schemeIndex + 2).join('/');
      return `${scheme}://${targetHost}${targetPath}${u.search}${u.hash}`;
    } catch (e) {
      return String(rawUrl || '').trim();
    }
  }

  function effectivePageUrl() {
    return normalizeTranslatedProxyUrl(window.location.href);
  }

  function isTranslatedProxyPage(rawUrl) {
    try {
      const u = new URL(String(rawUrl || window.location.href), window.location.href);
      const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
      return host === 'translated.turbopages.org';
    } catch (e) {
      return false;
    }
  }

  function normalizedUrlObject(rawUrl, baseHref) {
    const base = baseHref ? normalizeTranslatedProxyUrl(baseHref) : effectivePageUrl();
    const abs = new URL(String(rawUrl || ''), base || window.location.href);
    return new URL(normalizeTranslatedProxyUrl(abs.toString()), window.location.href);
  }

  function isFootFetishClubThreadUrl(rawUrl) {
    try {
      const u = new URL(normalizeTranslatedProxyUrl(rawUrl), window.location.href);
      const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
      return host === 'foot-fetish.club' && /^\/threads\/[^/]+/i.test(String(u.pathname || ''));
    } catch (e) {
      return false;
    }
  }

  function isFootFetishClubThreadPage() {
    return isFootFetishClubThreadUrl(effectivePageUrl());
  }

  function promptRedditBdfrLimit(defaultLimit = 100) {
    try {
      const input = window.prompt('Reddit BDFR: max posts downloaden? Leeg = 100, 0 = onbeperkt', String(defaultLimit));
      if (input === null) return null;
      const raw = String(input || '').trim().toLowerCase();
      if (!raw) return defaultLimit;
      if (raw === '0' || raw === 'all' || raw === 'alles' || raw === 'unlimited' || raw === 'onbeperkt') return 0;
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return Math.min(5000, n);
    } catch (e) {}
    return defaultLimit;
  }

  function redditBdfrLimitForClick(clickEvent, defaultLimit = 0) {
    const wantsPrompt = !!(clickEvent && (clickEvent.metaKey || clickEvent.ctrlKey || clickEvent.altKey || clickEvent.shiftKey));
    if (!wantsPrompt) return defaultLimit;
    return promptRedditBdfrLimit(defaultLimit);
  }

  function redditCanonicalUrl(raw) {
    try {
      const u = new URL(String(raw || ''), window.location.href);
      const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
      const p = String(u.pathname || '');
      if (host === 'redd.it' || host.endsWith('.redd.it')) {
        const id = p.replace(/^\/+/, '').split('/')[0];
        return id ? `https://redd.it/${encodeURIComponent(id)}` : u.toString();
      }
      if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
        const post = p.match(/^\/r\/([^\/?#]+)\/comments\/([a-z0-9]+)/i);
        if (post && post[1] && post[2]) return `https://www.reddit.com/r/${encodeURIComponent(decodeURIComponent(post[1]))}/comments/${post[2]}/`;
        const userPost = p.match(/^\/(?:user|u)\/([^\/?#]+)\/comments\/([a-z0-9]+)/i);
        if (userPost && userPost[1] && userPost[2]) return `https://www.reddit.com/user/${encodeURIComponent(decodeURIComponent(userPost[1]))}/comments/${userPost[2]}/`;
        const sub = p.match(/^\/r\/([^\/?#]+)/i);
        if (sub && sub[1]) return `https://www.reddit.com/r/${encodeURIComponent(decodeURIComponent(sub[1]))}/`;
        const user = p.match(/^\/(?:user|u)\/([^\/?#]+)/i);
        if (user && user[1]) return `https://www.reddit.com/user/${encodeURIComponent(decodeURIComponent(user[1]))}/`;
      }
      u.hash = '';
      return u.toString();
    } catch (e) {
      return String(raw || '').trim();
    }
  }

  function redditPartsFromUrl(raw) {
    try {
      const u = new URL(String(raw || ''), window.location.href);
      const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
      const p = String(u.pathname || '');
      const out = { postUrl: '', subreddit: '', user: '' };
      if (host === 'redd.it' || host.endsWith('.redd.it')) {
        const id = p.replace(/^\/+/, '').split('/')[0];
        if (id) out.postUrl = `https://redd.it/${encodeURIComponent(id)}`;
        return out;
      }
      if (!(host === 'reddit.com' || host.endsWith('.reddit.com'))) return out;
      const post = p.match(/^\/r\/([^\/?#]+)\/comments\/([a-z0-9]+)/i);
      if (post && post[1] && post[2]) {
        out.subreddit = decodeURIComponent(post[1]);
        out.postUrl = `https://www.reddit.com/r/${encodeURIComponent(out.subreddit)}/comments/${post[2]}/`;
      }
      const userPost = p.match(/^\/(?:user|u)\/([^\/?#]+)\/comments\/([a-z0-9]+)/i);
      if (userPost && userPost[1] && userPost[2]) {
        out.user = decodeURIComponent(userPost[1]);
        out.postUrl = `https://www.reddit.com/user/${encodeURIComponent(out.user)}/comments/${userPost[2]}/`;
      }
      const sub = p.match(/^\/r\/([^\/?#]+)/i);
      if (sub && sub[1]) out.subreddit = decodeURIComponent(sub[1]);
      const user = p.match(/^\/(?:user|u)\/([^\/?#]+)/i);
      if (user && user[1]) out.user = decodeURIComponent(user[1]);
      return out;
    } catch (e) {
      return { postUrl: '', subreddit: '', user: '' };
    }
  }

  function redditAuthorFromPage() {
    const selectors = [
      'shreddit-post[author]',
      '[data-testid="post_author_link"]',
      'a[data-click-id="user"]',
      'a[href^="/user/"]',
      'a[href^="/u/"]',
      'a[href*="reddit.com/user/"]',
      'a[href*="reddit.com/u/"]'
    ];
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (!el) continue;
        const attr = (el.getAttribute && (el.getAttribute('author') || el.getAttribute('data-author'))) || '';
        const href = (el.getAttribute && el.getAttribute('href')) || '';
        const text = String(attr || el.textContent || '').trim().replace(/^u\//i, '').replace(/^\/?user\//i, '').replace(/^@/, '');
        const fromHref = String(href || '').match(/\/(?:user|u)\/([^\/?#]+)/i);
        const value = fromHref && fromHref[1] ? decodeURIComponent(fromHref[1]) : text;
        if (value && /^[A-Za-z0-9_-]{2,32}$/.test(value) && !/^(deleted|automoderator)$/i.test(value)) return value;
      } catch (e) {}
    }
    return '';
  }

  function redditTargetOptions(meta) {
    const parts = redditPartsFromUrl((meta && meta.url) || window.location.href);
    const channel = String(meta && meta.channel || '');
    if (!parts.subreddit && /^r_/i.test(channel)) parts.subreddit = channel.replace(/^r_/i, '');
    if (!parts.user && /^u_/i.test(channel)) parts.user = channel.replace(/^u_/i, '');
    if (!parts.user) parts.user = redditAuthorFromPage();

    const opts = [];
    if (parts.postUrl) {
      opts.push({ key: '1', mode: 'post', label: 'alleen deze post', url: redditCanonicalUrl(parts.postUrl), limitable: false });
    }
    if (parts.user) {
      opts.push({ key: '2', mode: 'user', label: `alles van gebruiker u/${parts.user}`, url: `https://www.reddit.com/user/${encodeURIComponent(parts.user)}/`, limitable: true });
    }
    if (parts.subreddit) {
      opts.push({ key: '3', mode: 'subreddit', label: `alles van kanaal r/${parts.subreddit}`, url: `https://www.reddit.com/r/${encodeURIComponent(parts.subreddit)}/`, limitable: true });
    }
    return opts;
  }

  function chooseRedditTarget(meta) {
    const options = redditTargetOptions(meta);
    if (!options.length) return null;
    const lines = options.map((opt, idx) => `${idx + 1}. ${opt.label}`);
    const input = window.prompt(`Reddit downloaden via BDFR:\n${lines.join('\n')}\n\nKies nummer:`, '1');
    if (input === null) return null;
    const raw = String(input || '').trim().toLowerCase();
    const picked = options.find((opt, idx) => raw === opt.key || raw === String(idx + 1) || raw === opt.mode);
    if (!picked) {
      showNotification('Reddit keuze geannuleerd: onbekende optie', true);
      return null;
    }
    const out = { ...picked };
    if (picked.limitable) {
      const limit = promptRedditBdfrLimit(0);
      if (limit === null) return null;
      out.limit = limit;
    }
    return out;
  }

  function redditTargetForMode(meta, mode) {
    const wanted = String(mode || '').trim().toLowerCase();
    if (!wanted) return null;
    return redditTargetOptions(meta).find((opt) => opt.mode === wanted) || null;
  }

  function xTwitterPartsFromUrl(raw) {
    try {
      const u = new URL(String(raw || ''), window.location.href);
      if (!isTwitterHost(u.hostname)) return { postUrl: '', profileUrl: '', user: '' };
      const segments = String(u.pathname || '').split('/').filter(Boolean);
      const first = String(segments[0] || '').replace(/^@/, '');
      if (first.toLowerCase() === 'i' && String(segments[1] || '').toLowerCase() === 'web' && String(segments[2] || '').toLowerCase() === 'status' && /^\d+$/.test(String(segments[3] || ''))) {
        return { postUrl: `https://x.com/i/web/status/${segments[3]}`, profileUrl: '', user: '' };
      }
      const blocked = new Set(['home', 'explore', 'search', 'hashtag', 'i', 'intent', 'settings', 'notifications', 'messages', 'login', 'signup']);
      if (!first || blocked.has(first.toLowerCase())) return { postUrl: '', profileUrl: '', user: '' };
      const isUser = /^[A-Za-z0-9_]{1,15}$/.test(first);
      const out = { postUrl: '', profileUrl: '', user: isUser ? first : '' };
      if (isUser) out.profileUrl = `https://x.com/${encodeURIComponent(first)}`;
      if (isUser && String(segments[1] || '').toLowerCase() === 'status' && /^\d+$/.test(String(segments[2] || ''))) {
        out.postUrl = `https://x.com/${encodeURIComponent(first)}/status/${segments[2]}`;
      }
      return out;
    } catch (e) {
      return { postUrl: '', profileUrl: '', user: '' };
    }
  }

  function xTwitterTargetOptions(meta) {
    const parts = xTwitterPartsFromUrl((meta && meta.url) || window.location.href);
    const opts = [];
    if (parts.postUrl) {
      opts.push({ mode: 'post', label: 'deze X-post', url: parts.postUrl });
    }
    if (parts.profileUrl) {
      opts.push({ mode: 'profile', label: `X-profiel @${parts.user}`, url: parts.profileUrl, user: parts.user });
    }
    return opts;
  }

  function xTwitterTargetForMode(meta, mode) {
    const wanted = String(mode || '').trim().toLowerCase();
    if (!wanted) return null;
    return xTwitterTargetOptions(meta).find((opt) => opt.mode === wanted) || null;
  }

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
      if (isFootFetishClubThreadPage()) return true;
    } catch (e) {}
    try {
      if (isVipergirlsThreadPage() || isVipergirlsForumPage()) return true;
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
      const u = normalizedUrlObject(rawUrl, baseHref);
      const host = String(u.hostname || '').toLowerCase();
      if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return false;
      return /\/(attachments?|attach)\//i.test(String(u.pathname || ''));
    } catch (e) {}
    return false;
  }

  function isFootFetishForumDirectAttachmentMediaUrl(rawUrl, baseHref) {
    try {
      const u = normalizedUrlObject(rawUrl, baseHref);
      const host = String(u.hostname || '').toLowerCase();
      const p = String(u.pathname || '').toLowerCase();
      if (host === 'flc.nyc3.digitaloceanspaces.com') return /\/data\/(?:attachments|video)\//i.test(p);
      if (host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com')) return /\/data\/(?:attachments|video)\//i.test(p);
      return false;
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

  function isFootFetishForumMediaCandidateUrl(rawUrl, baseHref, contextText) {
    try {
      const s = String(rawUrl || '').trim();
      if (!s || /^(data:|blob:|javascript:|mailto:)/i.test(s)) return false;
      const u = normalizedUrlObject(s, baseHref);
      const host = String(u.hostname || '').toLowerCase();
      const p = String(u.pathname || '').toLowerCase();
      const text = String(contextText || '').toLowerCase();
      if (!/^https?:$/i.test(String(u.protocol || ''))) return false;
      if (p.includes('/data/avatars/') || /\b(avatar|emoji|emote|smilie|reaction|logo|icon)\b/i.test(p)) return false;
      if (/apple-touch-icon|favicon|site-logo|logo\.\w+$|\/icons?\//i.test(p)) return false;
      if (host === 'cdn.jsdelivr.net' && p.includes('/joypixels/')) return false;
      if (host === 'secure.gravatar.com') return false;

      const isFffHost = host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com');
      const isUploadHost = host === 'upload.footfetishforum.com' || host.endsWith('.upload.footfetishforum.com');
      const isFffFilesHost = host === 'files.footfetishforum.com' || host.endsWith('.files.footfetishforum.com');
      const isDirectMediaFile = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv|mp3|m4a|zip|rar|7z)(?:$|[?#])/i.test(p);

      if (isUploadHost) return /^\/image\//i.test(p) || /\/images\//i.test(p) || isDirectMediaFile;
      if (host === 'flc.nyc3.digitaloceanspaces.com') return /\/data\/(?:attachments|video)\//i.test(p) || isDirectMediaFile;
      if (isFffFilesHost) return /^\/s\/[^\/]+/i.test(p);

      if (isFffHost) {
        if (p === '/attachments/upload') return false;
        if (p === '/proxy.php') {
          const img = u.searchParams ? (u.searchParams.get('image') || '') : '';
          return !!img && isFootFetishForumMediaCandidateUrl(img, baseHref, contextText);
        }
        return /^\/attachments\//i.test(p) || /\/data\/(?:attachments|video)\//i.test(p);
      }

      if (isDirectMediaFile) return true;
      if (isKnownExternalMediaWrapperHost(host)) return true;
      if (looksLikeExternalMediaPageUrl(u.toString(), text)) return true;
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

  function getHubCandidates() {
    const seen = new Set();
    const out = [];
    for (const base of [HUB, HUB_FALLBACK]) {
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

    const push = (raw, kind, el) => {
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
        if (!isFootFetishForumMediaCandidateUrl(final, baseHref, kind)) return;
        if (seen.has(final)) return;
        seen.add(final);
        out.push({ url: final, el: el || null, kind: kind || '' });
      } catch (e) {}
    };

    const contentRoots = Array.from(doc.querySelectorAll(
      'article, .message, .message-main, .message-body, .message-content, .message-userContent, .message-attachments, .bbWrapper, .post-body, .js-lbContainer, .lbContainer, [data-lb-container-zoom], [data-attachment-id]'
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
                    const imgSrc = img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
                    if (imgSrc) push(imgSrc, 'img_under_link', img);
                    push(href, 'thumb_link', parentLink);
                    hadParentLink = true;
                  }
                } catch (e) {
                  push(href, 'thumb_link', parentLink);
                  hadParentLink = true;
                }
              }
            }
          } catch (e) {}

          if (hadParentLink) continue;

          push(img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-url'), 'img', img);
          const srcset = String(img.getAttribute('srcset') || '').trim();
          if (srcset) {
            const parts = srcset.split(',').map(s => String(s || '').trim()).filter(Boolean);
            for (const part of parts) {
              const first = part.split(/\s+/)[0];
              if (first) push(first, 'img_srcset', img);
              if (out.length >= maxItems) return out;
            }
          }
        }
      } catch (e) {}

      try {
        for (const v of Array.from(root.querySelectorAll('video'))) {
          if (out.length >= maxItems) return out;
          push(v.currentSrc || v.src || v.getAttribute('src'), 'video', v);
          try {
            for (const s of Array.from(v.querySelectorAll('source'))) {
              push(s.src || s.getAttribute('src'), 'video_source', s);
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
            if (looksLikeExternalMedia && isTwitterHost(host) && !isDownloadableTwitterUrl(abs)) {
              looksLikeExternalMedia = false;
            }
            if (looksLikeFile || looksLikeAttachment || looksLikeExternalMedia) push(s, 'a', a);
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
              if (looksLikeFile || looksLikeExternalMedia || isFootFetishForumMediaCandidateUrl(s, baseHref, 'text')) {
                push(s, 'text', root);
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    return out;
  }

  function showFootFetishForumScanReport({ isForumPage, res, candidates }) {
    try {
      const existing = document.getElementById('webdl-fff-scan-report');
      if (existing) existing.remove();
    } catch (e) {}
    try {
      const overlay = document.createElement('div');
      overlay.id = 'webdl-fff-scan-report';
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
      });
      const panel = document.createElement('div');
      Object.assign(panel.style, {
        width: 'min(560px, 92vw)',
        maxHeight: 'min(70vh, 640px)',
        margin: '16px',
        padding: '12px',
        background: '#0b1220',
        color: '#e5e7eb',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '10px',
        boxShadow: '0 10px 32px rgba(0,0,0,0.55)',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: '12px',
        overflow: 'auto',
      });
      overlay.appendChild(panel);
      const title = document.createElement('div');
      title.textContent = isForumPage ? 'Forum scan' : 'Thread scan';
      title.style.cssText = 'font-weight:700;color:#93c5fd;margin-bottom:6px;font-size:14px;';
      panel.appendChild(title);
      const summary = document.createElement('div');
      const threads = Number(res && res.threads) || 0;
      const pages = Number(res && res.pages) || 0;
      const forumPages = Number(res && res.forumPages) || 0;
      const count = Array.isArray(candidates) ? candidates.length : 0;
      summary.textContent = `${count} media gevonden | ${threads} threads | ${pages} threadpagina's | ${forumPages} forumpagina's`;
      summary.style.cssText = 'color:#d1d5db;margin-bottom:10px;';
      panel.appendChild(summary);
      const links = Array.isArray(res && res.threadLinks) ? res.threadLinks.slice(0, 80) : [];
      if (links.length && !count) {
        const msg = document.createElement('div');
        msg.textContent = 'Threads zijn gevonden, maar uit de threadpagina’s is nog geen media gehaald. Er wordt niets gedownload.';
        msg.style.cssText = 'color:#fca5a5;margin-bottom:10px;';
        panel.appendChild(msg);
      }
      const diagnostics = Array.isArray(res && res.diagnostics) ? res.diagnostics.slice(0, 20) : [];
      if (diagnostics.length) {
        const diagTitle = document.createElement('div');
        diagTitle.textContent = 'Forumdiagnose';
        diagTitle.style.cssText = 'font-weight:700;color:#bfdbfe;margin:8px 0 4px;';
        panel.appendChild(diagTitle);
        for (const d of diagnostics) {
          const row = document.createElement('div');
          const url = String(d && d.url || '');
          const titleText = String(d && d.title || '').trim();
          const linksCount = Number(d && d.links) || 0;
          const refsCount = Number(d && d.refs) || 0;
          row.textContent = `${linksCount} thread-links, ${refsCount} thread-referenties | ${titleText || url}`;
          row.title = url;
          row.style.cssText = 'word-break:break-word;color:#cbd5e1;padding:3px 0;border-top:1px solid rgba(255,255,255,0.06);';
          panel.appendChild(row);
        }
      }
      const list = document.createElement('div');
      for (const url of links) {
        const row = document.createElement('div');
        row.textContent = url;
        row.style.cssText = 'word-break:break-all;color:#9ca3af;padding:3px 0;border-top:1px solid rgba(255,255,255,0.06);';
        list.appendChild(row);
      }
      panel.appendChild(list);
      const close = document.createElement('button');
      close.textContent = 'Sluit';
      close.style.cssText = 'margin-top:12px;padding:7px 10px;background:#374151;color:#e5e7eb;border:0;border-radius:6px;cursor:pointer;';
      close.addEventListener('click', () => overlay.remove());
      panel.appendChild(close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      (document.body || document.documentElement).appendChild(overlay);
    } catch (e) {}
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

  function footFetishForumThreadPartsFromUrl(raw, baseHref) {
    try {
      const u = normalizedUrlObject(raw, baseHref);
      u.hash = '';
      const host = String(u.hostname || '').toLowerCase();
      if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return null;
      const text = `${String(u.pathname || '')}${String(u.search || '')}`;
      const m = text.match(/(?:^|[\/?&])threads\/([^\/\?#"'<>]+)\.(\d+)(?:[\/\?#&]|$)/i);
      if (!m || !m[1] || !m[2]) return null;
      return { url: u, slug: m[1], id: m[2] };
    } catch (e) {}
    return null;
  }

  function countFootFetishForumThreadRefsInDocument(doc) {
    let count = 0;
    try {
      count += Array.from(doc.querySelectorAll(
        'a[href*="threads/"], a[data-href*="threads/"], a[data-url*="threads/"], a[data-preview-url*="threads/"], [data-content-url*="threads/"]'
      )).length;
    } catch (e) {}
    try {
      const html = String(doc && doc.documentElement && doc.documentElement.outerHTML || '');
      const matches = html.match(/(?:href|data-href|data-url|data-preview-url|data-content-url)=["'][^"']*threads\/[^"']+["']/ig);
      count += matches ? matches.length : 0;
    } catch (e) {}
    return count;
  }

  function collectFootFetishForumThreadLinksFromForumDocument(doc, baseHref, maxThreads = 200) {
    const out = [];
    const seen = new Set();
    const push = (raw, row) => {
      try {
        if (out.length >= maxThreads) return;
        const parts = footFetishForumThreadPartsFromUrl(raw, baseHref);
        if (!parts || !parts.url || !parts.slug || !parts.id) return;
        const u = parts.url;
        if (row) {
          const rowClass = String(row.className || '').toLowerCase();
          const rowText = String(row.textContent || '').toLowerCase();
          if (/\bis-redirect\b|structitem-status--redirect/.test(rowClass)) return;
          if (/\bredirect\b/.test(rowText) && !/\breplies\b|\bviews\b/.test(rowText)) return;
        }
        u.pathname = `/threads/${parts.slug}.${parts.id}/`;
        u.search = '';
        const final = u.toString();
        const key = parts.id;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(final);
      } catch (e) {}
    };

    const pushElementUrls = (el, row) => {
      if (!el || !el.getAttribute) return;
      const attrs = ['href', 'data-href', 'data-url', 'data-preview-url', 'data-content-url'];
      for (const attr of attrs) {
        try {
          const value = el.getAttribute(attr);
          if (value) push(value, row);
        } catch (e) {}
        if (out.length >= maxThreads) return;
      }
    };

    try {
      const rows = Array.from(doc.querySelectorAll(
        '.structItem--thread, .structItem, .structItemContainer .structItem, .discussionListItem, [data-author][data-content]'
      )).filter(Boolean);
      if (rows.length) {
        for (const row of rows) {
          if (!row) continue;
          const rowClass = String(row.className || '').toLowerCase();
          if (/\bis-redirect\b|structitem-status--redirect/.test(rowClass)) continue;
          const anchors = Array.from(row.querySelectorAll(
            '.structItem-title a[href], a[data-tp-primary="on"][href], a[href*="threads/"], a[data-href*="threads/"], a[data-url*="threads/"], a[data-preview-url*="threads/"], [data-content-url*="threads/"]'
          ));
          for (const a of anchors) {
            pushElementUrls(a, row);
            if (out.length >= maxThreads) break;
          }
          if (out.length >= maxThreads) break;
        }
      }
      if (!out.length) {
        const titleAnchors = Array.from(doc.querySelectorAll(
          '.structItem-title a[href], a[data-tp-primary="on"][href], .discussionListItem .title a[href], a[href*="threads/"], a[data-href*="threads/"], a[data-url*="threads/"], a[data-preview-url*="threads/"], [data-content-url*="threads/"]'
        ));
        for (const a of titleAnchors) {
          const row = a.closest ? a.closest('.structItem, .structItem--thread, .discussionListItem, [data-author][data-content], article, li, tr') : null;
          pushElementUrls(a, row);
          if (out.length >= maxThreads) break;
        }
      }
      if (!out.length) {
        const html = String(doc && doc.documentElement && doc.documentElement.outerHTML || '');
        const attrRe = /\b(?:href|data-href|data-url|data-preview-url|data-content-url)=["']([^"']*threads\/[^"']+)["']/ig;
        let m;
        while ((m = attrRe.exec(html)) && out.length < maxThreads) {
          push(m[1], null);
        }
        const absRe = /https?:\/\/(?:[^\/"'\s<>]+\.)?footfetishforum\.com\/(?:index\.php\?)?threads\/[^"'\s<>]+?\.\d+[^"'\s<>]*/ig;
        while ((m = absRe.exec(html)) && out.length < maxThreads) {
          push(m[0], null);
        }
      }
    } catch (e) {}
    return out;
  }

  function parseFootFetishForumThreadContext(rawUrl, fallbackTitle) {
    try {
      const u = normalizedUrlObject(rawUrl, window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return null;
      const m = u.toString().match(/footfetishforum\.com\/threads\/([^\/\?#]+)\.(\d+)(?:\/[^\/\?#]*)?(?:\/|\?|#|$)/i);
      if (!m) return null;
      let name = String(fallbackTitle || '').trim();
      if (!name) {
        name = String(m[1] || '').replace(/[-_]+/g, ' ').trim();
        name = name.split(/\s+/g).filter(Boolean).map((w) => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
      }
      return {
        url: u.toString(),
        platform: 'footfetishforum',
        channel: name || `Thread ${m[2]}`,
        title: name || `Thread ${m[2]}`,
        thread_id: String(m[2] || '')
      };
    } catch (e) {
      return null;
    }
  }

  function findNextFootFetishForumForumPageUrl(doc, baseHref) {
    return findNextFootFetishForumThreadPageUrl(doc, baseHref);
  }

  function sameFootFetishForumPageUrl(a, b) {
    try {
      const ua = normalizedUrlObject(a, window.location.href);
      const ub = normalizedUrlObject(b, window.location.href);
      ua.hash = '';
      ub.hash = '';
      return ua.toString() === ub.toString();
    } catch (e) {
      return false;
    }
  }

  function isCloudflareChallengeDocument(doc) {
    try {
      const title = String(doc && doc.title || '').trim().toLowerCase();
      if (title.includes('just a moment')) return true;
      const text = String(doc && doc.body && doc.body.textContent || '').toLowerCase();
      return text.includes('enable javascript and cookies to continue') || text.includes('cloudflare');
    } catch (e) {
      return false;
    }
  }

  async function loadFootFetishForumDocument(url, options = {}) {
    const opt = options && typeof options === 'object' ? options : {};
    const timeoutMs = Math.max(3000, Math.min(60000, parseInt(opt.timeoutMs || '20000', 10) || 20000));
    const useCurrent = opt.useCurrent === true && sameFootFetishForumPageUrl(url, window.location.href);
    if (useCurrent) return document;

    const parseHtml = (html) => {
      try {
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        if (doc && !isCloudflareChallengeDocument(doc)) return doc;
      } catch (e) {}
      return null;
    };

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => {
        try { ctrl.abort(); } catch (e) {}
      }, timeoutMs);
      try {
        const resp = await fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store', signal: ctrl.signal });
        const text = await resp.text();
        if (resp && resp.ok) {
          const doc = parseHtml(text);
          if (doc) return doc;
        }
      } finally {
        clearTimeout(t);
      }
    } catch (e) {}

    return new Promise((resolve) => {
      let done = false;
      const frame = document.createElement('iframe');
      const cleanup = (doc) => {
        if (done) return;
        done = true;
        let safeDoc = doc || null;
        if (safeDoc && safeDoc.documentElement) {
          try {
            safeDoc = new DOMParser().parseFromString(safeDoc.documentElement.outerHTML, 'text/html');
          } catch (e) {}
        }
        try { frame.remove(); } catch (e) {}
        resolve(safeDoc || null);
      };
      const timer = setTimeout(() => cleanup(null), timeoutMs);
      frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;opacity:0;pointer-events:none;';
      frame.setAttribute('aria-hidden', 'true');
      frame.onload = () => {
        setTimeout(() => {
          try {
            const doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
            if (doc && !isCloudflareChallengeDocument(doc)) {
              clearTimeout(timer);
              cleanup(doc);
              return;
            }
          } catch (e) {}
          clearTimeout(timer);
          cleanup(null);
        }, 800);
      };
      try {
        frame.src = String(url || '');
        (document.body || document.documentElement).appendChild(frame);
      } catch (e) {
        clearTimeout(timer);
        cleanup(null);
      }
    });
  }

  async function fetchFootFetishForumForumCandidates(startUrl, options = {}) {
    const opt = options && typeof options === 'object' ? options : {};
    const maxForumPages = parseScanLimit(opt.maxForumPages);
    const maxThreadPages = parseScanLimit(opt.maxThreadPages || opt.maxPages);
    const maxThreads = parseScanLimit(opt.maxThreads);
    const maxItems = parseScanLimit(opt.maxItems);
    const delayMs = Math.max(0, Math.min(3000, parseInt(opt.delayMs || '250', 10) || 250));
    const timeoutMs = Math.max(3000, Math.min(60000, parseInt(opt.timeoutMs || '20000', 10) || 20000));

    const threadLinks = [];
    const seenThreads = new Set();
    let forumUrl = String(startUrl || '').trim();
    const diagnostics = [];
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
        doc = await loadFootFetishForumDocument(forumUrl, {
          timeoutMs,
          useCurrent: forumPages === 1,
        });
      } catch (e) {
        break;
      }
      if (!doc) break;

      const links = collectFootFetishForumThreadLinksFromForumDocument(doc, forumUrl, maxThreads - threadLinks.length);
      try {
        diagnostics.push({
          url: forumUrl,
          title: String(doc.title || '').trim(),
          links: Array.isArray(links) ? links.length : 0,
          refs: countFootFetishForumThreadRefsInDocument(doc)
        });
      } catch (e) {}
      for (const link of links) {
        try {
          const parts = footFetishForumThreadPartsFromUrl(link, forumUrl);
          const key = parts && parts.id ? parts.id : link;
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

    return { candidates: out, threadLinks: threadLinks.slice(), pages: threadPages, forumPages, threads: threadLinks.length, diagnostics };
  }

  async function fetchFootFetishForumThreadCandidates(startUrl, options = {}) {
    const opt = options && typeof options === 'object' ? options : {};
    const maxPages = parseScanLimit(opt.maxPages);
    const maxItems = parseScanLimit(opt.maxItems);
    const delayMs = Math.max(0, Math.min(3000, parseInt(opt.delayMs || '250', 10) || 250));
    const timeoutMs = Math.max(3000, Math.min(60000, parseInt(opt.timeoutMs || '20000', 10) || 20000));

    const seen = new Set();
    const out = [];

    let url = String(startUrl || '').trim();
    try {
      const u0 = new URL(url, window.location.href);
      u0.hash = '';
      url = u0.toString();
    } catch (e) {}
    url = firstFootFetishForumThreadPageUrl(url, window.location.href) || url;
    const sourceContext = parseFootFetishForumThreadContext(url, '');

    let pages = 0;
    while (url && pages < maxPages && out.length < maxItems) {
      pages++;
      let doc = null;
      try {
        doc = await loadFootFetishForumDocument(url, {
          timeoutMs,
          useCurrent: pages === 1,
        });
      } catch (e) {
        break;
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
        out.push({ url: s, el: c.el || null, kind: c.kind || '', sourceContext });
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
      if (isDownloadableTwitterUrl(u)) return true;
      if (isKnownExternalMediaWrapperHost(host)) return true;
      if (/(youtube\.com|youtu\.be|vimeo\.com|redgifs\.com|gfycat\.com|imgur\.com|instagram\.com|tiktok\.com|reddit\.com|redd\.it|t\.me|telegram\.me)/i.test(host)) return true;
      if (/\/(video|videos|gallery|galleries|album|albums|watch|view|clip|movie|media|embed|post|posts|photo|photos|set|sets|show|download|file)\b/i.test(p)) return true;
      if (/\b(video|videos|gallery|galleries|album|albums|clip|movie|download|teaser|trailer|watch|part\s*\d+)\b/i.test(text)) return true;
      if (text && text.length >= 6 && /[a-z]/i.test(text) && !/^(like|quote|reply|report|bookmark|share|profile|member|click to expand|last edited)/i.test(text)) return true;
    } catch (e) {}
    return false;
  }

  function isTwitterHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    return host === 'twitter.com' || host === 'x.com' || host === 'mobile.twitter.com';
  }

  function isDownloadableTwitterUrl(input) {
    try {
      const u = input instanceof URL ? input : new URL(String(input || ''), window.location.href);
      if (!isTwitterHost(u.hostname)) return false;
      const segments = String(u.pathname || '').split('/').filter(Boolean);
      if (!segments.length) return false;
      const first = String(segments[0] || '').replace(/^@/, '');
      if (first.toLowerCase() === 'i' && String(segments[1] || '').toLowerCase() === 'web' && String(segments[2] || '').toLowerCase() === 'status' && /^\d+$/.test(String(segments[3] || ''))) return true;
      const blocked = new Set([
        'home', 'explore', 'search', 'hashtag', 'i', 'intent', 'settings',
        'notifications', 'messages', 'login', 'signup', 'tos', 'privacy',
      ]);
      if (!first || blocked.has(first.toLowerCase())) return false;
      if (segments.length === 1) return /^[a-z0-9_]{1,15}$/i.test(first);
      if (String(segments[1] || '').toLowerCase() === 'status' && /^\d+$/.test(String(segments[2] || ''))) return true;
      if (/^[a-z0-9_]{1,15}$/i.test(first)) return true;
    } catch (e) {}
    return false;
  }

  function isRedditBatchSeedUrl(input) {
    const s = String(input || '');
    if (!s) return false;
    if (/reddit\.com\/(?:r\/[^\/\?#]+\/)?comments\/[a-z0-9]+(?:\/[^\/\?#]+)?/i.test(s)) return true;
    if (/reddit\.com\/(?:user|u)\/[^\/\?#]+(?:\/[^?#]*)?/i.test(s)) return true;
    if (/reddit\.com\/r\/[^\/\?#]+(?:\/[^?#]*)?/i.test(s)) return true;
    if (/redd\.it\/[a-z0-9]+/i.test(s)) return true;
    return false;
  }

  function isVipergirlsHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'vipergirls.to' || host.endsWith('.vipergirls.to') || host === 'viper.to' || host.endsWith('.viper.to');
  }

  const VIPERGIRLS_URL_RE = /(?:vipergirls\.to|viper\.to)/i;
  const VIPERGIRLS_THREAD_RE = /(?:vipergirls\.to|viper\.to)\/threads\/(\d+)-([^\/\?#]+)/i;

  // ========================
  // METADATA SCRAPING
  // ========================
  function scrapeMetadata() {
    const url = effectivePageUrl();
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

    else if (/(?:^|\/\/)(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\//i.test(url)) {
      meta.platform = 'twitter';
      const parts = xTwitterPartsFromUrl(url);
      if (parts.user) meta.channel = `@${parts.user}`;
    }

    else if (/reddit\.com|redd\.it/i.test(url)) {
      meta.platform = 'reddit';
      const m = url.match(/reddit\.com\/r\/([^\/\?#]+)/i);
      if (m) meta.channel = `r_${m[1]}`;
      const um = url.match(/reddit\.com\/(?:user|u)\/([^\/\?#]+)/i);
      if (um) meta.channel = `u_${um[1]}`;
    }

    else if (/redgifs\.com|gifdeliverynetwork\.com|gfycat\.com/i.test(url)) {
      meta.platform = 'redgifs';
      const um = url.match(/redgifs\.com\/users\/([^\/\?#]+)/i);
      if (um && um[1]) meta.channel = um[1];
      const titleEl = document.querySelector('h1, [data-testid*="title"], [class*="title"]');
      if (titleEl && titleEl.textContent && titleEl.textContent.trim()) meta.title = titleEl.textContent.trim();
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
      const tm = url.match(/footfetishforum\.com\/threads\/[^\/\?#]+\.(\d+)(?:\/[^\/\?#]*)?(?:\/|\?|#|$)/i);
      if (tm && tm[1]) meta.channel = `thread_${tm[1]}`;
      const fm = url.match(/footfetishforum\.com\/forums\/[^\/\?#]*\.(\d+)(?:\/|\?|#|$)/i);
      if (fm && fm[1]) meta.channel = `forum_${fm[1]}`;
    }

    else if (/foot-fetish\.club/i.test(url)) {
      meta.platform = isTranslatedProxyPage() ? 'turbopages' : 'xenforo';
      meta.adapter = 'xenforo';
      if (isTranslatedProxyPage()) meta.contextUrl = String(window.location.href || '');
      const tm = url.match(/foot-fetish\.club\/threads\/([^\/\?#]+)/i);
      if (tm && tm[1]) meta.channel = `thread_${tm[1]}`;
      const heading = pickFirstMatchingText('h1, .p-title-value, .title, .page-title');
      if (heading && heading.text) meta.title = heading.text;
    }

    else if (VIPERGIRLS_URL_RE.test(url)) {
      meta.platform = 'vipergirls';
      const tm = url.match(VIPERGIRLS_THREAD_RE);
      if (tm && tm[1]) meta.channel = `thread_${tm[1]}`;
      if (tm && tm[2]) {
        const name = tm[2].replace(/[-_]+/g, ' ').trim();
        if (name) meta.title = name;
      }
      const fm = url.match(/(?:vipergirls\.to|viper\.to)\/forumdisplay\.php\?[^#]*\bf=(\d+)/i) || url.match(/(?:vipergirls\.to|viper\.to)\/forums\/(\d+)-/i);
      if (fm && fm[1]) meta.channel = `forum_${fm[1]}`;
      else if (/vipergirls\.to\/forum\.php(?:[?#]|$)/i.test(url)) meta.channel = 'forum_index';
      const heading = pickFirstMatchingText('h1, .threadtitle, .title, .page-title');
      if (heading && heading.text) meta.title = heading.text;
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
      const u = normalizedUrlObject(effectivePageUrl(), window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return false;
      return /\/threads\//i.test(String(u.pathname || ''));
    } catch (e) {
      return false;
    }
  }

  function isFootFetishForumForumPage() {
    try {
      const u = normalizedUrlObject(effectivePageUrl(), window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return false;
      return /\/forums\/[^\/\?#]*\.\d+(?:\/|\?|#|$)/i.test(String(u.pathname || '') + String(u.search || '') + String(u.hash || ''));
    } catch (e) {
      return false;
    }
  }

  function firstFootFetishForumThreadPageUrl(rawUrl, baseHref) {
    try {
      const u = normalizedUrlObject(rawUrl, baseHref);
      const host = String(u.hostname || '').toLowerCase();
      if (!(host === 'footfetishforum.com' || host.endsWith('.footfetishforum.com'))) return '';
      const m = String(u.pathname || '').match(/^(\/threads\/[^\/?#]+\.\d+)(?:\/page-\d+)?\/?$/i);
      if (!m || !m[1]) return '';
      u.pathname = m[1] + '/';
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch (e) {}
    return '';
  }

  function isVipergirlsThreadPage() {
    try {
      const u = new URL(window.location.href);
      if (!isVipergirlsHost(u.hostname)) return false;
      return /\/threads\/\d+-/i.test(String(u.pathname || ''));
    } catch (e) {
      return false;
    }
  }

  function isVipergirlsForumPage() {
    try {
      const u = new URL(window.location.href);
      if (!isVipergirlsHost(u.hostname)) return false;
      const path = String(u.pathname || '');
      const full = path + String(u.search || '') + String(u.hash || '');
      return /\/forum\.php(?:[?#]|$)/i.test(full) || /\/forumdisplay\.php\?[^#]*\bf=\d+/i.test(full) || /\/forums\/\d+-/i.test(path);
    } catch (e) {
      return false;
    }
  }

  function normalizeVipergirlsThreadUrl(rawUrl, baseHref) {
    try {
      const u = new URL(String(rawUrl || ''), baseHref || window.location.href);
      u.hash = '';
      if (!isVipergirlsHost(u.hostname)) return '';
      const path = String(u.pathname || '');
      const modern = path.match(/\/threads\/(\d+)-([^\/\?#]+)/i);
      if (modern && modern[1]) {
        u.search = '';
        return u.toString();
      }
      const t = u.searchParams ? (u.searchParams.get('t') || '') : '';
      if (/\/showthread\.php$/i.test(path) && /^\d+$/.test(t)) return u.toString();
    } catch (e) {}
    return '';
  }

  function parseVipergirlsThreadContext(rawUrl, fallbackTitle) {
    try {
      const u = new URL(String(rawUrl || ''), window.location.href);
      if (!isVipergirlsHost(u.hostname)) return null;
      let id = '';
      let name = String(fallbackTitle || '').trim();
      const modern = u.toString().match(VIPERGIRLS_THREAD_RE);
      if (modern) {
        id = String(modern[1] || '');
        if (!name) name = String(modern[2] || '').replace(/[-_]+/g, ' ').trim();
      } else if (/\/showthread\.php$/i.test(String(u.pathname || ''))) {
        id = String(u.searchParams ? (u.searchParams.get('t') || '') : '');
      }
      if (!id) return null;
      return {
        url: u.toString(),
        platform: 'vipergirls',
        channel: `thread_${id}`,
        title: name || `Thread ${id}`,
        thread_id: id
      };
    } catch (e) {
      return null;
    }
  }

  function collectVipergirlsThreadLinksFromForumDocument(doc, baseHref, maxThreads = 200) {
    const out = [];
    const seen = new Set();
    const push = (raw, title) => {
      try {
        if (out.length >= maxThreads) return;
        const url = normalizeVipergirlsThreadUrl(raw, baseHref);
        if (!url) return;
        const ctx = parseVipergirlsThreadContext(url, title);
        const key = (ctx && ctx.thread_id) || url;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ url, sourceContext: ctx || null, kind: 'thread' });
      } catch (e) {}
    };

    try {
      const rows = Array.from(doc.querySelectorAll('li.threadbit, tr.threadbit, .threadbit, .thread, tr, li, .forumbit_post')).filter(Boolean);
      for (const row of rows) {
        if (out.length >= maxThreads) break;
        const cls = String(row.className || '').toLowerCase();
        if (/\bsticky\b|\bannouncement\b|\bmoved\b/.test(cls)) {
          // Sticky threads are still useful; only skip explicit moved redirects.
          if (/\bmoved\b/.test(cls)) continue;
        }
        const anchors = Array.from(row.querySelectorAll('a[href*="/threads/"], a[href*="showthread.php"]'));
        for (const a of anchors) {
          const text = String(a.textContent || '').trim();
          push(a.getAttribute('href'), text);
          if (out.length >= maxThreads) break;
        }
      }
      if (!out.length) {
        const anchors = Array.from(doc.querySelectorAll('a[href*="/threads/"], a[href*="showthread.php"]'));
        for (const a of anchors) {
          push(a.getAttribute('href'), String(a.textContent || '').trim());
          if (out.length >= maxThreads) break;
        }
      }
    } catch (e) {}
    return out;
  }

  function collectVipergirlsForumLinksFromDocument(doc, baseHref, maxForums = 100) {
    const out = [];
    const seen = new Set();
    const push = (raw) => {
      try {
        if (out.length >= maxForums) return;
        const u = new URL(String(raw || ''), baseHref);
        u.hash = '';
        if (!isVipergirlsHost(u.hostname)) return;
        const path = String(u.pathname || '');
        const full = path + String(u.search || '');
        if (!(/\/forumdisplay\.php\?[^#]*\bf=\d+/i.test(full) || /\/forums\/\d+-/i.test(path) || /\/forum\.php(?:[?#]|$)/i.test(full))) return;
        const final = u.toString();
        if (seen.has(final)) return;
        seen.add(final);
        out.push(final);
      } catch (e) {}
    };
    try {
      for (const a of Array.from(doc.querySelectorAll('a[href*="forumdisplay.php"], a[href*="/forums/"], a[href*="forum.php"]'))) {
        push(a.getAttribute('href'));
        if (out.length >= maxForums) break;
      }
    } catch (e) {}
    return out;
  }

  function isVipergirlsJunkMediaUrl(rawUrl, baseHref) {
    try {
      const u = new URL(String(rawUrl || ''), baseHref || window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      const p = String(u.pathname || '').toLowerCase();
      const isVipr = host === 'vipr.im' || host.endsWith('.vipr.im');
      if (/^thumbnails\d*\.imagebam\.com$/i.test(host)) return true;
      if (/^thumbs?\d*\./i.test(host)) return true;
      if (/\/(?:thumb|thumbs|thumbnail|thumbnails)\//i.test(p)) return true;
      if (/\/th\//i.test(p) && !isVipr) return true;
      if (isVipergirlsHost(host) && /\/images\/viper-red\/misc\/progress\.gif$/i.test(p)) return true;
    } catch (e) {}
    return false;
  }

  function isVipergirlsMediaCandidateUrl(rawUrl, baseHref, contextText) {
    try {
      const s = String(rawUrl || '').trim();
      if (!s || /^(data:|blob:|javascript:|mailto:)/i.test(s)) return false;
      const u = new URL(s, baseHref || window.location.href);
      const host = String(u.hostname || '').toLowerCase();
      const p = String(u.pathname || '').toLowerCase();
      const text = String(contextText || '').toLowerCase();
      if (!/^https?:$/i.test(String(u.protocol || ''))) return false;
      if (isVipergirlsJunkMediaUrl(u.toString(), baseHref)) return false;
      if (/\b(avatar|emoji|emote|smilie|smiley|reaction|logo|icon|banner|sprite|button)\b/i.test(p + ' ' + text)) return false;
      if (/\/(?:images|clientscript|css|js)\/(?:smilies|misc|buttons|icons)\//i.test(p)) return false;

      const isViperHost = isVipergirlsHost(host);
      const isDirectMediaFile = /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|mp4|mov|m4v|webm|mkv|zip|rar|7z)(?:$|[?#])/i.test(p);
      if (isKeep2ShareFilehostUrl(u.toString(), baseHref)) return true;
      if (isDirectMediaFile) return true;
      if (!isViperHost && isKnownExternalMediaWrapperHost(host)) return true;
      if (!isViperHost && looksLikeExternalMediaPageUrl(u.toString(), text)) return true;
      if (isViperHost && /\/attachments?\//i.test(p)) return true;
    } catch (e) {}
    return false;
  }

  function collectVipergirlsCandidatesFromDocument(doc, baseHref, maxItems = 2000) {
    const rootDoc = doc || document;
    const pageHref = String(baseHref || window.location.href);
    const out = [];
    const seen = new Set();
    const sourceContext = parseVipergirlsThreadContext(pageHref, '');

    const viprFullImageFromThumb = (raw) => {
      try {
        const u = new URL(String(raw || ''), pageHref);
        const host = String(u.hostname || '').toLowerCase();
        const m = String(u.pathname || '').match(/^\/th\/([^/]+)\/([^/?#]+\.jpe?g)$/i);
        if (!m || !(host === 'vipr.im' || host.endsWith('.vipr.im'))) return '';
        return `${u.protocol}//${u.host}/i/${m[1]}/${m[2]}/30.jpg`;
      } catch (e) {
        return '';
      }
    };

    const isLikelyThumbnailCdnImage = (raw) => isVipergirlsJunkMediaUrl(raw, pageHref);

    const push = (raw, kind, el, contextText) => {
      try {
        if (out.length >= maxItems) return;
        const s = String(raw || '').trim();
        if (!s || /^(data:|blob:|javascript:|mailto:)/i.test(s)) return;
        const u = new URL(s, pageHref);
        u.hash = '';
        let final = u.toString();
        if (!isVipergirlsMediaCandidateUrl(final, pageHref, contextText || (el && el.textContent) || '')) return;
        const isK2s = isKeep2ShareFilehostUrl(final, pageHref);
        if (isK2s) final = normalizeKeep2ShareCandidateUrl(final, pageHref) || final;
        const key = isK2s ? (keep2ShareDedupeKey(final, pageHref) || final) : final;
        const candidate = { url: final, kind: isK2s ? 'keep2share_link' : (kind || 'media'), el: el || null, sourceContext };
        if (seen.has(key)) {
          const existingIndex = out.findIndex((item) => ((isK2s ? keep2ShareDedupeKey(item && item.url ? item.url : '', pageHref) : item.url) || item.url) === key);
          if (existingIndex >= 0 && isK2s && preferKeep2ShareCandidate(candidate, out[existingIndex])) out[existingIndex] = candidate;
          return;
        }
        seen.add(key);
        out.push(candidate);
      } catch (e) {}
    };

    const roots = Array.from(rootDoc.querySelectorAll(
      '.postbody, .postcontent, .postrow, .content, [id^="post_message"], [id^="post"]'
    )).filter(Boolean);
    if (!roots.length) roots.push(rootDoc);

    for (const root of roots) {
      if (out.length >= maxItems) break;
      try {
        for (const img of Array.from(root.querySelectorAll('img'))) {
          if (out.length >= maxItems) break;
          const rect = img.getBoundingClientRect ? img.getBoundingClientRect() : { width: 0, height: 0 };
          const cls = String(img.className || '').toLowerCase();
          const alt = String(img.alt || '').toLowerCase();
          if ((rect.width && rect.width < 40) || (rect.height && rect.height < 40)) continue;
          if (/\b(avatar|smilie|smiley|emoji|icon)\b/i.test(cls + ' ' + alt)) continue;
          const imgSrc = img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src');
          const fullFromThumb = viprFullImageFromThumb(imgSrc);
          const parentLink = img.closest ? img.closest('a[href]') : null;
          if (fullFromThumb) {
            push(fullFromThumb, 'vipr_full_from_thumb', img, alt);
          } else {
            if (parentLink) {
              push(parentLink.getAttribute('href'), 'thumb_link', parentLink, parentLink.textContent || alt);
            } else if (!isLikelyThumbnailCdnImage(imgSrc)) {
              push(imgSrc, 'img', img, alt);
            }
          }
          const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
          if (srcset) {
            const first = srcset.split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean).pop();
            if (first) {
              const full = viprFullImageFromThumb(first);
              if (full) push(full, 'vipr_full_from_srcset_thumb', img, alt);
              else if (!parentLink && !isLikelyThumbnailCdnImage(first)) push(first, 'img_srcset', img, alt);
            }
          }
        }
      } catch (e) {}
      try {
        for (const a of Array.from(root.querySelectorAll('a[href], a[data-href], a[data-url]'))) {
          if (out.length >= maxItems) break;
          push(a.getAttribute('href') || a.getAttribute('data-href') || a.getAttribute('data-url'), 'a', a, a.textContent || '');
        }
      } catch (e) {}
      try {
        const raw = String(root && root.textContent ? root.textContent : '');
        const re = /(https?:\/\/[^\s)\]"']+)/g;
        let m;
        while ((m = re.exec(raw)) && out.length < maxItems) {
          push(String(m[1] || '').replace(/[),\]."']+$/g, ''), 'text', root, '');
        }
      } catch (e) {}
    }

    return uniqueCandidates(out);
  }

  function collectVipergirlsCandidates(maxItems = 2000) {
    return collectVipergirlsCandidatesFromDocument(document, window.location.href, maxItems);
  }

  function isKeep2ShareFilehostUrl(rawUrl, baseHref) {
    try {
      const u = new URL(String(rawUrl || ''), baseHref || window.location.href);
      const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
      if (!/^https?:$/i.test(String(u.protocol || ''))) return false;
      if (host === 'keep2share.cc' || host === 'k2s.cc' || host === 'k2s.io') return true;
      return host.endsWith('.keep2share.cc') || host.endsWith('.k2s.cc') || host.endsWith('.k2s.io');
    } catch (e) {}
    return false;
  }

  function keep2ShareFileId(rawUrl, baseHref) {
    try {
      const u = new URL(String(rawUrl || ''), baseHref || window.location.href);
      if (!isKeep2ShareFilehostUrl(u.toString(), baseHref)) return '';
      const m = String(u.pathname || '').match(/^\/file\/([^\/?#]+)/i);
      return m && m[1] ? decodeURIComponent(m[1]).trim().toLowerCase() : '';
    } catch (e) {}
    return '';
  }

  function keep2ShareDedupeKey(rawUrl, baseHref) {
    const id = keep2ShareFileId(rawUrl, baseHref);
    return id ? `keep2share:${id}` : '';
  }

  function normalizeKeep2ShareCandidateUrl(rawUrl, baseHref) {
    try {
      const u = new URL(String(rawUrl || ''), baseHref || window.location.href);
      if (!isKeep2ShareFilehostUrl(u.toString(), baseHref)) return '';
      const m = String(u.pathname || '').match(/^\/file\/([^\/?#]+)(?:\/([^?#]+))?/i);
      if (!m || !m[1]) return u.toString();
      const id = m[1];
      const filename = String(m[2] || '').replace(/^\/+|\/+$/g, '').trim();
      u.hash = '';
      u.search = '';
      u.pathname = filename ? `/file/${id}/${filename}` : `/file/${id}`;
      return u.toString();
    } catch (e) {}
    return '';
  }

  function keep2ShareCandidateScore(candidate) {
    try {
      const url = String(candidate && candidate.url ? candidate.url : '');
      if (!keep2ShareFileId(url)) return 0;
      const u = new URL(url, window.location.href);
      const p = String(u.pathname || '');
      let score = 10;
      if (/^\/file\/[^\/?#]+\/[^\/?#]+/i.test(p)) score += 10;
      if (!u.search) score += 3;
      if (/keep2share_link/i.test(String(candidate && candidate.kind ? candidate.kind : ''))) score += 1;
      return score;
    } catch (e) {}
    return 0;
  }

  function preferKeep2ShareCandidate(candidate, existing) {
    try {
      const candidateKey = keep2ShareDedupeKey(candidate && candidate.url ? candidate.url : '');
      const existingKey = keep2ShareDedupeKey(existing && existing.url ? existing.url : '');
      if (!candidateKey || candidateKey !== existingKey) return false;
      return keep2ShareCandidateScore(candidate) > keep2ShareCandidateScore(existing);
    } catch (e) {}
    return false;
  }

  function isPriorityBatchCandidate(candidate) {
    try {
      const url = String(candidate && candidate.url ? candidate.url : '');
      if (keep2ShareFileId(url)) return true;
      return false;
    } catch (e) {}
    return false;
  }

  function sortBatchPreviewCandidates(candidates) {
    const list = Array.isArray(candidates) ? candidates.slice() : [];
    return list.sort((a, b) => {
      const ap = isPriorityBatchCandidate(a) ? 0 : 1;
      const bp = isPriorityBatchCandidate(b) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const ak = String(a && a.kind ? a.kind : '');
      const bk = String(b && b.kind ? b.kind : '');
      if (ak !== bk) return ak.localeCompare(bk);
      return String(a && a.url ? a.url : '').localeCompare(String(b && b.url ? b.url : ''));
    });
  }

  function summarizeBatchCandidatesForPreview(candidates) {
    try {
      const list = Array.isArray(candidates) ? candidates : [];
      let k2s = 0;
      let media = 0;
      let other = 0;
      for (const c of list) {
        const url = String(c && c.url ? c.url : '');
        if (keep2ShareFileId(url)) k2s++;
        else if (/\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|mp4|mov|m4v|webm|mkv|mp3|m4a)(\?|$)/i.test(url)) media++;
        else other++;
      }
      const parts = [];
      if (k2s) parts.push(`${k2s} K2S`);
      if (media) parts.push(`${media} media`);
      if (other) parts.push(`${other} overige`);
      return parts.join(' · ');
    } catch (e) {}
    return '';
  }

  function collectVipergirlsKeep2ShareCandidatesFromDocument(doc, baseHref, maxItems = 5000) {
    const out = [];
    const seen = new Set();
    const sourceContext = parseVipergirlsThreadContext(baseHref || window.location.href, '');
    const push = (raw, kind, el) => {
      try {
        if (out.length >= maxItems) return;
        const s = String(raw || '').trim();
        if (!s || /^(data:|blob:|javascript:|mailto:)/i.test(s)) return;
        const u = new URL(s, baseHref || window.location.href);
        u.hash = '';
        if (!isKeep2ShareFilehostUrl(u.toString(), baseHref)) return;
        const final = normalizeKeep2ShareCandidateUrl(u.toString(), baseHref) || u.toString();
        const key = keep2ShareDedupeKey(final, baseHref) || final;
        if (seen.has(key)) {
          const existingIndex = out.findIndex((item) => (keep2ShareDedupeKey(item && item.url ? item.url : '', baseHref) || item.url) === key);
          if (existingIndex >= 0) {
            const replacement = { url: final, kind: kind || 'keep2share', el: el || null, sourceContext };
            if (preferKeep2ShareCandidate(replacement, out[existingIndex])) out[existingIndex] = replacement;
          }
          return;
        }
        seen.add(key);
        out.push({ url: final, kind: kind || 'keep2share', el: el || null, sourceContext });
      } catch (e) {}
    };

    try {
      for (const a of Array.from((doc || document).querySelectorAll('a[href], a[data-href], a[data-url]'))) {
        push(a.getAttribute('href') || a.getAttribute('data-href') || a.getAttribute('data-url'), 'keep2share_link', a);
        if (out.length >= maxItems) break;
      }
    } catch (e) {}

    try {
      const raw = String((doc || document).body ? (doc || document).body.textContent : (doc || document).textContent || '');
      const re = /(https?:\/\/[^\s)\]"']+)/g;
      let m;
      while ((m = re.exec(raw)) && out.length < maxItems) {
        push(String(m[1] || '').replace(/[),\]."']+$/g, ''), 'keep2share_text', null);
      }
    } catch (e) {}

    return uniqueCandidates(out);
  }

  function collectVipergirlsKeep2ShareCandidates(maxItems = 5000) {
    return collectVipergirlsKeep2ShareCandidatesFromDocument(document, window.location.href, maxItems);
  }

  async function fetchVipergirlsKeep2ShareThreadCandidates(startUrl, options = {}) {
    const opt = options && typeof options === 'object' ? options : {};
    const maxPages = parseScanLimit(opt.maxPages);
    const maxItems = parseScanLimit(opt.maxItems);
    const delayMs = Math.max(0, Math.min(3000, parseInt(opt.delayMs || '250', 10) || 250));
    const timeoutMs = Math.max(3000, Math.min(60000, parseInt(opt.timeoutMs || '20000', 10) || 20000));
    const seen = new Set();
    const out = [];
    let url = String(startUrl || '').trim();
    try {
      const u0 = new URL(url, window.location.href);
      u0.hash = '';
      url = u0.toString();
    } catch (e) {}

    let pages = 0;
    while (url && pages < maxPages && out.length < maxItems) {
      pages++;
      let doc = null;
      try {
        doc = await loadFootFetishForumDocument(url, {
          timeoutMs,
          useCurrent: pages === 1 && sameFootFetishForumPageUrl(url, window.location.href),
        });
      } catch (e) {
        break;
      }
      if (!doc) break;

      const remaining = Math.max(0, maxItems - out.length);
      const candidates = collectVipergirlsKeep2ShareCandidatesFromDocument(doc, url, remaining);
      for (const c of (Array.isArray(candidates) ? candidates : [])) {
        if (!c || !c.url) continue;
        if (seen.has(c.url)) continue;
        seen.add(c.url);
        out.push(c);
        if (out.length >= maxItems) break;
      }

      const nextUrl = findNextVipergirlsForumPageUrl(doc, url);
      if (!nextUrl || nextUrl === url) break;
      url = nextUrl;
      if (delayMs > 0) {
        try { await delay(delayMs); } catch (e) {}
      }
    }

    return { candidates: out, pages };
  }

  async function fetchVipergirlsMixedThreadCandidates(startUrl, options = {}) {
    const opt = options && typeof options === 'object' ? options : {};
    const maxPages = parseScanLimit(opt.maxPages);
    const maxItems = parseScanLimit(opt.maxItems);
    const delayMs = Math.max(0, Math.min(3000, parseInt(opt.delayMs || '250', 10) || 250));
    const timeoutMs = Math.max(3000, Math.min(60000, parseInt(opt.timeoutMs || '20000', 10) || 20000));
    const out = [];
    const seen = new Set();
    let url = String(startUrl || '').trim();
    try {
      const u0 = new URL(url, window.location.href);
      u0.hash = '';
      url = u0.toString();
    } catch (e) {}

    let pages = 0;
    while (url && pages < maxPages && out.length < maxItems) {
      pages++;
      let doc = null;
      try {
        doc = await loadFootFetishForumDocument(url, {
          timeoutMs,
          useCurrent: pages === 1 && sameFootFetishForumPageUrl(url, window.location.href),
        });
      } catch (e) {
        break;
      }
      if (!doc) break;

      const remaining = Math.max(0, maxItems - out.length);
      const candidates = collectVipergirlsCandidatesFromDocument(doc, url, remaining);
      for (const c of (Array.isArray(candidates) ? candidates : [])) {
        if (!c || !c.url) continue;
        const key = keep2ShareDedupeKey(c.url, url) || c.url;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
        if (out.length >= maxItems) break;
      }

      const nextUrl = findNextVipergirlsForumPageUrl(doc, url);
      if (!nextUrl || nextUrl === url) break;
      url = nextUrl;
      if (delayMs > 0) {
        try { await delay(delayMs); } catch (e) {}
      }
    }

    return { candidates: uniqueCandidates(out), pages };
  }

  function findNextVipergirlsForumPageUrl(doc, baseHref) {
    try {
      const selectors = [
        'link[rel="next"][href]',
        'a[rel="next"][href]',
        'a.pagination_next[href]',
        '.pagination a[rel="next"][href]',
        '.pagination a[title*="Next"][href]',
        'a[title*="Next Page"][href]'
      ];
      for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (!el) continue;
        const href = el.getAttribute('href');
        if (!href) continue;
        const u = new URL(href, baseHref);
        u.hash = '';
        const host = String(u.hostname || '').toLowerCase();
        if (isVipergirlsHost(host)) return u.toString();
      }
      for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
        const text = String(a.textContent || '').trim().toLowerCase();
        const cls = String(a.className || '').toLowerCase();
        const rel = String(a.getAttribute('rel') || '').toLowerCase();
        if (!(text === 'next' || text === '>' || text === '›' || /\bnext\b/.test(cls) || /\bnext\b/.test(rel))) continue;
        const u = new URL(a.getAttribute('href'), baseHref);
        u.hash = '';
        const host = String(u.hostname || '').toLowerCase();
        if (isVipergirlsHost(host)) return u.toString();
      }
    } catch (e) {}
    return '';
  }

  async function fetchVipergirlsForumCandidates(startUrl, options = {}) {
    const opt = options && typeof options === 'object' ? options : {};
    const maxForumPages = parseScanLimit(opt.maxForumPages);
    const maxThreads = parseScanLimit(opt.maxThreads || opt.maxItems);
    const delayMs = Math.max(0, Math.min(3000, parseInt(opt.delayMs || '250', 10) || 250));
    const timeoutMs = Math.max(3000, Math.min(60000, parseInt(opt.timeoutMs || '20000', 10) || 20000));

    const queue = [];
    const seenForums = new Set();
    const seenThreads = new Set();
    const candidates = [];
    const threadLinks = [];
    let forumPages = 0;

    const enqueueForum = (raw, front = false) => {
      try {
        const u = new URL(String(raw || ''), window.location.href);
        u.hash = '';
        if (!isVipergirlsHost(u.hostname)) return;
        const s = u.toString();
        if (seenForums.has(s)) return;
        seenForums.add(s);
        if (front) queue.unshift(s);
        else queue.push(s);
      } catch (e) {}
    };
    enqueueForum(startUrl);

    while (queue.length && forumPages < maxForumPages && candidates.length < maxThreads) {
      const forumUrl = queue.shift();
      let doc = null;
      forumPages++;
      try {
        doc = await loadFootFetishForumDocument(forumUrl, {
          timeoutMs,
          useCurrent: forumPages === 1 && sameFootFetishForumPageUrl(forumUrl, window.location.href),
        });
      } catch (e) {
        doc = null;
      }
      if (!doc) continue;

      const links = collectVipergirlsThreadLinksFromForumDocument(doc, forumUrl, maxThreads - candidates.length);
      for (const c of links) {
        const ctx = c && c.sourceContext ? c.sourceContext : parseVipergirlsThreadContext(c && c.url, '');
        const key = (ctx && ctx.thread_id) || (c && c.url);
        if (!key || seenThreads.has(key)) continue;
        seenThreads.add(key);
        threadLinks.push(c.url);
        candidates.push(c);
        if (candidates.length >= maxThreads) break;
      }

      const nextUrl = findNextVipergirlsForumPageUrl(doc, forumUrl);
      if (nextUrl) enqueueForum(nextUrl, true);
      if (candidates.length < maxThreads) {
        const forumLinks = collectVipergirlsForumLinksFromDocument(doc, forumUrl, 100);
        for (const url of forumLinks) enqueueForum(url);
      }
      if (delayMs > 0 && queue.length && candidates.length < maxThreads) {
        try { await delay(delayMs); } catch (e) {}
      }
    }

    return { candidates, threadLinks, pages: 0, forumPages, threads: threadLinks.length };
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
        if (!isFootFetishForumMediaCandidateUrl(final, window.location.href, kind)) return;
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
                    const imgSrc = img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
                    if (imgSrc) {
                      push(imgSrc, img, 'img_under_link');
                    }
                    push(href, parentLink, 'thumb_link');
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
        if (looksLikeExternalMedia && isTwitterHost(host) && !isDownloadableTwitterUrl(abs)) looksLikeExternalMedia = false;

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
            if (looksLikeFile || looksLikeExternalMedia || isFootFetishForumMediaCandidateUrl(s, window.location.href, 'text')) {
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
          if (looksLikeExternalMedia && isTwitterHost(host) && !isDownloadableTwitterUrl(abs)) looksLikeExternalMedia = false;

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
    const byKey = new Map();
    for (const c of (Array.isArray(candidates) ? candidates : [])) {
      try {
        let u = String((c && c.url) || '').trim();
        if (!u) continue;
        u = normalizeKeep2ShareCandidateUrl(u) || u;
        const item = {
          url: u,
          el: (c && c.el) ? c.el : null,
          kind: (c && c.kind) ? c.kind : '',
          sourceContext: (c && c.sourceContext && typeof c.sourceContext === 'object') ? c.sourceContext : null
        };
        const key = keep2ShareDedupeKey(u) || u;
        const existing = byKey.get(key);
        if (!existing || preferKeep2ShareCandidate(item, existing)) byKey.set(key, item);
      } catch (e) {}
    }
    return Array.from(byKey.values());
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

  function isFootFetishClubAttachmentUrl(rawUrl) {
    try {
      const u = normalizedUrlObject(rawUrl, window.location.href);
      const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
      const p = String(u.pathname || '');
      if (host !== 'foot-fetish.club') return false;
      if (!/\/attachments\//i.test(p)) return false;
      return !/(?:twemoji|emoji|smilie|smiley|reaction|avatar|logo|sprite|icon)/i.test(u.toString());
    } catch (e) {
      return false;
    }
  }

  function collectFootFetishClubAttachmentCandidatesFromDocument(doc, pageUrl) {
    const out = [];
    const root = doc || document;
    for (const a of Array.from(root.querySelectorAll('a[href*="/attachments/"]'))) {
      const href = a.getAttribute('href') || '';
      if (!href) continue;
      let url = '';
      try {
        url = normalizedUrlObject(href, pageUrl || window.location.href).toString();
      } catch (e) {
        continue;
      }
      if (!isFootFetishClubAttachmentUrl(url)) continue;
      const label = String(a.getAttribute('title') || a.textContent || '').trim();
      if (/^(?:[\p{Emoji_Presentation}\p{Emoji}\uFE0F\s]+)$/u.test(label)) continue;
      out.push({ url, el: a.ownerDocument === document ? a : null, kind: 'xenforo_attachment', label });
    }
    return uniqueCandidates(out);
  }

  function footFetishClubThreadBaseUrl(rawUrl) {
    try {
      const u = normalizedUrlObject(rawUrl || effectivePageUrl(), window.location.href);
      u.hash = '';
      u.search = '';
      u.pathname = String(u.pathname || '/').replace(/\/page-\d+\/?$/i, '').replace(/\/+$/, '');
      return u.toString();
    } catch (e) {
      return String(rawUrl || effectivePageUrl() || '').replace(/#.*$/, '');
    }
  }

  function footFetishClubPageUrl(baseUrl, page) {
    const base = footFetishClubThreadBaseUrl(baseUrl);
    if (!page || page <= 1) return base;
    return `${base}/page-${page}`;
  }

  function footFetishClubMaxPageFromDocument(doc) {
    let max = 1;
    const root = doc || document;
    for (const a of Array.from(root.querySelectorAll('a[href*="/page-"]'))) {
      try {
        const u = normalizedUrlObject(a.getAttribute('href') || '', window.location.href);
        const m = String(u.pathname || '').match(/\/page-(\d+)\/?$/i);
        if (m && m[1]) max = Math.max(max, parseInt(m[1], 10) || 1);
      } catch (e) {}
    }
    return max;
  }

  async function collectFootFetishClubThreadAttachments(maxPages) {
    const baseUrl = footFetishClubThreadBaseUrl(effectivePageUrl());
    const parser = new DOMParser();
    let pageCount = footFetishClubMaxPageFromDocument(document);
    const limit = Number.isFinite(Number(maxPages)) && Number(maxPages) > 0 ? Number(maxPages) : 500;
    const out = collectFootFetishClubAttachmentCandidatesFromDocument(document, effectivePageUrl());
    const firstLimit = Math.min(pageCount, limit);
    for (let page = 2; page <= firstLimit; page += 1) {
      const pageUrl = footFetishClubPageUrl(baseUrl, page);
      try {
        const resp = await fetch(pageUrl, { credentials: 'include', cache: 'no-store' });
        if (!resp.ok) break;
        const html = await resp.text();
        const doc = parser.parseFromString(html, 'text/html');
        pageCount = Math.max(pageCount, footFetishClubMaxPageFromDocument(doc));
        out.push(...collectFootFetishClubAttachmentCandidatesFromDocument(doc, pageUrl));
      } catch (e) {
        addLog(`Foot-Fetish.Club pagina ${page} scanner fout: ${e && e.message ? e.message : String(e)}`, 'warn');
        break;
      }
    }
    return {
      candidates: uniqueCandidates(out),
      pages: Math.min(pageCount, limit),
      totalPages: pageCount,
    };
  }

  function filenameFromContentDisposition(value) {
    const raw = String(value || '');
    const utf = raw.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf && utf[1]) {
      try { return decodeURIComponent(utf[1].trim().replace(/^"|"$/g, '')); } catch (e) {}
    }
    const ascii = raw.match(/filename="?([^";]+)"?/i);
    return ascii && ascii[1] ? ascii[1].trim() : '';
  }

  function filenameFromFootFetishClubAttachmentUrl(rawUrl, contentType) {
    try {
      const u = normalizedUrlObject(rawUrl, window.location.href);
      const last = decodeURIComponent(String(u.pathname || '').split('/').filter(Boolean).pop() || 'attachment');
      const m = last.match(/^(.+?)(?:\.\d+)?\/?$/);
      let name = (m && m[1] ? m[1] : last)
        .replace(/-jpe?g$/i, '.jpg')
        .replace(/-png$/i, '.png')
        .replace(/-gif$/i, '.gif')
        .replace(/-webp$/i, '.webp')
        .replace(/-mp4$/i, '.mp4');
      if (!/\.(?:jpe?g|png|gif|webp|avif|bmp|mp4|webm|mov)$/i.test(name)) {
        const type = String(contentType || '').split(';')[0].toLowerCase();
        const ext = type === 'image/jpeg' ? '.jpg'
          : type === 'image/png' ? '.png'
          : type === 'image/gif' ? '.gif'
          : type === 'image/webp' ? '.webp'
          : type === 'video/mp4' ? '.mp4'
          : '';
        name += ext;
      }
      return name;
    } catch (e) {
      return 'attachment';
    }
  }

  async function uploadFootFetishClubAttachmentsViaBrowser(candidates, meta, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const items = uniqueCandidates((candidates || []).filter((c) => c && c.url));
    const stats = { total: items.length, imported: 0, duplicates: 0, skipped: 0, errors: 0, error: '' };
    const pageUrl = effectivePageUrl().replace(/#.*$/, '');
    const progressKey = 'ffc-fullscale';
    const updateProgress = (done, isError = false) => {
      try {
        showStatusNotification(
          progressKey,
          `Foot-Fetish.Club fullscale: ${done}/${items.length} verwerkt`,
          isError,
        );
      } catch (e) {}
    };
    updateProgress(0, false);
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      try {
        if (i === 0 || i % 10 === 0) updateProgress(i, false);
        const mediaResp = await fetch(item.url, { credentials: 'include', redirect: 'follow', cache: 'no-store' });
        const contentType = String(mediaResp.headers.get('content-type') || '').split(';')[0].toLowerCase();
        if (!mediaResp.ok || !/^(?:image|video)\//i.test(contentType)) {
          stats.skipped += 1;
          stats.error = `geen media-response: HTTP ${mediaResp.status || 0}, content-type ${contentType || 'leeg'}`;
          addLog(`Foot-Fetish.Club skip: ${stats.error} (${item.url})`, 'warn');
          continue;
        }
        const blob = await mediaResp.blob();
        if (!blob || blob.size <= 0) {
          stats.skipped += 1;
          stats.error = `lege media-response (${contentType || 'zonder content-type'})`;
          addLog(`Foot-Fetish.Club skip: ${stats.error} (${item.url})`, 'warn');
          continue;
        }
        const filename = filenameFromContentDisposition(mediaResp.headers.get('content-disposition'))
          || filenameFromFootFetishClubAttachmentUrl(item.url, contentType);
        const result = await postHubBlob('api/browser-media', blob, {
          sourceUrl: item.url,
          pageUrl,
          filename,
          contentType,
          platform: 'foot-fetish.club',
          channel: meta && meta.channel ? meta.channel : 'Foot-Fetish.Club',
          title: meta && meta.title ? meta.title : document.title || filename,
          force: options.force === true ? '1' : '',
        }, 120000);
        if (result && result.success) {
          if (result.duplicate) stats.duplicates += 1;
          else stats.imported += 1;
        } else {
          stats.errors += 1;
          stats.error = (result && result.error) ? result.error : 'Hub upload gaf geen foutmelding terug';
          addLog(`Foot-Fetish.Club upload fout: ${stats.error} (${item.url})`, 'warn');
        }
      } catch (e) {
        stats.errors += 1;
        stats.error = e && e.message ? e.message : String(e);
        addLog(`Foot-Fetish.Club fullscale fout: ${stats.error} (${item.url})`, 'warn');
      }
    }
    updateProgress(items.length, stats.errors > 0 && !stats.imported && !stats.duplicates);
    if (!stats.error && !stats.imported && !stats.duplicates && stats.skipped > 0) {
      stats.error = `${stats.skipped} items geskipt; geen fullscale image/video response`;
    }
    return {
      success: stats.errors === 0 || stats.imported > 0 || stats.duplicates > 0,
      ...stats,
    };
  }

  function collectBatchCandidates(meta) {
    if (isFootFetishClubThreadPage()) {
      const candidates = collectFootFetishClubAttachmentCandidatesFromDocument(document, effectivePageUrl());
      return { candidates, urls: candidates.map((c) => c.url) };
    }
    if (isFootFetishForumThreadPage()) {
      const candidates = uniqueCandidates(collectFootFetishForumCandidates(2000));
      return { candidates, urls: candidates.map((c) => c.url) };
    }
    if (isVipergirlsThreadPage()) {
      const candidates = uniqueCandidates(collectVipergirlsCandidates(2000));
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
        .webdl-batch-kind-priority { color: #67e8f9; font-weight: 700; }
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
        candidates = sortBatchPreviewCandidates(uniqueCandidates(candidates));
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

        const directToFffAttachmentPageSet = (() => {
          const map = new Map();
          try {
            for (const [thumbUrl, directSet] of thumbLinkToDirectSet.entries()) {
              if (!looksLikeFffAttachmentPage(thumbUrl)) continue;
              for (const directUrl of directSet) {
                if (!map.has(directUrl)) map.set(directUrl, new Set());
                map.get(directUrl).add(thumbUrl);
              }
            }
          } catch (e) {}
          return map;
        })();

        const underLinkDirectSet = (() => {
          const set = new Set();
          try {
            for (const c2 of (Array.isArray(candidates) ? candidates : [])) {
              const kind2 = String((c2 && c2.kind) ? c2.kind : '');
              if (!/_under_link/i.test(kind2)) continue;
              const direct2 = normalizeUrl((c2 && c2.url) ? c2.url : '');
              if (direct2 && looksLikeMediaFileUrl(direct2)) set.add(direct2);
            }
          } catch (e) {}
          return set;
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

        candidates = candidates.filter((c) => {
          try {
            const kind = String((c && c.kind) ? c.kind : '');
            const url = normalizeUrl((c && c.url) ? c.url : '');
            if (!/thumb_link/i.test(kind)) {
              if (/_under_link/i.test(kind) && directToFffAttachmentPageSet.has(url)) return false;
              return true;
            }
            if (looksLikeFffAttachmentPage(url)) return true;
            const mappedSet = thumbLinkToDirectSet.get(url);
            if (mappedSet && mappedSet.size) {
              for (const direct of mappedSet) {
                if (direct && looksLikeMediaFileUrl(direct) && candidateUrlSet.has(direct)) return false;
              }
            }
            const direct = inferDirectMediaUrlFromLink(c && c.el ? c.el : null);
            if (direct && looksLikeMediaFileUrl(direct) && candidateUrlSet.has(direct)) return false;
          } catch (e) {}
          return true;
        });

        const defaultCheckedForCandidate = (c) => {
          try {
            const url = c && c.url ? normalizeUrl(c.url) : '';
            const kind = String((c && c.kind) ? c.kind : '');
            if (!url) return false;
            if (isFootFetishClubAttachmentUrl(url)) return true;
            if (/^xenforo_attachment$/i.test(kind)) return true;
            if (keep2ShareFileId(url)) return true;
            if (/\/\/[^/]*vipr\.im\/th\//i.test(url)) return false;
            const candidateText = String(
              c && c.el && c.el.textContent ? c.el.textContent :
              ''
            ).trim();
            const isLikelyExternalPage = looksLikeExternalMediaPageUrl(url, candidateText);
            if (looksLikeMediaFileUrl(url)) {
              const isFffDirectAttachment = isFootFetishForumDirectAttachmentMediaUrl(url, window.location.href);
              if (isFffDirectAttachment && /_under_link/i.test(kind) && directToFffAttachmentPageSet.has(url)) return false;
              if (/_under_link/i.test(kind) && !isFffDirectAttachment) return false;
              if (underLinkDirectSet.has(url) && !isFffDirectAttachment) return false;
              return true;
            }
            if (/_under_link/i.test(kind)) return false;
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

        const summarizeDefaultSelectionForPreview = () => {
          try {
            let selected = 0;
            let mediaUrls = 0;
            let previewMediaSkipped = 0;
            let wrappers = 0;
            let other = 0;
            for (const c of candidates) {
              const url = c && c.url ? normalizeUrl(c.url) : '';
              const kind = String((c && c.kind) ? c.kind : '');
              const checked = defaultCheckedForCandidate(c);
              if (checked) selected++;
              if (looksLikeMediaFileUrl(url)) {
                mediaUrls++;
                if (!checked && /_under_link/i.test(kind)) previewMediaSkipped++;
                continue;
              }
              if (looksLikeIndirectPageUrl(url) || looksLikeFffAttachmentPage(url) || keep2ShareFileId(url)) wrappers++;
              else other++;
            }
            const parts = [`${selected} geselecteerd`];
            if (mediaUrls) parts.push(`${mediaUrls} media-URLs`);
            if (previewMediaSkipped) parts.push(`${previewMediaSkipped} previews overgeslagen`);
            if (wrappers) parts.push(`${wrappers} full-size/wrapper links`);
            if (other) parts.push(`${other} overige`);
            return parts.join(' · ');
          } catch (e) {
            return '';
          }
        };

        const defaultSelectionNoteForCandidate = (c) => {
          try {
            const url = c && c.url ? normalizeUrl(c.url) : '';
            const kind = String((c && c.kind) ? c.kind : '');
            if (!url || defaultCheckedForCandidate(c)) return '';
            if (looksLikeMediaFileUrl(url) && /_under_link/i.test(kind)) {
              return 'preview/thumbnail; full-size link wordt gebruikt';
            }
            if (/thumb_link/i.test(kind)) {
              const direct = getDirectHintForCandidate(c);
              if (direct) return 'dubbel; directe media staat al in de selectie';
            }
            if (/^text$/i.test(kind)) return 'tekstlink; geen duidelijke media';
            return 'niet standaard geselecteerd';
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
      const previewSummary = summarizeDefaultSelectionForPreview() || summarizeBatchCandidatesForPreview(candidates);
      sub.textContent = `${(meta && meta.platform) ? meta.platform : 'unknown'} | ${(meta && meta.channel) ? meta.channel : 'unknown'} | ${candidates.length} items${previewSummary ? ` (${previewSummary})` : ''}`;
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
        const k2sId = keep2ShareFileId(c.url);
        k.className = k2sId ? 'webdl-batch-kind webdl-batch-kind-priority' : 'webdl-batch-kind';
        const note = defaultSelectionNoteForCandidate(c);
        k.textContent = (k2sId ? `K2S file · ${k2sId}` : (c.kind ? c.kind : '')) + (note ? ` · ${note}` : '');
        if (note) k.style.color = '#fbbf24';
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
        const sourceContexts = {};
        for (const r of selectedRows) {
          try {
            const key = normalizeUrl(r && r.c && r.c.url ? r.c.url : '');
            const hint = getDirectHintForCandidate(r && r.c ? r.c : null);
            if (key && hint && hint !== key) directHints[key] = hint;
            const ctx = r && r.c && r.c.sourceContext && typeof r.c.sourceContext === 'object' ? r.c.sourceContext : null;
            if (key && ctx && ctx.url) sourceContexts[key] = ctx;
          } catch (e) {}
        }
        finish({ urls: selected, directHints, sourceContexts });
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
    fontSize: '13px', minWidth: '240px', maxWidth: '350px',
    height: 'auto', maxHeight: '70vh', boxSizing: 'border-box',
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
    borderBottom: '1px solid #333', color: '#00d4ff', fontSize: '14px',
    display: 'flex', alignItems: 'center', gap: '6px'
  });
  const titleLabel = document.createElement('span');
  titleLabel.textContent = title.textContent;
  const toolbarFullTitle = titleLabel.textContent;
  Object.assign(titleLabel.style, { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  title.textContent = '';
  title.appendChild(titleLabel);
  const smartToggleBtn = document.createElement('button');
  smartToggleBtn.textContent = 'Auto';
  Object.assign(smartToggleBtn.style, { border: '1px solid #155e75', background: '#0e7490', color: '#fff', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', fontSize: '10px' });
  smartToggleBtn.title = 'Auto: toon alleen knoppen die op deze pagina werken';
  const collapseBtn = document.createElement('button');
  collapseBtn.textContent = '−';
  Object.assign(collapseBtn.style, { border: '1px solid #334155', background: '#111827', color: '#fff', borderRadius: '4px', padding: '2px 7px', cursor: 'pointer', fontSize: '12px', lineHeight: '14px' });
  collapseBtn.title = 'Toolbar in-/uitklappen';
  title.appendChild(smartToggleBtn);
  title.appendChild(collapseBtn);
  smartToggleBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  collapseBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  toolbar.appendChild(title);

  let toolbarCollapsed = false;
  let smartButtons = true;

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

  function setButtonAvailable(btn, ok) {
    if (!btn) return;
    const available = !!ok;
    try { btn.disabled = !available; } catch (e) {}
    try { btn.style.opacity = available ? '1' : '0.45'; } catch (e) {}
    try { btn.style.cursor = available ? 'pointer' : 'not-allowed'; } catch (e) {}
    try { btn.style.display = smartButtons && !available ? 'none' : ''; } catch (e) {}
  }

  function hasVisibleVideoElement() {
    try {
      return Array.from(document.querySelectorAll('video')).some((v) => {
        const r = v.getBoundingClientRect ? v.getBoundingClientRect() : null;
        return r && r.width > 80 && r.height > 60 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
      });
    } catch (e) {
      return false;
    }
  }

  function hasUsableLinksOnPage(meta) {
    try {
      if (meta && meta.platform && meta.platform !== 'unknown') return true;
      return collectBatchUrls(meta || scrapeMetadata()).length > 0;
    } catch (e) {
      return false;
    }
  }

  function updateMetaDisplay() {
    const m = scrapeMetadata();
    metaInfo.innerHTML = `<span style="color:#00d4ff">${m.platform}</span> | ${m.channel}<br><span style="color:#ccc">${m.title.substring(0, 60)}${m.title.length > 60 ? '...' : ''}</span>`;
    if (m.url) checkUrlStatus(m.url);
    try {
      const redgifsHere = isRedgifsUrl(window.location.href) || collectRedgifsUrls(1).length > 0;
      const redgifsFeedHere = isRedgifsExpandableUrl(window.location.href) || collectRedgifsUrls(1).some((u) => isRedgifsExpandableUrl(u));
      const youtubeHere = m.platform === 'youtube';
      const xHere = m.platform === 'twitter' && isDownloadableTwitterUrl(m.url);
      const xTargets = xHere ? xTwitterTargetOptions(m) : [];
      const xPostHere = xTargets.some((opt) => opt.mode === 'post');
      const xProfileHere = xTargets.some((opt) => opt.mode === 'profile');
      const redditHere = m.platform === 'reddit' && isRedditBatchSeedUrl(m.url);
      const redditTargets = redditHere ? redditTargetOptions(m) : [];
      const redditPostHere = redditTargets.some((opt) => opt.mode === 'post');
      const redditUserHere = redditTargets.some((opt) => opt.mode === 'user');
      const redditSubredditHere = redditTargets.some((opt) => opt.mode === 'subreddit');
      const threadHere = isFootFetishForumThreadPage() || isFootFetishForumForumPage() || isFootFetishClubThreadPage() || isVipergirlsThreadPage() || isVipergirlsForumPage();
      const k2sHere = isVipergirlsThreadPage();
      const visibleMediaHere = collectVisibleMediaUrls(1).length > 0;
      const batchHere = hasUsableLinksOnPage(m);

      setButtonAvailable(downloadBtn, m.platform !== 'unknown' || batchHere || redgifsHere);
      try { redditBtnContainer.style.display = smartButtons && !redditHere ? 'none' : 'flex'; } catch (e) {}
      try { xBtnContainer.style.display = smartButtons && !xHere ? 'none' : 'flex'; } catch (e) {}
      setButtonAvailable(batchDownloadBtn, batchHere);
      setButtonAvailable(forceBatchDownloadBtn, batchHere);
      setButtonAvailable(mediaDownloadBtn, visibleMediaHere);
      setButtonAvailable(redditPostBtn, redditPostHere);
      setButtonAvailable(redditUserBtn, redditUserHere);
      setButtonAvailable(redditSubredditBtn, redditSubredditHere);
      setButtonAvailable(xPostBtn, xPostHere);
      setButtonAvailable(xProfileBtn, xProfileHere);
      setButtonAvailable(ytShortsBtn, youtubeHere);
      setButtonAvailable(ytVideosBtn, youtubeHere);
      setButtonAvailable(openAllBtn, batchHere);
      setButtonAvailable(vdhHintBtn, m.platform !== 'unknown');
      setButtonAvailable(recStartBtn, hasVisibleVideoElement());
      setButtonAvailable(recStopBtn, isRecording === true);

      if (threadBatchDownloadBtn) {
        setButtonAvailable(threadBatchDownloadBtn, threadHere);
      }
      if (keep2ShareBatchBtn) {
        setButtonAvailable(keep2ShareBatchBtn, k2sHere);
        try { keep2ShareBatchBtn.title = 'Klik: Keep2Share-links op deze pagina. Shift/Alt: hele thread. Cmd/Ctrl: limieten.'; } catch (e) {}
      }
      if (redgifsClipBtn) {
        setButtonAvailable(redgifsClipBtn, redgifsHere);
        try { redgifsClipBtn.title = 'Redgifs clip of Redgifs-links op deze pagina naar de hub sturen.'; } catch (e) {}
      }
      if (redgifsFeedBtn) {
        setButtonAvailable(redgifsFeedBtn, redgifsFeedHere);
        try { redgifsFeedBtn.title = 'Redgifs profiel/search/collection downloaden. Cmd/Ctrl-klik voor limiet.'; } catch (e) {}
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

  const redditBtnContainer = document.createElement('div');
  Object.assign(redditBtnContainer.style, { display: 'flex', gap: '6px', marginBottom: '8px' });
  toolbar.appendChild(redditBtnContainer);

  const xBtnContainer = document.createElement('div');
  Object.assign(xBtnContainer.style, { display: 'flex', gap: '6px', marginBottom: '8px' });
  toolbar.appendChild(xBtnContainer);

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

  function makeCompactBtnIn(container, text, bg) {
    const btn = makeBtnIn(container, text, bg);
    Object.assign(btn.style, {
      minWidth: '0',
      padding: '7px 8px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    return btn;
  }

  const screenshotBtn = makeBtn('📷 Screenshot', '#4CAF50');
  const downloadBtn = makeBtn('⬇️ Huidige media', '#2196F3');
  const batchDownloadBtn = makeBtn('⏬ Pagina scannen', '#1565C0');
  const dashboardBtn = makeBtn('📊 Dashboard', '#0f3460');
  const mediaDownloadBtn = makeBtnIn(extraBtnContainer, '🖼 Media zichtbaar', '#6d28d9');
  const forceBatchDownloadBtn = makeBtnIn(extraBtnContainer, '🔥 Forceer opnieuw', '#b91c1c');
  const threadBatchDownloadBtn = makeBtnIn(extraBtnContainer, '🧵 Hele thread', '#0ea5e9');
  const keep2ShareBatchBtn = makeBtnIn(extraBtnContainer, '🔐 K2S links', '#0891b2');
  const vdhHintBtn = makeBtnIn(extraBtnContainer, '🧩 VDH kanaal', '#2e7d32');
  const redditPostBtn = makeCompactBtnIn(redditBtnContainer, 'Post', '#ff4500');
  const redditUserBtn = makeCompactBtnIn(redditBtnContainer, 'Gebruiker', '#d9480f');
  const redditSubredditBtn = makeCompactBtnIn(redditBtnContainer, 'Kanaal', '#c2410c');
  const xPostBtn = makeCompactBtnIn(xBtnContainer, 'X Post', '#111827');
  const xProfileBtn = makeCompactBtnIn(xBtnContainer, 'X Profiel', '#0f766e');
  const redgifsClipBtn = makeBtnIn(extraBtnContainer, 'Redgifs clip', '#dc2626');
  const redgifsFeedBtn = makeBtnIn(extraBtnContainer, 'Redgifs feed', '#991b1b');
  const ytShortsBtn = makeBtnIn(extraBtnContainer, 'YT shorts', '#7c3aed');
  const ytVideosBtn = makeBtnIn(extraBtnContainer, 'YT videos', '#5b21b6');
  const openAllBtn = makeBtnIn(extraBtnContainer, 'Open links', '#03A9F4');
  try {
    screenshotBtn.title = 'Maak een screenshot van deze pagina';
    downloadBtn.title = 'Download de huidige video, foto of geselecteerde media';
    batchDownloadBtn.title = 'Scan alleen deze pagina en download gevonden links/media';
    dashboardBtn.title = 'Open WEBDL dashboard';
    mediaDownloadBtn.title = 'Download direct zichtbare video/foto-bronnen op deze pagina';
    forceBatchDownloadBtn.title = 'Queue dezelfde gevonden links opnieuw, ook als ze al bestaan';
    threadBatchDownloadBtn.title = 'Scan de hele forumthread over alle pagina\'s';
    keep2ShareBatchBtn.title = 'ViperGirls: download Keep2Share-links. Klik = huidige pagina, Shift/Alt = hele thread, Cmd/Ctrl = limieten.';
    vdhHintBtn.title = 'Geef Video DownloadHelper een kanaal/context hint';
    redditPostBtn.title = 'Reddit: download alleen deze post via BDFR';
    redditUserBtn.title = 'Reddit: download alles van deze gebruiker via BDFR';
    redditSubredditBtn.title = 'Reddit: download alles van dit kanaal/subreddit via BDFR';
    xPostBtn.title = 'X/Twitter: download deze post via gallery-dl';
    xProfileBtn.title = 'X/Twitter: download dit profiel via gallery-dl';
    redgifsClipBtn.title = 'Download deze Redgifs clip of Redgifs links op de pagina';
    redgifsFeedBtn.title = 'Download/expand Redgifs profiel, collectie, niche of zoekpagina';
    ytShortsBtn.title = 'Download YouTube Shorts van dit kanaal';
    ytVideosBtn.title = 'Download YouTube videos van dit kanaal';
    openAllBtn.title = 'Open alle gevonden links in tabs';
  } catch (e) {}

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

  function toolbarPanels() {
    return [metaInfo, btnContainer, extraBtnContainer, recContainer, statusBar, notifArea, logContainer, logToggle];
  }

  function applyToolbarCollapsed() {
    for (const el of toolbarPanels()) {
      try { el.style.display = toolbarCollapsed ? 'none' : ''; } catch (e) {}
    }
    try {
      toolbar.style.minWidth = toolbarCollapsed ? '150px' : '240px';
      toolbar.style.maxWidth = toolbarCollapsed ? '220px' : '350px';
      toolbar.style.padding = toolbarCollapsed ? '8px 10px' : '12px';
      collapseBtn.textContent = toolbarCollapsed ? '+' : '−';
      title.style.marginBottom = toolbarCollapsed ? '0' : '8px';
      titleLabel.textContent = toolbarCollapsed ? '⠿ WEBDL' : toolbarFullTitle;
    } catch (e) {}
    if (!toolbarCollapsed) updateMetaDisplay();
  }

  function applySmartButtonMode() {
    try {
      smartToggleBtn.dataset.active = smartButtons ? '1' : '0';
      smartToggleBtn.textContent = smartButtons ? 'Auto' : 'Alles';
      smartToggleBtn.style.background = smartButtons ? '#0e7490' : '#374151';
      smartToggleBtn.style.borderColor = smartButtons ? '#155e75' : '#4b5563';
      smartToggleBtn.title = smartButtons ? 'Auto actief: alleen werkende knoppen zichtbaar' : 'Alles actief: ook niet-passende knoppen tonen';
    } catch (e) {}
    updateMetaDisplay();
  }

  collapseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toolbarCollapsed = !toolbarCollapsed;
    applyToolbarCollapsed();
  });

  smartToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    smartButtons = !smartButtons;
    applySmartButtonMode();
  });

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

  const statusNotifications = new Map();
  function showStatusNotification(key, msg, isError = false) {
    const id = String(key || 'status');
    let n = statusNotifications.get(id);
    if (!n || !n.isConnected) {
      n = document.createElement('div');
      n.dataset.webdlStatusNotification = id;
      Object.assign(n.style, {
        padding: '6px 8px',
        borderRadius: '4px',
        marginBottom: '4px',
        fontSize: '11px',
        wordBreak: 'break-word',
        backgroundColor: isError ? '#c0392b' : '#2563eb',
        color: 'white',
        fontWeight: '700'
      });
      notifArea.appendChild(n);
      statusNotifications.set(id, n);
    }
    n.textContent = msg;
    n.style.backgroundColor = isError ? '#c0392b' : '#2563eb';
    try {
      if (/\b(?:klaar|fout|geannuleerd|mislukt)\b/i.test(String(msg || ''))) addLog(msg, isError ? 'error' : 'info');
    } catch (e) {}
    return n;
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
      if (!isFootFetishForumThreadPage() && !isFootFetishClubThreadPage()) return;
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

      const abs = normalizedUrlObject(candidate, window.location.href);
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

  async function postHubJson(endpoint, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
    const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
    let lastError = null;
    for (const base of getHubCandidates()) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || REQUEST_TIMEOUT_MS));
      try {
        const resp = await fetch(`${base}/${cleanEndpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}),
          signal: controller.signal
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          lastError = (data && data.error) ? data.error : `Hub fout: ${resp.status}`;
          continue;
        }
        return data;
      } catch (e) {
        lastError = e && e.message ? e.message : String(e);
      } finally {
        clearTimeout(t);
      }
    }
    return { success: false, error: lastError || 'Hub niet bereikbaar' };
  }

  async function postHubBlob(endpoint, blob, params, timeoutMs = 120000) {
    const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
    const query = new URLSearchParams();
    const data = params && typeof params === 'object' ? params : {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null || value === '') continue;
      query.set(key, String(value));
    }
    let lastError = null;
    for (const base of getHubCandidates()) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 120000));
      try {
        const url = `${base}/${cleanEndpoint}${query.toString() ? `?${query.toString()}` : ''}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': blob && blob.type ? blob.type : 'application/octet-stream' },
          body: blob,
          signal: controller.signal,
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          lastError = json && json.error ? json.error : `Hub fout: ${resp.status}`;
          continue;
        }
        return json;
      } catch (e) {
        lastError = e && e.message ? e.message : String(e);
      } finally {
        clearTimeout(t);
      }
    }
    return { success: false, error: lastError || 'Hub niet bereikbaar' };
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

  async function getHubJson(endpoint, timeoutMs = REQUEST_TIMEOUT_MS) {
    const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
    let lastError = null;
    for (const base of getHubCandidates()) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || REQUEST_TIMEOUT_MS));
      try {
        const resp = await fetch(`${base}/${cleanEndpoint}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
          cache: 'no-store'
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          lastError = (data && data.error) ? data.error : `Hub fout: ${resp.status}`;
          continue;
        }
        return data;
      } catch (e) {
        lastError = e && e.message ? e.message : String(e);
      } finally {
        clearTimeout(t);
      }
    }
    return { success: false, error: lastError || 'Hub niet bereikbaar' };
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

  function normalizeHubSingleResult(data, url) {
    const raw = data && typeof data === 'object' ? data : {};
    const simpleServerDownloadId = raw.simple_server_download_id || raw.simpleServerDownloadId || null;
    const hubJobId = raw.id || raw.jobId || null;
    const expandedId = raw.groupId || raw.group_id || null;
    return {
      success: true,
      hub: true,
      raw,
      url,
      downloadId: simpleServerDownloadId || hubJobId || expandedId || null,
      hubJobId,
      simpleServerDownloadId,
      expanded: !!raw.expanded,
      total: Number.isFinite(Number(raw.total)) ? Number(raw.total) : undefined,
      queued: Number.isFinite(Number(raw.queued)) ? Number(raw.queued) : undefined,
      duplicates: Number.isFinite(Number(raw.duplicates)) ? Number(raw.duplicates) : undefined,
      errors: Number.isFinite(Number(raw.errors)) ? Number(raw.errors) : undefined,
      skipped: Number.isFinite(Number(raw.skipped)) ? Number(raw.skipped) : undefined,
      paused: Number.isFinite(Number(raw.paused)) ? Number(raw.paused) : undefined,
      duplicate: !!raw.duplicate,
      delegated: !!raw.delegated,
      status: raw.status || null,
      title: raw.title || raw.playlistName || '',
      message: raw.expanded ? 'Expanded in WebDL-Hub' : 'Added to WebDL-Hub',
    };
  }

  function normalizeHubBatchResult(data) {
    const raw = data && typeof data === 'object' ? data : {};
    const jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
    return {
      success: true,
      hub: true,
      raw,
      total: Number(raw.total) || jobs.length,
      queued: Number(raw.queued) || 0,
      duplicates: Number(raw.duplicates) || 0,
      errors: Number(raw.errors) || 0,
      skipped: Number(raw.skipped) || 0,
      jobs,
      failed: Array.isArray(raw.failed) ? raw.failed : [],
      downloads: jobs.map((job) => ({
        downloadId: job && (job.simple_server_download_id || job.id) || null,
        hubJobId: job && job.id || null,
        url: job && job.url || '',
        duplicate: !!(job && job.duplicate),
        status: job && job.status || null,
        title: job && job.title || job && job.video_title || '',
      })),
    };
  }

  function shouldPollNativeDownload(result) {
    if (!result || !result.downloadId) return false;
    return !result.hub || !!result.simpleServerDownloadId;
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
    const payload = {
      url,
      ...(meta && meta.adapter ? { adapter: meta.adapter } : {}),
      priority: 10,
      options: {
        ...(meta && typeof meta === 'object' ? meta : {}),
        queued_from: 'firefox-toolbar',
      },
    };
    const backgroundPayload = { url, metadata: meta };
    const viaBg = await sendBackgroundAction('queueDownload', backgroundPayload, 12000);
    if (viaBg && viaBg.success) return viaBg;
    if (viaBg && /timeout/i.test(String(viaBg.error || ''))) return viaBg;
    const viaHub = await postHubJson('api/jobs', payload, 12000);
    if (viaHub && !viaHub.error) return normalizeHubSingleResult(viaHub, url);
    return viaBg && viaBg.error ? viaBg : viaHub;
  }

  async function queueDownloadRequestWithOverride(meta, urlOverride) {
    const target = String(urlOverride || '').trim();
    if (!target) return queueDownloadRequest(meta);
    const backgroundPayload = { url: target, metadata: meta };
    const hubPayload = {
      url: target,
      ...(meta && meta.adapter ? { adapter: meta.adapter } : {}),
      priority: 10,
      options: {
        ...(meta && typeof meta === 'object' ? meta : {}),
        queued_from: 'firefox-toolbar',
      },
    };
    const viaBg = await sendBackgroundAction('queueDownload', backgroundPayload, 12000);
    if (viaBg && viaBg.success) return viaBg;
    if (viaBg && /timeout/i.test(String(viaBg.error || ''))) return viaBg;
    const viaHub = await postHubJson('api/jobs', hubPayload, 12000);
    if (viaHub && !viaHub.error) return normalizeHubSingleResult(viaHub, target);
    return viaBg && viaBg.error ? viaBg : viaHub;
  }

  async function queueBatchDownloadRequest(urls, meta, options) {
    const opt = options && typeof options === 'object' ? options : {};
    const payloadMeta = meta && typeof meta === 'object' ? { ...meta } : {};
    if (opt.directHints && typeof opt.directHints === 'object' && Object.keys(opt.directHints).length) {
      payloadMeta.webdl_direct_hints = { ...opt.directHints };
    }
    if (opt.sourceContexts && typeof opt.sourceContexts === 'object' && Object.keys(opt.sourceContexts).length) {
      payloadMeta.webdl_source_contexts = { ...opt.sourceContexts };
    }
    const payload = { urls, metadata: payloadMeta };
    if (opt.force === true) payload.force = true;
    const viaBg = await sendBackgroundAction('queueBatchDownload', payload, 20000);
    if (viaBg && viaBg.success) return viaBg;
    if (viaBg && /timeout/i.test(String(viaBg.error || ''))) return viaBg;
    const viaHub = await postHubJson('api/jobs/batch', {
      urls,
      metadata: payloadMeta,
      options: { queued_from: 'firefox-toolbar' },
      force: opt.force === true,
      priority: 10,
    }, 20000);
    if (viaHub && !viaHub.error) return normalizeHubBatchResult(viaHub);
    return viaBg && viaBg.error ? viaBg : viaHub;
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
        updateRecUI(!!data.isRecording, data.activeRecordingUrls, data.activeRecordingKeys);
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

  async function ensureHubReachable(showError = false) {
    try {
      const health = await getHubJson('api/health', 5000);
      if (health && health.ok === true) return true;
      if (health && health.success !== false && health.db === 'up') return true;
      throw new Error((health && health.error) ? health.error : 'Hub health endpoint niet bereikbaar');
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (showError) {
        showNotification(`WebDL-Hub niet bereikbaar: ${msg}`, true);
        addLog(`Hub-check mislukt: ${msg}`, 'error');
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
  // DOWNLOAD VIDEO (queue via WebDL-Hub)
  // ========================
  downloadBtn.addEventListener('click', async function() {
    if (!(await ensureHubReachable(true))) return;
    const meta = scrapeMetadata();

    if (meta.platform === 'reddit' && isRedditBatchSeedUrl(meta.url)) {
      await runRedditAllBatchFromCurrentPage(downloadBtn, 'post', null);
      return;
    }

    if (isFootFetishForumThreadPage() || isFootFetishClubThreadPage() || isVipergirlsThreadPage()) {
      const picked = String(lastPickedMediaUrl || '').trim();
      const fresh = picked && (Date.now() - (lastPickedMediaAt || 0)) < (12 * 60 * 60 * 1000);
      if (!fresh) {
        showNotification('Klik eerst op een foto/video/attachment en druk dan Download (of gebruik ⏬ Batch / 🖼 Media).', true);
        return;
      }
      addLog(`Download selected media: ${picked}`);
      try {
        if (isFootFetishClubThreadPage()) {
          const clubMeta = {
            ...meta,
            adapter: 'browser-media',
            platform: 'foot-fetish.club',
            contextUrl: effectivePageUrl().replace(/#.*$/, ''),
          };
          const result = await uploadFootFetishClubAttachmentsViaBrowser(
            [{ url: picked, el: null, kind: 'xenforo_attachment' }],
            clubMeta,
            { force: false },
          );
          if (result && result.success) {
            showNotification(`Foot-Fetish.Club: ${result.imported} nieuw, ${result.duplicates} bestaand, ${result.skipped} geskipt, ${result.errors} fout`, result.errors > 0);
            addLog(`Foot-Fetish.Club selected import: ${result.imported} nieuw, ${result.duplicates} bestaand, ${result.skipped} geskipt, ${result.errors} fout`);
          } else {
            showNotification(`Download fout: ${(result && result.error) ? result.error : 'unknown'}`, true);
          }
          return;
        }
        const result = await queueDownloadRequestWithOverride(meta, picked);
        if (result && result.success) {
          const id = result.downloadId;
          const title = result.title || meta.title;
          const status = (result && typeof result.status === 'string') ? result.status : '';
          if (result.duplicate) {
            const statusHint = status ? ` (${status})` : '';
            showNotification(`Bestaat al: #${id}${statusHint} — ${title}`);
            addLog(`Bestaat al #${id}${statusHint}`);
            if (shouldPollNativeDownload(result) && status && status !== 'completed' && status !== 'error' && status !== 'cancelled') {
              pollDownload(id);
            }
          } else {
            showNotification(`Download #${id} gestart: ${title}`);
            addLog(`Download #${id} gestart`);
            if (shouldPollNativeDownload(result)) pollDownload(id);
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
          showNotification(`AZNudeFeet: ${formatBatchStats(stats)}`);
          addLog(`AZNudeFeet gestart: ${formatBatchStats(stats)}`);
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
            if (shouldPollNativeDownload(result)) pollDownload(id);
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
          if (shouldPollNativeDownload(result) && status && status !== 'completed' && status !== 'error' && status !== 'cancelled') {
            pollDownload(id);
          }
        } else {
          showNotification(`Download #${id} gestart: ${title}`);
          addLog(`Download #${id} gestart`);
          if (shouldPollNativeDownload(result)) pollDownload(id);
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
    if (isFootFetishClubThreadPage()) {
      return collectFootFetishClubAttachmentCandidatesFromDocument(document, effectivePageUrl()).map((c) => c.url);
    }
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
    if (!rows.length && result && (result.queued != null || result.duplicates != null || result.errors != null || result.total != null)) {
      const queued = Number(result.queued) || 0;
      const duplicates = Number(result.duplicates) || 0;
      const errors = Number(result.errors) || 0;
      const total = Number(result.total) || queued + duplicates + errors;
      const skipped = Math.max(0, total - queued - duplicates - errors);
      return { total, queued, duplicates, errors, skipped, paused: Number(result.paused) || 0 };
    }
    if (result && result.expanded) {
      return {
        total: Number(result.total) || 0,
        queued: Number(result.queued) || 0,
        duplicates: Number(result.duplicates) || 0,
        errors: Number(result.errors) || 0,
        skipped: Number(result.skipped) || 0,
        paused: Number(result.paused) || 0
      };
    }
    if (!rows.length && result && Array.isArray(result.jobs)) {
      const queued = Number(result.queued) || result.jobs.length;
      const duplicates = Number(result.duplicates) || 0;
      const errors = Number(result.errors) || 0;
      const total = Number(result.total) || result.jobs.length;
      return {
        total,
        queued,
        duplicates,
        errors,
        skipped: Math.max(0, total - queued - duplicates - errors),
        paused: Number(result.paused) || 0
      };
    }
    const duplicates = rows.filter((d) => !!(d && d.duplicate)).length;
    const queued = Math.max(0, rows.length - duplicates);
    return { total: rows.length, queued, duplicates, errors: 0, skipped: 0 };
  }

  function formatBatchStats(stats) {
    const extra = [];
    if (stats && Number(stats.errors || 0) > 0) extra.push(`${Number(stats.errors) || 0} fout`);
    if (stats && Number(stats.skipped || 0) > 0) extra.push(`${Number(stats.skipped) || 0} overgeslagen`);
    if (stats && Number(stats.paused || 0) > 0) extra.push(`${Number(stats.paused) || 0} gepauzeerd`);
    return `${Number(stats && stats.queued) || 0} nieuw, ${Number(stats && stats.duplicates) || 0} bestaand${extra.length ? `, ${extra.join(', ')}` : ''} (${Number(stats && stats.total) || 0} totaal)`;
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

  function isRedgifsUrl(rawUrl) {
    try {
      const u = new URL(String(rawUrl || ''), window.location.href);
      const host = String(u.hostname || '').replace(/^www\./, '').toLowerCase();
      return host === 'redgifs.com'
        || host.endsWith('.redgifs.com')
        || host === 'gifdeliverynetwork.com'
        || host.endsWith('.gifdeliverynetwork.com')
        || host === 'gfycat.com'
        || host.endsWith('.gfycat.com');
    } catch (e) {
      return false;
    }
  }

  function isRedgifsExpandableUrl(rawUrl) {
    try {
      const u = new URL(String(rawUrl || ''), window.location.href);
      if (!isRedgifsUrl(u.toString())) return false;
      const p = String(u.pathname || '').replace(/\/+$/, '').toLowerCase();
      return /^\/users\/[^/]+$/.test(p)
        || /^\/users\/[^/]+\/collections\/[^/]+$/.test(p)
        || /^\/niches\/[^/]+$/.test(p)
        || /^\/(?:gifs\/[^/]+|search(?:\/gifs)?|browse)$/.test(p);
    } catch (e) {
      return false;
    }
  }

  function isRedgifsSingleClipUrl(rawUrl) {
    try {
      const u = new URL(String(rawUrl || ''), window.location.href);
      if (!isRedgifsUrl(u.toString())) return false;
      const p = String(u.pathname || '').replace(/\/+$/, '');
      return /^\/(?:watch|ifr)\/[A-Za-z0-9]+$/i.test(p)
        || /^\/[A-Za-z0-9]+$/i.test(p)
        || /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i.test(u.pathname);
    } catch (e) {
      return false;
    }
  }

  function collectRedgifsUrls(maxItems = 200) {
    const out = [];
    const seen = new Set();
    const push = (raw) => {
      try {
        const value = String(raw || '').trim();
        if (!value || /^(javascript:|mailto:|data:|blob:)/i.test(value)) return;
        const u = new URL(value, window.location.href);
        u.hash = '';
        const final = u.toString();
        if (!isRedgifsUrl(final) || seen.has(final)) return;
        seen.add(final);
        out.push(final);
      } catch (e) {}
    };

    push(window.location.href);
    for (const el of Array.from(document.querySelectorAll('a[href], video[src], source[src]'))) {
      try {
        push(el.getAttribute('href') || el.currentSrc || el.src || el.getAttribute('src'));
        if (out.length >= maxItems) break;
      } catch (e) {}
    }
    return out.slice(0, maxItems);
  }

  async function runRedgifsClipDownload(triggerBtn) {
    if (!(await ensureHubReachable(true))) return;
    const meta = scrapeMetadata();
    const original = triggerBtn ? triggerBtn.textContent : 'Redgifs clip';
    if (triggerBtn) {
      triggerBtn.textContent = 'RG...';
      triggerBtn.style.opacity = '0.6';
    }
    try {
      if (isRedgifsSingleClipUrl(meta.url) || isRedgifsExpandableUrl(meta.url)) {
        const result = await queueDownloadRequest(meta);
        if (result && result.success) {
          showNotification(`Redgifs: ${result.duplicate ? 'bestaat al' : 'gestart'} #${result.downloadId || result.hubJobId || ''}`);
          addLog(`Redgifs clip gestart: ${result.downloadId || result.hubJobId || meta.url}`);
        } else {
          showNotification(`Redgifs fout: ${(result && result.error) ? result.error : 'unknown'}`, true);
          addLog(`Redgifs fout: ${(result && result.error) ? result.error : 'unknown'}`, 'error');
        }
        return;
      }

      const urls = collectRedgifsUrls(200).filter((u) => isRedgifsSingleClipUrl(u));
      if (!urls.length) {
        showNotification('Geen Redgifs clips gevonden op deze pagina', true);
        return;
      }
      const ok = window.confirm(`Redgifs clips downloaden: ${urls.length} items?`);
      if (!ok) return;
      const result = await queueBatchDownloadRequest(urls, { ...meta, platform: 'redgifs' });
      if (result && result.success) {
        const stats = summarizeBatchResult(result);
        showNotification(`Redgifs clips: ${formatBatchStats(stats)}`);
        addLog(`Redgifs clips gestart: ${formatBatchStats(stats)}`);
      } else {
        showNotification(`Redgifs fout: ${(result && result.error) ? result.error : 'unknown'}`, true);
      }
    } catch (e) {
      showNotification(`Redgifs fout: ${e && e.message ? e.message : String(e)}`, true);
      addLog(`Redgifs fout: ${e && e.message ? e.message : String(e)}`, 'error');
    } finally {
      if (triggerBtn) {
        triggerBtn.textContent = original;
        triggerBtn.style.opacity = '1';
      }
    }
  }

  async function runRedgifsFeedDownload(triggerBtn, clickEvent) {
    if (!(await ensureHubReachable(true))) return;
    const meta = scrapeMetadata();
    const original = triggerBtn ? triggerBtn.textContent : 'Redgifs profiel';
    if (triggerBtn) {
      triggerBtn.textContent = 'Redgifs...';
      triggerBtn.style.opacity = '0.6';
    }
    try {
      const wantsSettings = !!(clickEvent && (clickEvent.metaKey || clickEvent.ctrlKey));
      if (wantsSettings) {
        const input = window.prompt('Redgifs feed: max clips verzamelen? Leeg/0 = standaard', '');
        if (input === null) return;
        const n = parseInt(String(input || '').trim(), 10);
        if (Number.isFinite(n) && n > 0) meta.limit = Math.max(1, Math.min(5000, n));
      }

      if (isRedgifsExpandableUrl(meta.url)) {
        const result = await queueDownloadRequest(meta);
        if (result && result.success) {
          const stats = summarizeBatchResult(result);
          const suffix = result.expanded ? `: ${formatBatchStats(stats)}` : ` gestart #${result.downloadId || result.hubJobId || ''}`;
          showNotification(`Redgifs feed${suffix}`);
          addLog(`Redgifs feed gestart${suffix}`);
        } else {
          showNotification(`Redgifs feed fout: ${(result && result.error) ? result.error : 'unknown'}`, true);
        }
        return;
      }

      const urls = collectRedgifsUrls(500);
      if (!urls.length) {
        showNotification('Geen Redgifs feed/profiel of links gevonden', true);
        return;
      }
      const selected = urls.filter((u) => isRedgifsSingleClipUrl(u));
      if (!selected.length) {
        showNotification('Geen downloadbare Redgifs clip-links gevonden', true);
        return;
      }
      const ok = window.confirm(`Redgifs links op deze pagina downloaden: ${selected.length} items?`);
      if (!ok) return;
      const result = await queueBatchDownloadRequest(selected, { ...meta, platform: 'redgifs' });
      if (result && result.success) {
        const stats = summarizeBatchResult(result);
        showNotification(`Redgifs links: ${formatBatchStats(stats)}`);
        addLog(`Redgifs links gestart: ${formatBatchStats(stats)}`);
      } else {
        showNotification(`Redgifs links fout: ${(result && result.error) ? result.error : 'unknown'}`, true);
      }
    } catch (e) {
      showNotification(`Redgifs feed fout: ${e && e.message ? e.message : String(e)}`, true);
      addLog(`Redgifs feed fout: ${e && e.message ? e.message : String(e)}`, 'error');
    } finally {
      if (triggerBtn) {
        triggerBtn.textContent = original;
        triggerBtn.style.opacity = '1';
      }
    }
  }

  async function runRedditAllBatchFromCurrentPage(triggerBtn, targetMode, clickEvent) {
    if (!(await ensureHubReachable(true))) return;

    const meta = scrapeMetadata();
    if (meta.platform !== 'reddit' || !isRedditBatchSeedUrl(meta.url)) {
      showNotification('Gebruik deze knop op een Reddit post, subreddit of user pagina', true);
      return;
    }

    const target = targetMode ? redditTargetForMode(meta, targetMode) : chooseRedditTarget(meta);
    if (!target || !target.url) return;
    const wantsLimitPrompt = !!(clickEvent && (clickEvent.metaKey || clickEvent.ctrlKey || clickEvent.altKey || clickEvent.shiftKey));
    if (target.limitable && typeof target.limit === 'undefined' && wantsLimitPrompt) {
      const limit = promptRedditBdfrLimit(0);
      if (limit === null) return;
      target.limit = limit;
    }

    const redditMeta = {
      ...meta,
      url: target.url,
      reddit_target_mode: target.mode,
      reddit_target_label: target.label,
      queued_from: 'firefox-toolbar-reddit-options',
    };
    if (target.limitable && Number.isFinite(Number(target.limit)) && Number(target.limit) > 0) {
      redditMeta.limit = Number(target.limit);
      redditMeta.bdfr_limit = Number(target.limit);
      redditMeta.reddit_limit = Number(target.limit);
    }

    const original = triggerBtn ? triggerBtn.textContent : 'Reddit';
    if (triggerBtn) {
      triggerBtn.textContent = '⏳ Reddit...';
      triggerBtn.style.opacity = '0.6';
    }

    try {
      addLog(`Reddit ${target.mode}: ${target.url}${target.limitable ? ` limiet=${target.limit || 'alles'}` : ''}`);
      const result = await queueDownloadRequestWithOverride(redditMeta, target.url);
      if (result && result.success) {
        const id = result.downloadId || result.hubJobId || '';
        showNotification(`Reddit ${target.label}: ${result.duplicate ? 'bestaat al' : 'gestart'}${id ? ` #${id}` : ''}`);
        addLog(`Reddit ${target.label} gestart: ${target.url}${id ? ` #${id}` : ''}`);
      } else {
        const err = (result && result.error) ? result.error : 'unknown';
        showNotification(`Reddit fout: ${err}`, true);
        addLog(`Reddit fout: ${err}`, 'error');
      }
    } catch (e) {
      showNotification(`Reddit fout: ${e.message}`, true);
      addLog(`Reddit fout: ${e.message}`, 'error');
    } finally {
      if (triggerBtn) {
        triggerBtn.textContent = original;
        triggerBtn.style.opacity = '1';
      }
    }
  }

  async function runXDownloadFromCurrentPage(triggerBtn, targetMode) {
    if (!(await ensureHubReachable(true))) return;

    const meta = scrapeMetadata();
    if (meta.platform !== 'twitter' || !isDownloadableTwitterUrl(meta.url)) {
      showNotification('Gebruik deze knop op een X/Twitter post of profiel', true);
      return;
    }

    const target = xTwitterTargetForMode(meta, targetMode);
    if (!target || !target.url) {
      showNotification('Geen passende X/Twitter downloaddoel gevonden', true);
      return;
    }

    const xMeta = {
      ...meta,
      url: target.url,
      x_target_mode: target.mode,
      x_target_label: target.label,
      queued_from: 'firefox-toolbar-x-options',
    };
    if (target.user) xMeta.channel = `@${target.user}`;

    const original = triggerBtn ? triggerBtn.textContent : 'X';
    if (triggerBtn) {
      triggerBtn.textContent = 'X...';
      triggerBtn.style.opacity = '0.6';
    }

    try {
      addLog(`X ${target.mode}: ${target.url}`);
      const result = await queueDownloadRequestWithOverride(xMeta, target.url);
      if (result && result.success) {
        const id = result.downloadId || result.hubJobId || '';
        showNotification(`X ${target.label}: ${result.duplicate ? 'bestaat al' : 'gestart'}${id ? ` #${id}` : ''}`);
        addLog(`X ${target.label} gestart: ${target.url}${id ? ` #${id}` : ''}`);
      } else {
        const err = (result && result.error) ? result.error : 'unknown';
        showNotification(`X fout: ${err}`, true);
        addLog(`X fout: ${err}`, 'error');
      }
    } catch (e) {
      showNotification(`X fout: ${e.message}`, true);
      addLog(`X fout: ${e.message}`, 'error');
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
    if (!(await ensureHubReachable(true))) return;

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
        const stats = summarizeBatchResult(result);
        showNotification(`YouTube ${label}: ${formatBatchStats(stats)}`);
        addLog(`YouTube ${label}: ${formatBatchStats(stats)}`);
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
    if (!(await ensureHubReachable(true))) return;

    if (isFootFetishClubThreadPage()) {
      await runBatchFromCurrentPage(mediaDownloadBtn, { force: false });
      return;
    }

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
        showNotification(`Media: ${formatBatchStats(stats)}${expandHint}`);
        addLog(`Media gestart: ${formatBatchStats(stats)}`);
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

  redditPostBtn.addEventListener('click', async function(e) {
    await runRedditAllBatchFromCurrentPage(redditPostBtn, 'post', e);
  });

  redditUserBtn.addEventListener('click', async function(e) {
    await runRedditAllBatchFromCurrentPage(redditUserBtn, 'user', e);
  });

  redditSubredditBtn.addEventListener('click', async function(e) {
    await runRedditAllBatchFromCurrentPage(redditSubredditBtn, 'subreddit', e);
  });

  xPostBtn.addEventListener('click', async function() {
    await runXDownloadFromCurrentPage(xPostBtn, 'post');
  });

  xProfileBtn.addEventListener('click', async function() {
    await runXDownloadFromCurrentPage(xProfileBtn, 'profile');
  });

  redgifsClipBtn.addEventListener('click', async function() {
    await runRedgifsClipDownload(redgifsClipBtn);
  });

  redgifsFeedBtn.addEventListener('click', async function(e) {
    await runRedgifsFeedDownload(redgifsFeedBtn, e);
  });

  async function runBatchFromCurrentPage(triggerBtn, opts, clickEvent) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const force = options.force === true;

    if (!(await ensureHubReachable(true))) return;

    const meta = scrapeMetadata();
    if (isFootFetishClubThreadPage()) {
      meta.adapter = 'browser-media';
      meta.platform = 'foot-fetish.club';
      meta.contextUrl = effectivePageUrl().replace(/#.*$/, '');
      meta.webdl_batch_kind = 'foot_fetish_club_current_page';
    }
    let urls = [];
    let redditIndexInfo = null;

    let batchCandidates = null;

    if (meta.platform === 'reddit' && isRedditBatchSeedUrl(meta.url)) {
      showNotification('Gebruik Reddit: Post, Gebruiker of Kanaal voor BDFR-download', false);
      addLog('Reddit pagina scannen overgeslagen; gebruik Post/Gebruiker/Kanaal');
      return;
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

    const redditFallbackTarget = redditIndexInfo && meta.platform === 'reddit' && redditIndexInfo.mode === 'fallback_target';
    let redditLimit = null;
    if (redditFallbackTarget) {
      redditLimit = promptRedditBdfrLimit(100);
      if (redditLimit === null) return;
      if (Number.isFinite(Number(redditLimit)) && Number(redditLimit) > 0) {
        meta.limit = Number(redditLimit);
        meta.bdfr_limit = Number(redditLimit);
      }
    }
    const redditHint = (redditIndexInfo && meta.platform === 'reddit')
      ? (redditFallbackTarget
        ? `\nReddit listing is geblokkeerd door 403; WEBDL stuurt deze subreddit/user direct naar BDFR.${redditLimit ? `\nLimiet: ${redditLimit} posts.` : '\nLimiet: onbeperkt.'}`
        : `\nMode: ${redditIndexInfo.mode}, pagina's: ${redditIndexInfo.scannedPages}, posts gescand: ${redditIndexInfo.scannedPosts}`)
      : '';
    let selectedDirectHints = null;
    let previewAccepted = false;
    if (isFootFetishForumThreadPage() || isFootFetishClubThreadPage() || isVipergirlsThreadPage()) {
      let selected = null;
      let previewFailed = false;
      try {
        const candidates = Array.isArray(batchCandidates) && batchCandidates.length
          ? batchCandidates
          : urls.map((u) => ({ url: u, el: null, kind: '' }));
        try { addLog(`Preview: ${candidates.length} items`); } catch (e) {}
        try { showNotification(`Preview: ${candidates.length} items`, false); } catch (e) {}
        try { console.log('[WEBDL][batch] preview.open', { force: !!force, items: candidates.length }); } catch (e) {}
        selected = await showBatchPreviewModal(candidates, meta, force);
      } catch (e) {
        previewFailed = true;
        selected = null;
      }

      if (selected && Array.isArray(selected.urls) && selected.urls.length) {
        urls = selected.urls;
        previewAccepted = true;
        selectedDirectHints = selected.directHints && typeof selected.directHints === 'object' ? selected.directHints : null;
        if (selected.sourceContexts && typeof selected.sourceContexts === 'object') meta.webdl_source_contexts = selected.sourceContexts;
      } else if (Array.isArray(selected) && selected.length) {
        urls = selected;
        previewAccepted = true;
      } else {
        try { addLog(previewFailed ? 'Preview niet getoond; batch afgebroken' : 'Batch geannuleerd'); } catch (e) {}
        try { showNotification(previewFailed ? 'Preview niet getoond; batch afgebroken' : 'Batch geannuleerd', previewFailed); } catch (e) {}
        return;
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
    const ok = previewAccepted
      ? true
      : (confirmLabel
        ? window.confirm(confirmLabel)
        : (redditFallbackTarget
          ? window.confirm(`Reddit target downloaden via BDFR?${redditHint}`)
          : confirmBatchStart({ count: urls.length, force, label: 'Batch download', redditHint })));
    if (!ok) return;

    if (isFootFetishClubThreadPage()) {
      const modeLabel = force ? 'Force' : 'Batch';
      addLog(`Foot-Fetish.Club ${modeLabel}: ${urls.length} geselecteerd`);
      const oldLabel = String((triggerBtn && triggerBtn.textContent) || '').trim();
      if (triggerBtn) {
        triggerBtn.textContent = `⏳ ${modeLabel}...`;
        triggerBtn.style.opacity = '0.6';
      }
      try {
        const result = await uploadFootFetishClubAttachmentsViaBrowser(
          urls.map((url) => ({ url, el: null, kind: 'xenforo_attachment' })),
          meta,
          { force },
        );
        if (result && result.success) {
          showNotification(`Foot-Fetish.Club: ${result.imported} nieuw, ${result.duplicates} bestaand, ${result.skipped} geskipt, ${result.errors} fout`, result.errors > 0);
          addLog(`Foot-Fetish.Club ${modeLabel} klaar: ${result.imported} nieuw, ${result.duplicates} bestaand, ${result.skipped} geskipt, ${result.errors} fout`);
        } else {
          showNotification(`Foot-Fetish.Club fout: ${(result && result.error) ? result.error : 'unknown'}`, true);
        }
      } catch (e) {
        showNotification(`Foot-Fetish.Club fout: ${e && e.message ? e.message : String(e)}`, true);
        addLog(`Foot-Fetish.Club fout: ${e && e.message ? e.message : String(e)}`, 'error');
      } finally {
        if (triggerBtn) {
          triggerBtn.textContent = oldLabel || (force ? '🔥 Force' : '⏬ Batch');
          triggerBtn.style.opacity = '1';
        }
      }
      return;
    }

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
        showNotification(`${modeLabel}: ${formatBatchStats(stats)}${expandHint}`);
        addLog(`${modeLabel} gestart: ${formatBatchStats(stats)}`);
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

    if (!(await ensureHubReachable(true))) return;

    const isForumPage = isFootFetishForumForumPage();
    const isThreadPage = isFootFetishForumThreadPage();
    const isFootFetishClubThread = isFootFetishClubThreadPage();
    const isVipergirlsThread = isVipergirlsThreadPage();
    const isVipergirlsForum = isVipergirlsForumPage();
    const isAnyForumPage = isForumPage || isVipergirlsForum;
    if (!isThreadPage && !isForumPage && !isFootFetishClubThread && !isVipergirlsThread && !isVipergirlsForum) {
      showNotification('Hele thread: alleen voor FootFetishForum, Foot-Fetish.Club of Vipergirls thread/forum pagina\'s', true);
      return;
    }

    const meta = scrapeMetadata();
    const oldLabel = String((triggerBtn && triggerBtn.textContent) || '').trim();

    try {
      if (triggerBtn) {
        triggerBtn.textContent = force ? '⏳ Thread (force)...' : '⏳ Thread...';
        triggerBtn.style.opacity = '0.6';
      }

      if (isFootFetishClubThread) {
        const startUrl = effectivePageUrl().replace(/#.*$/, '');
        const clubMeta = {
          ...meta,
          url: startUrl,
          adapter: 'browser-media',
          platform: 'foot-fetish.club',
          contextUrl: isTranslatedProxyPage() ? String(window.location.href || '') : startUrl,
          webdl_batch_kind: 'foot_fetish_club_whole_thread',
        };
        showNotification('Foot-Fetish.Club: threadpagina’s scannen met browser-login...', false);
        const scan = await collectFootFetishClubThreadAttachments(WEBDL_UNLIMITED);
        const candidates = scan && Array.isArray(scan.candidates) ? scan.candidates : [];
        if (!candidates.length) {
          showNotification('Foot-Fetish.Club: geen attachment media gevonden', true);
          addLog(`Foot-Fetish.Club geen attachments gevonden: ${startUrl}`, 'warn');
          return;
        }
        let selected = null;
        let previewFailed = false;
        try {
          showNotification(`Preview: ${candidates.length} Foot-Fetish.Club attachments`, false);
          addLog(`Foot-Fetish.Club preview: ${candidates.length} attachments (${scan.pages || '?'} pagina's)`);
          selected = await showBatchPreviewModal(candidates, clubMeta, force);
        } catch (e) {
          previewFailed = true;
          selected = null;
        }
        if (selected && Array.isArray(selected.urls) && selected.urls.length) {
          const selectedSet = new Set(selected.urls);
          candidates.splice(0, candidates.length, ...candidates.filter((c) => selectedSet.has(c.url)));
        } else if (Array.isArray(selected) && selected.length) {
          const selectedSet = new Set(selected);
          candidates.splice(0, candidates.length, ...candidates.filter((c) => selectedSet.has(c.url)));
        } else {
          showNotification(previewFailed ? 'Preview niet getoond; Foot-Fetish.Club batch afgebroken' : 'Foot-Fetish.Club batch geannuleerd', previewFailed);
          addLog(previewFailed ? 'Foot-Fetish.Club preview niet getoond; batch afgebroken' : 'Foot-Fetish.Club batch geannuleerd', previewFailed ? 'error' : 'info');
          return;
        }
        showNotification(`Foot-Fetish.Club fullscale: ${candidates.length} geselecteerd`, false);
        const result = await uploadFootFetishClubAttachmentsViaBrowser(candidates, clubMeta, { force });
        if (result && result.success) {
          showNotification(`Foot-Fetish.Club klaar: ${result.imported} nieuw, ${result.duplicates} bestaand, ${result.skipped} geskipt, ${result.errors} fout`, result.errors > 0);
          addLog(`Foot-Fetish.Club browser-import klaar: ${result.imported} nieuw, ${result.duplicates} bestaand, ${result.skipped} geskipt, ${result.errors} fout`);
        } else {
          const msg = result && result.error ? result.error : 'unknown';
          showNotification(`Foot-Fetish.Club fullscale fout: ${msg}`, true);
          addLog(`Foot-Fetish.Club fullscale fout: ${msg}`, 'error');
        }
        return;
      }

      let maxPages = WEBDL_UNLIMITED;
      let maxItems = WEBDL_UNLIMITED;
      let maxForumPages = WEBDL_UNLIMITED;

      const wantsSettings = !!(clickEvent && (clickEvent.metaKey || clickEvent.ctrlKey));
      if (wantsSettings) {
        if (isAnyForumPage) {
          try {
            const fIn = window.prompt('Forum: max forum-pagina\'s scannen? Leeg/0 = alles', '');
            if (fIn === null) return;
            maxForumPages = parseScanLimit(fIn);
          } catch (e) {}
        }
        try {
          const pIn = window.prompt(isAnyForumPage ? 'Forum: max pagina\'s per thread scannen? Leeg/0 = alles' : 'Hele thread: max pagina\'s scannen? Leeg/0 = alles', '');
          if (pIn === null) return;
          maxPages = parseScanLimit(pIn);
        } catch (e) {}
        try {
          const iIn = window.prompt(isVipergirlsForum ? 'Vipergirls forum: max threads verzamelen? Leeg/0 = alles' : 'Hele thread: max items (URLs) verzamelen? Leeg/0 = alles', '');
          if (iIn === null) return;
          maxItems = parseScanLimit(iIn);
        } catch (e) {}
      }

      try { if (wantsSettings && isForumPage) localStorage.setItem('WEBDL_FFF_FORUM_MAX_PAGES', Number.isFinite(maxForumPages) ? String(maxForumPages) : ''); } catch (e) {}
      try { if (wantsSettings && isVipergirlsForum) localStorage.setItem('WEBDL_VIPERGIRLS_FORUM_MAX_PAGES', Number.isFinite(maxForumPages) ? String(maxForumPages) : ''); } catch (e) {}
      try { if (wantsSettings) localStorage.setItem(isAnyForumPage ? 'WEBDL_FFF_FORUM_MAX_THREAD_PAGES' : 'WEBDL_FFF_THREAD_MAX_PAGES', Number.isFinite(maxPages) ? String(maxPages) : ''); } catch (e) {}
      try { if (wantsSettings) localStorage.setItem('WEBDL_FFF_THREAD_MAX_ITEMS', Number.isFinite(maxItems) ? String(maxItems) : ''); } catch (e) {}

      try {
        const hint = wantsSettings ? '' : ' (Cmd/Ctrl-klik voor optionele limiet)';
        showNotification(`${isAnyForumPage ? `Forum scannen: ${formatScanLimit(maxForumPages)} forum-pagina's, ` : 'Thread scannen: '} ${formatScanLimit(maxPages)} pagina's/thread, ${formatScanLimit(maxItems)} items${hint}`, false);
      } catch (e) {}

      const startUrl = String(window.location.href || '').replace(/#.*$/, '');
      const res = isVipergirlsForum
        ? await fetchVipergirlsForumCandidates(startUrl, { maxForumPages, maxThreads: maxItems, maxItems })
        : (isVipergirlsThread
          ? await fetchVipergirlsMixedThreadCandidates(startUrl, { maxPages, maxItems })
          : (isForumPage
          ? await fetchFootFetishForumForumCandidates(startUrl, { maxForumPages, maxThreadPages: maxPages, maxItems })
          : await fetchFootFetishForumThreadCandidates(startUrl, { maxPages, maxItems })));
      const candidates = uniqueCandidates(res && res.candidates ? res.candidates : []);

      try {
        if (shouldDebugBatch(meta, clickEvent)) {
          debugLogBatchUrls('thread.collected', candidates.map((c) => c.url), meta);
        }
      } catch (e2) {}

      if (!candidates.length) {
        if (isForumPage) {
          try { showFootFetishForumScanReport({ isForumPage: true, res, candidates }); } catch (e) {}
        }
        const detail = isForumPage && res && Number(res.threads) > 0 ? ` (${res.threads} threads gevonden, 0 media; geen thread-URLs als download gestart)` : '';
        showNotification(`${isAnyForumPage ? 'Forum' : 'Hele thread'}: geen URLs gevonden${detail}`, true);
        return;
      }

      try {
        const extra = isAnyForumPage ? ` | forum=${res && res.forumPages ? res.forumPages : '?'} | threads=${res && res.threads ? res.threads : '?'}` : '';
        addLog(`${isAnyForumPage ? 'Forum' : 'Thread'} pages: ${res && Number.isFinite(Number(res.pages)) ? res.pages : '?'}${extra} | items: ${candidates.length}`);
      } catch (e) {}
      try { showNotification(`${isAnyForumPage ? 'Forum' : 'Thread'}: ${candidates.length} items (${res && Number.isFinite(Number(res.pages)) ? res.pages : '?'} threadpagina's)`, false); } catch (e) {}

      let selected = null;
      let selectedDirectHints = null;
      let selectedSourceContexts = null;
      let previewAccepted = false;
      let previewFailed = false;
      try {
        selected = await showBatchPreviewModal(candidates, meta, force);
      } catch (e) {
        previewFailed = true;
        selected = null;
      }

      let urls = candidates.map((c) => c.url);
      if (selected && Array.isArray(selected.urls) && selected.urls.length) {
        urls = selected.urls;
        previewAccepted = true;
        selectedDirectHints = selected.directHints && typeof selected.directHints === 'object' ? selected.directHints : null;
        selectedSourceContexts = selected.sourceContexts && typeof selected.sourceContexts === 'object' ? selected.sourceContexts : null;
      } else if (Array.isArray(selected) && selected.length) {
        urls = selected;
        previewAccepted = true;
      }
      else {
        try { addLog(previewFailed ? 'Preview niet getoond; batch afgebroken' : 'Batch geannuleerd'); } catch (e) {}
        try { showNotification(previewFailed ? 'Preview niet getoond; batch afgebroken' : 'Batch geannuleerd', previewFailed); } catch (e) {}
        return;
      }

      const ok = previewAccepted ? true : confirmBatchStart({ count: urls.length, force, label: isAnyForumPage ? 'Forum download' : 'Hele thread download' });
      if (!ok) return;

      addLog(force ? `Force ${isAnyForumPage ? 'forum' : 'thread'} batch: ${urls.length} items` : `${isAnyForumPage ? 'Forum' : 'Thread'} batch: ${urls.length} items`);
      const result = await queueBatchDownloadRequest(urls, meta, { force, directHints: selectedDirectHints, sourceContexts: selectedSourceContexts });
      if (result && result.success) {
        const stats = summarizeBatchResult(result);
        const label = force ? `Force ${isAnyForumPage ? 'forum' : 'thread'}` : (isAnyForumPage ? 'Forum' : 'Thread');
        showNotification(`${label}: ${formatBatchStats(stats)}`);
        addLog(`${label} gestart: ${formatBatchStats(stats)}`);
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

  async function runVipergirlsKeep2ShareBatch(triggerBtn, clickEvent) {
    if (!(await ensureHubReachable(true))) return;
    if (!isVipergirlsThreadPage()) {
      showNotification('K2S: alleen op ViperGirls thread-pagina\'s', true);
      return;
    }

    const wholeThread = !!(clickEvent && (clickEvent.shiftKey || clickEvent.altKey));
    const wantsSettings = !!(clickEvent && (clickEvent.metaKey || clickEvent.ctrlKey));
    const meta = scrapeMetadata();
    const oldLabel = String((triggerBtn && triggerBtn.textContent) || '').trim();

    try {
      if (triggerBtn) {
        triggerBtn.textContent = wholeThread ? '⏳ K2S thread...' : '⏳ K2S pagina...';
        triggerBtn.style.opacity = '0.6';
      }

      let maxPages = WEBDL_UNLIMITED;
      let maxItems = WEBDL_UNLIMITED;

      if (wantsSettings) {
        try {
          const pIn = window.prompt('K2S hele thread: max pagina\'s scannen? Leeg/0 = alles', '');
          if (pIn === null) return;
          maxPages = parseScanLimit(pIn);
        } catch (e) {}
        try {
          const iIn = window.prompt('K2S: max links verzamelen? Leeg/0 = alles', '');
          if (iIn === null) return;
          maxItems = parseScanLimit(iIn);
        } catch (e) {}
      }

      try { if (wantsSettings) localStorage.setItem('WEBDL_VIPERGIRLS_K2S_MAX_PAGES', Number.isFinite(maxPages) ? String(maxPages) : ''); } catch (e) {}
      try { if (wantsSettings) localStorage.setItem('WEBDL_VIPERGIRLS_K2S_MAX_ITEMS', Number.isFinite(maxItems) ? String(maxItems) : ''); } catch (e) {}

      const result = wholeThread
        ? await fetchVipergirlsKeep2ShareThreadCandidates(window.location.href, { maxPages, maxItems })
        : { candidates: collectVipergirlsKeep2ShareCandidates(maxItems), pages: 1 };
      const candidates = uniqueCandidates(result && result.candidates ? result.candidates : []);

      if (shouldDebugBatch(meta, clickEvent)) {
        debugLogBatchUrls(wholeThread ? 'k2s.thread.collected' : 'k2s.page.collected', candidates.map((c) => c.url), meta);
      }

      if (!candidates.length) {
        showNotification(wholeThread ? 'K2S thread: geen Keep2Share-links gevonden' : 'K2S pagina: geen Keep2Share-links gevonden', true);
        addLog(wholeThread ? 'K2S thread: 0 links' : 'K2S pagina: 0 links');
        return;
      }

      showNotification(`K2S ${wholeThread ? 'thread' : 'pagina'}: ${candidates.length} links gevonden${wholeThread ? ` (${result.pages || '?'} pagina's)` : ''}`);
      const selected = await showBatchPreviewModal(candidates, meta, false);
      if (!selected || !Array.isArray(selected.urls) || !selected.urls.length) {
        showNotification('K2S batch geannuleerd');
        addLog('K2S batch geannuleerd');
        return;
      }

      const k2sMeta = {
        ...meta,
        platform: 'vipergirls',
        title: `${meta.title || 'ViperGirls'} Keep2Share`,
        webdl_batch_kind: wholeThread ? 'vipergirls_keep2share_thread' : 'vipergirls_keep2share_page',
      };
      const queueResult = await queueBatchDownloadRequest(selected.urls, k2sMeta, {
        directHints: selected.directHints,
        sourceContexts: selected.sourceContexts,
      });
      if (queueResult && queueResult.success) {
        const stats = summarizeBatchResult(queueResult);
        showNotification(`K2S: ${formatBatchStats(stats)}`);
        addLog(`K2S gestart: ${formatBatchStats(stats)}`);
      } else {
        showNotification(`K2S fout: ${(queueResult && queueResult.error) ? queueResult.error : 'unknown'}`, true);
        addLog(`K2S fout: ${(queueResult && queueResult.error) ? queueResult.error : 'unknown'}`, 'error');
      }
    } catch (e) {
      showNotification(`K2S fout: ${e && e.message ? e.message : String(e)}`, true);
      addLog(`K2S fout: ${e && e.message ? e.message : String(e)}`, 'error');
    } finally {
      if (triggerBtn) {
        triggerBtn.textContent = oldLabel || '🔐 K2S links';
        triggerBtn.style.opacity = '1';
      }
    }
  }

  if (keep2ShareBatchBtn) {
    keep2ShareBatchBtn.addEventListener('click', async function(e) {
      await runVipergirlsKeep2ShareBatch(keep2ShareBatchBtn, e);
    });
  }

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
  let recordingHeartbeatTimer = null;
  let currentRecordingKey = '';
  let recordingUiMode = 'idle';
  let recordingUiLockUntil = 0;
  let recordingPendingKey = '';
  let recordingHeartbeatMisses = 0;
  const RECORDING_UI_LOCK_MS = 6000;
  const recordingClientId = (() => {
    try {
      if (window.__webdlRecordingClientId) return window.__webdlRecordingClientId;
      const stored = window.sessionStorage && window.sessionStorage.getItem('webdlRecordingClientId');
      if (stored) {
        window.__webdlRecordingClientId = stored;
        return stored;
      }
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      window.__webdlRecordingClientId = id;
      if (window.sessionStorage) window.sessionStorage.setItem('webdlRecordingClientId', id);
      return id;
    } catch (e) {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
  })();

  function normalizeRecordingKeyFromMeta(meta) {
    const cleanTikTokChannel = (value) => {
      let s = String(value || '').trim().toLowerCase();
      if (!s) return '';
      s = s.replace(/^tiktok:/, '');
      s = s.replace(/^https?:\/\/(?:www\.)?tiktok\.com\//, '');
      s = s.replace(/^\/+/, '');
      s = s.replace(/\/live\/?$/, '');
      if (!s.startsWith('@')) s = `@${s}`;
      return s;
    };
    try {
      const raw = String((meta && (meta.url || meta.pageUrl || meta.sourceUrl)) || window.location.href || '').trim();
      const platform = String((meta && meta.platform) || '').trim().toLowerCase();
      const channel = String((meta && meta.channel) || '').trim().toLowerCase();
      if (raw) {
        const rawLower = raw.toLowerCase().replace(/\/+$/, '');
        if (/^tiktok:@/i.test(rawLower)) {
          const user = cleanTikTokChannel(rawLower);
          if (user) return `tiktok:${user}/live`;
        }
        if ((platform === 'tiktok' || rawLower.includes('/live')) && /^@[^\/\s]+(?:\/live)?$/i.test(rawLower)) {
          const user = cleanTikTokChannel(rawLower);
          if (user) return `tiktok:${user}/live`;
        }
        const u = new URL(raw);
        const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
        const pathname = String(u.pathname || '').replace(/\/+$/, '');
        const tiktok = pathname.match(/^\/@([^\/]+)(?:\/live)?$/i);
        if (host.endsWith('tiktok.com') && tiktok && tiktok[1]) return `tiktok:@${tiktok[1].toLowerCase()}/live`;
        if (host.includes('chaturbate.com')) {
          const model = pathname.split('/').filter(Boolean)[0] || channel;
          if (model) return `chaturbate:${model.toLowerCase()}`;
        }
        if (host.includes('stripchat.com')) {
          const model = pathname.split('/').filter(Boolean)[0] || channel;
          if (model) return `stripchat:${model.toLowerCase()}`;
        }
        return `${host}${pathname || '/'}`.toLowerCase();
      }
      if (platform === 'tiktok' && channel) {
        const user = cleanTikTokChannel(channel);
        if (user) return `tiktok:${user}/live`;
      }
      if (platform || channel) return `${platform || 'unknown'}:${channel || 'unknown'}`;
    } catch (e) {}
    if (meta && String(meta.platform || '').trim().toLowerCase() === 'tiktok') {
      const user = cleanTikTokChannel(meta.channel);
      if (user) return `tiktok:${user}/live`;
    }
    return String(window.location.href || 'default_rec').split('?')[0].replace(/\/+$/, '').toLowerCase();
  }

  function recordingKeyAliases(key) {
    const s = String(key || '').trim().toLowerCase().replace(/\/+$/, '');
    const aliases = new Set();
    if (!s) return aliases;
    aliases.add(s);
    if (/^tiktok:@[^\/]+(?:\/live)?$/i.test(s)) {
      const user = s.replace(/^tiktok:/, '').replace(/\/live$/, '');
      aliases.add(`tiktok:${user}/live`);
      aliases.add(`${user}/live`);
      aliases.add(user);
    } else if (/^@[^\/]+(?:\/live)?$/i.test(s)) {
      const user = s.replace(/\/live$/, '');
      aliases.add(`tiktok:${user}/live`);
      aliases.add(`${user}/live`);
      aliases.add(user);
    }
    return aliases;
  }

  function setRecordingUiMode(mode, key, lockMs = RECORDING_UI_LOCK_MS) {
    recordingUiMode = mode || 'idle';
    if (key) recordingPendingKey = String(key);
    recordingUiLockUntil = Date.now() + Math.max(0, Number(lockMs) || 0);
    renderRecButtons(recordingUiMode);
  }

  function clearRecordingUiLock(mode) {
    recordingUiMode = mode || (isRecording ? 'recording' : 'idle');
    recordingUiLockUntil = 0;
    if (recordingUiMode === 'idle') recordingPendingKey = '';
    renderRecButtons(recordingUiMode);
  }

  function stopRecordingHeartbeat() {
    if (recordingHeartbeatTimer) {
      clearInterval(recordingHeartbeatTimer);
      recordingHeartbeatTimer = null;
    }
    recordingHeartbeatMisses = 0;
  }

  function renderRecButtons(mode) {
    const state = mode || (isRecording ? 'recording' : 'idle');
    if (state === 'starting') {
      recStartBtn.textContent = '\u23fa Starten...';
      recStartBtn.style.opacity = '0.65';
      recStartBtn.style.cursor = 'wait';
      recStopBtn.style.opacity = '0.5';
      recStopBtn.style.cursor = 'not-allowed';
      recStopBtn.style.backgroundColor = '#555';
      return;
    }
    if (state === 'stopping') {
      recStartBtn.textContent = '\u23fa REC...';
      recStartBtn.style.opacity = '0.5';
      recStartBtn.style.cursor = 'not-allowed';
      recStopBtn.textContent = '\u23f9 Stoppen...';
      recStopBtn.style.opacity = '0.65';
      recStopBtn.style.cursor = 'wait';
      recStopBtn.style.backgroundColor = '#8f3330';
      return;
    }
    recStopBtn.textContent = '\u23f9 REC Stop';
    if (state === 'recording') {
      recStartBtn.textContent = '\u23fa REC...';
      recStartBtn.style.opacity = '0.5';
      recStartBtn.style.cursor = 'not-allowed';
      recStopBtn.style.opacity = '1';
      recStopBtn.style.cursor = 'pointer';
      recStopBtn.style.backgroundColor = '#e74c3c';
    } else {
      recStartBtn.textContent = '\u23fa REC Start';
      recStartBtn.style.opacity = '1';
      recStartBtn.style.cursor = 'pointer';
      recStopBtn.style.opacity = '0.5';
      recStopBtn.style.cursor = 'not-allowed';
      recStopBtn.style.backgroundColor = '#555';
    }
  }

  function updateRecUI(recording, activeUrls, activeKeys) {
    const meta = scrapeMetadata();
    const key = normalizeRecordingKeyFromMeta(meta);
    const keyAliases = recordingKeyAliases(key);
    const myUrl = window.location.href;
    const myRecording = Array.isArray(activeKeys) && activeKeys.length
      ? activeKeys.some(k => keyAliases.has(String(k || '').trim().toLowerCase().replace(/\/+$/, '')))
      : (Array.isArray(activeUrls) && activeUrls.length
        ? activeUrls.some(u => myUrl.startsWith(u) || u.startsWith(myUrl.split('?')[0]))
        : !!recording);
    if (Date.now() < recordingUiLockUntil) {
      if (recordingUiMode === 'starting' && !myRecording) {
        isRecording = true;
        currentRecordingKey = currentRecordingKey || recordingPendingKey || key;
        captureFrame.style.display = 'none';
        renderRecButtons('starting');
        return;
      }
      if (recordingUiMode === 'stopping' && myRecording) {
        isRecording = false;
        renderRecButtons('stopping');
        return;
      }
    }
    if (!myRecording && recordingHeartbeatTimer && currentRecordingKey && recordingUiMode !== 'stopping') {
      isRecording = true;
      captureFrame.style.display = 'none';
      renderRecButtons('recording');
      return;
    }
    isRecording = myRecording;
    if (!myRecording && cropUpdateTimer) {
      clearInterval(cropUpdateTimer);
      cropUpdateTimer = null;
    }
    if (!myRecording && recordingHeartbeatTimer) {
      stopRecordingHeartbeat();
      currentRecordingKey = '';
    }
    if (myRecording) {
      captureFrame.style.display = 'none';
    }
    recordingUiMode = myRecording ? 'recording' : 'idle';
    recordingUiLockUntil = 0;
    if (!myRecording) recordingPendingKey = '';
    renderRecButtons(recordingUiMode);
  }

  function ensureRecordingHeartbeat(meta) {
    currentRecordingKey = normalizeRecordingKeyFromMeta(meta || scrapeMetadata());
    if (recordingHeartbeatTimer) clearInterval(recordingHeartbeatTimer);
    recordingHeartbeatMisses = 0;
    const send = async () => {
      if (!currentRecordingKey) return;
      try {
        const result = await postServerJson('recording/heartbeat', {
        recordingKey: currentRecordingKey,
        recordingClientId,
        metadata: meta || scrapeMetadata()
        }, 5000);
        if (result && result.active === false) {
          recordingHeartbeatMisses += 1;
          if (recordingHeartbeatMisses >= 2) {
            stopRecordingHeartbeat();
            currentRecordingKey = '';
            isRecording = false;
            updateRecUI(false);
          }
          return;
        }
        recordingHeartbeatMisses = 0;
        if (result && result.recordingKey) currentRecordingKey = result.recordingKey;
        isRecording = true;
        if (recordingUiMode !== 'stopping') renderRecButtons('recording');
      } catch (e) {
        recordingHeartbeatMisses += 1;
      }
    };
    send();
    recordingHeartbeatTimer = setInterval(send, 10000);
  }

  function stopOwnedRecording(reason) {
    if (!currentRecordingKey) return;
    const meta = scrapeMetadata();
    const payload = {
      recordingKey: currentRecordingKey,
      recordingClientId,
      metadata: meta,
      reason
    };
    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${SERVER}/stop-recording`, new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch (e) {}
    fetch(`${SERVER}/stop-recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {});
  }

  window.addEventListener('pagehide', () => {
    if (isRecording) stopOwnedRecording('pagehide');
  });
  window.addEventListener('beforeunload', () => {
    if (isRecording) stopOwnedRecording('beforeunload');
  });

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
    if (isRecording || recordingUiMode === 'starting' || recordingUiMode === 'stopping') return;
    const meta = scrapeMetadata();
    const recordingKey = normalizeRecordingKeyFromMeta(meta);
    const crop = getVideoCropRect();
    if (crop.error) {
      showNotification(crop.error, true);
      addLog(crop.error, 'error');
      return;
    }

    addLog(`Opname starten (crop ${crop.width}x${crop.height} @ ${crop.x},${crop.y})`);
    currentRecordingKey = recordingKey;
    isRecording = true;
    setRecordingUiMode('starting', recordingKey);
    try {
      const result = await startRecordingRequest({ metadata: meta, crop, lock: true, recordingKey, recordingClientId });
      if (result.success) {
        applyConnectionState(true);
        currentRecordingKey = result.recordingKey || recordingKey;
        recordingPendingKey = currentRecordingKey;
        updateRecUI(true, [meta.url || window.location.href], [currentRecordingKey]);
        clearRecordingUiLock('recording');
        ensureRecordingHeartbeat(meta);
        const startedFile = result.file || result.finalFile || result.rawFile || currentRecordingKey || 'actief';
        showNotification(`Opname gestart: ${startedFile}`);
        addLog(`REC gestart: ${startedFile}`);

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
          stopRecordingHeartbeat();
          currentRecordingKey = '';
          updateRecUI(false);
          clearRecordingUiLock('idle');
          showNotification('Opname succesvol afgesloten.');
          addLog('Opname afgesloten (toggle)');
        } else {
          updateRecUI(true, [meta.url || window.location.href], [recordingKey]);
          clearRecordingUiLock('recording');
          showNotification(`Fout bij afsluiten opname: ${toggleResult.error}`, true);
        }
      } else if (result && result.needsForce) {
        if (confirm("Er loopt al een opname op de achtergrond. Wil je deze geforceerd beëindigen en een nieuwe starten?")) {
          setRecordingUiMode('starting', recordingKey);
          const forceResult = await startRecordingRequest({ metadata: meta, crop, lock: true, force: true, recordingKey, recordingClientId });
          if (forceResult.success) {
            applyConnectionState(true);
            currentRecordingKey = forceResult.recordingKey || recordingKey;
            recordingPendingKey = currentRecordingKey;
            updateRecUI(true, [meta.url || window.location.href], [currentRecordingKey]);
            clearRecordingUiLock('recording');
            ensureRecordingHeartbeat(meta);
            const forcedFile = forceResult.file || forceResult.finalFile || forceResult.rawFile || currentRecordingKey || 'actief';
            showNotification(`Opname geforceerd herstart: ${forcedFile}`);
            addLog(`REC geforceerd herstart: ${forcedFile}`);
            if (!cropUpdateTimer) {
              cropUpdateTimer = setInterval(() => {
                if (!isRecording) return;
                const next = getVideoCropRect();
                if (next && !next.error) sendCropUpdate(next);
              }, 250);
            }
          } else {
            isRecording = false;
            clearRecordingUiLock('idle');
            showNotification(forceResult.error, true);
          }
        } else {
          isRecording = false;
          clearRecordingUiLock('idle');
        }
      } else {
        isRecording = false;
        clearRecordingUiLock('idle');
        if (result && result.error) addLog(`REC start geweigerd: ${result.error}`, 'error');
        showNotification(result.error, true);
      }
    } catch (e) {
      isRecording = false;
      clearRecordingUiLock('idle');
      showNotification(`REC fout: ${e.message}`, true);
      addLog(`REC fout: ${e.message}`, 'error');
    }
  });

  recStopBtn.addEventListener('click', async () => {
    if (!isRecording || recordingUiMode === 'starting' || recordingUiMode === 'stopping') return;
    addLog('Opname stoppen...');
    const meta = scrapeMetadata();
    const stopKey = currentRecordingKey || normalizeRecordingKeyFromMeta(meta);
    setRecordingUiMode('stopping', stopKey);
    try {
      const result = await stopRecordingRequest({ metadata: meta, recordingKey: stopKey, recordingClientId });
      if (result.success) {
        applyConnectionState(true);
        stopRecordingHeartbeat();
        currentRecordingKey = '';
        updateRecUI(false);
        clearRecordingUiLock('idle');
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
        updateRecUI(true, [meta.url || window.location.href], [stopKey]);
        clearRecordingUiLock('recording');
        if (result && result.error) addLog(`REC stop geweigerd: ${result.error}`, 'error');
        showNotification(result.error, true);
      }
    } catch (e) {
      updateRecUI(true, [meta.url || window.location.href], [stopKey]);
      clearRecordingUiLock('recording');
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
        showNotification(`Bestaat al in WebDL${message.downloadId ? ` (#${message.downloadId})` : ''}`);
        try { addLog(`Rechtsklik download overgeslagen, bestaat al: ${message.url}`); } catch (e) {}
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
      updateRecUI(!!message.isRecording, message.activeRecordingUrls, message.activeRecordingKeys);
    }
    return true;
  });

  browser.runtime.sendMessage({ action: "contentScriptLoaded" })
    .then((status) => {
      if (status && typeof status.isConnected === 'boolean') {
        applyConnectionState(!!status.isConnected);
      }
      if (status && typeof status.isRecording !== 'undefined') {
        updateRecUI(!!status.isRecording, status.activeRecordingUrls, status.activeRecordingKeys);
      }
      if (status && Number.isFinite(Number(status.activeDownloads))) {
        document.getElementById('webdl-dl-count').textContent = `${Number(status.activeDownloads) || 0} actief`;
      }
    })
    .catch(() => {});
})();
