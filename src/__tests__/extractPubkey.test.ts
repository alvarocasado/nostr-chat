import { describe, it, expect } from 'vitest'
import { generateKeys, encodePubkey } from '../lib/nostr'
import { nip19 } from 'nostr-tools'

// Re-export the function under test so it can be unit-tested independently.
// extractPubkey lives inside AddContactModal — copy the logic here so we can
// test it without rendering the full component.
function extractPubkey(raw: string): string | null {
  const s = raw.trim()
  const npubMatch = s.match(/npub1[a-z0-9]+/)
  if (npubMatch) {
    try {
      const decoded = nip19.decode(npubMatch[0])
      if (decoded.type === 'npub') return decoded.data as string
    } catch { /* ignore */ }
  }
  const nprofileMatch = s.match(/nprofile1[a-z0-9]+/)
  if (nprofileMatch) {
    try {
      const decoded = nip19.decode(nprofileMatch[0])
      if (decoded.type === 'nprofile') return (decoded.data as { pubkey: string }).pubkey
    } catch { /* ignore */ }
  }
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s
  return null
}

describe('extractPubkey', () => {
  const { pk } = generateKeys()
  const npub = encodePubkey(pk)
  const nprofile = nip19.nprofileEncode({ pubkey: pk, relays: ['wss://relay.damus.io'] })

  it('extracts from a bare npub1 string', () => {
    expect(extractPubkey(npub)).toBe(pk)
  })

  it('extracts from a nostr:npub1 URI', () => {
    expect(extractPubkey(`nostr:${npub}`)).toBe(pk)
  })

  it('extracts from a nprofile1 string', () => {
    expect(extractPubkey(nprofile)).toBe(pk)
  })

  it('extracts from a nostr:nprofile1 URI', () => {
    expect(extractPubkey(`nostr:${nprofile}`)).toBe(pk)
  })

  it('extracts a raw 64-char hex pubkey', () => {
    expect(extractPubkey(pk)).toBe(pk)
  })

  it('is case-insensitive for hex input', () => {
    expect(extractPubkey(pk.toUpperCase())).toBe(pk.toUpperCase())
  })

  it('returns null for an empty string', () => {
    expect(extractPubkey('')).toBeNull()
  })

  it('returns null for a random string', () => {
    expect(extractPubkey('not-a-key')).toBeNull()
  })

  it('returns null for a too-short hex string', () => {
    expect(extractPubkey('deadbeef')).toBeNull()
  })
})
