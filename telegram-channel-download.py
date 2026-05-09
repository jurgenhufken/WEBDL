#!/usr/bin/env python3
import os
import sys
import re
import asyncio
import argparse
from telethon import TelegramClient
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.contacts import SearchRequest
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

async def resolve_entity(client, chat_ref):
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

async def download_message(client, message, output_dir, semaphore, stats):
    """Download a single message's media with concurrency control"""
    async with semaphore:
        try:
            path = await message.download_media(file=output_dir)
            if path:
                stats['count'] += 1
                print(f"✅ [{stats['count']}] Downloaded: {os.path.basename(path)}")
            return True
        except Exception as e:
            print(f"⚠️  Error downloading message {message.id}: {e}")
            return False

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

    download_tasks = []
    semaphore = asyncio.Semaphore(parallel)
    stats = {'count': 0}

    async for message in client.iter_messages(entity, limit=message_limit):
        if message.media and isinstance(message.media, (MessageMediaPhoto, MessageMediaDocument)):
            print(f"📎 Message {message.id}: {type(message.media).__name__}")
            download_tasks.append(download_message(client, message, output_dir, semaphore, stats))
            if media_limit and len(download_tasks) >= media_limit:
                print(f"🎯 Media limit reached after message {message.id}")
                break
        elif message.media:
            print(f"📎 Message {message.id}: {type(message.media).__name__} (skipped)")
        else:
            print(f"💬 Message {message.id}: geen media")

    if download_tasks:
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
    parser.add_argument('parallel', nargs='?', type=int, default=5, help='simultaneous downloads')
    parser.add_argument('--with-linked', action='store_true', help='also download linked discussion/sub-chat when Telegram exposes one')
    parser.add_argument('--media-limit', type=int, default=None, help='stop after this many downloadable media messages')
    args = parser.parse_args()

    asyncio.run(download_channel(
        args.chat_ref,
        args.output_dir,
        message_limit=args.message_limit,
        parallel=args.parallel,
        with_linked=args.with_linked,
        media_limit=args.media_limit,
    ))
