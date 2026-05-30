#!/usr/bin/env python3
import os
import sys
import re
import json
import asyncio
import argparse
from telethon import TelegramClient
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.contacts import SearchRequest
from telethon.tl.functions.messages import CheckChatInviteRequest, ImportChatInviteRequest
from telethon.tl.types import Channel, MessageMediaPhoto, MessageMediaDocument, PeerChannel

# Using Telegram Desktop API credentials (public, used by many open source tools)
API_ID = 2040
API_HASH = 'b18441a1ff607e10a989891a5462e627'

PHONE = os.getenv('TELEGRAM_PHONE', '')
SESSION_DIR = os.path.expanduser('~/.tdl')
SESSION_NAME = os.path.join(SESSION_DIR, 'webdl_telegram.session')

def safe_dir_name(value):
    value = re.sub(r'[^\w.-]+', '_', str(value).strip(), flags=re.UNICODE)
    return value.strip('_') or 'telegram_channel'

def normalize_chat_ref(chat_ref):
    chat_ref = str(chat_ref).strip()
    if chat_ref.startswith(('https://t.me/', 'http://t.me/', 'https://telegram.me/', 'http://telegram.me/')):
        chat_ref = re.sub(r'^https?://(?:t\.me|telegram\.me)/', '', chat_ref, flags=re.I)
        chat_ref = chat_ref.split('?', 1)[0].strip('/')
        if chat_ref.startswith('c/'):
            parts = chat_ref.split('/')
            if len(parts) >= 2 and parts[1].isdigit():
                return int('-100' + parts[1])
        chat_ref = chat_ref.split('/', 1)[0]
    if chat_ref.startswith('@'):
        chat_ref = chat_ref[1:]
    try:
        cid = int(chat_ref)
        # For groups/channels, Telegram commonly uses -100<id>.
        if cid > 0:
            cid = -1000000000000 - cid
        return cid
    except ValueError:
        return chat_ref

def invite_hash_from_ref(chat_ref):
    chat_ref = str(chat_ref).strip()
    chat_ref = chat_ref.split('?', 1)[0].strip()

    patterns = [
        r'^https?://(?:t\.me|telegram\.me)/\+([^/?#]+)',
        r'^https?://(?:t\.me|telegram\.me)/joinchat/([^/?#]+)',
        r'^tg://join\?invite=([^&#]+)',
        r'^\+([^/?#]+)$',
    ]
    for pattern in patterns:
        match = re.match(pattern, chat_ref, flags=re.I)
        if match:
            return match.group(1)
    return None

async def resolve_invite_entity(client, invite_hash):
    info = await client(CheckChatInviteRequest(invite_hash))
    chat = getattr(info, 'chat', None)
    if chat is not None:
        return chat

    updates = await client(ImportChatInviteRequest(invite_hash))
    chats = getattr(updates, 'chats', None) or []
    if chats:
        return chats[0]
    raise RuntimeError(f"Invite link resolved without a chat: {invite_hash}")

async def resolve_entity(client, chat_ref):
    invite_hash = invite_hash_from_ref(chat_ref)
    if invite_hash:
        return await resolve_invite_entity(client, invite_hash)

    normalized = normalize_chat_ref(chat_ref)
    try:
        return await client.get_entity(normalized)
    except Exception:
        if isinstance(normalized, int):
            raise
        result = await client(SearchRequest(q=str(chat_ref), limit=10))
        needle = str(chat_ref).strip().lower().replace('@', '')
        candidates = list(result.chats) + list(result.users)
        for candidate in candidates:
            username = (getattr(candidate, 'username', '') or '').lower()
            title = (getattr(candidate, 'title', '') or getattr(candidate, 'first_name', '') or '').lower()
            if username == needle or title == needle or needle in title:
                return candidate
        raise

def message_source_url(entity, message):
    username = getattr(entity, 'username', None)
    if username:
        return f"https://t.me/{username}/{message.id}"
    entity_id = str(getattr(entity, 'id', '') or '')
    if entity_id.startswith('-100'):
        entity_id = entity_id[4:]
    if entity_id:
        return f"https://t.me/c/{entity_id}/{message.id}"
    return ''

def message_title(message, file_path, chat_title=''):
    caption = str(getattr(message, 'message', '') or '').strip()
    if caption:
        caption = re.sub(r'\s+', ' ', caption)
        return caption[:140].strip()

    file_name = getattr(getattr(message, 'file', None), 'name', None)
    stem = ''
    if file_name:
        stem = os.path.splitext(file_name)[0].replace('_', ' ').strip()
    if not stem:
        stem = os.path.splitext(os.path.basename(str(file_path or '')))[0].replace('_', ' ').strip()

    if re.match(r'^(?:document|video|photo)(?:\s+\d{4}|\s*$)', stem, flags=re.I):
        prefix = str(chat_title or 'Telegram').strip() or 'Telegram'
        return f"{prefix} #{message.id}"
    return stem or f"Telegram #{message.id}"

