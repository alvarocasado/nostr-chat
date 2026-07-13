import { describe, it, expect } from 'vitest'
import {
  serializeCallLog, parseCallLogPayload, deriveCallOutcome, callLogLabel,
  type CallLogPayload,
} from '../lib/callLog'

describe('serialize / parse round-trip', () => {
  it('round-trips a completed call with duration', () => {
    const s = serializeCallLog({ callId: 'c1', mediaType: 'video', outcome: 'completed', duration: 754 })
    expect(parseCallLogPayload(s)).toEqual({
      type: 'call-log', callId: 'c1', mediaType: 'video', outcome: 'completed', duration: 754,
    })
  })

  it('round-trips a missed call without duration', () => {
    const s = serializeCallLog({ callId: 'c2', mediaType: 'audio', outcome: 'missed' })
    expect(parseCallLogPayload(s)).toEqual({
      type: 'call-log', callId: 'c2', mediaType: 'audio', outcome: 'missed',
    })
  })
})

describe('parseCallLogPayload validation', () => {
  const valid = { type: 'call-log', callId: 'c', mediaType: 'audio', outcome: 'missed' }

  it('rejects non-JSON and non-object content', () => {
    expect(parseCallLogPayload('hello')).toBeNull()
    expect(parseCallLogPayload('{not json')).toBeNull()
  })
  it('rejects wrong type field', () => {
    expect(parseCallLogPayload(JSON.stringify({ ...valid, type: 'edit' }))).toBeNull()
  })
  it('rejects empty and oversized callId', () => {
    expect(parseCallLogPayload(JSON.stringify({ ...valid, callId: '' }))).toBeNull()
    expect(parseCallLogPayload(JSON.stringify({ ...valid, callId: 'x'.repeat(129) }))).toBeNull()
  })
  it('rejects unknown outcome and mediaType', () => {
    expect(parseCallLogPayload(JSON.stringify({ ...valid, outcome: 'exploded' }))).toBeNull()
    expect(parseCallLogPayload(JSON.stringify({ ...valid, mediaType: 'hologram' }))).toBeNull()
  })
  it('rejects invalid durations', () => {
    expect(parseCallLogPayload(JSON.stringify({ ...valid, duration: -1 }))).toBeNull()
    expect(parseCallLogPayload(JSON.stringify({ ...valid, duration: Infinity }))).toBeNull()
    expect(parseCallLogPayload(JSON.stringify({ ...valid, duration: 'long' }))).toBeNull()
  })
})

describe('deriveCallOutcome', () => {
  it('connected at any point is completed regardless of end reason', () => {
    expect(deriveCallOutcome(true)).toBe('completed')
    expect(deriveCallOutcome(true, 'ended')).toBe('completed')
    expect(deriveCallOutcome(true, 'rejected')).toBe('completed')
  })
  it('never-connected maps end reasons', () => {
    expect(deriveCallOutcome(false, 'rejected')).toBe('declined')
    expect(deriveCallOutcome(false, 'busy')).toBe('busy')
    expect(deriveCallOutcome(false, 'ended')).toBe('missed')
    expect(deriveCallOutcome(false)).toBe('missed')
  })
})

describe('callLogLabel', () => {
  const p = (over: Partial<CallLogPayload>): CallLogPayload =>
    ({ type: 'call-log', callId: 'c', mediaType: 'audio', outcome: 'missed', ...over })

  it('completed shows kind and duration for both sides', () => {
    expect(callLogLabel(p({ outcome: 'completed', duration: 754, mediaType: 'video' }), true)).toBe('Video call · 12:34')
    expect(callLogLabel(p({ outcome: 'completed', duration: 61 }), false)).toBe('Voice call · 1:01')
  })
  it('missed is perspective-aware', () => {
    expect(callLogLabel(p({}), true)).toBe('Voice call · no answer')
    expect(callLogLabel(p({}), false)).toBe('Missed voice call')
    expect(callLogLabel(p({ mediaType: 'video' }), false)).toBe('Missed video call')
  })
  it('declined is the same for both sides', () => {
    expect(callLogLabel(p({ outcome: 'declined' }), true)).toBe('Voice call declined')
    expect(callLogLabel(p({ outcome: 'declined' }), false)).toBe('Voice call declined')
  })
  it('busy is perspective-aware', () => {
    expect(callLogLabel(p({ outcome: 'busy' }), true)).toBe('Voice call · busy')
    expect(callLogLabel(p({ outcome: 'busy' }), false)).toBe('Missed voice call · busy')
  })
})
