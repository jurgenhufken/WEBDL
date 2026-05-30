#!/usr/bin/env python3
"""
foot_video_dl.py — download een footstockings video page → mp4 op disk + DB-update.

Gebruik:
  python3 foot_video_dl.py <video-page-url>           # download 1 video
  python3 foot_video_dl.py --queue                    # walk alle pending footstockings video-rows
  python3 foot_video_dl.py --queue --limit 10         # max 10 items uit queue

Werkwijze:
- Fetch video-page HTML
- Extract `video_alt_url` (1080p) of `video_url` (720p) uit JS flashvars
- Download mp4 via urllib (premium-quality direct URL)
- Save naar /Volumes/WEBDL Extra/WEBDL/footstockings/<channel>/<title>/<id>_<quality>.mp4
- Update DB row: status='completed', filepath, filesize, finished_at
"""

import sys
import os
import re
import json
import urllib.request
import urllib.parse
import subprocess
import shutil
from urllib.error import HTTPError, URLError

BASE_DIR_CANDIDATES = [
    "/Volumes/WEBDL Extra/WEBDL/footstockings",
    "/Volumes/HDD - One Touch/WEBDL/footstockings",
    os.path.expanduser("~/Downloads/WEBDL/footstockings"),
]
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Firefox/115.0",
    "Accept": "*/*",
}
FETCH_TIMEOUT = 30
DOWNLOAD_TIMEOUT = 600     # 10 min voor een grote video
CHUNK = 1024 * 1024        # 1MB chunks


def pick_basedir():
    for d in BASE_DIR_CANDIDATES:
        try:
            os.makedirs(d, exist_ok=True)
            if os.path.isdir(d):
                return d
        except Exception:
            continue
    raise RuntimeError("Geen geschikte BASE_DIR gevonden")


