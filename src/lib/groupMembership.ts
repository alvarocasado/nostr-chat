// Membership control payloads. group_rekey / group_remove ride NIP-04 kind-4
// DMs (like group_invite in lib/nostr.ts); members rides the in-group
// encrypted transport (like edit/delete in lib/messageOps.ts). Authorization
// (sender must be the group creator) is checked by the inbox handlers, not here.

const MAX_MEMBERS = 1000
const MAX_GROUP_ID_LEN = 100

export function isHex64(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)
}

function isValidGroupId(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= MAX_GROUP_ID_LEN
}

function isValidMembers(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.length <= MAX_MEMBERS && v.every(isHex64)
}

export interface GroupRekeyPayload {
  type: 'group_rekey'
  groupId: string
  groupKeyHex: string
  groupName: string
  memberPubkeys: string[]
}

export interface GroupRemovePayload {
  type: 'group_remove'
  groupId: string
}

export interface MembersPayload {
  type: 'members'
  memberPubkeys: string[]
}

export function serializeGroupRekey(groupId: string, groupKeyHex: string, groupName: string, memberPubkeys: string[]): string {
  return JSON.stringify({ type: 'group_rekey', groupId, groupKeyHex, groupName, memberPubkeys } satisfies GroupRekeyPayload)
}

export function serializeGroupRemove(groupId: string): string {
  return JSON.stringify({ type: 'group_remove', groupId } satisfies GroupRemovePayload)
}

export function serializeMembers(memberPubkeys: string[]): string {
  return JSON.stringify({ type: 'members', memberPubkeys } satisfies MembersPayload)
}

export function parseGroupRekeyPayload(content: string): GroupRekeyPayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (
      obj.type === 'group_rekey' &&
      isValidGroupId(obj.groupId) &&
      isHex64(obj.groupKeyHex) &&
      typeof obj.groupName === 'string' &&
      isValidMembers(obj.memberPubkeys)
    ) return obj as GroupRekeyPayload
  } catch { /* not JSON */ }
  return null
}

export function parseGroupRemovePayload(content: string): GroupRemovePayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (obj.type === 'group_remove' && isValidGroupId(obj.groupId)) return obj as GroupRemovePayload
  } catch { /* not JSON */ }
  return null
}

export function parseMembersPayload(content: string): MembersPayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (obj.type === 'members' && isValidMembers(obj.memberPubkeys)) return obj as MembersPayload
  } catch { /* not JSON */ }
  return null
}
