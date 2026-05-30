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
      // Directe model-page op recu.me. Werkt als model daar geïndexeerd is.
      label: '🎬 recu.me model',
      color: '#ec4899',
      match(_pageType, url) { return Boolean(chaturbateModelFromUrl(url)); },
      onClick(ctx) {
        const model = chaturbateModelFromUrl(ctx.url);
        if (!model) return { text: '✗ Geen model in URL' };
        window.open(`https://recu.me/${encodeURIComponent(model)}/`, '_blank');
        return { text: '✓ Tab geopend' };
      },
    },
    {
      // 2026-05-30: search-fallback wanneer directe model-page geen resultaat
      // geeft (model bestaat niet op recu.me of andere naam-variant). Search
      // werkt altijd, toont matching results.
      label: '🔍 recu.me zoek',
      color: '#f472b6',
      match(_pageType, url) { return Boolean(chaturbateModelFromUrl(url)); },
      onClick(ctx) {
        const model = chaturbateModelFromUrl(ctx.url);
        if (!model) return { text: '✗ Geen model' };
        window.open(`https://recu.me/search/?searchquery=${encodeURIComponent(model)}`, '_blank');
        return { text: '✓ Zoek geopend' };
      },
    },
    {
      label: '📸 Open in stripchat',
      color: '#a855f7',
      match(_pageType, url) { return Boolean(chaturbateModelFromUrl(url)); },
      onClick(ctx) {
        const model = chaturbateModelFromUrl(ctx.url);
        if (!model) return { text: '✗ Geen model' };
        window.open(`https://stripchat.com/${encodeURIComponent(model)}`, '_blank');
        return { text: '✓ Tab geopend' };
      },
    },
  ],

  paginationUrl: (b) => b,
  detectMaxPage: () => 1,
};

window.WEBDL_SITES['chaturbate.com'] = CHATURBATE_CONFIG;
