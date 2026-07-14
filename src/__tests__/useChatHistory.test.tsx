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
const processDMEvent = vi.fn()
const processGiftWrap = vi.fn()
vi.mock('../lib/inbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/inbox')>()
  return {
    ...actual,
    processChannelEvent: (...a: unknown[]) => processChannelEvent(a[0] as { id: string; created_at: number }),
    processDMEvent: (...a: unknown[]) => processDMEvent(...a),
    processGiftWrap: (...a: unknown[]) => processGiftWrap(...a),
  }
})

const getPeerRelays = vi.fn()
vi.mock('../lib/peerRelays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/peerRelays')>()
  return { ...actual, getPeerRelays: (...a: unknown[]) => getPeerRelays(...a) }
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

describe('useChatHistory (dm wrap backfill)', () => {
  const PEER = 'd'.repeat(64)

  beforeEach(async () => {
    fetchEvents.mockReset()
    processDMEvent.mockReset()
    processGiftWrap.mockReset()
    getPeerRelays.mockReset()
    getPeerRelays.mockResolvedValue({ read: [], write: [] })
    processDMEvent.mockImplementation(async (ev: { id: string; created_at: number }) => {
      const s = useNostrStore.getState()
      s.prependMessages(PEER, [{ id: ev.id, pubkey: 'p', content: ev.id, createdAt: ev.created_at, tags: [], kind: 4 }])
    })
    processGiftWrap.mockImplementation(async (ev: { id: string; created_at: number }) => {
      const s = useNostrStore.getState()
      s.prependMessages(PEER, [{ id: ev.id, pubkey: 'p', content: ev.id, createdAt: ev.created_at, tags: [], kind: 1059 }])
    })
    openUserDb(PK)
    const db = getUserDb()!
    await db.messages.clear()
    useNostrStore.setState({ relays: ['wss://r'], messages: { [PEER]: [m('anchor', 100)] } })
  })

  afterEach(async () => {
    const db = getUserDb()
    if (db) await db.messages.clear()
    closeUserDb()
  })

  it('issues the wrap filter (kind 1059, #p) alongside the two kind-4 filters', async () => {
    fetchEvents.mockResolvedValue([])
    const { result } = renderHook(() => useChatHistory(PEER, 'dm', PK))
    await act(async () => { await result.current.loadOlder() })

    expect(fetchEvents).toHaveBeenCalledTimes(3)
    const sentFilter = fetchEvents.mock.calls[0][1]
    const receivedFilter = fetchEvents.mock.calls[1][1]
    const wrapFilter = fetchEvents.mock.calls[2][1]
    expect(sentFilter).toMatchObject({ kinds: [4], authors: [PK], '#p': [PEER] })
    expect(receivedFilter).toMatchObject({ kinds: [4], authors: [PEER], '#p': [PK] })
    expect(wrapFilter).toMatchObject({ kinds: [1059], '#p': [PK] })
  })

  it('does not exhaust on a full-limit page of duplicate wraps, and advances the wrap cursor on the next page', async () => {
    const dupIds = Array.from({ length: 50 }, (_, i) => `w${i}`)
    // Pre-seed the store so the relay-fetched wraps are already known (added === 0).
    const existing = dupIds.map((id, i) => m(id, 101 + i))
    useNostrStore.setState({ messages: { [PEER]: [m('anchor', 100), ...existing] } })

    const wrapEvents = dupIds.map((id, i) => ({ id, kind: 1059, created_at: 50 + i, pubkey: 'p', content: '', tags: [], sig: '' }))
    fetchEvents
      .mockResolvedValueOnce([]) // sent
      .mockResolvedValueOnce([]) // received
      .mockResolvedValueOnce(wrapEvents) // wraps: full page, all duplicates

    const { result } = renderHook(() => useChatHistory(PEER, 'dm', PK))
    let added = -1
    await act(async () => { added = await result.current.loadOlder() })
    expect(added).toBe(0)
    expect(result.current.exhausted).toBe(false)

    // Next page: wrap `until` should have advanced past the fetched wraps'
    // min created_at (50), independent of the unchanged rumor-time cursor.
    fetchEvents.mockResolvedValue([])
    await act(async () => { await result.current.loadOlder() })
    const secondWrapFilter = fetchEvents.mock.calls.at(-1)![1]
    expect(secondWrapFilter.until).toBe(49)
  })

  it('exhausts when a short (sub-limit) wrap page adds no new messages and legacy results are empty', async () => {
    const dupIds = ['x0', 'x1', 'x2']
    const existing = dupIds.map((id, i) => m(id, 101 + i))
    useNostrStore.setState({ messages: { [PEER]: [m('anchor', 100), ...existing] } })

    const wrapEvents = dupIds.map((id, i) => ({ id, kind: 1059, created_at: 60 + i, pubkey: 'p', content: '', tags: [], sig: '' }))
    fetchEvents
      .mockResolvedValueOnce([]) // sent
      .mockResolvedValueOnce([]) // received
      .mockResolvedValueOnce(wrapEvents) // short page, all duplicates

    const { result } = renderHook(() => useChatHistory(PEER, 'dm', PK))
    let added = -1
    await act(async () => { added = await result.current.loadOlder() })
    expect(added).toBe(0)
    expect(result.current.exhausted).toBe(true)
  })
})
