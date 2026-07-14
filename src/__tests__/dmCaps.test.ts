import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event } from 'nostr-tools'

const h = vi.hoisted(() => ({ fetchEvent: vi.fn(), publishEvent: vi.fn() }))
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, fetchEvent: h.fetchEvent, publishEvent: h.publishEvent }
})
vi.mock('../lib/signer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/signer')>()
  const signer = {
    pubkey: 'f'.repeat(64),
    caps: { nip04: true, nip44: true },
    signEvent: vi.fn(async (t: object) => ({ ...t, id: 'signed', pubkey: 'f'.repeat(64), sig: '' })),
  }
  return { ...actual, getSigner: () => signer, requireSigner: () => signer }
})

import { fetchDmCaps, parseDmRelayList, ensureOwnDmRelayList, resetDmCapsCache, DM_RELAY_LIST_KIND } from '../lib/dmCaps'

const PEER = 'a'.repeat(64)
const RELAYS = ['wss://r']

function listEvent(tags: string[][]): Event {
  return { id: 'e', pubkey: PEER, kind: DM_RELAY_LIST_KIND, created_at: 1, tags, content: '', sig: '' } as Event
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDmCapsCache()
})

describe('parseDmRelayList', () => {
  it('extracts relay tags, drops non-ws urls, caps at 4', () => {
    expect(parseDmRelayList(listEvent([
      ['relay', 'wss://a'], ['relay', 'http://evil'], ['relay', 'wss://b'],
      ['relay', 'wss://c'], ['relay', 'wss://d'], ['relay', 'wss://e'],
    ]))).toEqual(['wss://a', 'wss://b', 'wss://c', 'wss://d'])
  })
})

describe('fetchDmCaps', () => {
  it('peer with a 10050 is nip17-capable with its relays', async () => {
    h.fetchEvent.mockResolvedValue(listEvent([['relay', 'wss://dm']]))
    expect(await fetchDmCaps(PEER, RELAYS)).toEqual({ nip17: true, relays: ['wss://dm'] })
    expect(h.fetchEvent).toHaveBeenCalledWith(RELAYS, { kinds: [DM_RELAY_LIST_KIND], authors: [PEER], limit: 1 })
  })

  it('peer without a 10050 is not capable, and the result is cached (one fetch)', async () => {
    h.fetchEvent.mockResolvedValue(null)
    expect(await fetchDmCaps(PEER, RELAYS)).toEqual({ nip17: false, relays: [] })
    await fetchDmCaps(PEER, RELAYS)
    expect(h.fetchEvent).toHaveBeenCalledTimes(1)
  })

  it('fetch failure degrades to not-capable', async () => {
    h.fetchEvent.mockRejectedValue(new Error('offline'))
    expect(await fetchDmCaps(PEER, RELAYS)).toEqual({ nip17: false, relays: [] })
  })
})

describe('ensureOwnDmRelayList', () => {
  it('publishes when absent', async () => {
    h.fetchEvent.mockResolvedValue(null)
    await ensureOwnDmRelayList(['wss://mine'])
    expect(h.publishEvent).toHaveBeenCalledTimes(1)
  })

  it('does not republish when one exists', async () => {
    h.fetchEvent.mockResolvedValue(listEvent([['relay', 'wss://mine']]))
    await ensureOwnDmRelayList(['wss://mine'])
    expect(h.publishEvent).not.toHaveBeenCalled()
  })
})
