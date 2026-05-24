// @ts-check
// webdl-core/sources/source.js
//
// Source-interface: elke ondersteunde host implementeert dit contract.
// Per ARCHITECTURE.md §2: scheduler vraagt Source.inspect(url) → items[],
// dispatcht items naar workers. Géén UI-code, géén DB-code per Source.

/**
 * @typedef {Object} Item
 * Een enkel media-item dat downloadbaar is.
 * @property {string} url          Direct dispatchbare URL (image/video/archive)
 * @property {'video' | 'image' | 'archive' | 'unknown'} type
 * @property {string} [title]      Optioneel: titel
 * @property {string} [hostHint]   Optioneel: oorspronkelijke host (bv. 'imagebam')
 * @property {Object<string, any>} [metadata]  Extra (groottehint, page-context, etc.)
 */

/**
 * @typedef {Object} InspectResult
 * Output van Source.inspect(url) — wat staat er op deze pagina?
 * @property {Item[]} items                   Direct downloadbare items op deze pagina
 * @property {string[]} [paginationUrls]      Voor whole-thread: alle pagina-URLs (page 1..N)
 * @property {string[]} [childUrls]           Voor forum-scan: thread-URLs binnen deze forum-page
 * @property {string} channel                 Gallery-channel-naam (bv. 'thread_5271987_ex-girlfriends')
 * @property {string} [title]                 Pagina-titel (voor metadata)
 * @property {'single' | 'listing' | 'forum' | null} pageType  Type van de gescande pagina
 */

/**
 * @typedef {Object} SourceFeatures
 * Wat ondersteunt deze Source. Hierop kan scheduler beslissen of een intent
 * uitgevoerd kan worden (bv. 'whole-thread' alleen op forums).
 * @property {boolean} [paginate]           Multi-page support
 * @property {boolean} [wholeThread]        Forum thread-walking (alle pages)
 * @property {boolean} [forumScan]          Subforum → thread-discovery
 * @property {boolean} [wrapperResolve]     Bv. Chevereto image-page → direct image
 * @property {boolean} [cloudflareCookie]   Vereist cookies-from-firefox
 * @property {boolean} [authToken]          Bv. K2S accessToken
 * @property {number}  [rateLimitPerMin]    Max requests/min naar deze host
 * @property {string}  [defaultLane]        'heavy' | 'middle' | 'light'
 */

/**
 * @typedef {Object} Source
 * Het contract dat elke host moet implementeren.
 * @property {string} id                                          Unieke key (bv. 'vipergirls')
 * @property {string} displayName                                 Voor UI/logs
 * @property {(url: string) => boolean} matches                   Is deze URL voor mij?
 * @property {(url: string) => ('single' | 'listing' | 'forum' | null)} detectPageType
 * @property {(url: string, opts?: InspectOptions) => Promise<InspectResult>} inspect
 *           Server-side scan van de pagina. Mag fetch() doen.
 * @property {(baseUrl: string, page: number) => string} [paginate]
 *           Bouw URL voor pagina N. Optioneel (alleen als features.paginate).
 * @property {(url: string) => string} deriveChannel              Gallery-channel-naam
 * @property {SourceFeatures} features
 */

/**
 * @typedef {Object} InspectOptions
 * @property {AbortSignal} [signal]              Abort de fetch
 * @property {number} [timeoutMs]                Default 20000
 * @property {boolean} [useCurrent]              Als true en URL == window.location: gebruik document
 * @property {Object<string, string>} [extraHeaders]
 */

/**
 * Registry voor alle geregistreerde Sources.
 * Sources registreren zichzelf via {@link registerSource} bij module-load.
 */
const SOURCES = /** @type {Map<string, Source>} */ (new Map());

/**
 * @param {Source} source
 */
function registerSource(source) {
  if (!source || !source.id) throw new Error('Source heeft geen id');
  if (SOURCES.has(source.id)) {
    console.warn(`[webdl-core/sources] source ${source.id} dubbel geregistreerd, overschrijven`);
  }
  SOURCES.set(source.id, source);
}

/**
 * Zoek de Source die deze URL kan afhandelen.
 * @param {string} url
 * @returns {Source | null}
 */
function findForUrl(url) {
  for (const s of SOURCES.values()) {
    try {
      if (s.matches(url)) return s;
    } catch (e) {
      console.warn(`[webdl-core/sources] ${s.id}.matches() gooide error:`, e);
    }
  }
  return null;
}

/**
 * @returns {Source[]}
 */
function listAll() {
  return Array.from(SOURCES.values());
}

module.exports = {
  registerSource,
  findForUrl,
  listAll,
  /** @internal voor tests */
  _registry: SOURCES,
};
