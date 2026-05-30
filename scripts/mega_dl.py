#!/usr/bin/env python3
"""
mega_dl.py — download mega.nz files/folders via megatools + insert in DB.

Gebruik:
  python3 mega_dl.py <mega-url>                          # download 1 link
  python3 mega_dl.py --queue [--limit N]                 # walk pending DB-rows

Werkwijze:
- mega.nz/file/<id>#<key>      → 1 file (megatools dl)
- mega.nz/folder/<id>#<key>    → folder met sub-files (megatools dl recursief)
- Sub-folder syntax /folder/X/folder/Y wordt geconverteerd via megatools

Output: /Volumes/WEBDL Extra/WEBDL/mega/<folder-id>/<filename>
DB-update: status='completed', filepath, filesize per file.
"""

import sys
import os
import re
import subprocess
import argparse
from datetime import datetime

MEGATOOLS = "/opt/homebrew/bin/megatools"
BASE_DIR_CANDIDATES = [
    "/Volumes/WEBDL Extra/WEBDL/mega",
    "/Volumes/HDD - One Touch/WEBDL/mega",
    os.path.expanduser("~/Downloads/WEBDL/mega"),
]


def pick_basedir():
    for d in BASE_DIR_CANDIDATES:
        try:
            os.makedirs(d, exist_ok=True)
            if os.path.isdir(d):
                return d
        except Exception:
            continue
    raise RuntimeError("Geen geschikte BASE_DIR gevonden")


def is_mega_url(url):
    return bool(re.match(r"^https?://mega\.(?:nz|co\.nz)/", url, re.I))


def parse_mega_url(url):
    """Return ('file'|'folder', id, key, sub_path)."""
    m = re.match(r"^https?://mega\.(?:nz|co\.nz)/(file|folder)/([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)(/folder/[A-Za-z0-9_-]+)?", url, re.I)
    if not m:
        return None
    return {"kind": m.group(1), "id": m.group(2), "key": m.group(3), "sub": m.group(4) or ""}


def safe_dirname(name, max_len=80):
    name = re.sub(r"[^\w.-]+", "_", str(name).strip())
    return name.strip("_")[:max_len] or "mega_folder"


