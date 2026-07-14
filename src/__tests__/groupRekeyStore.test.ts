import { describe, it, expect, beforeEach } from 'vitest'
import { useNostrStore } from '../store/nostrStore'

const GROUP = 'g1'

beforeEach(() => {
  useNostrStore.setState({
    groups: [{ id: GROUP, name: 'Team', creatorPubkey: 'creator', memberPubkeys: ['creator', 'bob'], relayUrl: 'wss://r' }],
    groupKeys: { [GROUP]: 'a'.repeat(64) },
    groupKeyHistory: {},
    groupKeyRotatedAt: {},
    groupMembersUpdatedAt: {},
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

  it('is idempotent for a key already current or in history, but still bumps the rotation timestamp', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 2000) // replay of current
    useNostrStore.getState().rotateGroupKey(GROUP, 'a'.repeat(64), 3000) // replay of retired
    const s = useNostrStore.getState()
    expect(s.groupKeys[GROUP]).toBe('b'.repeat(64))
    expect(s.groupKeyHistory[GROUP]).toEqual(['a'.repeat(64)])
    // Idempotent replays still bump the high-water mark when newer, so later
    // stale-membership checks compare against the latest known rotation.
    expect(s.groupKeyRotatedAt[GROUP]).toBe(3000)
  })

  it('bumps groupKeyRotatedAt on an idempotent replay with a newer rotatedAt', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 5000) // replay of current, newer timestamp
    expect(useNostrStore.getState().groupKeyRotatedAt[GROUP]).toBe(5000)
  })

  it('does not regress groupKeyRotatedAt on an idempotent replay with an older rotatedAt', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 500) // replay of current, older/stale timestamp
    expect(useNostrStore.getState().groupKeyRotatedAt[GROUP]).toBe(1000)
  })

  it('stacks multiple epochs oldest→newest in history', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    useNostrStore.getState().rotateGroupKey(GROUP, 'c'.repeat(64), 2000)
    expect(useNostrStore.getState().groupKeyHistory[GROUP]).toEqual(['a'.repeat(64), 'b'.repeat(64)])
  })

  it('installs without history when there is no existing current key', () => {
    useNostrStore.setState({ groupKeys: {}, groupKeyHistory: {}, groupKeyRotatedAt: {} })
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 500)
    const s = useNostrStore.getState()
    expect(s.groupKeys[GROUP]).toBe('b'.repeat(64))
    expect(s.groupKeyHistory[GROUP]).toBeUndefined()
    expect(s.groupKeyRotatedAt[GROUP]).toBe(500)
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
    useNostrStore.getState().setGroupMembers(GROUP, ['creator'], 1000)
    expect(useNostrStore.getState().groups[0].memberPubkeys).toEqual(['creator'])
    expect(useNostrStore.getState().groupMembersUpdatedAt[GROUP]).toBe(1000)
  })

  it('ignores a members update with a lower updatedAt than the current high-water mark', () => {
    useNostrStore.getState().setGroupMembers(GROUP, ['creator'], 1000)
    useNostrStore.getState().setGroupMembers(GROUP, ['creator', 'bob', 'eve'], 500) // stale replay
    const s = useNostrStore.getState()
    expect(s.groups[0].memberPubkeys).toEqual(['creator'])
    expect(s.groupMembersUpdatedAt[GROUP]).toBe(1000)
  })

  it('applies a members update whose updatedAt equals the current high-water mark', () => {
    useNostrStore.getState().setGroupMembers(GROUP, ['creator'], 1000)
    useNostrStore.getState().setGroupMembers(GROUP, ['creator', 'bob'], 1000) // same second, e.g. rekey + members control
    expect(useNostrStore.getState().groups[0].memberPubkeys).toEqual(['creator', 'bob'])
  })

  it('markGroupRemoved flags the group', () => {
    useNostrStore.getState().markGroupRemoved(GROUP)
    expect(useNostrStore.getState().groups[0].removed).toBe(true)
  })

  it('clearGroupRemoved unflags the group', () => {
    useNostrStore.getState().markGroupRemoved(GROUP)
    useNostrStore.getState().clearGroupRemoved(GROUP)
    expect(useNostrStore.getState().groups[0].removed).toBeUndefined()
  })
})
