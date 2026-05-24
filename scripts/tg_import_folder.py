#!/usr/bin/env python3
"""Import Telegram-channel media-files from a hub-job folder into public.downloads.

Doel: files die het hub-tdl-script naar disk heeft geschreven NA dat de hub-job
zich 'done' markeerde, alsnog in de gallery laten verschijnen.

Dedup-strategie:
  1. Skip files waarvan het filepath al in public.downloads staat
  2. Skip files waarvan telegram_message_id (uit .json sidecar) al bestaat
     voor dit channel
  3. Sla zonder .json sidecar over (geen TG metadata = niet veilig importeren)

Gebruik:
  python3 tg_import_folder.py <folder> <channel_id> <channel_name> [--apply]

Voorbeeld:
  python3 tg_import_folder.py \\
    "/Volumes/WEBDL Extra/WEBDL/_4KDownloader/hub/47467" \\
    3667969449 "Feet vip"
  # → DRY-RUN, toont aantallen

  python3 tg_import_folder.py ... --apply
  # → echte INSERT
"""
import os
import sys
import json
import argparse
from datetime import datetime, timezone

try:
    import psycopg2
    from psycopg2.extras import Json
except ImportError:
    print("ERROR: psycopg2 niet gevonden. Install: pip3 install psycopg2-binary")
    sys.exit(1)


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('folder', help='folder met TG media + .json sidecars')
    p.add_argument('channel_id', help='Telegram channel id (numeriek)')
    p.add_argument('channel_name', help='display name van het channel')
    p.add_argument('--hub-job-id', default=None, help='hub-job id (default: afgeleid uit folder-naam)')
    p.add_argument('--apply', action='store_true', help='werkelijk inserteren (zonder = dry-run)')
    p.add_argument('--include-no-sidecar', action='store_true',
                   help='ook files zonder .json sidecar importeren (filepath als unique-key, geen TG message_id)')
    p.add_argument('--db', default='dbname=webdl', help='Postgres conn string')
    return p.parse_args()


def find_media_files(folder):
    if not os.path.isdir(folder):
        raise SystemExit(f"folder bestaat niet: {folder}")
    files = []
    for name in sorted(os.listdir(folder)):
        if name.startswith('.'):
            continue
        if name.endswith('.json'):
            continue
        full = os.path.join(folder, name)
        if os.path.isfile(full):
            files.append((name, full))
    return files


def load_sidecar(filepath):
    json_path = filepath + '.json'
    if not os.path.exists(json_path):
        return None
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def derive_msg_id(sidecar):
    if not sidecar:
        return None
    for k in ('telegram_message_id', 'message_id', 'msg_id', 'id'):
        v = sidecar.get(k)
        if v is None:
            continue
        try:
            return int(v)
        except (TypeError, ValueError):
            continue
    return None


def derive_title(filename, sidecar):
    if sidecar:
        for k in ('title', 'caption', 'text'):
            v = sidecar.get(k)
            if v and isinstance(v, str):
                return v.strip()[:200]
    base = filename.rsplit('.', 1)[0]
    return base[:200]


def derive_published_at(sidecar):
    if not sidecar:
        return None
    for k in ('date', 'message_date', 'source_published_at'):
        v = sidecar.get(k)
        if not v:
            continue
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v, tz=timezone.utc).isoformat()
        if isinstance(v, str):
            return v
    return None


def derive_ext(filename):
    if '.' not in filename:
        return ''
    return filename.rsplit('.', 1)[-1].lower()


