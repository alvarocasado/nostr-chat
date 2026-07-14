import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event } from 'nostr-tools'

const h = vi.hoisted(() => ({
  fetchDmCaps: vi.fn(),
  buildGiftWraps: vi.fn(),
  buildDMEvent: vi.fn(),
  publishEvent: vi.fn(),
  getPeerRelays: vi.fn(),
  caps: { nip04: true, nip44: true },
}))
vi.mock('../lib/dmCaps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dmCaps')>()
  return { ...actual, fetchDmCaps: h.fetchDmCaps }
})
vi.mock('../lib/giftWrap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/giftWrap')>()
  return { ...actual, buildGiftWraps: h.buildGiftWraps }
})
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, buildDMEvent: h.buildDMEvent, publishEvent: h.publishEvent }
})
vi.mock('../lib/peerRelays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/peerRelays')>()
  return { ...actual, getPeerRelays: h.getPeerRelays }
})
vi.mock('../lib/signer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/signer')>()
  const signer = { pubkey: 'f'.repeat(64), caps: h.caps }
  return { ...actual, getSigner: () => signer, requireSigner: () => signer }
})

import { useNostrStore } from '../store/nostrStore'
import { buildPrivateSend } from '../lib/privateSend'
import { RUMOR_KIND } from '../lib/giftWrap'

const PEER = 'a'.repeat(64)
const wrapR = { id: 'wrapR', kind: 1059 } as Event
const wrapS = { id: 'wrapS', kind: 1059 } as Event

beforeEach(() => {
  vi.clearAllMocks()
  h.caps.nip44 = true
  useNostrStore.setState({ relays: ['wss://mine'], relayModes: {} })
  h.buildGiftWraps.mockResolvedValue({ rumorId: 'rumor1', createdAt: 111, wrapForRecipient: wrapR, wrapForSelf: wrapS })
  h.buildDMEvent.mockResolvedValue({ id: 'legacy1', kind: 4, created_at: 222, tags: [['p', PEER]] } as Event)
  h.getPeerRelays.mockResolvedValue({ read: ['wss://peer-read'], write: [] })
})

describe('buildPrivateSend', () => {
  it('gift-wraps when signer has nip44 and peer has 10050', async () => {
    h.fetchDmCaps.mockResolvedValue({ nip17: true, relays: ['wss://dm'] })
    const ps = await buildPrivateSend(PEER, 'hello')
    expect(ps.msgId).toBe('rumor1')
    expect(ps.createdAt).toBe(111)
    expect(ps.kind).toBe(RUMOR_KIND)
    expect(ps.publishables).toHaveLength(2)
    expect(ps.publishables[0].event).toBe(wrapR)
    expect(ps.publishables[0].relays).toContain('wss://dm')     // peer's DM relays
    expect(ps.publishables[1].event).toBe(wrapS)
    expect(ps.publishables[1].relays).toEqual(['wss://mine'])   // self copy → own write relays
    expect(h.buildDMEvent).not.toHaveBeenCalled()
  })

  it('falls back to peer read relays when the 10050 lists none', async () => {
    h.fetchDmCaps.mockResolvedValue({ nip17: true, relays: [] })
    const ps = await buildPrivateSend(PEER, 'hello')
    expect(ps.publishables[0].relays).toContain('wss://peer-read')
  })

  it('uses legacy kind 4 when the peer has no 10050', async () => {
    h.fetchDmCaps.mockResolvedValue({ nip17: false, relays: [] })
    const ps = await buildPrivateSend(PEER, 'hello')
    expect(ps.msgId).toBe('legacy1')
    expect(ps.kind).toBe(4)
    expect(ps.publishables).toHaveLength(1)
    expect(ps.publishables[0].relays).toEqual(expect.arrayContaining(['wss://mine', 'wss://peer-read']))
    expect(h.buildGiftWraps).not.toHaveBeenCalled()
  })

  it('uses legacy kind 4 when own signer lacks nip44 (no 10050 lookup)', async () => {
    h.caps.nip44 = false
    const ps = await buildPrivateSend(PEER, 'hello')
    expect(ps.kind).toBe(4)
    expect(h.fetchDmCaps).not.toHaveBeenCalled()
  })
})
