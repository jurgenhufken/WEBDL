#!/usr/bin/env python3
"""hoes_tube_dl.py — scrape hoes.tube search/category URLs en queue elke
video via simple-server /download (yt-dlp handelt single-video download).

URL types:
  /search/<term>/                  → search (pagination N/ tot 0 nieuwe vids)
  /<category>/                     → category listing (zelfde walk)
  /videos/<id>/<slug>/             → single video → direct queueen

Walk:
  Probeer pagination patterns: /N/, /page-N/, ?page=N
  Eerste die ≥1 nieuwe /videos/ link levert → gebruiken
  Stop bij 2× achter elkaar geen nieuwe URLs

Gebruik:
  python3 hoes_tube_dl.py https://hoes.tube/search/teen-amateur-feet-webcam/
  python3 hoes_tube_dl.py <url> --max 50 --throttle-ms 200 --dry-run
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
BASE = 'https://hoes.tube'
SERVER = 'http://localhost:35729'
VIDEO_LINK_RE = re.compile(r'https?://(?:www\.)?hoes\.tube/videos/(\d+)/([a-z0-9-]+)', re.IGNORECASE)


def make_opener():
    cj = CookieJar()
    h = urllib.request.HTTPCookieProcessor(cj)
    o = urllib.request.build_opener(h)
    o.addheaders = [('User-Agent', UA), ('Accept', 'text/html,*/*'), ('Accept-Language', 'en-US,en;q=0.5')]
    return o


def fetch_text(o, url, ref=None):
    req = urllib.request.Request(url)
    if ref:
        req.add_header('Referer', ref)
    with o.open(req, timeout=20) as resp:
        return resp.read().decode('utf-8', errors='replace')


def collect_video_links(html):
    """Return list of unique (url, id, slug) tuples."""
    seen = set()
    out = []
    for m in VIDEO_LINK_RE.finditer(html):
        vid_id = m.group(1)
        if vid_id in seen:
            continue
        seen.add(vid_id)
        slug = m.group(2)
        # Normalize URL
        url = f'{BASE}/videos/{vid_id}/{slug}/'
        out.append((url, vid_id, slug))
    return out


def derive_channel(source_url):
    """Per URL-type: search_<term>, category_<name>, or 'unknown'."""
    try:
        u = urllib.parse.urlparse(source_url)
        segs = [s for s in u.path.split('/') if s]
        if len(segs) >= 2 and segs[0] == 'search':
            return f'search_{segs[1]}'
        if len(segs) == 1 and segs[0] not in ('videos', 'search'):
            return f'category_{segs[0]}'
    except Exception:
        pass
    return 'unknown'


def post_download(url, metadata):
    """POST naar simple-server /download. Returnt response dict."""
    body = json.dumps({'url': url, 'metadata': metadata}).encode('utf-8')
    req = urllib.request.Request(f'{SERVER}/download', data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {'success': False, 'error': str(e)[:80]}


def walk_listing(o, source_url, channel, max_videos, max_pages, throttle_ms, dry_run):
    print(f'== Walk: {source_url}')
    print(f'== Channel: {channel}')
    base = source_url.rstrip('/')
    # Probeer paging-templates in volgorde
    templates = [
        '{base}/{n}/',
        '{base}/page/{n}/',
        '{base}/?page={n}',
    ]
    # Detect which pagination werkt: fetch page 2 met elke template, kijk welk pat het meeste unieke nieuwe links levert
    page1_html = fetch_text(o, source_url, ref=f'{BASE}/')
    page1_links = collect_video_links(page1_html)
    if not page1_links:
        print(f'  page 1: GEEN video-links gevonden — abort')
        return
    print(f'  page 1: {len(page1_links)} video-links')

    base_seen = {vid for (_, vid, _) in page1_links}
    best_template = None
    if max_pages > 1:
        for tpl in templates:
            try:
                test_url = tpl.format(base=base, n=2)
                html = fetch_text(o, test_url, ref=source_url)
                links = collect_video_links(html)
                new_count = sum(1 for (_, vid, _) in links if vid not in base_seen)
                print(f'  test pattern {tpl}: page-2 → {len(links)} links, {new_count} nieuw')
                if new_count >= 5:
                    best_template = tpl
                    break
            except Exception as e:
                print(f'  test pattern {tpl}: FAIL {e}')
        if not best_template:
            print('  ⚠️  geen werkende pagination gevonden — alleen page 1 verwerken')

    # Verzamel alle URLs
    all_links = list(page1_links)
    all_ids = set(vid for (_, vid, _) in page1_links)
    consecutive_empty = 0
    if best_template:
        for n in range(2, max_pages + 1):
            url = best_template.format(base=base, n=n)
            try:
                html = fetch_text(o, url, ref=source_url)
            except Exception as e:
                print(f'  page {n} FAIL: {e}')
                break
            links = collect_video_links(html)
            new = [it for it in links if it[1] not in all_ids]
            for it in new:
                all_ids.add(it[1])
                all_links.append(it)
            print(f'  page {n}: {len(links)} links ({len(new)} nieuw)')
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
            'platform': 'hoestube',
            'channel': channel,
            'title': slug.replace('-', ' '),
            'source_url': source_url,
            'webdl_pin_context': True,
        }
        r = post_download(url, metadata)
        if r.get('duplicate'):
            dup += 1
            msg = 'DUP'
        elif r.get('success'):
            queued += 1
            msg = f'OK #{r.get("downloadId","?")}'
        else:
            fail += 1
            msg = f'FAIL {r.get("error","?")[:40]}'
        if i % 10 == 0 or i == 1 or i == len(all_links):
            print(f'  [{i}/{len(all_links)}] {msg}')
        time.sleep(throttle_ms / 1000)
    print(f'\nDONE. queued={queued} dup={dup} fail={fail}')
    print(f'Gallery filter: platform=hoestube channel={channel}')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('url', help='hoes.tube URL')
    p.add_argument('--channel-override', default=None)
    p.add_argument('--max', type=int, default=0, help='max aantal videos (0 = onbeperkt)')
    p.add_argument('--max-pages', type=int, default=100)
    p.add_argument('--throttle-ms', type=int, default=200)
    p.add_argument('--dry-run', action='store_true')
    args = p.parse_args()

    o = make_opener()

    # Single video?
    if re.match(r'^https?://(?:www\.)?hoes\.tube/videos/\d+/', args.url):
        channel = args.channel_override or 'unknown'
        print(f'== Single video: {args.url}')
        if args.dry_run:
            print(f'  DRY (single)')
            return
        r = post_download(args.url, {'platform': 'hoestube', 'channel': channel, 'source_url': args.url})
        print(f'  → {r}')
        return

    channel = args.channel_override or derive_channel(args.url)
    walk_listing(o, args.url, channel, args.max, args.max_pages, args.throttle_ms, args.dry_run)


if __name__ == '__main__':
    main()
