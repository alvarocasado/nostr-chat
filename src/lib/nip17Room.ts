// NIP-17 group chats ("rooms"): a kind-14 rumor p-tagging several people.
// The set of sender + p tags IS the room, so there is no group key, no admin
// and nothing to invite; adding or removing someone makes a new room. Each
// message is gift-wrapped once per member, so rooms are for small groups.
import { buildRumorWraps, RUMOR_KIND } from './giftWrap'
import { fetchDmCaps } from './dmCaps'
import { combineRelays, getPeerRelays } from './peerRelays'
import { requireSigner } from './signer'
import { isHex64 } from './groupMembership'
import type { PrivateSend } from './privateSend'
import { useNostrStore } from '../store/nostrStore'

export const ROOM_ID_PREFIX = 'nip17:'
/** Participants including you. The NIP suggests another scheme past ~10. */
export const MAX_ROOM_SIZE = 10
/** Ignore incoming rooms bigger than this (sanity cap, not the creation limit). */
export const MAX_INCOMING_ROOM_SIZE = 50

export function isRoomId(id: string): boolean {
  return id.startsWith(ROOM_ID_PREFIX)
}

/** Stable id for a room: every member computes the same one from the same set. */
export async function roomIdFor(participants: string[]): Promise<string> {
  const canonical = [...new Set(participants)].sort().join(',')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  return ROOM_ID_PREFIX + hex
}

/** Everyone in the room a rumor belongs to: its author plus its p tags. */
export function rumorParticipants(senderPubkey: string, tags: string[][]): string[] {
  const set = new Set([senderPubkey])
  for (const t of tags) if (t[0] === 'p' && isHex64(t[1])) set.add(t[1])
  return [...set].sort()
}

export function rumorSubject(tags: string[][]): string | undefined {
  const s = tags.find(t => t[0] === 'subject')?.[1]?.trim()
  return s ? s.slice(0, 100) : undefined
}

/**
 * Gift-wrap one message to every other member of a room (and to ourselves).
 * Throws if a member has no kind-10050 relay list, because their client
 * cannot read gift wraps and would silently miss the message.
 */
export async function buildRoomSend(memberPubkeys: string[], content: string, subject?: string): Promise<PrivateSend> {
  const signer = requireSigner()
  if (!signer.caps.nip44) throw new Error('Your signer cannot send private group messages')
  const state = useNostrStore.getState()
  const myWrite = state.writeRelays()
  const others = memberPubkeys.filter(pk => pk !== signer.pubkey)

  const caps = await Promise.all(others.map(pk => fetchDmCaps(pk, state.readRelays())))
  const missing = others.filter((_, i) => !caps[i].nip17)
  if (missing.length > 0) {
    const names = missing.map(pk => state.profiles[pk]?.display_name || state.profiles[pk]?.name || pk.slice(0, 8) + '…')
    throw new Error(`${names.join(', ')} can't receive private group messages yet`)
  }

  // Same delivery rule as 1:1 DMs: their 10050 relays, else their read relays.
  const targets = await Promise.all(others.map(async (pk, i) => combineRelays(myWrite,
    caps[i].relays.length > 0 ? caps[i].relays : (await getPeerRelays(pk, state.readRelays())).read)))
  const { rumorId, createdAt, wraps, wrapForSelf } =
    await buildRumorWraps(others, content, subject ? [['subject', subject]] : [])
  return {
    msgId: rumorId,
    createdAt,
    kind: RUMOR_KIND,
    publishables: [
      ...wraps.map((w, i) => ({ event: w.event, relays: targets[i] })),
      { event: wrapForSelf, relays: myWrite },
    ],
  }
}
