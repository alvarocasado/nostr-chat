import type { Event } from 'nostr-tools'
import type { MediaType } from './webrtc'
import { encryptWithGroupKey, decryptWithGroupKey } from './groupCrypto'
import { requireSigner } from './signer'

// Group call presence: ephemeral range, app's 241xx block (24100 call
// signals, 24101 typing, 24102 read receipts). Relays never store these.
export const GROUP_CALL_PRESENCE_KIND = 24103

// Full mesh: each participant uploads N-1 streams; 6 is the practical
// browser ceiling for video on decent uplinks.
export const MAX_GROUP_CALL_PARTICIPANTS = 6
export const PRESENCE_INTERVAL_MS = 30_000
export const PRESENCE_EXPIRY_MS = 90_000

const MAX_CALL_ID_LEN = 128

export interface GroupCallPresence {
  type: 'presence'
  callId: string
  mediaType: MediaType
}

export async function buildPresenceEvent(
  groupId: string,
  groupKeyHex: string,
  callId: string,
  mediaType: MediaType,
): Promise<Event> {
  const payload: GroupCallPresence = { type: 'presence', callId, mediaType }
  const content = await encryptWithGroupKey(JSON.stringify(payload), groupKeyHex)
  return requireSigner().signEvent({
    kind: GROUP_CALL_PRESENCE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', groupId]],
    content,
  })
}

export async function parsePresenceEvent(event: Event, groupKeyHex: string): Promise<GroupCallPresence | null> {
  if (event.kind !== GROUP_CALL_PRESENCE_KIND) return null
  try {
    const obj = JSON.parse(await decryptWithGroupKey(event.content, groupKeyHex)) as Record<string, unknown>
    if (
      obj.type === 'presence' &&
      typeof obj.callId === 'string' && obj.callId.length > 0 && obj.callId.length <= MAX_CALL_ID_LEN &&
      (obj.mediaType === 'audio' || obj.mediaType === 'video')
    ) return obj as unknown as GroupCallPresence
  } catch { /* wrong key or malformed */ }
  return null
}

// One heartbeat per participant pubkey; receivedAt is local wall-clock ms.
export interface Heartbeat {
  callId: string
  mediaType: MediaType
  receivedAt: number
}

export interface LiveCall {
  callId: string
  mediaType: MediaType
  participants: string[]
}

/**
 * Derive the group's live call from heartbeats. Stale heartbeats (older than
 * PRESENCE_EXPIRY_MS) are ignored. If several callIds are live (concurrent
 * starts), all clients converge on the lexicographically smallest.
 */
export function deriveRoster(heartbeats: ReadonlyMap<string, Heartbeat>, nowMs: number): LiveCall | null {
  const byCall = new Map<string, { mediaType: MediaType; participants: string[] }>()
  for (const [pubkey, hb] of heartbeats) {
    if (nowMs - hb.receivedAt > PRESENCE_EXPIRY_MS) continue
    const entry = byCall.get(hb.callId) ?? { mediaType: hb.mediaType, participants: [] }
    entry.participants.push(pubkey)
    byCall.set(hb.callId, entry)
  }
  if (byCall.size === 0) return null
  const callId = [...byCall.keys()].sort()[0]
  const { mediaType, participants } = byCall.get(callId)!
  return { callId, mediaType, participants: [...participants].sort() }
}

/**
 * Pubkeys with a live heartbeat for one specific (already-active) call.
 *
 * This differs from deriveRoster, which converges on the lexicographically
 * smallest *live* callId across the group — correct for deciding which call
 * to join, but wrong for sweeping an in-progress call: a residual heartbeat
 * from a recently-ended call (still inside PRESENCE_EXPIRY_MS) can sort
 * smaller than the current callId and would otherwise evict peers that are
 * legitimately still on the active call.
 */
export function activeCallPeers(heartbeats: ReadonlyMap<string, Heartbeat>, callId: string, nowMs: number): string[] {
  const result: string[] = []
  for (const [pubkey, hb] of heartbeats) {
    if (hb.callId !== callId) continue
    if (nowMs - hb.receivedAt > PRESENCE_EXPIRY_MS) continue
    result.push(pubkey)
  }
  return result
}

/** Glare tie-break: when both sides of a pair sent offers, the offer from the lexicographically smaller pubkey wins. */
export function myOfferWins(myPubkey: string, theirPubkey: string): boolean {
  return myPubkey < theirPubkey
}

export type JoinState = 'can-join' | 'full' | 'busy' | 'other-device' | 'in-call'

export function deriveJoinState(args: {
  participants: string[]
  myPubkey: string
  inCallLocally: boolean
  busyWithDmCall: boolean
}): JoinState {
  const { participants, myPubkey, inCallLocally, busyWithDmCall } = args
  if (inCallLocally) return 'in-call'
  if (busyWithDmCall) return 'busy'
  if (participants.includes(myPubkey)) return 'other-device'
  if (participants.length >= MAX_GROUP_CALL_PARTICIPANTS) return 'full'
  return 'can-join'
}

// Call-start announcement: a group control message on the existing encrypted
// transport (like reactions/edits). UX only; presence is the source of truth.
export interface CallStartPayload {
  type: 'call-start'
  callId: string
}

export function serializeCallStart(callId: string): string {
  return JSON.stringify({ type: 'call-start', callId } satisfies CallStartPayload)
}

export function parseCallStartPayload(content: string): CallStartPayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (
      obj.type === 'call-start' &&
      typeof obj.callId === 'string' && obj.callId.length > 0 && obj.callId.length <= MAX_CALL_ID_LEN
    ) return obj as CallStartPayload
  } catch { /* not JSON */ }
  return null
}