def main():
    args = parse_args()
    folder = os.path.abspath(args.folder)
    hub_job_id = args.hub_job_id or os.path.basename(folder)

    print(f"Folder    : {folder}")
    print(f"Channel ID: {args.channel_id}")
    print(f"Channel   : {args.channel_name}")
    print(f"Hub job id: {hub_job_id}")
    print(f"Mode      : {'APPLY (echte INSERT)' if args.apply else 'DRY-RUN'}")
    print()

    conn = psycopg2.connect(args.db)
    cur = conn.cursor()

    # Dedup set: bestaande filepaths in deze folder
    cur.execute(
        "SELECT filepath FROM public.downloads WHERE filepath LIKE %s",
        (f"{folder}/%",),
    )
    existing_paths = {r[0] for r in cur.fetchall()}
    print(f"Bestaande records met filepath in deze folder: {len(existing_paths)}")

    # Dedup set: bestaande telegram_message_ids voor dit channel
    cur.execute(
        """
        SELECT DISTINCT (metadata::jsonb->>'telegram_message_id')
        FROM public.downloads
        WHERE platform='telegram'
          AND channel=%s
          AND metadata::jsonb ? 'telegram_message_id'
        """,
        (args.channel_name,),
    )
    existing_msg_ids = set()
    for (raw,) in cur.fetchall():
        try:
            existing_msg_ids.add(int(raw))
        except (TypeError, ValueError):
            continue
    print(f"Bestaande telegram_message_ids voor channel '{args.channel_name}': {len(existing_msg_ids)}")
    print()

    media = find_media_files(folder)
    to_import = []
    counters = {
        'total': len(media),
        'skip_path_dup': 0,
        'skip_msg_dup': 0,
        'skip_no_sidecar': 0,
        'skip_bad_json': 0,
        'to_import': 0,
    }

    for name, fpath in media:
        if fpath in existing_paths:
            counters['skip_path_dup'] += 1
            continue

        sidecar = load_sidecar(fpath)
        if sidecar is None:
            if not os.path.exists(fpath + '.json'):
                if not args.include_no_sidecar:
                    counters['skip_no_sidecar'] += 1
                    continue
            else:
                counters['skip_bad_json'] += 1
                continue

        msg_id = derive_msg_id(sidecar) if sidecar else None
        if msg_id is not None and msg_id in existing_msg_ids:
            counters['skip_msg_dup'] += 1
            continue

        try:
            st = os.stat(fpath)
        except OSError as e:
            print(f"  WARN: stat faalde voor {fpath}: {e}")
            continue

        to_import.append({
            'filename': name,
            'filepath': fpath,
            'filesize': st.st_size,
            'mtime': datetime.fromtimestamp(st.st_mtime, tz=timezone.utc),
            'msg_id': msg_id,
            'sidecar': sidecar,
        })

    counters['to_import'] = len(to_import)

    print("Telling:")
    for k in ('total', 'skip_path_dup', 'skip_msg_dup', 'skip_no_sidecar', 'skip_bad_json', 'to_import'):
        print(f"  {k:18s}: {counters[k]:5d}")
    print()

    if not to_import:
        print("Niks te importeren.")
        return

    if not args.apply:
        print("Voorbeeld van eerste 5 records die geinserted zouden worden:")
        for r in to_import[:5]:
            msg_id_str = str(r['msg_id']) if r['msg_id'] is not None else '(geen)'
            print(f"  msg_id={msg_id_str:>7}  {r['filename'][:50]:50s}  {r['filesize']/1024/1024:.1f} MB")
        print()
        print("(DRY-RUN. Run opnieuw met --apply om echt te inserteren.)")
        return

    # APPLY: insert per record
    now = datetime.now(tz=timezone.utc)
    inserted = 0
    failed = 0

    for r in to_import:
        sc = r['sidecar']
        msg_id = r['msg_id']
        published = derive_published_at(sc)
        title = derive_title(r['filename'], sc)
        ext = derive_ext(r['filename'])

        url = (
            f"https://t.me/c/{args.channel_id}/{msg_id}"
            if msg_id is not None
            else f"file://{r['filepath']}"
        )

        meta = {
            "adapter": "tdl",
            "hub_job_id": hub_job_id,
            "telegram_chat_title": args.channel_name,
            "indexed_channel": args.channel_name,
            "telegram_message_id": msg_id,
            "source_published_at": published,
            "source_thread_title": args.channel_name,
            "source_graph": {
                "nodes": [
                    {"type": "host", "platform": "telegram"},
                    {"type": "thread", "id": args.channel_id, "title": args.channel_name, "url": None},
                    {
                        "type": "post",
                        "id": str(msg_id) if msg_id is not None else None,
                        "url": url if msg_id is not None else None,
                        "title": title,
                    },
                ],
            },
            "_imported_at": now.isoformat(),
            "_import_source": "tg_import_folder.py",
        }

        try:
            cur.execute(
                """
                INSERT INTO public.downloads
                  (url, source_url, platform, channel, title, filename, filepath,
                   filesize, format, status, progress, metadata,
                   created_at, updated_at, finished_at, is_thumb_ready, priority)
                VALUES
                  (%s, %s, %s, %s, %s, %s, %s,
                   %s, %s, %s, %s, %s,
                   %s, %s, %s, %s, %s)
                """,
                (
                    url,
                    url,
                    'telegram',
                    args.channel_name,
                    title,
                    r['filename'],
                    r['filepath'],
                    r['filesize'],
                    ext,
                    'completed',
                    100,
                    json.dumps(meta),
                    now,
                    now,
                    r['mtime'],
                    False,
                    0,
                ),
            )
            conn.commit()
            inserted += 1
        except Exception as e:
            conn.rollback()
            print(f"  ERROR insert {r['filename']}: {e}")
            failed += 1

    print()
    print(f"Klaar. Inserted: {inserted}, Failed: {failed}")


if __name__ == '__main__':
    main()
