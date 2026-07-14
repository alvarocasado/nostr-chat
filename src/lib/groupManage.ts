// Creator-side membership operations. Order matters on removal: metadata and
// backup first (durable records), then per-member key distribution, then the
// in-group members control encrypted with the NEW key so the removed member
// cannot read it. See docs/superpowers/specs/2026-07-13-group-rekey-design.md.
import {
  publishEvent, buildGroupInviteEvent, buildGroupRekeyEvent,
  buildGroupRemoveEvent, buildGroupMetadataEvent, buildGroupKeyBackupEvent,
} from './nostr'
import { generateGroupKey } from './groupCrypto'
import { serializeMembers } from './groupMembership'
import { sendGroupControl } from '../hooks/useNostrSubscriptions'
import { useNostrStore, type Group } from '../store/nostrStore'

/** Add a member: no rotation — they get the current key and see the current epoch. */
export async function addGroupMember(group: Group, newMemberPubkey: string): Promise<void> {
  const state = useNostrStore.getState()
  const key = state.groupKeys[group.id]
  if (!key) throw new Error('group key unavailable')
  const relays = state.writeRelays()
  const members = [...group.memberPubkeys, newMemberPubkey]

  await publishEvent(relays, await buildGroupInviteEvent(newMemberPubkey, group.id, key, group.name, members))
  await publishEvent(relays, await buildGroupMetadataEvent(key, group.id, group.name, group.about ?? '', members))
  await sendGroupControl(serializeMembers(members), group.id, key, relays)
  useNostrStore.getState().setGroupMembers(group.id, members, Math.floor(Date.now() / 1000))
}

/** Remove a member: rotate the key so they cannot read anything new. */
export async function removeGroupMember(group: Group, removePubkey: string): Promise<void> {
  const state = useNostrStore.getState()
  if (!state.groupKeys[group.id]) throw new Error('group key unavailable')
  const relays = state.writeRelays()
  const newKey = generateGroupKey()
  const members = group.memberPubkeys.filter(p => p !== removePubkey)
  const rotatedAt = Math.floor(Date.now() / 1000)

  await publishEvent(relays, await buildGroupMetadataEvent(newKey, group.id, group.name, group.about ?? '', members))

  // Local rotation before the backup so the backup includes the new epoch
  state.rotateGroupKey(group.id, newKey, rotatedAt)
  state.setGroupMembers(group.id, members, rotatedAt)
  const keysOldestFirst = useNostrStore.getState().allGroupKeys(group.id).slice().reverse()
  await publishEvent(relays, await buildGroupKeyBackupEvent(group.id, keysOldestFirst))

  // Rekey DM also goes to the creator's own pubkey so other devices converge;
  // this device already rotated locally with created_at == rotatedAt, so its
  // own copy of the DM is dropped as stale by the <= rotatedAt gate in inbox.ts.
  for (const member of members) {
    if (member === removePubkey) continue
    await publishEvent(relays, await buildGroupRekeyEvent(member, group.id, newKey, group.name, members))
  }
  await publishEvent(relays, await buildGroupRemoveEvent(removePubkey, group.id))
  await sendGroupControl(serializeMembers(members), group.id, newKey, relays)
}
