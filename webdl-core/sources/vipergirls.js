// @ts-check
// webdl-core/sources/vipergirls.js
//
// Reference Source: vipergirls.to + viper.to (vBulletin forum).
// Stap 2 uit ARCHITECTURE.md: 1e Source implementatie.
//
// Wat doet 'ie:
// - matches() — vipergirls.to OR viper.to URL
// - detectPageType — single video / thread / forum-index
// - inspect() — server-side fetch, parse, extract media + pagination
// - paginate() — bouw page-N URL
// - deriveChannel — 'thread_<id>_<slug>' formaat (max 40 chars slug)
//
// Bewust SIMPEL gehouden. Cloudflare/cookie-handling komt later via
// een browser-fetch-fallback. Eerst zien of basis werkt.

/** @typedef {import('./source').Source} Source */
/** @typedef {import('./source').Item} Item */
/** @typedef {import('./source').InspectResult} InspectResult */
/** @typedef {import('./source').InspectOptions} InspectOptions */

const { registerSource } = require('./source');

const VG_HOST_RE = /^(?:[a-z0-9-]+\.)?(?:vipergirls\.to|viper\.to)$/i;
const VG_THREAD_RE = /\/threads\/(\d+)-([^\/\?#]+)/i;
const VG_FORUM_RE = /\/(?:forumdisplay\.php\?[^#]*\bf=(\d+)|forums\/(\d+)-)/i;

const MEDIA_HOST_PATTERNS = [
  // Image hosts (full-size links zitten als a[href] in postbody)
  /imagebam\.com/i, /imagetwist\.com/i, /imgbox\.com/i, /pixhost\.(?:to|cc)/i,
  /postimg\.(?:cc|org)/i, /imagevenue\.com/i, /turboimagehost\.com/i, /turboimg\.net/i,
  /imx\.(?:to|cc)/i, /imgkiwi\.(?:com|net)/i, /imagetwist\.com/i, /imgchest\.com/i,
  /vipr\.(?:im|net)/i, /imagebams\.com/i, /imgbb\.com/i,
  // File hosts
  /\bk2s\.cc\b/i, /\bkeep2share\.cc\b/i, /\bk2s\.io\b/i, /rapidgator\.net/i,
  // Direct file extension (jpg/png/mp4/etc)
];

// 2026-05-25: K2S/Keep2Share premium accounts vereisen geldige auth. Zonder
// premium krijgt elke download "Download is not available" → wachtrij vol
// errors + captcha-flags. 2026-05-30: K2S werkt nu (web-cookie auth + monitor
// health.ok=true) — default DRAAIEN we K2S-links wel mee. Opt-out via
// WEBDL_VIPERGIRLS_SKIP_K2S=1 als premium weer expired raakt.
const SKIP_K2S_LINKS = String(process.env.WEBDL_VIPERGIRLS_SKIP_K2S || '0').trim() === '1';
const K2S_HOST_PATTERNS = [/\bk2s\.cc\b/i, /\bkeep2share\.cc\b/i, /\bk2s\.io\b/i];
const DIRECT_FILE_RE = /\.(jpe?g|png|gif|webp|bmp|avif|mp4|mov|m4v|webm|mkv|zip|rar|7z)(?:[?#]|$)/i;
const JUNK_PATH_RE = /\/(?:thumb|thumbs|thumbnail|icon|sprite|avatar|emoji|smilie|smiley)\b/i;
const JUNK_TEXT_RE = /\b(?:avatar|emoji|emote|smilie|smiley|reaction|logo|icon|banner|sprite)\b/i;
// 2026-05-24: imagebam-style video-preview thumbnails (1-10KB jpgs) zoals
// th_<hex>_NudeBeach056.wmv.v2_123_383lo.jpg — bijna 75% van forum-scans.
// User wil ze niet in de gallery. Filter ze hier zodat ze niet eens
// gedispatcht worden naar /download.
const VIDEO_PREVIEW_THUMB_RE = /\/?(?:th_)?[0-9a-f]{6,}_[^/]+\.(?:wmv|avi|mp4|mkv|mov|webm|flv|m4v)\.v\d+_/i;
// 2026-05-30 (Jürgen "rare thumbs eraf"): imagevenue gebruikt zelfde pattern
// maar verstopt het in de `?image=` query param i.p.v. het path. yt-dlp kan
// deze img.php-pages niet resolven → 75% van vipergirls posts queued met
// errors. Apart pattern omdat het in query zit, niet in path.
const IMAGEVENUE_PREVIEW_QUERY_RE = /[?&]image=[^&]*\.(?:wmv|avi|mp4|mkv|mov|webm|flv|m4v)\.v\d+_/i;
// 2026-05-30 (Jürgen scrape-batch): elke img.php?image= URL (ook zonder
// video-ext) faalt met yt-dlp "Unsupported URL". Strenger pakken: alle
// imagevenue img.php URLs skippen, alleen direct image-URLs accepteren.
const IMAGEVENUE_IMG_PHP_RE = /\bimagevenue\.com\/img\.php\b/i;
// 2026-05-30 (Jürgen "rare video previews"): URLs zoals
// ist5-2.filesor.com/.../Nud1sm003.avi.jpg = video-thumbnails met
// filename `<videoName>.<videoExt>.<imgExt>`. Filesor/pimpandhost levert
// deze als image-host maar het is altijd een poster van een video.
const VIDEO_POSTER_FILENAME_RE = /\.(wmv|avi|mp4|mov|mkv|webm|flv|m4v)\.(jpe?g|png|gif|webp|bmp)(?:[?#]|$)/i;
// 2026-05-30 (Jürgen "rare collages"): URLs zoals
// /nudistsonbeach_022_video__image_1_.jpg = collage-thumbnails met
// patroon `<videoName>_video__image_<N>_.<imgExt>`. picstate.com levert
// deze als preview-images van videos.
const VIDEO_COLLAGE_FILENAME_RE = /_video__image_[0-9]+_\.(jpe?g|png|gif|webp|bmp)(?:[?#]|$)/i;
// `cover.jpg` filenames in 4KDownloader/_4KDownloader/hub structures
const VIDEO_COVER_FILENAME_RE = /_cover\.(jpe?g|png|gif|webp|bmp)(?:[?#]|$)/i;
// `cdn-thumbs.imagevenue.com` host serveert pure thumbnails (15-50KB, suffix
// `_t.jpg`). Zijn klein, geen upgrade-pad → user wil ze niet.
const IMAGEVENUE_THUMB_HOST_RE = /(?:^|\.)cdn-thumbs\.imagevenue\.com$/i;
// Forum-zelf-paden: vipergirls.to/threads/images/icons/*.png zijn forum-iconen
// (smilies, ratings). JUNK_PATH_RE matcht /icon (singular) maar regex zou
// het al moeten pakken. Dit is een extra safety net.
const FORUM_ICON_RE = /\/(?:images\/icons|attachments\/icons|smilies)\//i;
// 2026-05-30 (Jürgen "video threads = alleen videos"): voor threads die
// duidelijk video-content zijn (titel/url bevat voyeur/nudist/beach/spying/
// candid/hidden/cam/video) → SKIP image-host URLs, behoud alleen file-hosts
// (K2S/rapidgator/etc) + direct video-files (.mp4 etc).
const VIDEO_THREAD_URL_RE = /\b(voyeur|nudist|beach|spying|candid|hidden[-_]?cam|hidden_camera|video|webcam|cams|caught)\b/i;
const IMAGE_HOST_PATTERNS = [
  /imagebam\.com/i, /imagetwist\.com/i, /imgbox\.com/i, /pixhost\.(?:to|cc)/i,
  /postimg\.(?:cc|org)/i, /imagevenue\.com/i, /turboimagehost\.com/i, /turboimg\.net/i,
  /imx\.(?:to|cc)/i, /imgkiwi\.(?:com|net)/i, /imgchest\.com/i,
  /vipr\.(?:im|net)/i, /imagebams\.com/i, /imgbb\.com/i, /pimpandhost\.com/i,
  /picstate\.com/i, /filesor\.com/i,
];
const VIDEO_FILE_EXT_RE = /\.(mp4|mov|m4v|mkv|webm|avi|wmv|flv|rar|zip|7z)(?:[?#]|$)/i;
// vipr.im thumbnails: hostname i*.vipr.im, path /th/<id>/<hex>.jpg.
// Resolver kan deze niet upgraden naar fullscale → blijft retry-loop. Filter ze
// hier voordat ze de queue raken. JUNK_PATH_RE matcht `/thumb` maar niet `/th/`.
const VIPR_THUMB_HOST_RE = /(?:^|\.)vipr\.im$/i;
const VIPR_THUMB_PATH_RE = /^\/th\//i;

/**
 * @param {string} url
 * @returns {boolean}
 */
function isVipergirlsUrl(url) {
  try {
    const u = new URL(url);
    return VG_HOST_RE.test(u.hostname);
  } catch (e) { return false; }
}

/**
 * @param {string} url
 * @returns {'single' | 'listing' | 'forum' | null}
 */
function detectPageType(url) {
  if (!isVipergirlsUrl(url)) return null;
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (VG_THREAD_RE.test(path)) return 'listing'; // thread = listing van posts/media
    if (VG_FORUM_RE.test(path + u.search)) return 'forum';
    return null;
  } catch (e) { return null; }
}

/**
 * @param {string} url
 * @returns {string}
 */
function deriveChannel(url) {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const tm = path.match(VG_THREAD_RE);
    if (tm) {
      const slug = String(tm[2] || '').toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 40)
        .replace(/-+$/, '');
      return slug ? `thread_${tm[1]}_${slug}` : `thread_${tm[1]}`;
    }
    const fm = (path + u.search).match(VG_FORUM_RE);
    if (fm) return `forum_${fm[1] || fm[2]}`;
    return 'vipergirls';
  } catch (e) { return 'vipergirls'; }
}

/**
 * @param {string} baseUrl
 * @param {number} page
 * @returns {string}
 */
function paginate(baseUrl, page) {
  if (page <= 1) return baseUrl;
  try {
    const u = new URL(baseUrl);
    // vBulletin: /threads/<id>-<slug>/?page=N
    u.searchParams.set('page', String(page));
    return u.toString();
  } catch (e) { return baseUrl; }
}

/**
 * Filter: is dit een echte media-URL die we willen downloaden?
 * @param {string} url
 * @param {string} [baseUrl] - de thread/page URL waar deze item vandaan komt
 *                              (gebruikt voor channel-aware filtering)
 * @returns {boolean}
 */
function isMediaCandidate(url, baseUrl) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (!/^https?:$/i.test(u.protocol)) return false;
    if (JUNK_PATH_RE.test(path)) return false;
    // Skip imagebam-style video-preview thumbnails (`th_<hex>_name.wmv.v2_*.jpg`).
    // User klacht: 75% van forum-scans waren deze 1-10KB previews, niet de echte videos.
    if (VIDEO_PREVIEW_THUMB_RE.test(path) || VIDEO_PREVIEW_THUMB_RE.test(u.pathname)) return false;
    // Skip imagevenue img.php?image=*.<videoExt>.v*_*lo previews (75% van vipergirls posts).
    if (IMAGEVENUE_PREVIEW_QUERY_RE.test(u.search || '')) return false;
    // Skip ALLE imagevenue img.php URLs — yt-dlp kan ze niet handlen, queue
    // vol met "Unsupported URL" errors.
    if (IMAGEVENUE_IMG_PHP_RE.test(u.hostname + u.pathname)) return false;
    // Skip video-poster filenames: <name>.<videoExt>.<imgExt> patroon
    // (filesor.com, pimpandhost, etc. leveren deze als rare thumbs).
    if (VIDEO_POSTER_FILENAME_RE.test(u.pathname)) return false;
    // Skip video-collage thumbnails: <name>_video__image_N_.<imgExt> (picstate).
    if (VIDEO_COLLAGE_FILENAME_RE.test(u.pathname)) return false;
    // Skip video-cover JPGs (4KDownloader, etc).
    if (VIDEO_COVER_FILENAME_RE.test(u.pathname)) return false;
    // Skip cdn-thumbs.imagevenue.com — pure thumbnails (15-50KB, geen upgrade-pad).
    if (IMAGEVENUE_THUMB_HOST_RE.test(u.hostname)) return false;
    // Skip forum-iconen (smilies, ratings) op vipergirls.to zelf.
    if (FORUM_ICON_RE.test(u.pathname)) return false;
    // Skip vipr.im thumbnails (/th/<id>/<hex>.jpg) — resolver kan ze niet upgraden.
    if (VIPR_THUMB_HOST_RE.test(u.hostname) && VIPR_THUMB_PATH_RE.test(u.pathname)) return false;
    // Skip K2S/Keep2Share als gebruiker geen premium heeft (default aan).
    if (SKIP_K2S_LINKS) {
      for (const p of K2S_HOST_PATTERNS) {
        if (p.test(u.hostname)) return false;
      }
    }
    // 2026-05-30 (Jürgen): voor VIDEO-threads (voyeur/nudist/beach/spying/
    // candid/hidden-cam/video) → skip image-host URLs volledig. Alleen
    // file-hosts (K2S/rapidgator) en directe video-files blijven.
    const isVideoThread = baseUrl && VIDEO_THREAD_URL_RE.test(String(baseUrl));
    if (isVideoThread) {
      for (const p of IMAGE_HOST_PATTERNS) {
        if (p.test(u.hostname)) return false;
      }
      // Direct image files (.jpg etc) ook skippen in video-threads.
      if (/\.(jpe?g|png|gif|webp|bmp|avif|svg)(?:[?#]|$)/i.test(path)) return false;
    }
    // Direct file extension
    if (DIRECT_FILE_RE.test(path)) return true;
    // Media-host wrapper page
    for (const pat of MEDIA_HOST_PATTERNS) {
      if (pat.test(u.hostname)) return true;
    }
    return false;
  } catch (e) { return false; }
}

/**
 * Parse HTML van een vipergirls-pagina, extract media-items.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {Item[]}
 */
function extractItemsFromHtml(html, baseUrl) {
  /** @type {Item[]} */
  const items = [];
  const seen = new Set();

  // Alleen <a href> in postbody/postcontent — niet sidebar/nav/footer.
  // Server-side: gebruik regex op postbody-blokken (geen DOM beschikbaar in Node).
  // Match alle <div class="postbody ...">...</div> blokken via een ruwe heuristiek.
  const POSTBODY_RE = /<(?:div|blockquote)[^>]*class="[^"]*(?:postbody|postcontent)[^"]*"[^>]*>([\s\S]*?)(?=<\/(?:div|blockquote)>\s*<(?:div|blockquote)[^>]*class="[^"]*post|<\/li>|<\/td>)/gi;

  let blockMatch;
  const blocks = [];
  while ((blockMatch = POSTBODY_RE.exec(html)) !== null) {
    blocks.push(blockMatch[1]);
  }
  // Fallback: als regex niets vond, scan hele html (kan junk meenemen)
  const scanText = blocks.length ? blocks.join('\n') : html;

  // Pak alle href + src URLs
  const URL_RE = /(?:href|src|data-src)="([^"]+)"/gi;
  let m;
  while ((m = URL_RE.exec(scanText)) !== null) {
    let abs;
    try { abs = new URL(m[1], baseUrl).toString(); } catch (e) { continue; }
    if (seen.has(abs)) continue;
    if (!isMediaCandidate(abs, baseUrl)) continue;
    seen.add(abs);
    /** @type {Item['type']} */
    let type = 'unknown';
    if (/\.(mp4|webm|mov|m4v|mkv)(?:[?#]|$)/i.test(abs)) type = 'video';
    else if (/\.(jpe?g|png|gif|webp|bmp|avif)(?:[?#]|$)/i.test(abs)) type = 'image';
    else if (/\.(zip|rar|7z)(?:[?#]|$)/i.test(abs)) type = 'archive';
    items.push({ url: abs, type });
  }
  return items;
}

/**
 * Detecteer hoogste page-nummer uit pagination-links in HTML.
 * Vipergirls (vBulletin) toont pagination zowel als ?page=N URLs ALS als
 * "Page X of N" tekst-marker. Tweede was eerder niet gepakt, waardoor
 * whole-thread alleen page 1 walkte op grote threads (123-page Big Boobs Land
 * vond 1017 items uit page 1; werkelijk totaal vanaf 100k+).
 * @param {string} html
 * @returns {number}
 */
function detectMaxPageFromHtml(html) {
  let max = 1;
  const PAGE_RE = /[?&]page=(\d+)/gi;
  let m;
  while ((m = PAGE_RE.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  // vBulletin: "Page 1 of 123" — pak de N uit "of N"
  const OF_RE = /Page\s+\d+\s+of\s+(\d+)/i;
  const ofMatch = html.match(OF_RE);
  if (ofMatch) {
    const n = parseInt(ofMatch[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  // Bonus: 'pagebutton42' / 'pagenumber=42' / 'data-page="42"' style markup
  const ATTR_RE = /(?:pagebutton|pagenumber=|data-page=\"|data-page=')(\d+)/gi;
  while ((m = ATTR_RE.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0';

/**
 * @param {string} url
 * @param {InspectOptions} [opts]
 * @returns {Promise<InspectResult>}
 */
async function inspect(url, opts = {}) {
  const timeoutMs = Math.max(3000, Math.min(60000, opts.timeoutMs || 20000));
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, timeoutMs);

  let html = '';
  let resp;
  try {
    resp = await fetch(url, {
      signal: opts.signal || ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, ...(opts.extraHeaders || {}) },
    });
    html = await resp.text();
  } finally {
    clearTimeout(timer);
  }

  if (!resp || !resp.ok) {
    throw new Error(`vipergirls.inspect HTTP ${resp ? resp.status : '?'} voor ${url}`);
  }

  const items = extractItemsFromHtml(html, url);
  const maxPage = detectMaxPageFromHtml(html);
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/\s*-\s*ViperGirls\.to\s*$/i, '').trim()
    : '';
  const pageType = detectPageType(url);
  const channel = deriveChannel(url);

  /** @type {string[]} */
  let paginationUrls = [];
  if (pageType === 'listing' && maxPage > 1) {
    for (let p = 1; p <= maxPage; p++) {
      paginationUrls.push(paginate(url, p));
    }
  }

  return { items, paginationUrls, channel, title, pageType };
}

/** @type {Source} */
const vipergirls = {
  id: 'vipergirls',
  displayName: 'ViperGirls',
  matches: isVipergirlsUrl,
  detectPageType,
  inspect,
  paginate,
  deriveChannel,
  features: {
    paginate: true,
    wholeThread: true,
    forumScan: true,
    wrapperResolve: false,    // ImageBam wrapper-resolve nog niet (komt in v2)
    cloudflareCookie: false,  // server-side fetch werkt voor regular pages
    authToken: false,
    rateLimitPerMin: 30,      // wees voorzichtig met Cloudflare
    defaultLane: 'middle',
  },
};

registerSource(vipergirls);

module.exports = vipergirls;