def topic_id_for_message(message):
    reply_to = getattr(message, 'reply_to', None)
    return getattr(reply_to, 'reply_to_top_id', None) or getattr(reply_to, 'reply_to_msg_id', None)

async def collect_topic_titles(client, entity):
    topics = {}
    if not getattr(entity, 'forum', False):
        return topics
    async for message in client.iter_messages(entity, limit=None):
        action = getattr(message, 'action', None)
        title = getattr(action, 'title', None)
        if title:
            topics[message.id] = str(title)
    return topics

def write_sidecar(file_path, entity, message, chat_title, topic_titles=None, channel_info=None):
    if not file_path:
        return
    try:
        topic_titles = topic_titles or {}
        channel_info = channel_info or {}
        topic_id = topic_id_for_message(message)
        topic_title = topic_titles.get(topic_id, '') if topic_id else ''
        source_url = message_source_url(entity, message)
        channel_title = topic_title or chat_title
        uploader_url = f"https://t.me/{getattr(entity, 'username', '')}" if getattr(entity, 'username', None) else ''
        title = message_title(message, file_path, channel_title)

        # File metadata
        file_obj = getattr(message, 'file', None)
        file_name = getattr(file_obj, 'name', None) or os.path.basename(str(file_path))
        file_size = getattr(file_obj, 'size', None) or (os.path.getsize(file_path) if os.path.exists(file_path) else None)
        mime_type = getattr(file_obj, 'mime_type', None) or ''
        duration = getattr(file_obj, 'duration', None)
        width = getattr(file_obj, 'width', None)
        height = getattr(file_obj, 'height', None)

        # Media type
        ext = os.path.splitext(str(file_path))[1].lower()
        if ext in ('.mp4', '.mkv', '.webm', '.avi', '.mov'):
            media_type = 'video'
        elif ext in ('.jpg', '.jpeg', '.png', '.gif', '.webp'):
            media_type = 'image'
        else:
            media_type = 'document'

        # Message metadata
        caption = str(getattr(message, 'message', '') or '').strip()
        views = getattr(message, 'views', None)
        forwards = getattr(message, 'forwards', None)
        edit_date = getattr(message, 'edit_date', None)

        # Entity type
        entity_type = type(entity).__name__  # Channel, Chat, User, etc.

        metadata = {
            'extractor_key': 'telegram',
            'platform': 'telegram',
            'channel': channel_title,
            'uploader': chat_title,
            'playlist_title': chat_title,
            'channel_id': str(getattr(entity, 'id', '') or ''),
            'channel_url': uploader_url,
            'channel_username': getattr(entity, 'username', None),
            'channel_type': entity_type,
            'channel_subscribers': channel_info.get('subscribers'),
            'channel_about': channel_info.get('about'),
            'channel_photo': channel_info.get('has_photo', False),
            'uploader_id': str(getattr(entity, 'id', '') or ''),
            'uploader_url': uploader_url,
            'fulltitle': title,
            'title': title,
            'description': caption if caption else None,
            'filename': file_name,
            'filesize': file_size,
            'mime_type': mime_type,
            'media_type': media_type,
            'duration': duration,
            'width': width,
            'height': height,
            'webpage_url': source_url,
            'original_url': source_url,
            'url': source_url,
            'timestamp': int(message.date.timestamp()) if getattr(message, 'date', None) else None,
            'upload_date': message.date.strftime('%Y%m%d') if getattr(message, 'date', None) else None,
            'modified_date': int(edit_date.timestamp()) if edit_date else None,
            'view_count': views,
            'forward_count': forwards,
            'source_site': 'telegram',
            'source_thread_title': chat_title,
            'source_post_title': title,
            'source_post_id': str(message.id),
            'source_post_url': source_url,
            'telegram_message_id': message.id,
            'telegram_chat_title': chat_title,
            'telegram_topic_title': topic_title,
            'telegram_topic_id': topic_id,
        }
        # Remove None values for cleaner JSON
        metadata = {k: v for k, v in metadata.items() if v is not None}
        with open(str(file_path) + '.json', 'w', encoding='utf-8') as fh:
            json.dump(metadata, fh, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️  Could not write metadata for message {message.id}: {e}")

async def download_message(client, message, output_dir, semaphore, stats, entity=None, topic_titles=None):
    """Download a single message's media with concurrency control.
    2026-05-30 (Jürgen "direct in gallery"): direct na succesvolle download
    een DB-row inserten zodat het item binnen seconden in de gallery verschijnt
    (i.p.v. te wachten op tg_auto_import.sh cycle van 3 min).
    """
    async with semaphore:
        try:
            path = await message.download_media(file=output_dir)
            if path:
                if entity is not None:
                    write_sidecar(path, entity, message, stats.get('chat_title') or '', topic_titles=topic_titles, channel_info=stats.get('channel_info'))
                    # Direct DB-insert zodat gallery dit item direct toont
                    try:
                        _insert_to_db_immediate(path, entity, message, stats)
                    except Exception as _e:
                        print(f"⚠️  DB-insert faalde voor {message.id}: {_e}")
                stats['count'] += 1
                total = stats.get('total') or 0
                if total:
                    pct = min(100, max(0, (stats['count'] / total) * 100))
                    print(f"PROG pct={pct:.1f}%")
                print(f"✅ [{stats['count']}] Downloaded: {os.path.basename(path)}")
            return True
        except Exception as e:
            print(f"⚠️  Error downloading message {message.id}: {e}")
            return False


# === DB-insert direct na download (Jürgen 2026-05-30) ===
_DB_CONN = None
def _get_db():
    global _DB_CONN
    if _DB_CONN is None or _DB_CONN.closed:
        try:
            import psycopg2
            _DB_CONN = psycopg2.connect("dbname=webdl user=jurgen host=localhost")
            _DB_CONN.autocommit = True
        except Exception as e:
            print(f"⚠️  Geen DB-conn: {e}")
            return None
    return _DB_CONN


def _insert_to_db_immediate(filepath, entity, message, stats):
    """Insert row in public.downloads als completed. Dedup via filepath uniek.
    Veilig om herhaaldelijk te roepen (ON CONFLICT DO NOTHING)."""
    conn = _get_db()
    if conn is None:
        return
    import os as _os
    channel_username = getattr(entity, 'username', None)
    channel_id = str(getattr(entity, 'id', '') or '')
    channel_name = channel_username or channel_id or 'telegram'
    chat_title = stats.get('chat_title') or channel_name
    # title uit message
    media_type = type(message.media).__name__ if message.media else 'unknown'
    title = (str(getattr(message, 'message', '') or '').strip()[:120] or _os.path.basename(filepath))[:200]
    duration_sec = 0
    try:
        from telethon.tl.types import DocumentAttributeVideo, DocumentAttributeAudio
        if hasattr(message.media, 'document') and message.media.document is not None:
            for attr in message.media.document.attributes or []:
                if isinstance(attr, (DocumentAttributeVideo, DocumentAttributeAudio)):
                    duration_sec = int(getattr(attr, 'duration', 0) or 0)
                    break
    except Exception:
        pass
    h, rem = divmod(duration_sec, 3600)
    m, s = divmod(rem, 60)
    duration_str = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}" if duration_sec else ''
    file_size = _os.path.getsize(filepath) if _os.path.exists(filepath) else 0
    source_url = f"https://t.me/{channel_username}/{message.id}" if channel_username else f"https://t.me/c/{channel_id}/{message.id}"
    import json as _json
    metadata = _json.dumps({
        'platform': 'telegram',
        'channel': channel_name,
        'channel_title': chat_title,
        'channel_id': channel_id,
        'telegram_message_id': message.id,
        'media_type': media_type,
        'duration_sec': duration_sec,
    })
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO downloads (url, platform, channel, title, status, metadata, source_url, filepath, filesize, duration, created_at, updated_at, finished_at)
            VALUES (%s, 'telegram', %s, %s, 'completed', %s::jsonb, %s, %s, %s, %s, NOW(), NOW(), NOW())
            ON CONFLICT DO NOTHING
        """, (source_url, channel_name, title, metadata, source_url, filepath, file_size, duration_str))

async def download_entity(client, chat_id, output_dir, message_limit=None, parallel=5, with_linked=False, seen=None, media_limit=None):
    """Download media from a Telegram channel/chat using an already connected client."""
    seen = seen or set()
    entity = await resolve_entity(client, chat_id)
    entity_id = getattr(entity, 'id', chat_id)
    if entity_id in seen:
        print(f"↩️  Already handled: {getattr(entity, 'title', chat_id)}")
        return
    seen.add(entity_id)
    title = getattr(entity, 'title', None) or getattr(entity, 'username', None) or str(chat_id)
    print(f"📋 Using chat: {title} ({entity_id})")
    print(f"📥 Downloading from: {title}")
    print(f"⚡ Parallel downloads: {parallel} simultaneous")
    if message_limit:
        print(f"🔎 Message scan limit: {message_limit}")
    if media_limit:
        print(f"🎯 Media limit: {media_limit}")

    os.makedirs(output_dir, exist_ok=True)

    # Collect channel info
    channel_info = {}
    try:
        if isinstance(entity, Channel):
            full = await client(GetFullChannelRequest(entity))
            fc = full.full_chat
            channel_info = {
                'subscribers': getattr(fc, 'participants_count', None),
                'about': getattr(fc, 'about', None) or '',
                'has_photo': bool(getattr(entity, 'photo', None)),
            }
            print(f"ℹ️  Channel info: {channel_info.get('subscribers', '?')} subscribers")
            if channel_info.get('about'):
                print(f"📝 About: {channel_info['about'][:100]}")
    except Exception as e:
        print(f"⚠️  Could not fetch channel info: {e}")

    topic_titles = await collect_topic_titles(client, entity)
    if topic_titles:
        print("🧵 Topics: " + ", ".join(sorted(set(topic_titles.values()))))

    download_tasks = []
    semaphore = asyncio.Semaphore(parallel)
    stats = {'count': 0, 'chat_title': title, 'channel_info': channel_info}

    async for message in client.iter_messages(entity, limit=message_limit):
        if message.media and isinstance(message.media, (MessageMediaPhoto, MessageMediaDocument)):
            print(f"📎 Message {message.id}: {type(message.media).__name__}")
            download_tasks.append(download_message(client, message, output_dir, semaphore, stats, entity=entity, topic_titles=topic_titles))
            if media_limit and len(download_tasks) >= media_limit:
                print(f"🎯 Media limit reached after message {message.id}")
                break
        elif message.media:
            print(f"📎 Message {message.id}: {type(message.media).__name__} (skipped)")
        else:
            print(f"💬 Message {message.id}: geen media")

    if download_tasks:
        stats['total'] = len(download_tasks)
        print(f"\n⚡ Starting {len(download_tasks)} downloads...")
        await asyncio.gather(*download_tasks)

    print(f"\n🎉 Done! Downloaded {stats['count']} files to {output_dir}")

    if with_linked and isinstance(entity, Channel):
        try:
            full = await client(GetFullChannelRequest(entity))
            linked_id = getattr(full.full_chat, 'linked_chat_id', None)
            if linked_id:
                linked = await client.get_entity(PeerChannel(linked_id))
                linked_title = getattr(linked, 'title', None) or str(linked_id)
                linked_dir = os.path.join(os.path.dirname(output_dir), f"{safe_dir_name(title)}__linked__{safe_dir_name(linked_title)}")
                print(f"\n🔗 Linked chat found: {linked_title}")
                await download_entity(client, linked_id, linked_dir, message_limit, parallel, with_linked=False, seen=seen, media_limit=media_limit)
            else:
                print("🔗 No linked chat found")
        except Exception as e:
            print(f"⚠️  Could not inspect linked chat: {e}")

async def download_channel(chat_id, output_dir, message_limit=None, parallel=5, with_linked=False, media_limit=None):
    """Download media from a Telegram channel/chat with parallel downloads."""
    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
    if PHONE:
        await client.start(phone=PHONE)
    else:
        await client.start()
    print(f"✅ Connected to Telegram")

    try:
        await download_entity(client, chat_id, output_dir, message_limit, parallel, with_linked, seen=set(), media_limit=media_limit)
    
    finally:
        await client.disconnect()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Download media from a Telegram chat/channel using the local ~/.tdl Telethon session.'
    )
    parser.add_argument('chat_ref', help='chat_id, @username, t.me URL, or search name')
    parser.add_argument('output_dir')
    parser.add_argument('message_limit', nargs='?', type=int, help='maximum messages to scan')
    parser.add_argument('parallel_positional', nargs='?', type=int, help='simultaneous downloads (legacy positional)')
    parser.add_argument('--parallel', type=int, default=None, help='simultaneous downloads')
    parser.add_argument('--with-linked', action='store_true', help='also download linked discussion/sub-chat when Telegram exposes one')
    parser.add_argument('--media-limit', type=int, default=None, help='stop after this many downloadable media messages')
    args = parser.parse_args()

    asyncio.run(download_channel(
        args.chat_ref,
        args.output_dir,
        message_limit=args.message_limit,
        parallel=args.parallel or args.parallel_positional or 5,
        with_linked=args.with_linked,
        media_limit=args.media_limit,
    ))
