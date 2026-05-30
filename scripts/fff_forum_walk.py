#!/usr/bin/env python3
"""fff_forum_walk.py — footfetishforum sub-forum walker.

Probleem: sub-forum pages (bv. /forums/initiation-archive.35/) zitten achter
een login. Server kan ze niet zonder credentials zien. Oplossing: lees de
Firefox sessie-cookies (xf_user, xf_session, cf_clearance) en gebruik die
voor de fetch.

Wat het doet:
- Read Firefox cookies for footfetishforum.com (immutable mode = veilig terwijl
  Firefox draait)
- Walk forum pages (/page-2/, /page-3/, ...) tot geen nieuwe threads of max-pages
- Per thread: POST naar localhost:35729/download met metadata.whole_thread=true
  zodat de server runWholeThread invokes (extractor + alle pages)

Gebruik:
  python3 fff_forum_walk.py https://footfetishforum.com/forums/initiation-archive.35/
  python3 fff_forum_walk.py <forum-url> --max-pages 5 --max-threads 50
  python3 fff_forum_walk.py <forum-url> --dry-run     # toon alleen threads

Channel: NIET overschreven. Server-extractor (parseFootFetishForumThreadInfo)
zet per-thread channel = Title-Case van thread-slug (bv. "Voyeur Hidden Cams
On Beach"), in lijn met bestaande WEBDL folder-structuur. Dit script stuurt
alleen de sub-forum context als informational metadata.
"""
import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request

# curl_cffi spoofet Firefox TLS-fingerprint zodat Cloudflare ons niet 403't
# ondanks dat we de juiste cf_clearance cookie meesturen.
try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    print('FATAL: pip install curl_cffi', file=sys.stderr)
    sys.exit(2)

SERVER = 'http://localhost:35729'
FFF_HOST = 'footfetishforum.com'
THREAD_LINK_RE = re.compile(r'href="(/threads/([a-z0-9-]+)\.(\d+)/?)"', re.IGNORECASE)
PAGE_LINK_RE_TMPL = r'/forums/{slug}/page-(\d+)'
FORUM_URL_RE = re.compile(r'^https?://(?:www\.)?footfetishforum\.com/forums/([a-z0-9-]+)\.(\d+)/?', re.IGNORECASE)
# XenForo p-title-value bevat de menselijke sub-forum naam ("Random Videos",
# "Initiations Archive", etc.) — zoals het in de WEBDL-folder-structuur staat.
FORUM_TITLE_RE = re.compile(r'<h1[^>]*class="[^"]*p-title-value[^"]*"[^>]*>([^<]+)</h1>', re.IGNORECASE)

# Media-extractie patterns — mirror van simple-server.js
# collectFootFetishForumMediaFromHtml + isFootFetishForumMediaCandidateUrl
MEDIA_ATTR_RE = re.compile(r'\b(?:href|src|data-src|data-lazy-src|data-url|data-href)=["\']([^"\']+)["\']', re.IGNORECASE)
MEDIA_RAW_RE = re.compile(r'(https?://[^\s"\'<>)]+)')

