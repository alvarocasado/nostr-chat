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

export async function decryptCallSignal(
  sk: Uint8Array,
  senderPubkey: string,
  content: string,
): Promise<CallSignal | null> {
  try {
    const plain = await nip04.decrypt(sk, senderPubkey, content)
    const obj = JSON.parse(plain)
    if (typeof obj?.type !== 'string' || typeof obj?.callId !== 'string') return null
    return obj as CallSignal
  } catch {
    return null
  }
}
