import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { openUserDb, closeUserDb, getUserDb } from '../lib/userDb'
import { messageToRecord } from '../lib/db'
import { useNostrStore } from '../store/nostrStore'
import { useChatHistory } from '../hooks/useChatHistory'
import type { Message } from '../store/nostrStore'

const PK = 'c'.repeat(64)
const m = (id: string, t: number): Message => ({ id, pubkey: 'p', content: id, createdAt: t, tags: [], kind: 42 })

describe('useChatHistory (Dexie load-older)', () => {
  beforeEach(async () => {
    openUserDb(PK)
    const db = getUserDb()!
    await db.messages.clear()
    // 1..10 persisted; window starts with 8,9,10 in memory
    for (let t = 1; t <= 10; t++) await db.messages.put(messageToRecord('chat', m(`m${t}`, t)))
    useNostrStore.setState({ relays: ['wss://r'], messages: { chat: [m('m8', 8), m('m9', 9), m('m10', 10)] } })
  })
  afterEach(async () => {
    const db = getUserDb()
    if (db) await db.messages.clear()
    closeUserDb()
  })

  it('prepends an older page from Dexie and reports the count', async () => {
    const { result } = renderHook(() => useChatHistory('chat', 'channel', PK))
    let added = 0
    await act(async () => { added = await result.current.loadOlder() })
    expect(added).toBe(7) // createdAt 1..7 are all older than 8 and fit within OLDER_PAGE
    expect(useNostrStore.getState().messages['chat'][0].createdAt).toBe(1)
    expect(result.current.exhausted).toBe(false)
  })

  it('marks exhausted when Dexie has nothing older (relay added later)', async () => {
    useNostrStore.setState({ messages: { chat: [m('m1', 1), m('m2', 2)] } })
    const { result } = renderHook(() => useChatHistory('chat', 'channel', PK))
    await act(async () => { await result.current.loadOlder() })
    expect(result.current.exhausted).toBe(true)
  })
})