# v2.2: anchor-wrapped image pattern. XenForo wraps elke attachment-thumb in
# <a href="/attachments/<filename>.<id>/"> dat naar de FULL versie wijst.
# We pakken de anchor href en negeren de img src (= thumb).
ANCHOR_IMG_RE = re.compile(
    r'<a\b[^>]*href=["\']([^"\']*/attachments/[^"\']+?\.(\d+)/?)["\'][^>]*>'
    r'(?:[^<]|<(?!/a>))*?'
    r'<img\b[^>]*src=["\']([^"\']+)["\']',
    re.IGNORECASE | re.DOTALL,
)
# flc.nyc3 inline-thumb pattern — gebruikt voor reject + voor lookup naar full-anchor
FLC_THUMB_RE = re.compile(
    r'^https?://flc\.nyc3\.digitaloceanspaces\.com/data/attachments/\d+/(\d+)-[a-f0-9]+\.(?:jpe?g|png|gif|webp|bmp|mp4|mov|m4v|webm|mkv)(?:\?|$)',
    re.IGNORECASE,
)
NEXT_PAGE_PATTERNS = [
    re.compile(r'<link\b[^>]*rel=["\']next["\'][^>]*href=["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'<a\b[^>]*rel=["\']next["\'][^>]*href=["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'<a\b[^>]*class=["\'][^"\']*pageNav-jump--next[^"\']*["\'][^>]*href=["\']([^"\']+)["\']', re.IGNORECASE),
    re.compile(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*class=["\'][^"\']*pageNav-jump--next[^"\']*["\']', re.IGNORECASE),
]
MEDIA_EXT_RE = re.compile(r'\.(?:jpe?g|png|gif|webp|bmp|avif|heic|heif|mp4|mov|m4v|webm|mkv)(?:$|\?)', re.IGNORECASE)
FFF_HOST_RE = re.compile(r'(?:^|\.)footfetishforum\.com$', re.IGNORECASE)
EXTERNAL_MEDIA_HOSTS = ('pixhost.to', 'postimg.cc', 'imgur.com', 'redgifs.com', 'gfycat.com')


def find_firefox_profile():
    base = os.path.expanduser('~/Library/Application Support/Firefox/Profiles')
    if not os.path.isdir(base):
        raise RuntimeError(f'Firefox profiles dir niet gevonden: {base}')
    # Prefer default-release boven default
    for suffix in ('.default-release', '.default'):
        for d in sorted(os.listdir(base)):
            if d.endswith(suffix):
                p = os.path.join(base, d)
                if os.path.isfile(os.path.join(p, 'cookies.sqlite')):
                    return p
    raise RuntimeError('Geen Firefox profile met cookies.sqlite gevonden')


def load_fff_cookies(profile_dir):
    """Return dict {name: value} voor footfetishforum cookies."""
    db_path = os.path.join(profile_dir, 'cookies.sqlite')
    conn = sqlite3.connect(f'file:{db_path}?immutable=1', uri=True)
    try:
        rows = conn.execute(
            "SELECT name, value FROM moz_cookies WHERE host LIKE '%footfetishforum.com%'"
        ).fetchall()
    finally:
        conn.close()
    return {n: v for n, v in rows}


def parse_forum_url(url):
    m = FORUM_URL_RE.match(url)
    if not m:
        return None
    return {'slug': m.group(1), 'id': m.group(2), 'full_slug': f"{m.group(1)}.{m.group(2)}"}


def fetch_text(cookies, url, timeout=30):
    r = cffi_requests.get(url, cookies=cookies, impersonate='firefox133', timeout=timeout)
    return r.text, r.status_code


def extract_threads(html):
    """Return list of (full_url, slug, thread_id) tuples, deduped, in order."""
    seen = set()
    out = []
    for m in THREAD_LINK_RE.finditer(html):
        tid = m.group(3)
        if tid in seen:
            continue
        seen.add(tid)
        url = f"https://{FFF_HOST}{m.group(1).rstrip('/')}/"
        out.append((url, m.group(2), tid))
    return out


def extract_max_page(html, slug):
    nav_re = re.compile(PAGE_LINK_RE_TMPL.format(slug=re.escape(slug)))
    pages = [int(m) for m in nav_re.findall(html)]
    return max(pages) if pages else 1


def extract_forum_title(html):
    m = FORUM_TITLE_RE.search(html)
    if not m:
        return ''
    return re.sub(r'\s+', ' ', m.group(1)).strip()


def absolute_url(raw, base):
    try:
        from urllib.parse import urljoin
        u = urljoin(base, raw)
        # strip hash
        if '#' in u:
            u = u.split('#', 1)[0]
        return u
    except Exception:
        return ''


def is_media_candidate(url):
    """Strikter dan server's isFootFetishForumMediaCandidateUrl — filtert ook
    XenForo UI-assets, emoji-CDN, vBulletin smilies, wrapper-URLs."""
    try:
        from urllib.parse import urlparse
        p = urlparse(url)
        host = (p.hostname or '').lower()
        path = (p.path or '').lower()
        full_lower = url.lower()

        # === DENY (eerst, vóór allow) ===
        # XenForo UI / forum-assets
        if re.search(r'/styles?/|/forum_assets/|/sprites?/|/board/', path):
            return False
        # Emoji-CDNs, vBulletin smilies, joypixels
        if 'joypixels' in full_lower or '/graemlins/' in path or '/smilies/' in path or '/smiles/' in path or '/ubb/' in path:
            return False
        if host == 'cdn.jsdelivr.net':
            return False
        # FFF eigen avatars, icons
        if '/data/avatars/' in path:
            return False
        if re.search(r'\b(?:avatar|emoji|smilie|reaction|logo|favicon|bell|sprite|spinner|loading)\b', path):
            return False

        # === ALLOW ===
        # upload.footfetishforum.com — alleen met directe media-extensie (eerst,
        # vóór de FFF-main-host check want upload.* matcht ook FFF_HOST_RE)
        if host == 'upload.footfetishforum.com' or host.endswith('.upload.footfetishforum.com'):
            return bool(MEDIA_EXT_RE.search(url))
        # FFF main-host: /attachments/<name>.<id>/ — moet een id-suffix hebben
        if host == 'footfetishforum.com' or host == 'www.footfetishforum.com':
            if re.match(r'^/attachments/[^/]+\.\d+/?', path):
                return True
            if re.search(r'/data/attachments/.+\.(?:jpe?g|png|gif|webp|bmp|avif|heic|heif|mp4|mov|m4v|webm|mkv)', path):
                return True
            return False  # andere FFF paden zijn HTML/forms/UI
        # Allow URLs met media-extensie (na de denies hierboven)
        if MEDIA_EXT_RE.search(url):
            return True
        # Externe hosts: pixhost, imgur, etc.
        for h in EXTERNAL_MEDIA_HOSTS:
            if host == h or host.endswith('.' + h):
                return True
    except Exception:
        pass
    return False


def extract_thread_media(html, base_url):
    """v2.2: pak FFF /attachments/<name>.<id>/ uit anchor-wrappers (= full versie),
    en mark de inline flc.nyc3 thumb-URLs als 'overruled by full' (skip).
    Voor upload.fff/pixhost/etc.: gewone attr+raw scan."""
    out = []
    seen = set()
    overruled = set()  # flc.nyc3 thumb URLs die al een full-anchor hebben

    # Stap 1: anchor-img pairs — pak href (= full), markeer img src (= thumb) als overruled
    for m in ANCHOR_IMG_RE.finditer(html):
        anchor_href = m.group(1)
        img_src = absolute_url(m.group(3), base_url)
        if img_src and FLC_THUMB_RE.match(img_src):
            overruled.add(img_src)
        final = absolute_url(anchor_href, base_url)
        if final and final not in seen and is_media_candidate(final):
            seen.add(final)
            out.append(final)

    def push(raw):
        final = absolute_url(raw, base_url)
        if not final or final in seen:
            return
        # v2.2: skip flc.nyc3 inline thumbs zonder anchor-wrap. Die zijn nooit full;
        # we hebben de anchor-wrappers al via stap 1 hierboven gepakt.
        if FLC_THUMB_RE.match(final):
            return
        if not is_media_candidate(final):
            return
        seen.add(final)
        out.append(final)
    for m in MEDIA_ATTR_RE.finditer(html):
        push(m.group(1))
    for m in MEDIA_RAW_RE.finditer(html):
        # strip trailing punctuation zoals server doet
        push(re.sub(r'[),\]."\']+$', '', m.group(1)))
    return out


def extract_next_thread_page(html, base_url):
    for pat in NEXT_PAGE_PATTERNS:
        m = pat.search(html)
        if m and m.group(1):
            return absolute_url(m.group(1), base_url)
    return ''


def walk_thread_for_media(cookies, thread_url, max_thread_pages=200, throttle_ms=200):
    """Walk alle pages van een thread, return lijst media-URLs."""
    media = []
    seen_pages = set()
    page_url = thread_url
    pages_visited = 0
    while page_url and pages_visited < max_thread_pages and page_url not in seen_pages:
        seen_pages.add(page_url)
        try:
            html, status = fetch_text(cookies, page_url)
        except Exception as e:
            print(f'    page-fetch FAIL {page_url}: {e}')
            break
        if status != 200:
            print(f'    page HTTP {status} {page_url} — stop')
            break
        page_media = extract_thread_media(html, page_url)
        for u in page_media:
            if u not in media:
                media.append(u)
        next_url = extract_next_thread_page(html, page_url)
        pages_visited += 1
        if not next_url or next_url == page_url:
            break
        page_url = next_url
        time.sleep(throttle_ms / 1000)
    return media, pages_visited


def post_gigascan_batch(forum_url, threads_media, forum_title, slug):
    """POST alle verzamelde media-URLs naar /gigascan/footfetishforum.
    threads_media: list of (thread_url, [media_urls])."""
    initial_urls = []
    source_contexts = {}
    seen = set()
    for thread_url, media_list in threads_media:
        ctx = {'url': thread_url, 'platform': 'footfetishforum'}
        for m in media_list:
            if m in seen:
                continue
            seen.add(m)
            initial_urls.append(m)
            source_contexts[m] = ctx
    payload = {
        'url': forum_url,
        'initialUrls': initial_urls,
        'sourceContexts': source_contexts,
        # Zet beide op 0: server moet GEEN forum/thread-walk doen (Cloudflare 403).
        # Python heeft alles al opgehaald en queue we direct via initialUrls.
        'maxForumPages': 0,
        'maxThreadPages': 0,
        'metadata': {
            'platform': 'footfetishforum',
            'source_forum_url': forum_url,
            'source_forum_slug': slug,
            'source_forum_title': forum_title or '',
            'requeue_reason': 'forum_walk_redownload',
        },
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(f'{SERVER}/gigascan/footfetishforum', data=data,
                                 headers={'Content-Type': 'application/json'},
                                 method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode('utf-8', errors='replace')
            try:
                obj = json.loads(body)
            except Exception:
                obj = {'raw': body[:200]}
            return True, obj, len(initial_urls)
    except Exception as e:
        return False, str(e), len(initial_urls)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('url', help='footfetishforum forum-URL (/forums/<slug>.<id>/)')
    ap.add_argument('--max-pages', type=int, default=200, help='max forum-pages om te walken')
    ap.add_argument('--max-threads', type=int, default=0, help='0 = onbeperkt')
    ap.add_argument('--max-thread-pages', type=int, default=200, help='max pages per thread')
    ap.add_argument('--dry-run', action='store_true', help='alleen tonen, geen POST')
    ap.add_argument('--throttle-ms', type=int, default=400, help='ms tussen page-fetches')
    args = ap.parse_args()

    info = parse_forum_url(args.url)
    if not info:
        print(f'FAIL: geen valide forum-URL: {args.url}', file=sys.stderr)
        sys.exit(1)

    profile = find_firefox_profile()
    print(f'Firefox profile : {profile}')
    cookies = load_fff_cookies(profile)
    print(f'FFF cookies     : {len(cookies)}')
    if 'xf_user' not in cookies:
        print('WARNING: geen xf_user cookie — niet ingelogd?', file=sys.stderr)

    forum_title = ''
    print(f'Forum slug      : {info["full_slug"]}')
    print(f'Mode            : {"DRY-RUN" if args.dry_run else "POST naar server"}')
    print()

    all_threads = []
    seen_ids = set()
    page = 1
    while page <= args.max_pages:
        page_url = args.url.rstrip('/') + '/' if page == 1 else args.url.rstrip('/') + f'/page-{page}'
        try:
            html, status = fetch_text(cookies, page_url)
        except Exception as e:
            print(f'  page {page} FAIL: {e}')
            break
        if status != 200:
            print(f'  page {page} HTTP {status} — stop')
            break
        threads = extract_threads(html)
        new = [(u, s, t) for (u, s, t) in threads if t not in seen_ids]
        for _, _, tid in new:
            seen_ids.add(tid)
        if page == 1:
            max_p = extract_max_page(html, info['full_slug'])
            forum_title = extract_forum_title(html)
            print(f'  detected max pages: {max_p}')
            print(f'  forum title       : {forum_title or "(niet gevonden)"}')
        print(f'  page {page}: {len(threads)} threads ({len(new)} nieuw)')
        if not new and page > 1:
            print('  geen nieuwe threads — stop walk')
            break
        all_threads.extend(new)
        if args.max_threads and len(all_threads) >= args.max_threads:
            all_threads = all_threads[:args.max_threads]
            break
        page += 1
        time.sleep(args.throttle_ms / 1000)

    print()
    print(f'Totaal threads: {len(all_threads)}')
    if not all_threads:
        print('Niets te queuen.')
        return

    if args.dry_run:
        print('\nDRY-RUN — eerste 20 threads:')
        for url, slug, tid in all_threads[:20]:
            print(f'  https://{FFF_HOST}/threads/{slug}.{tid}/')
        return

    # Per thread: walk pages, extract media-URLs (Python-side, Cloudflare-bypass).
    # Server kan FFF-HTML niet zelf ophalen (HTTP 403), dus wij doen het.
    print('\n=== Media-extractie ===')
    threads_media = []
    total_media = 0
    thread_pages_total = 0
    for i, (url, slug, tid) in enumerate(all_threads, 1):
        media, pages = walk_thread_for_media(cookies, url, args.max_thread_pages, args.throttle_ms)
        thread_pages_total += pages
        total_media += len(media)
        threads_media.append((url, media))
        print(f'  [{i}/{len(all_threads)}] {slug}.{tid} — pages={pages} media={len(media)}')
        time.sleep(args.throttle_ms / 1000)

    print()
    print(f'Threads gewalkt   : {len(threads_media)}')
    print(f'Thread-pages totaal: {thread_pages_total}')
    print(f'Media-URLs totaal : {total_media}')

    if total_media == 0:
        print('Geen media gevonden — niets te queuen.')
        return

    print('\n=== POST naar /gigascan/footfetishforum (batch) ===')
    ok, resp, queued_count = post_gigascan_batch(args.url, threads_media, forum_title, info['full_slug'])
    if ok:
        print(f'DONE. {queued_count} URLs gequeued via gigascan.')
        if isinstance(resp, dict) and resp.get('scanId'):
            print(f"scanId: {resp['scanId']}  — check: curl http://localhost:35729/gigascan/footfetishforum/{resp['scanId']}")
    else:
        print(f'FAIL: {resp}')


if __name__ == '__main__':
    main()
