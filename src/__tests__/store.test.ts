import { describe, it, expect, beforeEach } from 'vitest'
import { useNostrStore } from '../store/nostrStore'

// Reset store state before each test
beforeEach(() => {
  useNostrStore.setState({
    privateKeyHex: null,
    publicKey: null,
    nsec: null,
    npub: null,
    profile: null,
    relays: [],
    channels: [],
    joinedChannelIds: [],
    contacts: [],
    activeChatId: null,
    activeChatType: null,
    messages: {},
    profiles: {},
  })
})

describe('generateAndLogin', () => {
  it('sets publicKey, nsec, npub, and privateKeyHex', () => {
    const { nsec, npub } = useNostrStore.getState().generateAndLogin()
    const state = useNostrStore.getState()

    expect(state.publicKey).toMatch(/^[0-9a-f]{64}$/)
    expect(state.privateKeyHex).toMatch(/^[0-9a-f]{64}$/)
    expect(state.nsec).toBe(nsec)
    expect(state.npub).toBe(npub)
    expect(nsec).toMatch(/^nsec1/)
    expect(npub).toMatch(/^npub1/)
  })
})

describe('loginFromNsec', () => {
  it('returns true and sets keys for a valid nsec', () => {
    // Generate a key first to get a valid nsec
    const { nsec } = useNostrStore.getState().generateAndLogin()
    const savedPk = useNostrStore.getState().publicKey

    // Reset and login with nsec
    useNostrStore.setState({ privateKeyHex: null, publicKey: null, nsec: null, npub: null })
    const ok = useNostrStore.getState().loginFromNsec(nsec)

    expect(ok).toBe(true)
    expect(useNostrStore.getState().publicKey).toBe(savedPk)
    expect(useNostrStore.getState().nsec).toBe(nsec)
  })

  it('returns false for an invalid nsec', () => {
    const ok = useNostrStore.getState().loginFromNsec('nsec1notvalid')
    expect(ok).toBe(false)
    expect(useNostrStore.getState().publicKey).toBeNull()
  })
})

describe('logout', () => {
  it('clears auth state and messages', () => {
    useNostrStore.getState().generateAndLogin()
    useNostrStore.setState({ messages: { test: [{ id: '1', pubkey: 'pk', content: 'hi', createdAt: 0, tags: [], kind: 1 }] } })

    useNostrStore.getState().logout()
    const state = useNostrStore.getState()

    expect(state.publicKey).toBeNull()
    expect(state.privateKeyHex).toBeNull()
    expect(state.messages).toEqual({})
  })
})

describe('relay management', () => {
  it('addRelay appends a relay URL', () => {
    useNostrStore.getState().addRelay('wss://relay.example.com')
    expect(useNostrStore.getState().relays).toContain('wss://relay.example.com')
  })

  it('addRelay does not add duplicates', () => {
    useNostrStore.getState().addRelay('wss://relay.example.com')
    useNostrStore.getState().addRelay('wss://relay.example.com')
    const count = useNostrStore.getState().relays.filter(r => r === 'wss://relay.example.com').length
    expect(count).toBe(1)
  })

  it('removeRelay removes the URL', () => {
    useNostrStore.setState({ relays: ['wss://a.com', 'wss://b.com'] })
    useNostrStore.getState().removeRelay('wss://a.com')
    expect(useNostrStore.getState().relays).toEqual(['wss://b.com'])
  })
})

describe('contact management', () => {
  it('addContact adds a contact by pubkey', () => {
    useNostrStore.getState().addContact('pubkey123')
    expect(useNostrStore.getState().contacts).toHaveLength(1)
    expect(useNostrStore.getState().contacts[0].pubkey).toBe('pubkey123')
  })

  it('addContact does not add duplicate pubkeys', () => {
    useNostrStore.getState().addContact('pubkey123')
    useNostrStore.getState().addContact('pubkey123')
    expect(useNostrStore.getState().contacts).toHaveLength(1)
  })

  it('removeContact removes a contact', () => {
    useNostrStore.setState({ contacts: [{ pubkey: 'pk1' }, { pubkey: 'pk2' }] })
    useNostrStore.getState().removeContact('pk1')
    expect(useNostrStore.getState().contacts).toHaveLength(1)
    expect(useNostrStore.getState().contacts[0].pubkey).toBe('pk2')
  })
})

describe('channel management', () => {
  const channel = { id: 'ch1', name: 'general', creatorPubkey: 'pk', relayUrl: 'wss://r.com' }

  it('addChannel adds a channel', () => {
    useNostrStore.getState().addChannel(channel)
    expect(useNostrStore.getState().channels).toHaveLength(1)
  })

  it('addChannel does not add duplicate ids', () => {
    useNostrStore.getState().addChannel(channel)
    useNostrStore.getState().addChannel(channel)
    expect(useNostrStore.getState().channels).toHaveLength(1)
  })

  it('joinChannel adds id to joinedChannelIds', () => {
    useNostrStore.getState().joinChannel('ch1')
    expect(useNostrStore.getState().joinedChannelIds).toContain('ch1')
  })

  it('leaveChannel removes id and clears active chat if needed', () => {
    useNostrStore.setState({ joinedChannelIds: ['ch1'], activeChatId: 'ch1', activeChatType: 'channel' })
    useNostrStore.getState().leaveChannel('ch1')
    expect(useNostrStore.getState().joinedChannelIds).not.toContain('ch1')
    expect(useNostrStore.getState().activeChatId).toBeNull()
  })
})

describe('message management', () => {
  const msg = { id: 'm1', pubkey: 'pk', content: 'hello', createdAt: 1000, tags: [], kind: 42 }

  it('addMessage stores a message under the chatId', () => {
    useNostrStore.getState().addMessage('ch1', msg)
    expect(useNostrStore.getState().messages['ch1']).toHaveLength(1)
  })

  it('addMessage deduplicates by id', () => {
    useNostrStore.getState().addMessage('ch1', msg)
    useNostrStore.getState().addMessage('ch1', msg)
    expect(useNostrStore.getState().messages['ch1']).toHaveLength(1)
  })

  it('addMessage sorts messages by createdAt', () => {
    const older = { ...msg, id: 'm0', createdAt: 500 }
    useNostrStore.getState().addMessage('ch1', msg)
    useNostrStore.getState().addMessage('ch1', older)
    const msgs = useNostrStore.getState().messages['ch1']
    expect(msgs[0].id).toBe('m0')
    expect(msgs[1].id).toBe('m1')
  })
})
