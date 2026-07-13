import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event } from 'nostr-tools'
import { useNostrStore } from '../store/nostrStore'
import { encryptWithGroupKey } from '../lib/groupCrypto'
import { serializeGroupRekey, serializeGroupRemove, serializeMembers } from '../lib/groupMembership'

// decryptDM returns whatever the test staged; publish is swallowed.
let stagedPlaintext = ''
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    decryptDM: async () => stagedPlaintext,
    publishEvent: vi.fn().mockResolvedValue(undefined),
    buildGroupKeyBackupEvent: vi.fn().mockResolvedValue({ id: 'backup' }),
    fetchEvent: vi.fn().mockResolvedValue(null),
  }
})
vi.mock('../lib/signer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/signer')>()
  return { ...actual, getSigner: () => ({ pubkey: 'me'.padEnd(64, '0') }) }
})

import { processDMEvent, processGroupEvent, resetInboxDedup } from '../lib/inbox'

const ME = 'f'.repeat(64)
const CREATOR = 'c'.repeat(64)
const MALLORY = 'd'.repeat(64)
const GROUP = 'group-uuid-1'
const OLD_KEY = 'a'.repeat(64)
const NEW_KEY = 'b'.repeat(64)
const RELAYS = ['wss://r']

function dmEvent(from: string, createdAt = 100): Event {
  return {
    id: Math.random().toString(36).slice(2).padEnd(64, '0'),
    pubkey: from, created_at: createdAt, kind: 4,
    tags: [['p', ME]], content: 'ciphertext', sig: '',
  } as Event
}

beforeEach(() => {
  resetInboxDedup()
  useNostrStore.setState({
    publicKey: ME,
    groups: [{ id: GROUP, name: 'Team', creatorPubkey: CREATOR, memberPubkeys: [CREATOR, ME], relayUrl: RELAYS[0] }],
    groupKeys: { [GROUP]: OLD_KEY },
    groupKeyHistory: {},
    groupKeyRotatedAt: {},
    messages: {}, contacts: [], profiles: {}, blockedPubkeys: [], dismissedRequests: {}, seenAt: {},
  })
})

describe('group_rekey DM', () => {
  it('rotates the key and updates members when sent by the creator', async () => {
    stagedPlaintext = serializeGroupRekey(GROUP, NEW_KEY, 'Team', [CREATOR, ME])
    await processDMEvent(dmEvent(CREATOR), ME, RELAYS, { live: true })
    const s = useNostrStore.getState()
    expect(s.groupKeys[GROUP]).toBe(NEW_KEY)
    expect(s.groupKeyHistory[GROUP]).toEqual([OLD_KEY])
    expect(s.groups[0].memberPubkeys).toEqual([CREATOR, ME])
  })

  it('ignores rekey from a non-creator', async () => {
    stagedPlaintext = serializeGroupRekey(GROUP, NEW_KEY, 'Team', [MALLORY])
    await processDMEvent(dmEvent(MALLORY), ME, RELAYS, { live: true })
    expect(useNostrStore.getState().groupKeys[GROUP]).toBe(OLD_KEY)
  })

  it('ignores a stale rekey older than the last accepted rotation', async () => {
    stagedPlaintext = serializeGroupRekey(GROUP, NEW_KEY, 'Team', [CREATOR, ME])
    await processDMEvent(dmEvent(CREATOR, 200), ME, RELAYS, { live: true })
    stagedPlaintext = serializeGroupRekey(GROUP, 'e'.repeat(64), 'Team', [CREATOR, ME])
    await processDMEvent(dmEvent(CREATOR, 150), ME, RELAYS, { live: true }) // older replay
    expect(useNostrStore.getState().groupKeys[GROUP]).toBe(NEW_KEY)
  })
})

describe('group_remove DM', () => {
  it('marks the group removed when sent by the creator', async () => {
    stagedPlaintext = serializeGroupRemove(GROUP)
    await processDMEvent(dmEvent(CREATOR), ME, RELAYS, { live: true })
    expect(useNostrStore.getState().groups[0].removed).toBe(true)
  })

  it('ignores remove from a non-creator', async () => {
    stagedPlaintext = serializeGroupRemove(GROUP)
    await processDMEvent(dmEvent(MALLORY), ME, RELAYS, { live: true })
    expect(useNostrStore.getState().groups[0].removed).toBeUndefined()
  })
})

describe('members control in group transport', () => {
  async function groupEvent(plaintext: string, key: string, from: string): Promise<Event> {
    return {
      id: Math.random().toString(36).slice(2).padEnd(64, '0'),
      pubkey: from, created_at: 100, kind: 1042,
      tags: [['h', GROUP, RELAYS[0]]],
      content: await encryptWithGroupKey(plaintext, key), sig: '',
    } as Event
  }

  it('applies a creator-signed members update and does not store it as a message', async () => {
    const ev = await groupEvent(serializeMembers([CREATOR]), OLD_KEY, CREATOR)
    await processGroupEvent(ev, GROUP, [OLD_KEY], RELAYS, { live: true })
    const s = useNostrStore.getState()
    expect(s.groups[0].memberPubkeys).toEqual([CREATOR])
    expect(s.messages[GROUP] ?? []).toHaveLength(0)
  })

  it('ignores a members update from a non-creator', async () => {
    const ev = await groupEvent(serializeMembers([MALLORY]), OLD_KEY, MALLORY)
    await processGroupEvent(ev, GROUP, [OLD_KEY], RELAYS, { live: true })
    expect(useNostrStore.getState().groups[0].memberPubkeys).toEqual([CREATOR, ME])
  })

  it('decrypts an old-epoch message via key fallback', async () => {
    const ev = await groupEvent('old epoch text', OLD_KEY, CREATOR)
    await processGroupEvent(ev, GROUP, [NEW_KEY, OLD_KEY], RELAYS, { live: false })
    expect((useNostrStore.getState().messages[GROUP] ?? [])[0]?.content).toBe('old epoch text')
  })
})
