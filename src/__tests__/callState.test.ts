import { describe, it, expect } from 'vitest'
import type { CallSignal, CallSignalType } from '../lib/webrtc'

// ─── Pure state-machine logic ────────────────────────────────────────────────
// These functions mirror the exact decision rules in CallContext without
// requiring React, WebRTC, or Nostr I/O.

type CallState = 'idle' | 'calling' | 'incoming' | 'connected'

function shouldSendBusy(currentState: CallState, signal: CallSignal): boolean {
  return signal.type === 'call-offer' && currentState !== 'idle'
}

function nextStateOnSignal(current: CallState, signal: CallSignal): CallState {
  switch (signal.type) {
    case 'call-offer':
      return current === 'idle' ? 'incoming' : current  // busy → stays same
    case 'call-answer':
      return current === 'calling' ? 'connected' : current
    case 'call-end':
      return 'idle'
    default:
      return current
  }
}

function nextStateOnAction(
  current: CallState,
  action: 'initiate' | 'accept' | 'reject' | 'hangup',
): CallState {
  switch (action) {
    case 'initiate': return current === 'idle' ? 'calling' : current
    case 'accept':   return current === 'incoming' ? 'connected' : current
    case 'reject':   return current === 'incoming' ? 'idle' : current
    case 'hangup':   return 'idle'
  }
}

// ICE candidate buffer: queued when no remote SDP yet, flushed after
function makeIceBuffer() {
  const queue: RTCIceCandidateInit[] = []
  let hasRemoteSdp = false

  return {
    setRemoteSdp() { hasRemoteSdp = true },
    addCandidate(c: RTCIceCandidateInit): boolean {
      if (hasRemoteSdp) return true   // applied immediately
      queue.push(c)
      return false                    // buffered
    },
    flush() { const out = [...queue]; queue.length = 0; return out },
    get queued() { return queue.length },
    get ready() { return hasRemoteSdp },
  }
}

// ─── Busy rejection ───────────────────────────────────────────────────────────

describe('busy rejection', () => {
  const offer: CallSignal = { type: 'call-offer', callId: 'c1' }

  it('does not send busy when idle', () => {
    expect(shouldSendBusy('idle', offer)).toBe(false)
  })

  it('sends busy when already calling', () => {
    expect(shouldSendBusy('calling', offer)).toBe(true)
  })

  it('sends busy when already in an incoming state', () => {
    expect(shouldSendBusy('incoming', offer)).toBe(true)
  })

  it('sends busy when already connected', () => {
    expect(shouldSendBusy('connected', offer)).toBe(true)
  })

  it('does not send busy for non-offer signals', () => {
    const signals: CallSignalType[] = ['call-answer', 'ice-candidate', 'call-end']
    for (const type of signals) {
      expect(shouldSendBusy('connected', { type, callId: 'c1' })).toBe(false)
    }
  })
})

// ─── State transitions on incoming signals ───────────────────────────────────

describe('state transitions on incoming signals', () => {
  it('idle + call-offer → incoming', () => {
    expect(nextStateOnSignal('idle', { type: 'call-offer', callId: 'c1' })).toBe('incoming')
  })

  it('calling + call-answer → connected', () => {
    expect(nextStateOnSignal('calling', { type: 'call-answer', callId: 'c1' })).toBe('connected')
  })

  it('connected + call-end → idle', () => {
    expect(nextStateOnSignal('connected', { type: 'call-end', callId: 'c1' })).toBe('idle')
  })

  it('calling + call-end → idle (remote hung up before answering)', () => {
    expect(nextStateOnSignal('calling', { type: 'call-end', callId: 'c1' })).toBe('idle')
  })

  it('ice-candidate does not change state', () => {
    const states: CallState[] = ['calling', 'incoming', 'connected']
    for (const s of states) {
      expect(nextStateOnSignal(s, { type: 'ice-candidate', callId: 'c1' })).toBe(s)
    }
  })

  it('call-offer while not idle does not change state (caller sees busy response)', () => {
    const activeStates: CallState[] = ['calling', 'incoming', 'connected']
    for (const s of activeStates) {
      expect(nextStateOnSignal(s, { type: 'call-offer', callId: 'c2' })).toBe(s)
    }
  })
})

// ─── State transitions on user actions ───────────────────────────────────────

describe('state transitions on user actions', () => {
  it('idle + initiate → calling', () => {
    expect(nextStateOnAction('idle', 'initiate')).toBe('calling')
  })

  it('non-idle + initiate → unchanged (guard against double-call)', () => {
    expect(nextStateOnAction('calling', 'initiate')).toBe('calling')
    expect(nextStateOnAction('connected', 'initiate')).toBe('connected')
  })

  it('incoming + accept → connected', () => {
    expect(nextStateOnAction('incoming', 'accept')).toBe('connected')
  })

  it('incoming + reject → idle', () => {
    expect(nextStateOnAction('incoming', 'reject')).toBe('idle')
  })

  it('any state + hangup → idle', () => {
    const states: CallState[] = ['calling', 'incoming', 'connected']
    for (const s of states) {
      expect(nextStateOnAction(s, 'hangup')).toBe('idle')
    }
  })
})

// ─── ICE candidate buffering ─────────────────────────────────────────────────

describe('ICE candidate buffering', () => {
  it('buffers candidates when remote SDP is not yet set', () => {
    const buf = makeIceBuffer()
    const applied = buf.addCandidate({ candidate: 'cand1' })
    expect(applied).toBe(false)
    expect(buf.queued).toBe(1)
  })

  it('applies candidates immediately when remote SDP is set', () => {
    const buf = makeIceBuffer()
    buf.setRemoteSdp()
    const applied = buf.addCandidate({ candidate: 'cand1' })
    expect(applied).toBe(true)
    expect(buf.queued).toBe(0)
  })

  it('flushes all buffered candidates after remote SDP arrives', () => {
    const buf = makeIceBuffer()
    buf.addCandidate({ candidate: 'cand1' })
    buf.addCandidate({ candidate: 'cand2' })
    buf.addCandidate({ candidate: 'cand3' })
    expect(buf.queued).toBe(3)

    buf.setRemoteSdp()
    const flushed = buf.flush()
    expect(flushed).toHaveLength(3)
    expect(buf.queued).toBe(0)
  })

  it('flush returns candidates in arrival order', () => {
    const buf = makeIceBuffer()
    buf.addCandidate({ candidate: 'first' })
    buf.addCandidate({ candidate: 'second' })
    const flushed = buf.flush()
    expect(flushed[0].candidate).toBe('first')
    expect(flushed[1].candidate).toBe('second')
  })

  it('flush is idempotent — second flush returns empty array', () => {
    const buf = makeIceBuffer()
    buf.addCandidate({ candidate: 'cand1' })
    buf.flush()
    expect(buf.flush()).toHaveLength(0)
  })
})
