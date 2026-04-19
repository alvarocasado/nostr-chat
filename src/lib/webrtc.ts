import { finalizeEvent, nip04 } from 'nostr-tools'
import type { Event } from 'nostr-tools'

export const CALL_SIGNAL_KIND = 24100

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export type MediaType = 'audio' | 'video'
export type CallSignalType = 'call-offer' | 'call-answer' | 'ice-candidate' | 'call-end'

export interface CallSignal {
  type: CallSignalType
  callId: string
  mediaType?: MediaType
  sdp?: string
  candidate?: RTCIceCandidateInit
  reason?: 'rejected' | 'busy' | 'ended'
}

export async function buildCallSignalEvent(
  sk: Uint8Array,
  recipientPubkey: string,
  signal: CallSignal,
): Promise<Event> {
  const encrypted = await nip04.encrypt(sk, recipientPubkey, JSON.stringify(signal))
  return finalizeEvent({
    kind: CALL_SIGNAL_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkey]],
    content: encrypted,
  }, sk)
}

const VALID_SIGNAL_TYPES: CallSignalType[] = ['call-offer', 'call-answer', 'ice-candidate', 'call-end']
const MAX_SDP_LEN = 65_536   // generous ceiling; real SDPs are ~2–8 KB
const MAX_CALL_ID_LEN = 128

function isValidCallSignal(obj: unknown): obj is CallSignal {
  if (!obj || typeof obj !== 'object') return false
  const s = obj as Record<string, unknown>

  if (!VALID_SIGNAL_TYPES.includes(s.type as CallSignalType)) return false
  if (typeof s.callId !== 'string' || s.callId.length === 0 || s.callId.length > MAX_CALL_ID_LEN) return false

  if (s.sdp !== undefined) {
    if (typeof s.sdp !== 'string' || s.sdp.length > MAX_SDP_LEN) return false
  }
  if (s.mediaType !== undefined && s.mediaType !== 'audio' && s.mediaType !== 'video') return false
  if (s.candidate !== undefined && (typeof s.candidate !== 'object' || s.candidate === null)) return false

  return true
}

export async function decryptCallSignal(
  sk: Uint8Array,
  senderPubkey: string,
  content: string,
): Promise<CallSignal | null> {
  try {
    const plain = await nip04.decrypt(sk, senderPubkey, content)
    const obj = JSON.parse(plain) as unknown
    return isValidCallSignal(obj) ? obj : null
  } catch {
    return null
  }
}
