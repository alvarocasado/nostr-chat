import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'

const h = vi.hoisted(() => ({ fetchDmCaps: vi.fn() }))
vi.mock('../lib/dmCaps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dmCaps')>()
  return { ...actual, fetchDmCaps: h.fetchDmCaps }
})
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, publishEvent: vi.fn().mockResolvedValue(undefined), fetchEvent: vi.fn().mockResolvedValue(null) }
})

import { LocalSigner, setSigner } from '../lib/signer'
import { unwrapGiftWrap } from '../lib/giftWrap'
import { buildRoomSend, roomIdFor, rumorParticipants } from '../lib/nip17Room'
import { processGiftWrap, resetInboxDedup } from '../lib/inbox'
import { useNostrStore } from '../store/nostrStore'

const skAlice = generateSecretKey()
const skBob = generateSecretKey()
const skCarol = generateSecretKey()
const ALICE = getPublicKey(skAlice)
const BOB = getPublicKey(skBob)
const CAROL = getPublicKey(skCarol)
const RELAYS = ['wss://r']

const as = (sk: Uint8Array) => setSigner(new LocalSigner(new Uint8Array(sk)))

beforeEach(() => {
  resetInboxDedup()
  h.fetchDmCaps.mockResolvedValue({ nip17: true, relays: ['wss://dm'] })
  useNostrStore.setState({
    publicKey: BOB, relays: RELAYS, relayModes: {},
    messages: {}, contacts: [], profiles: {}, blockedPubkeys: [], dismissedRequests: {}, seenAt: {},
    groups: [], groupKeys: {}, groupKeyHistory: {}, groupKeyRotatedAt: {}, groupMembersUpdatedAt: {},
  })
})

describe('room identity', () => {
  it('gives every member the same id regardless of order or duplicates', async () => {
    const a = await roomIdFor([ALICE, BOB, CAROL])
    expect(await roomIdFor([CAROL, ALICE, BOB, ALICE])).toBe(a)
    expect(a).toMatch(/^nip17:[0-9a-f]{64}$/)
    expect(await roomIdFor([ALICE, BOB])).not.toBe(a)
  })

  it('takes the author plus valid p tags as participants', () => {
    expect(rumorParticipants(ALICE, [['p', BOB], ['p', 'junk'], ['subject', 'x'], ['p', CAROL]]))
      .toEqual([ALICE, BOB, CAROL].sort())
  })
})

describe('buildRoomSend', () => {
  it('wraps one rumor to each member and to me, p-tagging everyone else', async () => {
    as(skAlice)
    const ps = await buildRoomSend([ALICE, BOB, CAROL], 'hi all', 'Trip')
    expect(ps.publishables).toHaveLength(3) // Bob, Carol, self
    as(skBob)
    const un = await unwrapGiftWrap(ps.publishables[0].event)
    expect(un?.rumorId).toBe(ps.msgId)
    expect(un?.tags).toEqual([['p', BOB], ['p', CAROL], ['subject', 'Trip']])
    expect(ps.publishables[0].relays).toContain('wss://dm')
  })

  it('refuses when a member cannot read gift wraps', async () => {
    as(skAlice)
    h.fetchDmCaps.mockImplementation(async (pk: string) => ({ nip17: pk !== CAROL, relays: [] }))
    useNostrStore.setState({ profiles: { [CAROL]: { pubkey: CAROL, name: 'carol' } } })
    await expect(buildRoomSend([ALICE, BOB, CAROL], 'hi')).rejects.toThrow("carol can't receive private group messages yet")
  })
})

describe('receiving a room message', () => {
  async function roomWrapForBob(subject?: string) {
    as(skAlice)
    const ps = await buildRoomSend([ALICE, BOB, CAROL], 'hello room', subject)
    as(skBob)
    return ps
  }

  it('creates the room from an accepted contact and files the message under it', async () => {
    useNostrStore.setState({ contacts: [{ pubkey: ALICE }] })
    const ps = await roomWrapForBob('Trip')
    await processGiftWrap(ps.publishables[0].event, BOB, RELAYS, { live: false })
    const s = useNostrStore.getState()
    const roomId = await roomIdFor([ALICE, BOB, CAROL])
    expect(s.groups).toEqual([expect.objectContaining({ id: roomId, name: 'Trip', nip17: true })])
    expect(s.messages[roomId]).toEqual([expect.objectContaining({ id: ps.msgId, pubkey: ALICE, content: 'hello room' })])
    expect(s.messages[ALICE]).toBeUndefined() // not a 1:1 DM
  })

  it('drops a room message from someone who is not a contact', async () => {
    const ps = await roomWrapForBob()
    await processGiftWrap(ps.publishables[0].event, BOB, RELAYS, { live: false })
    const s = useNostrStore.getState()
    expect(s.groups).toHaveLength(0)
    expect(s.contacts).toHaveLength(0) // and no pending request either
  })
})
