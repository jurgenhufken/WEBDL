#!/usr/bin/env python3
"""Expand een footstockings.com listing-page (search/category/model/etc.)
naar individuele video-URLs en schiet ze in via simple-server /download.

Usage:
  python3 foot_expand.py <listing-url> [--apply] [--max N] [--pages N]

Voorbeeld:
  # Dry-run: toon wat zou worden ingeschoten
  python3 foot_expand.py https://footstockings.com/search/flexible-feet-joi/

  # Echt inschieten via simple-server, alleen page 1
  python3 foot_expand.py https://footstockings.com/search/flexible-feet-joi/ --apply

  # Meerdere pages
  python3 foot_expand.py https://footstockings.com/models/stella-liberty/ --apply --pages 3

Geldige listing-types: /search/, /categories/, /models/, /channels/,
  /playlists/, /latest-updates/, /most-popular/, /albums/

Single-video URLs (/videos/<id>/<slug>/) worden direct doorgezet zonder expansion.
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request


UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0'
VIDEO_LINK_RE = re.compile(r'href="(https://footstockings\.com/videos/\d+/[^"]+/)"')
# Hoofdcontainer met de echte zoek-/listing-resultaten — voorkomt dat
# "related videos" of sidebar-suggesties worden opgepakt.
MAIN_CONTAINER_RE = re.compile(
    r'<div\s+class="list-videos[^"]*">(.*?)</div>\s*</div>\s*</div>',
    re.DOTALL,
)
SIMPLE_SERVER_DOWNLOAD = 'http://localhost:35729/download'

LISTING_PATTERNS = [
    r'/search/[^/]+/?',
    r'/categories/[^/]+/?',
    r'/models/[^/]+/?',
    r'/channels/[^/]+/?',
    r'/playlists/[^/]+/?',
    r'/latest-updates/?',
    r'/most-popular/?',
    r'/albums/[^/]*/?',
    r'/[^/]+/?',  # fallback voor andere top-level paden
]


def fetch_page(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode('utf-8', errors='replace')


def extract_video_urls(html):
    """Pak unieke /videos/<id>/<slug>/ links uit de .list-videos hoofdcontainer.

    Negeert "related videos" / sidebar / footer-suggesties zodat we alleen
    het echte zoek-/listing-resultaat krijgen — niet wat de site er omheen
    promoot.
    """
    main_blocks = MAIN_CONTAINER_RE.findall(html)
    if not main_blocks:
        # Fallback: hele pagina (voor URL-types zonder .list-videos container)
        scope = html
    else:
        scope = '\n'.join(main_blocks)
    seen = set()
    out = []
    for url in VIDEO_LINK_RE.findall(scope):
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def derive_listing_label(url):
    parts = urllib.parse.urlparse(url).path.strip('/').split('/')
    if len(parts) >= 2:
        return f"{parts[0]}_{parts[1]}"
    if len(parts) >= 1:
        return parts[0]
    return 'footstockings_listing'


def is_single_video(url):
    return bool(re.search(r'/videos/\d+/[^/]+/?$', urllib.parse.urlparse(url).path))


def pagination_url(base_url, page):
    """Footstockings gebruikt typisch /<path>/<page>/ als pagination."""
    if page <= 1:
        return base_url
    parsed = urllib.parse.urlparse(base_url)
    path = parsed.path.rstrip('/')
    new_path = f"{path}/{page}/"
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, new_path,
                                      parsed.params, parsed.query, parsed.fragment))


def post_download(url, channel, title):
    body = json.dumps({
        'url': url,
        'platform': 'footstockings',
        'channel': channel,
        'title': title,
    }).encode('utf-8')
    req = urllib.request.Request(
        SIMPLE_SERVER_DOWNLOAD,
        data=body,
        method='POST',
        headers={'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {'success': False, 'error': f'HTTP {e.code}', 'detail': e.read().decode('utf-8', errors='replace')[:200]}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('url', help='footstockings listing-URL of single video-URL')
    p.add_argument('--apply', action='store_true', help='werkelijk inschieten via /download (zonder = dry-run)')
    p.add_argument('--max', type=int, default=0, help='maximum aantal videos om te pakken (0 = onbeperkt)')
    p.add_argument('--pages', type=int, default=1, help='hoeveel pagination-pages doorlopen (default 1)')
    args = p.parse_args()

    label = derive_listing_label(args.url)
    print(f"URL    : {args.url}")
    print(f"Label  : {label}")
    print(f"Mode   : {'APPLY (echte POSTs)' if args.apply else 'DRY-RUN'}")
    print(f"Pages  : {args.pages}")
    print()

    if is_single_video(args.url):
        print("Detectie: single-video URL. Direct doorzetten zonder expansion.")
        if args.apply:
            res = post_download(args.url, label, '')
            print(f"  {json.dumps(res)[:200]}")
        else:
            print(f"  zou POST: {args.url}")
        return

    all_urls = []
    for page in range(1, args.pages + 1):
        page_url = pagination_url(args.url, page)
        print(f"--- Page {page}: {page_url} ---")
        try:
            html = fetch_page(page_url)
        except Exception as e:
            print(f"  fetch faalde: {e}")
            break
        urls = extract_video_urls(html)
        print(f"  Gevonden: {len(urls)} video-links")
        if not urls and page > 1:
            print("  (geen videos meer - einde pagination)")
            break
        all_urls.extend(urls)

    # Dedup nogmaals over pages
    seen = set()
    unique = [u for u in all_urls if not (u in seen or seen.add(u))]
    print()
    print(f"Totaal unieke videos: {len(unique)}")
    if args.max > 0 and len(unique) > args.max:
        print(f"  Beperk tot --max {args.max}")
        unique = unique[:args.max]

    if not unique:
        print("Geen video-URLs gevonden.")
        return

    if not args.apply:
        print()
        print("Eerste 5 die geinserted zouden worden:")
        for u in unique[:5]:
            print(f"  {u}")
        print()
        print("(DRY-RUN. Run opnieuw met --apply om in te schieten.)")
        return

    ok, dup, fail = 0, 0, 0
    print()
    print("Inschieten via simple-server...")
    for u in unique:
        res = post_download(u, label, '')
        if res.get('success'):
            if res.get('duplicate'):
                dup += 1
            else:
                ok += 1
        else:
            fail += 1
            print(f"  FAIL {u}: {res.get('error')}")

    print()
    print(f"Klaar. Nieuw: {ok}, Duplicate: {dup}, Failed: {fail}, Totaal: {len(unique)}")


if __name__ == '__main__':
    main()
