// 1:1 call history records travel as kind-4 control payloads through the
// normal DM transport (like edits/deletes — see lib/messageOps.ts), so they
// inherit relay durability, backfill, dedup, persistence, and multi-device
// sync. One event, one writer: the caller publishes at the call's terminal
// transition. ponytail: caller crash mid-call leaves no record; a callee-side
// fallback log would cover it if that ever matters.

import type { MediaType } from './webrtc'
import { formatDuration } from './format'

export type CallOutcome = 'completed' | 'missed' | 'declined' | 'busy'

export interface CallLogPayload {
  type: 'call-log'
  callId: string
  mediaType: MediaType
  outcome: CallOutcome
  duration?: number // seconds, present only for completed
}

const MAX_CALL_ID_LEN = 128
const OUTCOMES: readonly string[] = ['completed', 'missed', 'declined', 'busy']

export function serializeCallLog(p: Omit<CallLogPayload, 'type'>): string {
  return JSON.stringify({ type: 'call-log', ...p } satisfies CallLogPayload)
}

export function parseCallLogPayload(content: string): CallLogPayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (
      obj?.type === 'call-log' &&
      typeof obj.callId === 'string' && obj.callId.length > 0 && obj.callId.length <= MAX_CALL_ID_LEN &&
      (obj.mediaType === 'audio' || obj.mediaType === 'video') &&
      OUTCOMES.includes(obj.outcome) &&
      (obj.duration === undefined ||
        (typeof obj.duration === 'number' && Number.isFinite(obj.duration) && obj.duration >= 0))
    ) return obj as CallLogPayload
  } catch { /* not JSON */ }
  return null
}

/** Terminal outcome of a 1:1 call, computed on the caller's side. */
export function deriveCallOutcome(wasConnected: boolean, endReason?: string): CallOutcome {
  if (wasConnected) return 'completed'
  if (endReason === 'rejected') return 'declined'
  if (endReason === 'busy') return 'busy'
  return 'missed'
}

/**
 * Thread-row and sidebar/notification label. `isOwn` = rendered by the caller
 * (event author); the callee perspective (isOwn=false) is also the sidebar
 * preview and notification text, since previews only run for incoming events.
 */
export function callLogLabel(p: CallLogPayload, isOwn: boolean): string {
  const kind = p.mediaType === 'video' ? 'Video call' : 'Voice call'
  const missedKind = p.mediaType === 'video' ? 'Missed video call' : 'Missed voice call'
  switch (p.outcome) {
    case 'completed': return `${kind} · ${formatDuration(p.duration ?? 0)}`
    case 'missed':    return isOwn ? `${kind} · no answer` : missedKind
    case 'declined':  return `${kind} declined`
    case 'busy':      return isOwn ? `${kind} · busy` : `${missedKind} · busy`
  }
}
