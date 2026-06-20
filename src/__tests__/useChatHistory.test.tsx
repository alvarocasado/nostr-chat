import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { openUserDb, closeUserDb, getUserDb } from '../lib/userDb'
import { messageToRecord } from '../lib/db'
import { useNostrStore } from '../store/nostrStore'
import { useChatHistory } from '../hooks/useChatHistory'
import type { Message } from '../store/nostrStore'

const PK = 'c'.repeat(64)
const m = (id: string, t: number): Message => ({ id, pubkey: 'p', content: id, createdAt: t, tags: [], kind: 42 })

const fetchEvents = vi.fn()
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, fetchEvents: (...args: unknown[]) => fetchEvents(...args) }
})

// Processors append to the store; simulate that for the relay path.
const processChannelEvent = vi.fn(async (ev: { id: string; created_at: number }) => {
  const s = useNostrStore.getState()
  s.prependMessages('chat', [{ id: ev.id, pubkey: 'p', content: ev.id, createdAt: ev.created_at, tags: [], kind: 42 }])
})
vi.mock('../lib/inbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/inbox')>()
  return { ...actual, processChannelEvent: (...a: unknown[]) => processChannelEvent(a[0] as { id: string; created_at: number }) }
})

describe('useChatHistory (Dexie load-older)', () => {
  beforeEach(async () => {
    fetchEvents.mockReset()
    processChannelEvent.mockReset()
    processChannelEvent.mockImplementation(async (ev: { id: string; created_at: number }) => {
      const s = useNostrStore.getState()
      s.prependMessages('chat', [{ id: ev.id, pubkey: 'p', content: ev.id, createdAt: ev.created_at, tags: [], kind: 42 }])
    })
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

  it('marks exhausted when Dexie has nothing older and relay also returns nothing', async () => {
    useNostrStore.setState({ messages: { chat: [m('m1', 1), m('m2', 2)] }, relays: ['wss://r'] })
    fetchEvents.mockResolvedValueOnce([])
    const { result } = renderHook(() => useChatHistory('chat', 'channel', PK))
    await act(async () => { await result.current.loadOlder() })
    expect(result.current.exhausted).toBe(true)
  })
})

describe('useChatHistory (relay fallback)', () => {
  beforeEach(async () => {
    fetchEvents.mockReset()
    processChannelEvent.mockReset()
    processChannelEvent.mockImplementation(async (ev: { id: string; created_at: number }) => {
      const s = useNostrStore.getState()
      s.prependMessages('chat', [{ id: ev.id, pubkey: 'p', content: ev.id, createdAt: ev.created_at, tags: [], kind: 42 }])
    })
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

  it('falls back to relays when Dexie is empty and prepends fetched events', async () => {
    // window already holds the oldest local messages
    useNostrStore.setState({ messages: { chat: [m('m1', 1), m('m2', 2)] }, relays: ['wss://r'] })
    fetchEvents.mockResolvedValueOnce([{ id: 'r0', created_at: 0 }])
    const { result } = renderHook(() => useChatHistory('chat', 'channel', PK))
    let added = 0
    await act(async () => { added = await result.current.loadOlder() })
    expect(fetchEvents).toHaveBeenCalledTimes(1)
    expect(added).toBe(1)
    expect(useNostrStore.getState().messages['chat'][0].id).toBe('r0')
    expect(result.current.exhausted).toBe(false)
  })

  it('marks exhausted when relays return no events', async () => {
    useNostrStore.setState({ messages: { chat: [m('m1', 1)] }, relays: ['wss://r'] })
    fetchEvents.mockResolvedValueOnce([])
    const { result } = renderHook(() => useChatHistory('chat', 'channel', PK))
    await act(async () => { await result.current.loadOlder() })
    expect(result.current.exhausted).toBe(true)
  })

  it('does not exhaust when the relay fetch throws', async () => {
    useNostrStore.setState({ messages: { chat: [m('m1', 1)] }, relays: ['wss://r'] })
    fetchEvents.mockRejectedValueOnce(new Error('relay down'))
    const { result } = renderHook(() => useChatHistory('chat', 'channel', PK))
    await act(async () => { await result.current.loadOlder() })
    expect(result.current.exhausted).toBe(false)
  })
})
