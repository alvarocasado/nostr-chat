import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, nip04 } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import { extractRootChatId, processChannelEvent, processDMEvent, resetInboxDedup, ensureProfile } from '../lib/inbox'
import { useNostrStore } from '../store/nostrStore'
import { fireNotification } from '../lib/notifications'
import { installTestSigner } from '../test/signer'
import { clearSigner } from '../lib/signer'
import { fetchEvent, publishEvent } from '../lib/nostr'

vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, fetchEvent: vi.fn().mockResolvedValue(null), publishEvent: vi.fn().mockResolvedValue(undefined) }
})
vi.mock('../lib/notifications', () => ({ fireNotification: vi.fn() }))
vi.mock('../lib/peerRelays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/peerRelays')>()
  return { ...actual, getPeerRelays: vi.fn().mockResolvedValue({ read: [], write: ['wss://authorwrite'] }) }
})

const RELAYS = ['wss://relay.test']

function makeChannelEvent(sk: Uint8Array, channelId: string, content: string, createdAt = 1000): Event {
  return finalizeEvent({
    kind: 42,
    created_at: createdAt,
    tags: [['e', channelId, RELAYS[0], 'root']],
    content,
  }, sk)
}

afterEach(() => {
  clearSigner()
})

beforeEach(() => {
  vi.clearAllMocks()
  resetInboxDedup()
  useNostrStore.setState({
    publicKey: 'me'.padEnd(64, '0'),
    npub: null,
    relays: RELAYS,
    channels: [{ id: 'chan1', name: 'general', creatorPubkey: 'p', relayUrl: RELAYS[0], unread: 0, mentions: 0 }],
    contacts: [],
    blockedPubkeys: [],
    dismissedRequests: {},
    groups: [],
    groupKeys: {},
    activeChatId: null,
    activeChatType: null,
    messages: {},
    profiles: {},
    seenAt: {},
  })
})

describe('extractRootChatId', () => {
  it('returns the root-marked e tag', () => {
    const tags = [['e', 'reply-id', '', 'reply'], ['e', 'root-id', 'wss://r', 'root']]
    expect(extractRootChatId(tags)).toBe('root-id')
  })

  it('falls back to the first e tag when no root marker exists', () => {
    const tags = [['p', 'somebody'], ['e', 'first-id']]
    expect(extractRootChatId(tags)).toBe('first-id')
  })

  it('returns null when there is no e tag', () => {
    expect(extractRootChatId([['p', 'somebody']])).toBeNull()
  })
})

describe('processChannelEvent', () => {
  it('adds the message and increments unread for an inactive channel', async () => {
    const sk = generateSecretKey()
    const event = makeChannelEvent(sk, 'chan1', 'hello world')
    await processChannelEvent(event, 'chan1', RELAYS, { live: true })

    const state = useNostrStore.getState()
    expect(state.messages['chan1']).toHaveLength(1)
    expect(state.messages['chan1'][0].content).toBe('hello world')
    expect(state.channels[0].unread).toBe(1)
    expect(state.channels[0].lastMessage).toBe('hello world')
  })

  it('runs side effects only once when the same event is delivered twice', async () => {
    const sk = generateSecretKey()
    const event = makeChannelEvent(sk, 'chan1', 'hello again')
    await processChannelEvent(event, 'chan1', RELAYS, { live: true })
    await processChannelEvent(event, 'chan1', RELAYS, { live: true })

    const state = useNostrStore.getState()
    expect(state.messages['chan1']).toHaveLength(1)
    expect(state.channels[0].unread).toBe(1)
  })

  it('does not count backfilled events older than seenAt as unread', async () => {
    useNostrStore.setState({ seenAt: { chan1: 5000 } })
    const sk = generateSecretKey()
    const event = makeChannelEvent(sk, 'chan1', 'old history', 1000)
    await processChannelEvent(event, 'chan1', RELAYS, { live: false })

    const state = useNostrStore.getState()
    expect(state.messages['chan1']).toHaveLength(1)
    expect(state.channels[0].unread).toBe(0)
  })

  it('counts backfilled events newer than seenAt as unread', async () => {
    useNostrStore.setState({ seenAt: { chan1: 500 } })
    const sk = generateSecretKey()
    const event = makeChannelEvent(sk, 'chan1', 'while away', 1000)
    await processChannelEvent(event, 'chan1', RELAYS, { live: false })

    expect(useNostrStore.getState().channels[0].unread).toBe(1)
  })
})