def fetch_html(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_video_info(html):
    """Extract flashvars: video_url (720p), video_alt_url (1080p), video_id, title."""
    info = {}
    m = re.search(r"video_id:\s*'(\d+)'", html)
    if m:
        info["id"] = m.group(1)
    m = re.search(r"video_title:\s*'([^']+)'", html)
    if m:
        info["title"] = m.group(1)
    m = re.search(r"video_url:\s*'(https?://[^']+)'", html)
    if m:
        info["url_720p"] = m.group(1)
    m = re.search(r"video_alt_url:\s*'(https?://[^']+)'", html)
    if m:
        info["url_1080p"] = m.group(1)
    m = re.search(r"video_url_text:\s*'([^']+)'", html)
    if m:
        info["url_quality"] = m.group(1)
    m = re.search(r"video_alt_url_text:\s*'([^']+)'", html)
    if m:
        info["alt_quality"] = m.group(1)
    return info


def safe_filename(name, max_len=120):
    name = re.sub(r"[^\w\s\-_.()]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name[:max_len] or "untitled"


def download_file(url, out_path, expected_size_hint=None):
    """Download met streaming chunks. Returns (success, bytes_written, error_msg)."""
    tmp = out_path + ".part"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            written = 0
            with open(tmp, "wb") as f:
                while True:
                    chunk = resp.read(CHUNK)
                    if not chunk:
                        break
                    f.write(chunk)
                    written += len(chunk)
        os.replace(tmp, out_path)
        return True, written, ""
    except HTTPError as e:
        return False, 0, f"HTTP {e.code}: {e.reason}"
    except URLError as e:
        return False, 0, f"URL error: {e}"
    except Exception as e:
        try:
            if os.path.exists(tmp): os.unlink(tmp)
        except Exception:
            pass
        return False, 0, f"exception: {e}"


def ffprobe_duration(filepath):
    """Returns duration als 'HH:MM:SS' of '' bij fout."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", filepath],
            capture_output=True, text=True, timeout=15
        )
        sec = float(result.stdout.strip() or 0)
        if sec <= 0: return ""
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = int(sec % 60)
        if h > 0: return f"{h}:{m:02d}:{s:02d}"
        return f"{m}:{s:02d}"
    except Exception:
        return ""


def update_db_completed(row_id, filepath, filesize):
    """SQL UPDATE downloads SET status='completed', filepath, filesize, duration, finished_at=NOW()."""
    duration = ffprobe_duration(filepath)
    safe_fp = filepath.replace("'", "''")
    safe_dur = duration.replace("'", "''")
    sql = f"""
UPDATE downloads
SET status='completed', filepath='{safe_fp}', filesize={filesize},
    duration='{safe_dur}', finished_at=NOW(), updated_at=NOW(), error=NULL
WHERE id={row_id};
"""
    result = subprocess.run(
        ["psql", "-U", "jurgen", "-d", "webdl", "-tAc", sql],
        capture_output=True, text=True, timeout=10
    )
    return result.returncode == 0


def update_db_error(row_id, msg):
    safe_msg = msg.replace("'", "''")[:500]
    sql = f"UPDATE downloads SET status='error', error='{safe_msg}', updated_at=NOW() WHERE id={row_id};"
    subprocess.run(
        ["psql", "-U", "jurgen", "-d", "webdl", "-tAc", sql],
        capture_output=True, text=True, timeout=10
    )


def download_one(page_url, base_dir, channel="unknown", row_id=None):
    print(f"[fetch] {page_url}")
    try:
        html = fetch_html(page_url)
    except Exception as e:
        msg = f"fetch HTML faalde: {e}"
        print(f"  ERROR: {msg}")
        if row_id: update_db_error(row_id, msg)
        return False
    info = extract_video_info(html)
    if not info.get("id"):
        msg = "geen video_id in HTML — page-structuur veranderd?"
        print(f"  ERROR: {msg}")
        if row_id: update_db_error(row_id, msg)
        return False
    # Prefer 1080p
    mp4_url = info.get("url_1080p") or info.get("url_720p")
    quality = info.get("alt_quality") if info.get("url_1080p") else info.get("url_quality", "?")
    if not mp4_url:
        msg = "geen mp4 URL in flashvars"
        print(f"  ERROR: {msg}")
        if row_id: update_db_error(row_id, msg)
        return False

    title = info.get("title") or f"video_{info['id']}"
    safe_title = safe_filename(title)
    safe_channel = safe_filename(channel)
    out_dir = os.path.join(base_dir, safe_channel, safe_title)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{safe_title} [{info['id']}] {quality}.mp4")

    if os.path.exists(out_path) and os.path.getsize(out_path) > 10000:
        size = os.path.getsize(out_path)
        print(f"  SKIP: file already exists ({size//1024//1024} MB)")
        if row_id: update_db_completed(row_id, out_path, size)
        return True

    print(f"  download: {quality} → {out_path}")
    ok, written, err = download_file(mp4_url, out_path)
    if not ok:
        print(f"  ERROR: {err}")
        if row_id: update_db_error(row_id, err)
        return False
    print(f"  OK: {written//1024//1024} MB written")
    if row_id: update_db_completed(row_id, out_path, written)
    return True


def main():
    args = sys.argv[1:]
    if not args:
        print("Usage: foot_video_dl.py <video-page-url>  OR  foot_video_dl.py --queue [--limit N]")
        sys.exit(1)
    base_dir = pick_basedir()

    if args[0] == "--queue":
        limit = 1000
        if "--limit" in args:
            i = args.index("--limit")
            limit = int(args[i + 1])
        # Walk pending footstockings video rows
        sql = f"""
SELECT id, url, channel FROM downloads
WHERE platform='footstockings' AND status IN ('pending','queued','error')
  AND url ~ '^https?://(www\\.)?footstockings\\.com/videos/[0-9]+/'
ORDER BY id DESC LIMIT {limit};
"""
        result = subprocess.run(
            ["psql", "-U", "jurgen", "-d", "webdl", "-tAc", sql],
            capture_output=True, text=True, timeout=30
        )
        rows = [line.split("|") for line in result.stdout.strip().split("\n") if line.strip()]
        print(f"== Queue: {len(rows)} pending video-rows")
        ok, err = 0, 0
        for parts in rows:
            if len(parts) < 3: continue
            rid, url, channel = parts[0], parts[1], parts[2]
            if download_one(url, base_dir, channel=channel or "unknown", row_id=int(rid)):
                ok += 1
            else:
                err += 1
        print(f"\n== DONE: {ok} ok, {err} err")
    else:
        # Single video URL
        ok = download_one(args[0], base_dir, channel="manual")
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
