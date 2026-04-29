import { finalizeEvent, nip04 } from 'nostr-tools'
import type { Event } from 'nostr-tools'

export const CALL_SIGNAL_KIND = 24100

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

/** Returns base STUN servers plus any saved TURN config from localStorage. */
export function getIceServers(): RTCIceServer[] {
  const base: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ]
  try {
    const raw = localStorage.getItem('turn_config')
    if (!raw) return base
    const extra = JSON.parse(raw) as RTCIceServer[]
    if (Array.isArray(extra) && extra.length > 0) return [...base, ...extra]
  } catch { /* localStorage unavailable or corrupt */ }
  return base
}

export type MediaType = 'audio' | 'video'
export type CallSignalType = 'call-offer' | 'call-answer' | 'ice-candidate' | 'call-end'

export interface CallSignal {
  type: CallSignalType
  callId: string
  mediaType?: MediaType
  sdp?: string
  candidate?: RTCIceCandidateInit
  reason?: 'rejected' | 'busy' | 'ended'
  iceServers?: RTCIceServer[]
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
const MAX_ICE_SERVERS = 20

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

  if (s.iceServers !== undefined) {
    if (!Array.isArray(s.iceServers) || s.iceServers.length > MAX_ICE_SERVERS) return false
    for (const srv of s.iceServers as unknown[]) {
      if (!srv || typeof srv !== 'object') return false
      const { urls } = srv as Record<string, unknown>
      if (typeof urls !== 'string' && !Array.isArray(urls)) return false
    }
  }

  return true
}

/**
 * Fetches fresh ICE servers for use at call-initiation time.
 * For Metered.ca mode this calls the API to get new time-scoped credentials
 * rather than reusing the cached ones, so they can be safely shared in the
 * encrypted call-offer signal.
 * Falls back to the cached config (getIceServers) on any error.
 */
export async function fetchCallIceServers(): Promise<RTCIceServer[]> {
  try {
    const mode = localStorage.getItem('turn_mode')
    if (mode !== 'metered') return getIceServers()

    const raw = localStorage.getItem('turn_metered_config')
    if (!raw) return getIceServers()
    const { subdomain, apiKey } = JSON.parse(raw) as { subdomain: string; apiKey: string }
    if (!subdomain || !apiKey) return getIceServers()
    const cleanSubdomain = subdomain.replace(/\.metered\.live$/i, '')

    const res = await fetch(
      `https://${encodeURIComponent(cleanSubdomain)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`
    )
    if (!res.ok) return getIceServers()
    const servers = await res.json() as RTCIceServer[]
    if (!Array.isArray(servers) || servers.length === 0) return getIceServers()

    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      ...servers,
    ]
  } catch {
    return getIceServers()
  }
}

/** Merges two ICE server lists, appending remote servers after local ones. */
export function mergeIceServers(local: RTCIceServer[], remote: RTCIceServer[]): RTCIceServer[] {
  return remote.length === 0 ? local : [...local, ...remote]
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
