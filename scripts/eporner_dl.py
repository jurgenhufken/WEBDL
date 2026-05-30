#!/usr/bin/env python3
"""eporner_dl.py — scrape eporner.com tag/category/search URLs en queue
elke video via simple-server /download (yt-dlp Eporner extractor handelt download).

URL types:
  /tag/<term>/                     → tag listing (pagination /tag/<term>/N/)
  /category/<term>/                → category
  /search/<term>/                  → search
  /video-<id>/<slug>/              → single video → direct queue

Gebruik:
  python3 eporner_dl.py https://www.eporner.com/tag/teen-girl-webcam-feet/
  python3 eporner_dl.py <url> --max 50 --dry-run
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar


UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0'
BASE = 'https://www.eporner.com'
SERVER = 'http://localhost:35729'
VIDEO_LINK_RE = re.compile(r'/video-([A-Za-z0-9]+)/([a-z0-9-]+)/?', re.IGNORECASE)
LISTING_URL_RE = re.compile(
    r'^https?://(?:www\.)?eporner\.com/(tag|category|search)/([A-Za-z0-9_+-]+)/?(?:(\d+)/?)?/?$',
    re.IGNORECASE,
)
SINGLE_URL_RE = re.compile(r'^https?://(?:www\.)?eporner\.com/video-[A-Za-z0-9]+/', re.IGNORECASE)


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
        url = f'{BASE}/video-{vid_id}/{slug}/'
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


def walk_listing(o, source_url, kind, term, channel, max_videos, max_pages, throttle_ms, dry_run):
    print(f'== Walk eporner {kind}: {term} (channel={channel})')
    base_path = f'/{kind}/{term}'
    page = 1
    all_links = []
    all_ids = set()
    consecutive_empty = 0
    while page <= max_pages:
        url = f'{BASE}{base_path}/' if page == 1 else f'{BASE}{base_path}/{page}/'
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
        print(f'  page {page}: {len(links)} links ({len(new)} nieuw)')
        if not new:
            consecutive_empty += 1
            if consecutive_empty >= 2:
                print('  → 2× leeg → stop')
                break
        else:
            consecutive_empty = 0
        if max_videos and len(all_links) >= max_videos:
            break
        page += 1
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
            'platform': 'eporner',
            'channel': channel,
            'title': slug.replace('-', ' '),
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
        if i % 10 == 0 or i == 1 or i == len(all_links):
            print(f'  [{i}/{len(all_links)}] queued={queued} dup={dup} fail={fail}')
        time.sleep(throttle_ms / 1000)
    print(f'\nDONE. queued={queued} dup={dup} fail={fail}')
    print(f'Gallery filter: platform=eporner channel={channel}')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('url')
    p.add_argument('--channel-override', default=None)
    p.add_argument('--max', type=int, default=0)
    p.add_argument('--max-pages', type=int, default=100)
    p.add_argument('--throttle-ms', type=int, default=200)
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    o = make_opener()

    if SINGLE_URL_RE.match(args.url):
        channel = args.channel_override or 'unknown'
        if args.dry_run:
            print(f'DRY single: {args.url}')
            return
        r = post_download(args.url, {'platform': 'eporner', 'channel': channel, 'source_url': args.url})
        print(f'  → {r}')
        return

    m = LISTING_URL_RE.match(args.url.rstrip('/') + '/')
    if not m:
        print(f'Onbekend URL-formaat: {args.url}', file=sys.stderr)
        sys.exit(1)
    kind, term = m.group(1), m.group(2)
    channel = args.channel_override or f'{kind}_{term}'
    walk_listing(o, args.url, kind, term, channel, args.max, args.max_pages, args.throttle_ms, args.dry_run)


if __name__ == '__main__':
    main()
