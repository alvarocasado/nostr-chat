import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  openUserDb,
  closeUserDb,
  getUserDb,
  getSetting,
  setSetting,
  deleteSetting,
  getActivePubkey,
  setActivePubkey,
  clearActivePubkey,
  evictOldMessages,
} from '../lib/userDb'
import { messageToRecord, recordToMessage } from '../lib/db'
import type { Message } from '../store/nostrStore'

// 64-char hex pubkey for tests
const TEST_PUBKEY = 'a'.repeat(64)

const baseMsg: Message = {
  id: 'msg1',
  pubkey: 'pk1',
  content: 'hello',
  createdAt: 1000,
  tags: [],
  kind: 42,
}

// ─── settings ────────────────────────────────────────────────────────────────

describe('userDb – settings', () => {
  beforeEach(() => {
    openUserDb(TEST_PUBKEY)
  })

  afterEach(async () => {
    const db = getUserDb()
    if (db) {
      await db.settings.clear()
      await db.messages.clear()
    }
    closeUserDb()
    clearActivePubkey()
  })

  it('getSetting returns fallback when DB is not open', async () => {
    closeUserDb()
    expect(await getSetting('foo', 'fallback')).toBe('fallback')
  })

  it('setSetting / getSetting round-trips a string', async () => {
    await setSetting('theme', 'dark')
    expect(await getSetting('theme', 'light')).toBe('dark')
  })

  it('getSetting returns fallback for a missing key', async () => {
    expect(await getSetting('nonexistent', 99)).toBe(99)
  })

  it('setSetting serializes complex objects', async () => {
    const val = { relays: ['wss://a.com'], count: 5 }
    await setSetting('complex', val)
    expect(await getSetting<typeof val>('complex', { relays: [], count: 0 })).toEqual(val)
  })

  it('deleteSetting removes the key', async () => {
    await setSetting('toDelete', 'val')
    await deleteSetting('toDelete')
    expect(await getSetting('toDelete', 'gone')).toBe('gone')
  })

  it('setSetting is a no-op when DB is not open', async () => {
    closeUserDb()
    await expect(setSetting('k', 'v')).resolves.toBeUndefined()
  })

  it('deleteSetting is a no-op when DB is not open', async () => {
    closeUserDb()
    await expect(deleteSetting('k')).resolves.toBeUndefined()
  })
})

// ─── localStorage helpers ────────────────────────────────────────────────────

describe('userDb – localStorage helpers', () => {
  afterEach(() => {
    clearActivePubkey()
  })

  it('setActivePubkey / getActivePubkey round-trip', () => {
    setActivePubkey(TEST_PUBKEY)
    expect(getActivePubkey()).toBe(TEST_PUBKEY)
  })

  it('clearActivePubkey removes the stored value', () => {
    setActivePubkey(TEST_PUBKEY)
    clearActivePubkey()
    expect(getActivePubkey()).toBeNull()
  })

  it('getActivePubkey returns null when nothing is stored', () => {
    expect(getActivePubkey()).toBeNull()
  })
})

// ─── message storage ─────────────────────────────────────────────────────────

describe('userDb – message storage', () => {
  beforeEach(() => {
    openUserDb(TEST_PUBKEY)
  })

  afterEach(async () => {
    const db = getUserDb()
    if (db) {
      await db.messages.clear()
      await db.settings.clear()
    }
    closeUserDb()
  })

  it('stores and retrieves a message by id', async () => {
    const db = getUserDb()!
    await db.messages.put(messageToRecord('ch1', baseMsg))
    const found = await db.messages.get('msg1')
    expect(found?.content).toBe('hello')
    expect(found?.chatId).toBe('ch1')
  })

  it('queries messages by chatId + createdAt index', async () => {
    const db = getUserDb()!
    await db.messages.put(messageToRecord('ch1', baseMsg))
    await db.messages.put(messageToRecord('ch1', { ...baseMsg, id: 'msg2', createdAt: 2000 }))
    await db.messages.put(messageToRecord('ch2', { ...baseMsg, id: 'msg3' }))

    const ch1msgs = await db.messages
      .where('[chatId+createdAt]')
      .between(['ch1', -Infinity], ['ch1', Infinity])
      .toArray()
    expect(ch1msgs).toHaveLength(2)
    expect(ch1msgs.every(m => m.chatId === 'ch1')).toBe(true)
  })

  it('evictOldMessages removes messages older than 7 days', async () => {
    const db = getUserDb()!
    const oldTs = Math.floor((Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000)
    const newTs = Math.floor(Date.now() / 1000)

    await db.messages.put(messageToRecord('ch1', { ...baseMsg, id: 'old', createdAt: oldTs }))
    await db.messages.put(messageToRecord('ch1', { ...baseMsg, id: 'new', createdAt: newTs }))

    await evictOldMessages()

    expect(await db.messages.get('old')).toBeUndefined()
    expect(await db.messages.get('new')).toBeDefined()
  })

  it('evictOldMessages is a no-op when DB is not open', async () => {
    closeUserDb()
    await expect(evictOldMessages()).resolves.toBeUndefined()
  })
})

// ─── messageToRecord / recordToMessage ───────────────────────────────────────

describe('messageToRecord / recordToMessage', () => {
  it('converts a minimal Message to a MessageRecord', () => {
    const record = messageToRecord('ch1', baseMsg)
    expect(record.id).toBe('msg1')
    expect(record.chatId).toBe('ch1')
    expect(record.content).toBe('hello')
    expect(record.createdAt).toBe(1000)
  })

  it('restores channelId from chatId when round-tripping', () => {
    const record = messageToRecord('ch1', baseMsg)
    const msg = recordToMessage(record)
    expect(msg.channelId).toBe('ch1')
    expect(msg.id).toBe('msg1')
  })

  it('preserves all optional fields through a round-trip', () => {
    const full: Message = {
      ...baseMsg,
      id: 'm2',
      kind: 4,
      channelId: 'dm',
      recipientPubkey: 'pk3',
      decrypted: true,
      tags: [['e', 'ref']],
      replyTo: { id: 'parent', pubkey: 'pk4', previewText: 'parent text' },
      status: 'sent',
    }
    const restored = recordToMessage(messageToRecord('dm', full))
    expect(restored.recipientPubkey).toBe('pk3')
    expect(restored.decrypted).toBe(true)
    expect(restored.replyTo).toEqual(full.replyTo)
    expect(restored.status).toBe('sent')
    expect(restored.tags).toEqual([['e', 'ref']])
  })
})
