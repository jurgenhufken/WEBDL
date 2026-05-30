// WEBDL site-config — chaturbate.com.
//
// Live cam-pagina's op chaturbate hebben de vorm `https://chaturbate.com/<model>/`.
// We bieden hier momenteel geen download zelf — recordings zijn een aparte flow
// in debug-toolbar/recording-pipeline. Wat we WEL bieden: snel doorklikken naar
// recu.me voor dezelfde model om bestaande captures te zien/downloaden.
//
// Voor latere uitbreiding: hier komen ook scan-knoppen voor channel-galleries
// of "open in stripchat" etc. Voorlopig minimaal — extraButtons-only.
window.WEBDL_SITES = window.WEBDL_SITES || {};

function chaturbateModelFromUrl(url) {
  try {
    const u = new URL(url);
    if (!/(?:^|\.)chaturbate\.com$/i.test(u.hostname)) return '';
    const parts = String(u.pathname || '').split('/').filter(Boolean);
    if (parts.length < 1) return '';

    // Locale-prefixen (ISO 639-1 codes die chaturbate gebruikt)
    const locales = new Set([
      'en', 'es', 'ja', 'fr', 'de', 'ru', 'it', 'pt', 'tr',
      'nl', 'ko', 'zh', 'ar', 'el', 'cs', 'fi', 'hu', 'pl', 'ro', 'sk', 'uk',
      'sv', 'da', 'no', 'in', 'th', 'vi', 'he', 'bg', 'hr', 'lt', 'lv', 'et',
      'sl', 'sr', 'ms',
    ]);

    const systemPrefixes = new Set([
      'tag', 'tags', 'genders', 'discover', 'feed', 'help', 'support', 'roomlist',
      'auth', 'account', 'login', 'signup', 'logout', 'apps', 'contests',
      'photo_videos', 'followed', 'following', 'favorites', 'external_link',
      'tipping', 'broadcaster', 'affiliates', 'emoticons', 'security',
    ]);

    let idx = 0;
    // Sla locale-prefix over indien aanwezig
    if (locales.has(parts[idx].toLowerCase())) {
      idx++;
    }

    if (idx >= parts.length) return '';

    // Sla '/b/' (broadcast) of '/p/' (profile) prefix over indien aanwezig
    const nextLower = parts[idx].toLowerCase();
    if (nextLower === 'b' || nextLower === 'p') {
      idx++;
    }

    if (idx >= parts.length) return '';

    const modelCandidate = parts[idx].toLowerCase();

    // Als het een gereserveerd systeem-pad of locale is, is het geen model-pagina
    if (systemPrefixes.has(modelCandidate)) return '';
    if (locales.has(modelCandidate)) return '';
    if (modelCandidate === 'b' || modelCandidate === 'p') return '';

    // Model-namen bevatten alleen alfanumeriek, underscore, dash
    if (/^[a-z0-9_-]{2,}$/i.test(modelCandidate)) {
      return modelCandidate;
    }
    return '';
  } catch (_) { return ''; }
}

// 2026-05-30 v4: robuuste tab-opener met 4 fallback-methodes.
// Chaturbate's CSP + Firefox popup-blocker blokkeren vaak window.open
// vanuit async content-script context. We proberen:
//   1. background sendMessage → browser.tabs.create (schoonst, buiten CSP)
//   2. programmatic <a> click (werkt als user-gesture nog actief is)
//   3. window.open (voor het geval CSP minder streng is)
//   4. location.href navigatie (altijd werkend, maar verliest huidige pagina)
async function chaturbateOpenTab(targetUrl) {
  // Method 1: via background script
  try {
    const resp = await browser.runtime.sendMessage({ action: 'openTab', url: targetUrl });
    if (resp && resp.success) {
      console.log('[WEBDL chaturbate] openTab success via background', resp);
      return { ok: true, method: 'background' };
    }
    console.warn('[WEBDL chaturbate] openTab response not success:', resp);
  } catch (e) {
    console.warn('[WEBDL chaturbate] sendMessage failed:', e && e.message || e);
  }

  // Method 2: programmatic <a> element click (bypasses popup-blocker in veel browsers)
  try {
    const a = document.createElement('a');
    a.href = targetUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { a.remove(); } catch (_) {} }, 200);
    console.log('[WEBDL chaturbate] openTab via <a> click');
    return { ok: true, method: 'anchor' };
  } catch (e) {
    console.warn('[WEBDL chaturbate] <a> click failed:', e && e.message || e);
  }

  // Method 3: window.open
  try {
    const w = window.open(targetUrl, '_blank');
    if (w) {
      console.log('[WEBDL chaturbate] openTab via window.open');
      return { ok: true, method: 'window.open' };
    }
    console.warn('[WEBDL chaturbate] window.open returned null (popup blocked)');
  } catch (e) {
    console.warn('[WEBDL chaturbate] window.open threw:', e && e.message || e);
  }

  // Method 4: navigate huidige tab (laatste redmiddel)
  console.log('[WEBDL chaturbate] fallback: location.href naar', targetUrl);
  location.href = targetUrl;
  return { ok: true, method: 'navigate' };
}

const CHATURBATE_CONFIG = {
  label: 'chaturbate',
  platform: 'chaturbate',

  // Return 'listing' op model-pagina's (laat extraButtons het werk doen).
  // Return null op niet-model pagina's (homepage, tags, etc.) → geen paneel.
  pageType(_path) {
    return chaturbateModelFromUrl(window.location.href) ? 'listing' : null;
  },

  deriveChannel() {
    const m = chaturbateModelFromUrl(window.location.href);
    return m ? `chaturbate:${m}` : 'chaturbate';
  },

  // Geen download-knoppen — alleen extraButtons.
  itemTypes: [],

  extraButtons: [
    {
      label: '🔍 Zoek op recu.me',
      color: '#ec4899',
      match(_pageType, url) { return Boolean(chaturbateModelFromUrl(url)); },
      async onClick(ctx) {
        const model = chaturbateModelFromUrl(ctx.url);
        if (!model) return { text: '✗ Geen model' };
        const target = `https://recu.me/search/?searchquery=${encodeURIComponent(model)}`;
        const result = await chaturbateOpenTab(target);
        if (result.method === 'navigate') return { text: '→ Navigeer naar recu.me' };
        return { text: '✓ Zoek geopend' };
      },
    },
    {
      label: '🎬 Direct (kan 404)',
      color: '#f472b6',
      match(_pageType, url) { return Boolean(chaturbateModelFromUrl(url)); },
      async onClick(ctx) {
        const model = chaturbateModelFromUrl(ctx.url);
        if (!model) return { text: '✗ Geen model in URL' };
        const target = `https://recu.me/${encodeURIComponent(model)}/`;
        const result = await chaturbateOpenTab(target);
        if (result.method === 'navigate') return { text: '→ Navigeer naar recu.me' };
        return { text: '✓ Tab geopend' };
      },
    },
    {
      label: '📸 Stripchat',
      color: '#a855f7',
      match(_pageType, url) { return Boolean(chaturbateModelFromUrl(url)); },
      async onClick(ctx) {
        const model = chaturbateModelFromUrl(ctx.url);
        if (!model) return { text: '✗ Geen model' };
        const target = `https://stripchat.com/${encodeURIComponent(model)}`;
        const result = await chaturbateOpenTab(target);
        if (result.method === 'navigate') return { text: '→ Navigeer naar stripchat' };
        return { text: '✓ Tab geopend' };
      },
    },
  ],

  paginationUrl: (b) => b,
  detectMaxPage: () => 1,
};

window.WEBDL_SITES['chaturbate.com'] = CHATURBATE_CONFIG;