describe('processDMEvent', () => {
  it('decrypts an incoming DM, stores it, and creates the contact', async () => {
    const senderSk = generateSecretKey()
    const senderPk = getPublicKey(senderSk)
    const mySk = generateSecretKey()
    const { signer } = installTestSigner(mySk)
    const myPk = signer.pubkey
    useNostrStore.setState({ publicKey: myPk })

    const encrypted = await nip04.encrypt(senderSk, myPk, 'secret hi')
    const event = finalizeEvent({
      kind: 4,
      created_at: 1000,
      tags: [['p', myPk]],
      content: encrypted,
    }, senderSk)

    await processDMEvent(event, myPk, RELAYS, { live: true })

    const state = useNostrStore.getState()
    expect(state.messages[senderPk]).toHaveLength(1)
    expect(state.messages[senderPk][0].content).toBe('secret hi')
    const contact = state.contacts.find(c => c.pubkey === senderPk)
    expect(contact?.unread).toBe(1)
    expect(contact?.lastMessage).toBe('secret hi')
    expect(contact?.pending).toBe(true)
  })

  it('handles group invite payloads: adds the group, sets the key, publishes a backup, and creates no chat message', async () => {
    const senderSk = generateSecretKey()
    const senderPk = getPublicKey(senderSk)
    const mySk = generateSecretKey()
    const { signer } = installTestSigner(mySk)
    const myPk = signer.pubkey
    useNostrStore.setState({ publicKey: myPk })

    const payload = JSON.stringify({ type: 'group_invite', groupId: 'g', groupKeyHex: 'k', groupName: 'n' })
    const encrypted = await nip04.encrypt(senderSk, myPk, payload)
    const event = finalizeEvent({
      kind: 4,
      created_at: 1000,
      tags: [['p', myPk]],
      content: encrypted,
    }, senderSk)

    await processDMEvent(event, myPk, RELAYS, { live: true })

    const state = useNostrStore.getState()
    expect(state.groups.find(grp => grp.id === 'g')?.name).toBe('n')
    expect(state.groupKeys['g']).toBe('k')
    expect(state.messages[senderPk]).toBeUndefined()
    expect(state.contacts.find(c => c.pubkey === senderPk)).toBeUndefined()
    expect(publishEvent).toHaveBeenCalledTimes(1)
  })

  it('handles a repeated group invite once: no duplicate group, single backup publish', async () => {
    const senderSk = generateSecretKey()
    const mySk = generateSecretKey()
    const { signer } = installTestSigner(mySk)
    const myPk = signer.pubkey
    useNostrStore.setState({ publicKey: myPk })

    const payload = JSON.stringify({ type: 'group_invite', groupId: 'g', groupKeyHex: 'k', groupName: 'n' })
    const encrypted = await nip04.encrypt(senderSk, myPk, payload)
    const event = finalizeEvent({
      kind: 4,
      created_at: 1000,
      tags: [['p', myPk]],
      content: encrypted,
    }, senderSk)

    await processDMEvent(event, myPk, RELAYS, { live: true })
    await processDMEvent(event, myPk, RELAYS, { live: false })

    const state = useNostrStore.getState()
    expect(state.groups.filter(grp => grp.id === 'g')).toHaveLength(1)
    expect(publishEvent).toHaveBeenCalledTimes(1)
  })
})

