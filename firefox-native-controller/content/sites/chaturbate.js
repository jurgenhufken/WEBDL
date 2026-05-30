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
    const first = parts[0].toLowerCase();
    const reserved = new Set(['', 'tag', 'tags', 'genders', 'discover', 'feed', 'help', 'support', 'roomlist',
                              'in', 'es', 'ja', 'fr', 'de', 'ru', 'it', 'pt', 'tr', 'auth', 'account', 'login']);
    if (reserved.has(first)) return '';
    return first;
  } catch (_) { return ''; }
}

const CHATURBATE_CONFIG = {
  label: 'chaturbate',
  platform: 'chaturbate',

  // 2026-05-30: was 'single' maar zonder matching itemType toonde paneel
  // "✗ Onbekend item-type". Return 'listing' (= toont "Deze pagina" tak die
  // bij lege itemTypes 0 items toont) en laat extraButtons het werk doen.
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
      // 2026-05-30 v3: chaturbate.com's CSP blokkeert window.open vanuit
      // content-script. Workaround: stuur message naar background script die
      // browser.tabs.create() doet — background script valt buiten chaturbate's
      // CSP. Plus location.href fallback als sendMessage faalt.
      label: '🔍 Zoek op recu.me',
      color: '#ec4899',
      match(_pageType, url) { return Boolean(chaturbateModelFromUrl(url)); },
      async onClick(ctx) {
        const model = chaturbateModelFromUrl(ctx.url);
        if (!model) return { text: '✗ Geen model' };
        const target = `https://recu.me/search/?searchquery=${encodeURIComponent(model)}`;
        try {
          await browser.runtime.sendMessage({ action: 'openTab', url: target });
          return { text: '✓ Zoek geopend' };
        } catch (e) {
          try { window.open(target, '_blank'); return { text: '✓ Tab geopend' }; }
          catch (_) { location.href = target; return { text: '✓ Navigeer naar zoek' }; }
        }
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
        try {
          await browser.runtime.sendMessage({ action: 'openTab', url: target });
          return { text: '✓ Tab geopend' };
        } catch (e) {
          try { window.open(target, '_blank'); return { text: '✓ Tab geopend' }; }
          catch (_) { location.href = target; return { text: '✓ Navigeer' }; }
        }
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
        try {
          await browser.runtime.sendMessage({ action: 'openTab', url: target });
          return { text: '✓ Tab geopend' };
        } catch (e) {
          try { window.open(target, '_blank'); return { text: '✓ Tab geopend' }; }
          catch (_) { location.href = target; return { text: '✓ Navigeer' }; }
        }
      },
    },
  ],

  paginationUrl: (b) => b,
  detectMaxPage: () => 1,
};

window.WEBDL_SITES['chaturbate.com'] = CHATURBATE_CONFIG;
