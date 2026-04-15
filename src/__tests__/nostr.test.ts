import { describe, it, expect } from 'vitest'
import {
  generateKeys,
  encodeNsec,
  encodePubkey,
  parseProfile,
  shortPubkey,
} from '../lib/nostr'
import type { Event } from 'nostr-tools'

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
