import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, getUserDb } from '../lib/userDb'

const fetchRelayList = vi.fn()
vi.mock('../lib/nostrSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostrSync')>()
  return { ...actual, fetchRelayList: (...a: unknown[]) => fetchRelayList(...a) }
})

import { combineRelays, getPeerRelays, resetPeerRelayCache, MAX_PEER_RELAYS } from '../lib/peerRelays'

const PK = 'd'.repeat(64)
const MINE = ['wss://mine1', 'wss://mine2']

beforeEach(() => {
  openUserDb(PK)
  resetPeerRelayCache()
  fetchRelayList.mockReset()
})
afterEach(async () => {
  const db = getUserDb()
  if (db) await db.relayLists.clear()
  closeUserDb()
})

describe('combineRelays', () => {
  it('unions mine with the peer set, deduped', () => {
    expect(combineRelays(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })
  it('caps the peer additions at MAX_PEER_RELAYS', () => {
    const peer = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
    expect(combineRelays(['m'], peer)).toEqual(['m', ...peer.slice(0, MAX_PEER_RELAYS)])
  })
  it('returns exactly mine when peer is empty', () => {
    expect(combineRelays(['a', 'b'], [])).toEqual(['a', 'b'])
  })
})

describe('getPeerRelays', () => {
  it('fetches on a miss, maps markers, and caches (no second fetch within TTL)', async () => {
    fetchRelayList.mockResolvedValueOnce({
      urls: ['wss://both', 'wss://ronly', 'wss://wonly'],
      modes: {
        'wss://both': { read: true, write: true },
        'wss://ronly': { read: true, write: false },
        'wss://wonly': { read: false, write: true },
      },
      createdAt: 1,
    })
    const first = await getPeerRelays('peerA', MINE)
    expect(first.read).toEqual(['wss://both', 'wss://ronly'])
    expect(first.write).toEqual(['wss://both', 'wss://wonly'])
    expect(fetchRelayList).toHaveBeenCalledTimes(1)

    resetPeerRelayCache() // drop memory; should hit fresh Dexie, still no refetch
    const second = await getPeerRelays('peerA', MINE)
    expect(second.write).toEqual(['wss://both', 'wss://wonly'])
    expect(fetchRelayList).toHaveBeenCalledTimes(1)
  })

  it('negative-caches an empty result on a null fetch (no refetch within TTL)', async () => {
    fetchRelayList.mockResolvedValue(null)
    const a = await getPeerRelays('peerB', MINE)
    expect(a).toEqual({ read: [], write: [] })
    const b = await getPeerRelays('peerB', MINE)
    expect(b).toEqual({ read: [], write: [] })
    expect(fetchRelayList).toHaveBeenCalledTimes(1)
  })

  it('negative-caches on a fetch error', async () => {
    fetchRelayList.mockRejectedValue(new Error('relay down'))
    const a = await getPeerRelays('peerC', MINE)
    expect(a).toEqual({ read: [], write: [] })
    expect(fetchRelayList).toHaveBeenCalledTimes(1)
  })
})
