import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useNostrStore } from '../store/nostrStore'

const h = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  sendGroupControl: vi.fn(),
  sendPrivate: vi.fn(),
  buildGroupMetadataEvent: vi.fn(),
  buildGroupKeyBackupEvent: vi.fn(),
}))

vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    publishEvent: h.publishEvent,
    buildGroupMetadataEvent: h.buildGroupMetadataEvent,
    buildGroupKeyBackupEvent: h.buildGroupKeyBackupEvent,
  }
})
vi.mock('../hooks/useNostrSubscriptions', () => ({ sendGroupControl: h.sendGroupControl }))
vi.mock('../lib/privateSend', () => ({ sendPrivate: h.sendPrivate }))

import { addGroupMember, removeGroupMember } from '../lib/groupManage'
import { serializeGroupInvite, serializeGroupRekey, serializeGroupRemove } from '../lib/groupMembership'
import type { Group } from '../store/nostrStore'

const ME = 'me'.padEnd(64, '0')
const BOB = 'b'.repeat(64)
const EVE = 'e'.repeat(64)
const KEY = 'a'.repeat(64)
const GROUP: Group = { id: 'g1', name: 'Team', creatorPubkey: ME, memberPubkeys: [ME, BOB, EVE], relayUrl: 'wss://r' }

beforeEach(() => {
  vi.clearAllMocks()
  h.publishEvent.mockResolvedValue(undefined)
  h.sendGroupControl.mockResolvedValue(undefined)
  h.sendPrivate.mockResolvedValue(undefined)
  for (const b of [h.buildGroupMetadataEvent, h.buildGroupKeyBackupEvent]) {
    b.mockResolvedValue({ id: 'evt' })
  }
  useNostrStore.setState({
    publicKey: ME,
    groups: [{ ...GROUP }],
    groupKeys: { g1: KEY },
    groupKeyHistory: {},
    groupKeyRotatedAt: {},
    relays: ['wss://r'],
    relayModes: {},
  })
})

describe('addGroupMember', () => {
  it('invites with the current key and full member list, updates local members', async () => {
    const NEW = 'f'.repeat(64)
    await addGroupMember(GROUP, NEW)
    expect(h.sendPrivate).toHaveBeenCalledWith(serializeGroupInvite('g1', KEY, 'Team', [ME, BOB, EVE, NEW]), NEW)
    expect(h.sendPrivate).toHaveBeenCalledTimes(1)
    expect(h.buildGroupMetadataEvent).toHaveBeenCalledWith(KEY, 'g1', 'Team', '', [ME, BOB, EVE, NEW])
    expect(h.sendGroupControl).toHaveBeenCalledTimes(1)
    expect(useNostrStore.getState().groups[0].memberPubkeys).toContain(NEW)
    // no rotation on add
    expect(useNostrStore.getState().groupKeys.g1).toBe(KEY)
  })
})

describe('removeGroupMember', () => {
  it('rotates the key, rekeys remaining members, notifies the removed one', async () => {
    await removeGroupMember(GROUP, EVE)
    const s = useNostrStore.getState()
    expect(s.groupKeys.g1).not.toBe(KEY)
    expect(s.groupKeyHistory.g1).toEqual([KEY])
    expect(s.groups[0].memberPubkeys).toEqual([ME, BOB])
    // rekey DM to every remaining member, including the creator's own pubkey
    // (so their other devices converge) — but never the removed member.
    expect(h.sendPrivate).toHaveBeenCalledWith(serializeGroupRekey('g1', s.groupKeys.g1, 'Team', [ME, BOB]), BOB)
    expect(h.sendPrivate).toHaveBeenCalledWith(serializeGroupRekey('g1', s.groupKeys.g1, 'Team', [ME, BOB]), ME)
    expect(h.sendPrivate).toHaveBeenCalledWith(serializeGroupRemove('g1'), EVE)
    // backup carries both epochs oldest→newest
    expect(h.buildGroupKeyBackupEvent).toHaveBeenCalledWith('g1', [KEY, s.groupKeys.g1])
    // members control sent with the NEW key
    expect(h.sendGroupControl.mock.calls[0][2]).toBe(s.groupKeys.g1)
  })

  it('propagates a publish failure so the UI can offer retry', async () => {
    h.publishEvent.mockRejectedValueOnce(new Error('relay down'))
    await expect(removeGroupMember(GROUP, EVE)).rejects.toThrow()
  })
})
