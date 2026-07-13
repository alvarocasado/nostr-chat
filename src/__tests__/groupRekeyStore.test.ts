import { describe, it, expect, beforeEach } from 'vitest'
import { useNostrStore } from '../store/nostrStore'

const GROUP = 'g1'

beforeEach(() => {
  useNostrStore.setState({
    groups: [{ id: GROUP, name: 'Team', creatorPubkey: 'creator', memberPubkeys: ['creator', 'bob'], relayUrl: 'wss://r' }],
    groupKeys: { [GROUP]: 'a'.repeat(64) },
    groupKeyHistory: {},
    groupKeyRotatedAt: {},
  })
})

describe('rotateGroupKey', () => {
  it('installs the new key and retires the old one to history', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    const s = useNostrStore.getState()
    expect(s.groupKeys[GROUP]).toBe('b'.repeat(64))
    expect(s.groupKeyHistory[GROUP]).toEqual(['a'.repeat(64)])
    expect(s.groupKeyRotatedAt[GROUP]).toBe(1000)
  })

  it('is idempotent for a key already current or in history', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 2000) // replay of current
    useNostrStore.getState().rotateGroupKey(GROUP, 'a'.repeat(64), 3000) // replay of retired
    const s = useNostrStore.getState()
    expect(s.groupKeys[GROUP]).toBe('b'.repeat(64))
    expect(s.groupKeyHistory[GROUP]).toEqual(['a'.repeat(64)])
    expect(s.groupKeyRotatedAt[GROUP]).toBe(1000)
  })

  it('stacks multiple epochs oldest→newest in history', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    useNostrStore.getState().rotateGroupKey(GROUP, 'c'.repeat(64), 2000)
    expect(useNostrStore.getState().groupKeyHistory[GROUP]).toEqual(['a'.repeat(64), 'b'.repeat(64)])
  })
})

describe('allGroupKeys', () => {
  it('returns newest→oldest', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    useNostrStore.getState().rotateGroupKey(GROUP, 'c'.repeat(64), 2000)
    expect(useNostrStore.getState().allGroupKeys(GROUP))
      .toEqual(['c'.repeat(64), 'b'.repeat(64), 'a'.repeat(64)])
  })

  it('returns empty array for unknown group', () => {
    expect(useNostrStore.getState().allGroupKeys('nope')).toEqual([])
  })
})

describe('membership actions', () => {
  it('setGroupMembers replaces the member list', () => {
    useNostrStore.getState().setGroupMembers(GROUP, ['creator'])
    expect(useNostrStore.getState().groups[0].memberPubkeys).toEqual(['creator'])
  })

  it('markGroupRemoved flags the group', () => {
    useNostrStore.getState().markGroupRemoved(GROUP)
    expect(useNostrStore.getState().groups[0].removed).toBe(true)
  })
})