def download_one(url, base_dir, row_id=None):
    info = parse_mega_url(url)
    if not info:
        msg = f"geen geldige mega URL: {url[:80]}"
        print(f"  ERROR: {msg}")
        if row_id: update_db_error(row_id, msg)
        return False

    folder_name = safe_dirname(info["id"] + (info["sub"].replace("/", "_") if info["sub"] else ""))
    out_dir = os.path.join(base_dir, folder_name)
    os.makedirs(out_dir, exist_ok=True)

    print(f"[mega] {info['kind']}/{info['id']} → {out_dir}")
    # Geen subprocess timeout — grote folders (10+ GB) hebben uren nodig en megatools
    # is resume-safe (skipt complete files, hervat .megatmp.* bij re-run). Als hangen
    # echt voorkomt, beter detecteren via disk-progress check elders.
    try:
        result = subprocess.run(
            [MEGATOOLS, "dl", "--no-progress", "--path", out_dir, url],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            msg = f"megatools exit {result.returncode}: {result.stderr[:200] or result.stdout[:200]}"
            print(f"  ERROR: {msg}")
            if row_id: update_db_error(row_id, msg)
            return False
    except Exception as e:
        msg = f"megatools exception: {e}"
        print(f"  ERROR: {msg}")
        if row_id: update_db_error(row_id, msg)
        return False

    # Scan downloaded files + insert/update DB
    files = []
    for root, _, fnames in os.walk(out_dir):
        for fn in fnames:
            fp = os.path.join(root, fn)
            if os.path.isfile(fp) and os.path.getsize(fp) > 0:
                files.append(fp)
    print(f"  OK: {len(files)} files in {out_dir}")

    if not files:
        msg = "0 files na megatools dl (link mogelijk verlopen of geen public access)"
        print(f"  ERROR: {msg}")
        if row_id: update_db_error(row_id, msg)
        return False

    # Update parent row + insert ALL files (zodat gallery alles toont).
    # insert_child dedupt op filepath dus dubbel-aanroep is veilig.
    largest = max(files, key=os.path.getsize)
    largest_size = os.path.getsize(largest)
    channel = f"mega_{info['id']}"
    if row_id:
        update_db_completed(row_id, largest, largest_size)
    # 2026-05-30: ALTIJD alle files inserteren (was alleen non-largest, dat
    # liet button-triggered downloads zonder DB-rij voor de hoofdfile achter).
    for fp in files:
        if row_id and fp == largest:
            continue  # parent row al ge-updatet
        insert_child(url, fp, os.path.getsize(fp), channel)
    return True


def update_db_completed(row_id, filepath, filesize):
    safe_fp = filepath.replace("'", "''")
    sql = f"UPDATE downloads SET status='completed', filepath='{safe_fp}', filesize={filesize}, finished_at=NOW(), updated_at=NOW(), error=NULL WHERE id={row_id};"
    subprocess.run(["psql", "-U", "jurgen", "-d", "webdl", "-tAc", sql], capture_output=True, timeout=10)


def update_db_error(row_id, msg):
    safe = msg.replace("'", "''")[:500]
    sql = f"UPDATE downloads SET status='error', error='{safe}', updated_at=NOW() WHERE id={row_id};"
    subprocess.run(["psql", "-U", "jurgen", "-d", "webdl", "-tAc", sql], capture_output=True, timeout=10)


def insert_child(parent_url, filepath, filesize, channel):
    safe_url = parent_url.replace("'", "''")
    safe_fp = filepath.replace("'", "''")
    safe_ch = channel.replace("'", "''")
    fname = os.path.basename(filepath)
    title = os.path.splitext(fname)[0][:200].replace("'", "''")
    safe_fname = fname.replace("'", "''")
    fmt = os.path.splitext(fname)[1].lstrip('.').lower() or 'bin'
    meta = f'{{"platform":"mega","channel":"{safe_ch}","title":"{title}","url":"{safe_url}","adapter":"mega_dl","source_url":"{safe_url}","indexed_channel":"{safe_ch}"}}'
    sql = f"""
INSERT INTO downloads (url, platform, channel, title, status, metadata, source_url, filepath, filename, filesize, format, progress, created_at, updated_at, finished_at)
SELECT '{safe_url}', 'mega', '{safe_ch}', '{title}', 'completed', '{meta}'::jsonb, '{safe_url}', '{safe_fp}', '{safe_fname}', {filesize}, '{fmt}', 100, NOW(), NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM downloads WHERE filepath = '{safe_fp}');
"""
    subprocess.run(["psql", "-U", "jurgen", "-d", "webdl", "-tAc", sql], capture_output=True, timeout=10)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?", help="mega.nz URL")
    parser.add_argument("--queue", action="store_true", help="walk pending mega rows in DB")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    base_dir = pick_basedir()

    if args.queue:
        sql = f"""
SELECT id, url FROM downloads
WHERE (url ILIKE '%mega.nz/%' OR url ILIKE '%mega.co.nz/%')
  AND status IN ('pending', 'error')
ORDER BY id ASC LIMIT {args.limit};
"""
        result = subprocess.run(
            ["psql", "-U", "jurgen", "-d", "webdl", "-tAc", sql],
            capture_output=True, text=True, timeout=30
        )
        rows = [line.split("|", 1) for line in result.stdout.strip().split("\n") if "|" in line]
        print(f"== Queue: {len(rows)} mega-rows")
        ok, err = 0, 0
        for parts in rows:
            if len(parts) < 2: continue
            rid, url = parts[0].strip(), parts[1].strip()
            if download_one(url, base_dir, row_id=int(rid)):
                ok += 1
            else:
                err += 1
        print(f"\n== DONE: {ok} ok, {err} err")
    elif args.url:
        if not is_mega_url(args.url):
            print(f"Geen mega URL: {args.url}")
            sys.exit(1)
        sys.exit(0 if download_one(args.url, base_dir) else 1)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
