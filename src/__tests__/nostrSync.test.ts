import { describe, it, expect, vi } from 'vitest'
import { fetchAppSettings, buildContactListEvent } from '../lib/nostrSync'
import { fetchEvent } from '../lib/nostr'
import { nip04, generateSecretKey } from 'nostr-tools'

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>()
  return {
    ...actual,
    nip04: { ...actual.nip04, decrypt: vi.fn(), encrypt: vi.fn() },
  }
})

describe('buildContactListEvent', () => {
  it('excludes pending contacts from p tags', () => {
    const sk = generateSecretKey()
    const contacts = [
      { pubkey: 'a'.repeat(64) },
      { pubkey: 'b'.repeat(64), pending: true },
    ]
    const event = buildContactListEvent(sk, contacts)
    const pTags = event.tags.filter(t => t[0] === 'p').map(t => t[1])
    expect(pTags).toContain('a'.repeat(64))
    expect(pTags).not.toContain('b'.repeat(64))
  })
})

describe('fetchAppSettings', () => {
  it('returns callsSettings when present in the decrypted event', async () => {
    const payload = {
      callsSettings: {
        turnMode: 'metered',
        turnMetered: { subdomain: 'myproject', apiKey: 'secret' },
      },
    }
    vi.mocked(fetchEvent).mockResolvedValueOnce({
      id: 'abc123',
      pubkey: 'aabbcc',
      created_at: 1000,
      kind: 30078,
      tags: [['d', 'nostr-chat-settings']],
      content: 'encrypted-blob',
      sig: 'sig',
    })
    vi.mocked(nip04.decrypt).mockResolvedValueOnce(JSON.stringify(payload))

    const sk = new Uint8Array(32)
    const result = await fetchAppSettings(['wss://relay.example.com'], sk, 'aabbcc')

    expect(result).not.toBeNull()
    expect(result!.settings.callsSettings?.turnMode).toBe('metered')
    expect(result!.settings.callsSettings?.turnMetered?.subdomain).toBe('myproject')
    expect(result!.settings.callsSettings?.turnMetered?.apiKey).toBe('secret')
  })

  it('returns null callsSettings when not present in event', async () => {
    const payload = { notificationSettings: { enabled: true } }
    vi.mocked(fetchEvent).mockResolvedValueOnce({
      id: 'abc123',
      pubkey: 'aabbcc',
      created_at: 1000,
      kind: 30078,
      tags: [['d', 'nostr-chat-settings']],
      content: 'encrypted-blob',
      sig: 'sig',
    })
    vi.mocked(nip04.decrypt).mockResolvedValueOnce(JSON.stringify(payload))

    const sk = new Uint8Array(32)
    const result = await fetchAppSettings(['wss://relay.example.com'], sk, 'aabbcc')

    expect(result).not.toBeNull()
    expect(result!.settings.callsSettings).toBeUndefined()
  })

  it('returns blockedPubkeys and dismissedRequests when present in the event', async () => {
    const payload = {
      blockedPubkeys: ['aa', 'bb'],
      dismissedRequests: { cc: 1000 },
    }
    vi.mocked(fetchEvent).mockResolvedValueOnce({
      id: 'abc123',
      pubkey: 'aabbcc',
      created_at: 1000,
      kind: 30078,
      tags: [['d', 'nostr-chat-settings']],
      content: 'encrypted-blob',
      sig: 'sig',
    })
    vi.mocked(nip04.decrypt).mockResolvedValueOnce(JSON.stringify(payload))

    const sk = new Uint8Array(32)
    const result = await fetchAppSettings(['wss://relay.example.com'], sk, 'aabbcc')

    expect(result).not.toBeNull()
    expect(result!.settings.blockedPubkeys).toEqual(['aa', 'bb'])
    expect(result!.settings.dismissedRequests).toEqual({ cc: 1000 })
  })
})
