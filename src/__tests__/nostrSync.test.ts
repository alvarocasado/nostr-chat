import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchAppSettings, buildContactListEvent, buildRelayListEvent, fetchRelayList } from '../lib/nostrSync'
import { fetchEvent } from '../lib/nostr'
import { nip04, generateSecretKey } from 'nostr-tools'
import { installTestSigner } from '../test/signer'
import { clearSigner } from '../lib/signer'
import type { RelayModes } from '../lib/relayRouting'

vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, fetchEvent: vi.fn() }
})

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>()
  return {
    ...actual,
    nip04: { ...actual.nip04, decrypt: vi.fn(), encrypt: vi.fn() },
  }
})

beforeEach(() => {
  installTestSigner()
})

afterEach(() => {
  clearSigner()
})

describe('buildContactListEvent', () => {
  it('excludes pending contacts from p tags', async () => {
    const contacts = [
      { pubkey: 'a'.repeat(64) },
      { pubkey: 'b'.repeat(64), pending: true },
    ]
    const event = await buildContactListEvent(contacts)
    const pTags = event.tags.filter(t => t[0] === 'p').map(t => t[1])
    expect(pTags).toContain('a'.repeat(64))
    expect(pTags).not.toContain('b'.repeat(64))
  })
})

describe('fetchAppSettings', () => {
  it('returns callsSettings when present in the decrypted event', async () => {
    const { signer } = installTestSigner()
    const pubkey = signer.pubkey
    const payload = {
      callsSettings: {
        turnMode: 'metered',
        turnMetered: { subdomain: 'myproject', apiKey: 'secret' },
      },
    }
    vi.mocked(fetchEvent).mockResolvedValueOnce({
      id: 'abc123',
      pubkey,
      created_at: 1000,
      kind: 30078,
      tags: [['d', 'nostr-chat-settings']],
      content: 'encrypted-blob',
      sig: 'sig',
    })
    vi.mocked(nip04.decrypt).mockResolvedValueOnce(JSON.stringify(payload))

    const result = await fetchAppSettings(['wss://relay.example.com'])

    expect(result).not.toBeNull()
    expect(result!.settings.callsSettings?.turnMode).toBe('metered')
    expect(result!.settings.callsSettings?.turnMetered?.subdomain).toBe('myproject')
    expect(result!.settings.callsSettings?.turnMetered?.apiKey).toBe('secret')
  })

  it('returns null callsSettings when not present in event', async () => {
    const { signer } = installTestSigner()
    const pubkey = signer.pubkey
    const payload = { notificationSettings: { enabled: true } }
    vi.mocked(fetchEvent).mockResolvedValueOnce({
      id: 'abc123',
      pubkey,
      created_at: 1000,
      kind: 30078,
      tags: [['d', 'nostr-chat-settings']],
      content: 'encrypted-blob',
      sig: 'sig',
    })
    vi.mocked(nip04.decrypt).mockResolvedValueOnce(JSON.stringify(payload))

    const result = await fetchAppSettings(['wss://relay.example.com'])

    expect(result).not.toBeNull()
    expect(result!.settings.callsSettings).toBeUndefined()
  })

  it('returns blockedPubkeys and dismissedRequests when present in the event', async () => {
    const { signer } = installTestSigner()
    const pubkey = signer.pubkey
    const payload = {
      blockedPubkeys: ['aa', 'bb'],
      dismissedRequests: { cc: 1000 },
    }
    vi.mocked(fetchEvent).mockResolvedValueOnce({
      id: 'abc123',
      pubkey,
      created_at: 1000,
      kind: 30078,
      tags: [['d', 'nostr-chat-settings']],
      content: 'encrypted-blob',
      sig: 'sig',
    })
    vi.mocked(nip04.decrypt).mockResolvedValueOnce(JSON.stringify(payload))

    const result = await fetchAppSettings(['wss://relay.example.com'])

    expect(result).not.toBeNull()
    expect(result!.settings.blockedPubkeys).toEqual(['aa', 'bb'])
    expect(result!.settings.dismissedRequests).toEqual({ cc: 1000 })
  })
})

describe('buildRelayListEvent (kind 10002)', () => {
  it('emits r tags with the correct markers', async () => {
    installTestSigner(generateSecretKey())
    const relays = ['wss://a', 'wss://b', 'wss://c']
    const modes: RelayModes = {
      'wss://a': { read: true, write: true },
      'wss://b': { read: true, write: false },
      'wss://c': { read: false, write: true },
    }
    const ev = await buildRelayListEvent(relays, modes)
    expect(ev.kind).toBe(10002)
    expect(ev.tags).toEqual([
      ['r', 'wss://a'],
      ['r', 'wss://b', 'read'],
      ['r', 'wss://c', 'write'],
    ])
  })

  it('treats an unmarked relay as read+write (bare r tag)', async () => {
    installTestSigner(generateSecretKey())
    const ev = await buildRelayListEvent(['wss://a'], {})
    expect(ev.tags).toEqual([['r', 'wss://a']])
  })
})

describe('fetchRelayList', () => {
  it('returns null when the event has no r tags', async () => {
    const pubkey = 'a'.repeat(64)
    vi.mocked(fetchEvent).mockResolvedValueOnce({
      id: 'abc123',
      pubkey,
      created_at: 1000,
      kind: 10002,
      tags: [['other', 'tag']],
      content: '',
      sig: 'sig',
    })

    const result = await fetchRelayList(['wss://relay.example.com'], pubkey)

    expect(result).toBeNull()
  })
})
