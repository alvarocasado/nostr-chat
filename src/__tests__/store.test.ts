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
  it('sets publicKey, nsec, npub, and privateKeyHex', async () => {
    const { nsec, npub } = await useNostrStore.getState().generateAndLogin()
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
  it('returns true and sets keys for a valid nsec', async () => {
    const { nsec } = await useNostrStore.getState().generateAndLogin()
    const savedPk = useNostrStore.getState().publicKey

    useNostrStore.setState({ privateKeyHex: null, publicKey: null, nsec: null, npub: null })
    const ok = await useNostrStore.getState().loginFromNsec(nsec)

    expect(ok).toBe(true)
    expect(useNostrStore.getState().publicKey).toBe(savedPk)
    expect(useNostrStore.getState().nsec).toBe(nsec)
  })

  it('returns false for an invalid nsec', async () => {
    const ok = await useNostrStore.getState().loginFromNsec('nsec1notvalid')
    expect(ok).toBe(false)
    expect(useNostrStore.getState().publicKey).toBeNull()
  })
})

describe('logout', () => {
  it('clears auth state and messages', async () => {
    await useNostrStore.getState().generateAndLogin()
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

  it('updateMessageStatus changes status on a matching message', () => {
    useNostrStore.getState().addMessage('ch1', { ...msg, status: 'sending' })
    useNostrStore.getState().updateMessageStatus('ch1', 'm1', 'sent')
    expect(useNostrStore.getState().messages['ch1'][0].status).toBe('sent')
  })

  it('updateMessageStatus is a no-op for an unknown chat', () => {
    useNostrStore.getState().updateMessageStatus('unknown', 'm1', 'sent')
    expect(useNostrStore.getState().messages['unknown']).toBeUndefined()
  })
})

describe('markRead', () => {
  it('zeroes unread count on a contact', () => {
    useNostrStore.setState({ contacts: [{ pubkey: 'pk1', unread: 5 }] })
    useNostrStore.getState().markRead('pk1')
    expect(useNostrStore.getState().contacts[0].unread).toBe(0)
  })

  it('zeroes unread and mentions on a channel', () => {
    useNostrStore.setState({
      channels: [{ id: 'ch1', name: 'general', creatorPubkey: 'p', relayUrl: 'wss://r.com', unread: 3, mentions: 2 }],
    })
    useNostrStore.getState().markRead('ch1')
    const ch = useNostrStore.getState().channels[0]
    expect(ch.unread).toBe(0)
    expect(ch.mentions).toBe(0)
  })
})

describe('setProfile', () => {
  const profile = { pubkey: 'pk1', name: 'Alice' }

  it('stores profile in profiles cache', () => {
    useNostrStore.getState().setProfile('pk1', profile)
    expect(useNostrStore.getState().profiles['pk1']).toEqual(profile)
  })

  it('updates the own profile when pubkey matches publicKey', async () => {
    await useNostrStore.getState().generateAndLogin()
    const myPk = useNostrStore.getState().publicKey!
    const myProfile = { pubkey: myPk, name: 'Me' }
    useNostrStore.getState().setProfile(myPk, myProfile)
    expect(useNostrStore.getState().profile).toEqual(myProfile)
  })

  it('updates matching contact profile', () => {
    useNostrStore.setState({ contacts: [{ pubkey: 'pk1' }] })
    useNostrStore.getState().setProfile('pk1', profile)
    expect(useNostrStore.getState().contacts[0].profile).toEqual(profile)
  })
})

describe('updateContactLastMessage', () => {
  it('updates lastMessage and increments unread when chat is not active', () => {
    useNostrStore.setState({ contacts: [{ pubkey: 'pk1', unread: 0 }], activeChatId: null })
    useNostrStore.getState().updateContactLastMessage('pk1', 'hello', 2000)
    const c = useNostrStore.getState().contacts.find(c => c.pubkey === 'pk1')!
    expect(c.lastMessage).toBe('hello')
    expect(c.lastMessageAt).toBe(2000)
    expect(c.unread).toBe(1)
  })

  it('does not increment unread when contact chat is active', () => {
    useNostrStore.setState({ contacts: [{ pubkey: 'pk1', unread: 0 }], activeChatId: 'pk1' })
    useNostrStore.getState().updateContactLastMessage('pk1', 'hi', 3000)
    expect(useNostrStore.getState().contacts[0].unread).toBe(0)
  })

  it('adds the contact if not present', () => {
    useNostrStore.setState({ contacts: [], activeChatId: null })
    useNostrStore.getState().updateContactLastMessage('new-pk', 'hey', 1000)
    const c = useNostrStore.getState().contacts.find(c => c.pubkey === 'new-pk')
    expect(c).toBeDefined()
    expect(c!.unread).toBe(1)
  })
})

describe('updateChannelLastMessage', () => {
  const ch = { id: 'ch1', name: 'general', creatorPubkey: 'p', relayUrl: 'wss://r.com', unread: 0, mentions: 0 }

  it('increments unread when channel is not active', () => {
    useNostrStore.setState({ channels: [ch], activeChatId: null })
    useNostrStore.getState().updateChannelLastMessage('ch1', 'hi', 1000)
    expect(useNostrStore.getState().channels[0].unread).toBe(1)
  })

  it('increments mentions for a mention event', () => {
    useNostrStore.setState({ channels: [ch], activeChatId: null })
    useNostrStore.getState().updateChannelLastMessage('ch1', 'hi @me', 1000, true)
    expect(useNostrStore.getState().channels[0].mentions).toBe(1)
  })

  it('does not increment unread when channel is active', () => {
    useNostrStore.setState({ channels: [ch], activeChatId: 'ch1' })
    useNostrStore.getState().updateChannelLastMessage('ch1', 'hi', 1000)
    expect(useNostrStore.getState().channels[0].unread).toBe(0)
  })
})

describe('mute / unmute', () => {
  it('muteChatUntil sets a timestamp', () => {
    const until = Date.now() + 3600_000
    useNostrStore.getState().muteChatUntil('pk1', until)
    expect(useNostrStore.getState().mutedChats['pk1']).toBe(until)
  })

  it('muteChatUntil accepts null (indefinite)', () => {
    useNostrStore.getState().muteChatUntil('pk1', null)
    expect(useNostrStore.getState().mutedChats['pk1']).toBeNull()
  })

  it('unmuteChat removes the entry', () => {
    useNostrStore.setState({ mutedChats: { pk1: null } })
    useNostrStore.getState().unmuteChat('pk1')
    expect(useNostrStore.getState().mutedChats['pk1']).toBeUndefined()
  })
})

describe('draft management', () => {
  it('setDraft stores text for a chat', () => {
    useNostrStore.getState().setDraft('ch1', 'hello world')
    expect(useNostrStore.getState().drafts['ch1']).toBe('hello world')
  })

  it('clearDraft removes the entry', () => {
    useNostrStore.setState({ drafts: { ch1: 'hi' } })
    useNostrStore.getState().clearDraft('ch1')
    expect(useNostrStore.getState().drafts['ch1']).toBeUndefined()
  })
})

describe('updateSeenAt', () => {
  it('stores a timestamp for a chat', () => {
    useNostrStore.getState().updateSeenAt('ch1', 9999)
    expect(useNostrStore.getState().seenAt['ch1']).toBe(9999)
  })

  it('overwrites an existing timestamp', () => {
    useNostrStore.setState({ seenAt: { ch1: 1000 } })
    useNostrStore.getState().updateSeenAt('ch1', 2000)
    expect(useNostrStore.getState().seenAt['ch1']).toBe(2000)
  })
})

describe('loginFromHex', () => {
  it('accepts a valid hex private key and sets auth state', async () => {
    const { generateKeys } = await import('../lib/nostr')
    const { sk } = generateKeys()
    const hex = Array.from(sk).map(b => b.toString(16).padStart(2, '0')).join('')
    const ok = await useNostrStore.getState().loginFromHex(hex)
    expect(ok).toBe(true)
    expect(useNostrStore.getState().publicKey).toMatch(/^[0-9a-f]{64}$/)
    expect(useNostrStore.getState().nsec).toMatch(/^nsec1/)
  })

  it('returns false for an invalid hex string', async () => {
    const ok = await useNostrStore.getState().loginFromHex('notahex')
    expect(ok).toBe(false)
  })
})

describe('triggerSettingsSync', () => {
  it('is a callable action on the store', () => {
    const state = useNostrStore.getState()
    expect(typeof state.triggerSettingsSync).toBe('function')
    expect(() => state.triggerSettingsSync()).not.toThrow()
  })
})

describe('jumpToMessage / clearTargetMessage', () => {
  beforeEach(() => {
    useNostrStore.setState({ activeChatId: null, activeChatType: null, targetMessageId: null })
  })

  it('jumpToMessage sets activeChatId, activeChatType, and targetMessageId', () => {
    useNostrStore.getState().jumpToMessage('aaa', 'dm', 'msg-42')
    const s = useNostrStore.getState()
    expect(s.activeChatId).toBe('aaa')
    expect(s.activeChatType).toBe('dm')
    expect(s.targetMessageId).toBe('msg-42')
  })

  it('clearTargetMessage sets targetMessageId to null', () => {
    useNostrStore.setState({ targetMessageId: 'msg-42' })
    useNostrStore.getState().clearTargetMessage()
    expect(useNostrStore.getState().targetMessageId).toBeNull()
  })
})
