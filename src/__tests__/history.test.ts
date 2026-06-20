import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, getUserDb } from '../lib/userDb'
import { messageToRecord } from '../lib/db'
import { pageOlderFromDexie, olderFilterFor, indexOfMessage } from '../lib/history'
import { GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND } from '../lib/nostr'
import type { Message } from '../store/nostrStore'

const PK = 'a'.repeat(64)

function rec(id: string, createdAt: number): Message {
  return { id, pubkey: 'p', content: id, createdAt, tags: [], kind: 42 }
}

describe('pageOlderFromDexie', () => {
  beforeEach(async () => {
    openUserDb(PK)
    const db = getUserDb()!
    await db.messages.clear()
    for (let t = 1; t <= 10; t++) await db.messages.put(messageToRecord('chat', rec(`m${t}`, t)))
  })

  afterEach(async () => {
    const db = getUserDb()
    if (db) await db.messages.clear()
    closeUserDb()
  })

  it('returns up to `limit` messages older than `before`, ascending', async () => {
    const page = await pageOlderFromDexie('chat', 8, 3)
    expect(page.map(m => m.createdAt)).toEqual([5, 6, 7])
  })

  it('excludes the boundary message at exactly `before`', async () => {
    const page = await pageOlderFromDexie('chat', 5, 10)
    expect(page.map(m => m.createdAt)).toEqual([1, 2, 3, 4])
  })

  it('returns an empty array when nothing is older', async () => {
    expect(await pageOlderFromDexie('chat', 1, 10)).toEqual([])
  })

  it('returns an empty array when the DB is closed', async () => {
    closeUserDb()
    expect(await pageOlderFromDexie('chat', 8, 3)).toEqual([])
  })
})

describe('indexOfMessage', () => {
  const msgs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as unknown as Message[]
  it('finds the index of a message by id', () => {
    expect(indexOfMessage(msgs, 'b')).toBe(1)
  })
  it('returns -1 when not present', () => {
    expect(indexOfMessage(msgs, 'z')).toBe(-1)
  })
})

describe('olderFilterFor', () => {
  it('builds a single #e filter for channels', () => {
    expect(olderFilterFor('channel', 'chan', 'me', 1000, 50)).toEqual([
      { kinds: [42], '#e': ['chan'], until: 1000, limit: 50 },
    ])
  })

  it('builds a kinds filter for groups including the legacy kind', () => {
    expect(olderFilterFor('group', 'grp', 'me', 1000, 50)).toEqual([
      { kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#e': ['grp'], until: 1000, limit: 50 },
    ])
  })

  it('builds two directional filters for DMs', () => {
    expect(olderFilterFor('dm', 'them', 'me', 1000, 50)).toEqual([
      { kinds: [4], authors: ['me'], '#p': ['them'], until: 1000, limit: 50 },
      { kinds: [4], authors: ['them'], '#p': ['me'], until: 1000, limit: 50 },
    ])
  })
})
