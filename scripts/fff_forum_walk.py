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

Channel = sub-forum slug (bv. "initiation-archive").
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


def post_whole_thread(thread_url, slug, channel):
    payload = {
        'url': thread_url,
        'metadata': {
            'platform': 'footfetishforum',
            'channel': channel,
            'webdl_kind': 'thread',
            'whole_thread': True,
            'source_forum_url': f"https://{FFF_HOST}/forums/{slug}",
            'source_forum_slug': slug,
            'requeue_reason': 'forum_walk_redownload',
        },
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(f'{SERVER}/download', data=data,
                                 headers={'Content-Type': 'application/json'},
                                 method='POST')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode('utf-8', errors='replace')
            try:
                obj = json.loads(body)
            except Exception:
                obj = {'raw': body[:200]}
            return True, obj
    except Exception as e:
        return False, str(e)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('url', help='footfetishforum forum-URL (/forums/<slug>.<id>/)')
    ap.add_argument('--max-pages', type=int, default=200)
    ap.add_argument('--max-threads', type=int, default=0, help='0 = onbeperkt')
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

    channel = info['slug']

    print(f'Forum slug      : {info["full_slug"]}')
    print(f'Channel         : {channel}')
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
            print(f'  detected max pages: {max_p}')
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

    ok = err = 0
    for i, (url, slug, tid) in enumerate(all_threads, 1):
        success, resp = post_whole_thread(url, info['full_slug'], channel)
        if success:
            ok += 1
            tag = 'dup' if (isinstance(resp, dict) and resp.get('duplicate')) else 'queued'
            print(f'  [{i}/{len(all_threads)}] {tag} {slug}.{tid}')
        else:
            err += 1
            print(f'  [{i}/{len(all_threads)}] FAIL {slug}.{tid}: {str(resp)[:80]}')
        time.sleep(0.05)

    print()
    print(f'DONE. ok={ok} err={err}')


if __name__ == '__main__':
    main()