describe('processDMEvent — request gate', () => {
  async function incomingDM(text: string, createdAt = 1000) {
    const senderSk = generateSecretKey()
    const senderPk = getPublicKey(senderSk)
    const mySk = generateSecretKey()
    const { signer } = installTestSigner(mySk)
    const myPk = signer.pubkey
    useNostrStore.setState({ publicKey: myPk })
    const encrypted = await nip04.encrypt(senderSk, myPk, text)
    const event = finalizeEvent({ kind: 4, created_at: createdAt, tags: [['p', myPk]], content: encrypted }, senderSk)
    return { event, senderPk, myPk }
  }

  it('drops events from a blocked sender entirely', async () => {
    const { event, senderPk, myPk } = await incomingDM('blocked hello')
    useNostrStore.setState({ blockedPubkeys: [senderPk], contacts: [] })
    await processDMEvent(event, myPk, RELAYS, { live: true })
    const s = useNostrStore.getState()
    expect(s.messages[senderPk]).toBeUndefined()
    expect(s.contacts.find(c => c.pubkey === senderPk)).toBeUndefined()
  })

  it('drops a dismissed sender message older than the dismissal', async () => {
    const old = await incomingDM('old', 500)
    useNostrStore.setState({ dismissedRequests: { [old.senderPk]: 1000 }, contacts: [], messages: {} })
    await processDMEvent(old.event, old.myPk, RELAYS, { live: false })
    expect(useNostrStore.getState().contacts.find(c => c.pubkey === old.senderPk)).toBeUndefined()
    expect(useNostrStore.getState().messages[old.senderPk]).toBeUndefined()
  })

  it('reopens a request for a dismissed sender message newer than the dismissal', async () => {
    const fresh = await incomingDM('new message', 2000)
    useNostrStore.setState({ dismissedRequests: { [fresh.senderPk]: 1000 }, contacts: [], messages: {} })
    await processDMEvent(fresh.event, fresh.myPk, RELAYS, { live: true })
    const c = useNostrStore.getState().contacts.find(c => c.pubkey === fresh.senderPk)
    expect(c?.pending).toBe(true)
    expect(useNostrStore.getState().messages[fresh.senderPk]).toHaveLength(1)
  })

  it('creates a pending contact for an unknown sender and does not notify', async () => {
    vi.mocked(fireNotification).mockClear()
    const { event, senderPk, myPk } = await incomingDM('hi stranger')
    useNostrStore.setState({ contacts: [], blockedPubkeys: [], dismissedRequests: {} })
    await processDMEvent(event, myPk, RELAYS, { live: true })
    const c = useNostrStore.getState().contacts.find(c => c.pubkey === senderPk)
    expect(c?.pending).toBe(true)
    expect(useNostrStore.getState().messages[senderPk]).toHaveLength(1)
    expect(fireNotification).not.toHaveBeenCalled()
  })

  it('drops a dismissed sender message exactly at the dismissal timestamp', async () => {
    const at = await incomingDM('boundary', 1000)
    useNostrStore.setState({ dismissedRequests: { [at.senderPk]: 1000 }, contacts: [], messages: {} })
    await processDMEvent(at.event, at.myPk, RELAYS, { live: false })
    expect(useNostrStore.getState().contacts.find(c => c.pubkey === at.senderPk)).toBeUndefined()
  })

  it('notifies for an already-accepted contact', async () => {
    vi.mocked(fireNotification).mockClear()
    const { event, senderPk, myPk } = await incomingDM('hey again')
    useNostrStore.setState({ contacts: [{ pubkey: senderPk, pending: false }], blockedPubkeys: [], dismissedRequests: {} })
    await processDMEvent(event, myPk, RELAYS, { live: true })
    expect(fireNotification).toHaveBeenCalled()
  })
})

describe('ensureProfile routing', () => {
  it('ensureProfile fetches the author profile from author write relays + given relays', async () => {
    useNostrStore.setState({ profiles: {} })
    const fe = fetchEvent as unknown as { mock: { calls: unknown[][] } }
    ensureProfile('authorPk', ['wss://myread'])
    // ensureProfile is fire-and-forget through getPeerRelays; poll until the kind-0
    // fetch is issued (deterministic — a fixed setTimeout tick can race the chain).
    await vi.waitFor(() => {
      expect(fe.mock.calls.some(c => {
        const r = c[0] as string[]
        return r.includes('wss://myread') && r.includes('wss://authorwrite')
      })).toBe(true)
    })
  })
})
