#!/usr/bin/env python3
"""xvideos_search_dl.py — scrape xvideos.com search/tag URLs en queue elke
video via simple-server /download (yt-dlp XVideos extractor handelt download).

URL types:
  /?k=<query>                      → search (pagination ?p=N, 0..N)
  /tags/<tag>/                     → tag listing
  /channels/<channel>/             → channel
  /video.<id>/<slug>               → single video → direct queue

Pagination: ?p=N (0-based bij search)

Gebruik:
  python3 xvideos_search_dl.py 'https://www.xvideos.com/?k=webcam+feet'
  python3 xvideos_search_dl.py <url> --max 200 --dry-run
"""
import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar


UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0'
BASE = 'https://www.xvideos.com'
SERVER = 'http://localhost:35729'
VIDEO_LINK_RE = re.compile(r'/video\.([A-Za-z0-9]+)/([a-z0-9_-]+)', re.IGNORECASE)


def make_opener():
    cj = CookieJar()
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    o.addheaders = [('User-Agent', UA), ('Accept', 'text/html,*/*'), ('Accept-Language', 'en-US,en;q=0.5')]
    return o


def fetch_text(o, url, ref=None):
    req = urllib.request.Request(url)
    if ref:
        req.add_header('Referer', ref)
    with o.open(req, timeout=20) as resp:
        return resp.read().decode('utf-8', errors='replace')


def collect_video_links(html):
    seen = set()
    out = []
    for m in VIDEO_LINK_RE.finditer(html):
        vid_id = m.group(1)
        if vid_id in seen:
            continue
        seen.add(vid_id)
        slug = m.group(2)
        url = f'{BASE}/video.{vid_id}/{slug}'
        out.append((url, vid_id, slug))
    return out


def post_download(url, metadata):
    body = json.dumps({'url': url, 'metadata': metadata}).encode('utf-8')
    req = urllib.request.Request(f'{SERVER}/download', data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {'success': False, 'error': str(e)[:80]}


def detect_source(url):
    """Returns (kind, term, channel) — kind is 'search'/'tag'/'channel'/'profile'."""
    u = urllib.parse.urlparse(url)
    qs = urllib.parse.parse_qs(u.query)
    if qs.get('k'):
        term = qs['k'][0]
        return 'search', term, f'search_{term.replace(" ", "_").replace("+", "_")}'
    parts = [p for p in u.path.split('/') if p]
    if len(parts) >= 2 and parts[0] in ('tags', 'tag'):
        return 'tag', parts[1], f'tag_{parts[1]}'
    if len(parts) >= 2 and parts[0] == 'channels':
        return 'channel', parts[1], f'channel_{parts[1]}'
    if len(parts) >= 2 and parts[0] == 'profiles':
        return 'profile', parts[1], f'profile_{parts[1]}'
    return None, None, None


def walk(o, source_url, channel, max_videos, max_pages, throttle_ms, dry_run):
    print(f'== Walk xvideos: {source_url}')
    print(f'== Channel: {channel}')
    # Bouw paged-URL door ?p=N toe te voegen (en bestaande p te vervangen)
    u = urllib.parse.urlparse(source_url)
    qs = urllib.parse.parse_qs(u.query)
    base_qs = {k: v[0] for k, v in qs.items() if k != 'p'}

    def page_url(p):
        new_qs = {**base_qs, 'p': str(p)}
        return urllib.parse.urlunparse(u._replace(query=urllib.parse.urlencode(new_qs)))

    all_links = []
    all_ids = set()
    consecutive_empty = 0
    for page in range(max_pages):
        url = page_url(page)
        try:
            html = fetch_text(o, url, ref=BASE + '/')
        except Exception as e:
            print(f'  page {page} FAIL: {e}')
            break
        links = collect_video_links(html)
        new = [it for it in links if it[1] not in all_ids]
        for it in new:
            all_ids.add(it[1])
            all_links.append(it)
        print(f'  page {page}: {len(links)} ({len(new)} nieuw, totaal {len(all_links)})')
        if not new:
            consecutive_empty += 1
            if consecutive_empty >= 2:
                print('  → 2× leeg → stop')
                break
        else:
            consecutive_empty = 0
        if max_videos and len(all_links) >= max_videos:
            break
        time.sleep(throttle_ms / 1000)

    if max_videos:
        all_links = all_links[:max_videos]

    print(f'\n== Totaal: {len(all_links)} unique videos')
    if dry_run:
        for (url, vid, slug) in all_links[:10]:
            print(f'  DRY {url}')
        if len(all_links) > 10:
            print(f'  ... +{len(all_links)-10} meer')
        return

    queued = 0
    dup = 0
    fail = 0
    for i, (url, vid, slug) in enumerate(all_links, 1):
        metadata = {
            'platform': 'xvideos',
            'channel': channel,
            'title': slug.replace('_', ' '),
            'source_url': source_url,
            'webdl_pin_context': True,
        }
        r = post_download(url, metadata)
        if r.get('duplicate'):
            dup += 1
        elif r.get('success'):
            queued += 1
        else:
            fail += 1
        if i % 25 == 0 or i == 1 or i == len(all_links):
            print(f'  [{i}/{len(all_links)}] queued={queued} dup={dup} fail={fail}')
        time.sleep(throttle_ms / 1000)
    print(f'\nDONE. queued={queued} dup={dup} fail={fail}')
    print(f'Gallery filter: platform=xvideos channel={channel}')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('url')
    p.add_argument('--channel-override', default=None)
    p.add_argument('--max', type=int, default=0)
    p.add_argument('--max-pages', type=int, default=50)
    p.add_argument('--throttle-ms', type=int, default=200)
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    o = make_opener()

    # Single video?
    if re.search(r'/video\.[A-Za-z0-9]+/', args.url):
        channel = args.channel_override or 'unknown'
        if args.dry_run:
            print(f'DRY single: {args.url}')
            return
        r = post_download(args.url, {'platform': 'xvideos', 'channel': channel, 'source_url': args.url})
        print(f'  → {r}')
        return

    kind, term, default_channel = detect_source(args.url)
    if not kind:
        print(f'Onbekend URL-formaat: {args.url}', file=sys.stderr)
        sys.exit(1)
    channel = args.channel_override or default_channel
    walk(o, args.url, channel, args.max, args.max_pages, args.throttle_ms, args.dry_run)


if __name__ == '__main__':
    main()
