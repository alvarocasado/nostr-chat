import { describe, it, expect } from 'vitest'
import {
  serializeGroupRekey, serializeGroupRemove, serializeMembers,
  parseGroupRekeyPayload, parseGroupRemovePayload, parseMembersPayload,
} from '../lib/groupMembership'

const KEY = 'f'.repeat(64)
const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)

describe('group_rekey payload', () => {
  it('round-trips', () => {
    const s = serializeGroupRekey('g1', KEY, 'Team', [PK_A, PK_B])
    expect(parseGroupRekeyPayload(s)).toEqual({
      type: 'group_rekey', groupId: 'g1', groupKeyHex: KEY, groupName: 'Team', memberPubkeys: [PK_A, PK_B],
    })
  })

  it('rejects bad key hex, bad members, and other types', () => {
    expect(parseGroupRekeyPayload(JSON.stringify({ type: 'group_rekey', groupId: 'g', groupKeyHex: 'short', groupName: 'x', memberPubkeys: [PK_A] }))).toBeNull()
    expect(parseGroupRekeyPayload(JSON.stringify({ type: 'group_rekey', groupId: 'g', groupKeyHex: KEY, groupName: 'x', memberPubkeys: ['nope'] }))).toBeNull()
    expect(parseGroupRekeyPayload(serializeGroupRemove('g1'))).toBeNull()
    expect(parseGroupRekeyPayload('not json')).toBeNull()
  })
})

describe('group_remove payload', () => {
  it('round-trips', () => {
    expect(parseGroupRemovePayload(serializeGroupRemove('g1'))).toEqual({ type: 'group_remove', groupId: 'g1' })
  })

  it('rejects missing groupId', () => {
    expect(parseGroupRemovePayload(JSON.stringify({ type: 'group_remove' }))).toBeNull()
  })
})

describe('members payload', () => {
  it('round-trips', () => {
    expect(parseMembersPayload(serializeMembers([PK_A]))).toEqual({ type: 'members', memberPubkeys: [PK_A] })
  })

  it('rejects invalid pubkeys and oversized lists', () => {
    expect(parseMembersPayload(JSON.stringify({ type: 'members', memberPubkeys: ['xyz'] }))).toBeNull()
    expect(parseMembersPayload(JSON.stringify({ type: 'members', memberPubkeys: Array(1001).fill(PK_A) }))).toBeNull()
  })
})
