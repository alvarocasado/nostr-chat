import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  generateKeys,
  encodeNsec,
  encodePubkey,
  parseProfile,
  shortPubkey,
  buildGroupMessageEvent,
  buildTypingEvent,
  GROUP_MESSAGE_KIND,
  LEGACY_GROUP_MESSAGE_KIND,
  TYPING_INDICATOR_KIND,
} from '../lib/nostr'
import { installTestSigner } from '../test/signer'
import { clearSigner } from '../lib/signer'
import type { Event } from 'nostr-tools'

beforeEach(() => { installTestSigner() })
afterEach(() => clearSigner())

describe('generateKeys', () => {
  it('returns a 32-byte secret key and 64-char hex public key', () => {
    const { sk, pk } = generateKeys()
    expect(sk).toBeInstanceOf(Uint8Array)
    expect(sk).toHaveLength(32)
    expect(pk).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a unique keypair on each call', () => {
    const a = generateKeys()
    const b = generateKeys()
    expect(a.pk).not.toBe(b.pk)
  })
})

describe('encodeNsec / encodePubkey', () => {
  it('encodes a secret key as nsec1...', () => {
    const { sk } = generateKeys()
    const nsec = encodeNsec(sk)
    expect(nsec).toMatch(/^nsec1[a-z0-9]+$/)
  })

  it('encodes a public key as npub1...', () => {
    const { pk } = generateKeys()
    const npub = encodePubkey(pk)
    expect(npub).toMatch(/^npub1[a-z0-9]+$/)
  })
})

describe('shortPubkey', () => {
  it('returns first 8 chars + ellipsis + last 4 chars', () => {
    const pk = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    expect(shortPubkey(pk)).toBe('abcdef12...7890')
  })
})

describe('event kinds', () => {
  it('group messages use a regular-range kind (1000-9999) so relays store full history', async () => {
    // Kinds 10000-19999 are replaceable per NIP-01: relays keep only the
    // latest event per pubkey, collapsing group history to one message per member.
    const event = await buildGroupMessageEvent('ciphertext', 'group-id', 'wss://relay.example')
    expect(event.kind).toBeGreaterThanOrEqual(1000)
    expect(event.kind).toBeLessThan(10000)
    expect(event.kind).toBe(GROUP_MESSAGE_KIND)
  })

  it('keeps the legacy replaceable kind exported for read back-compat', () => {
    expect(LEGACY_GROUP_MESSAGE_KIND).toBe(10042)
    expect(GROUP_MESSAGE_KIND).not.toBe(LEGACY_GROUP_MESSAGE_KIND)
  })

  it('typing indicators use an ephemeral kind that does not collide with NIP-46 (24133)', async () => {
    const event = await buildTypingEvent('channel', 'channel-id')
    expect(event.kind).toBeGreaterThanOrEqual(20000)
    expect(event.kind).toBeLessThan(30000)
    expect(event.kind).not.toBe(24133)
    expect(event.kind).toBe(TYPING_INDICATOR_KIND)
  })
})

describe('parseProfile', () => {
  const makeEvent = (content: string): Event => ({
    id: 'testid',
    pubkey: 'deadbeef'.repeat(8),
    created_at: 1000,
    kind: 0,
    tags: [],
    content,
    sig: 'sig',
  })

  it('parses name, about, picture from kind-0 content', () => {
    const event = makeEvent(JSON.stringify({ name: 'Alice', about: 'hi', picture: 'https://pic.jpg' }))
    const profile = parseProfile(event)
    expect(profile.name).toBe('Alice')
    expect(profile.about).toBe('hi')
    expect(profile.picture).toBe('https://pic.jpg')
    expect(profile.pubkey).toBe(event.pubkey)
  })

  it('returns just pubkey when content is invalid JSON', () => {
    const event = makeEvent('not json')
    const profile = parseProfile(event)
    expect(profile).toEqual({ pubkey: event.pubkey })
  })

  it('returns just pubkey when content is empty', () => {
    const event = makeEvent('')
    const profile = parseProfile(event)
    expect(profile).toEqual({ pubkey: event.pubkey })
  })
})
