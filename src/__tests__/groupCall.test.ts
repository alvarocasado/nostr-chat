import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installTestSigner } from '../test/signer'
import { clearSigner } from '../lib/signer'
import { generateGroupKey } from '../lib/groupCrypto'
import {
  GROUP_CALL_PRESENCE_KIND, MAX_GROUP_CALL_PARTICIPANTS,
  PRESENCE_EXPIRY_MS,
  buildPresenceEvent, parsePresenceEvent,
  deriveRoster, myOfferWins, deriveJoinState, activeCallPeers,
  serializeCallStart, parseCallStartPayload,
  type Heartbeat, type JoinState,
} from '../lib/groupCall'

beforeEach(() => { installTestSigner() })
afterEach(() => clearSigner())

const GROUP_ID = 'g'.repeat(64)

describe('presence events', () => {
  it('builds an ephemeral 24103 event tagged to the group with encrypted content', async () => {
    const key = generateGroupKey()
    const event = await buildPresenceEvent(GROUP_ID, key, 'call1', 'audio')
    expect(event.kind).toBe(GROUP_CALL_PRESENCE_KIND)
    expect(event.kind).toBeGreaterThanOrEqual(20000)
    expect(event.kind).toBeLessThan(30000)
    expect(event.tags).toEqual([['h', GROUP_ID]])
    expect(event.content).not.toContain('presence')
  })

  it('round-trips through parse with the group key', async () => {
    const key = generateGroupKey()
    const event = await buildPresenceEvent(GROUP_ID, key, 'call1', 'video')
    expect(await parsePresenceEvent(event, key)).toEqual({ type: 'presence', callId: 'call1', mediaType: 'video' })
  })

  it('returns null for wrong key, wrong kind, or malformed payloads', async () => {
    const key = generateGroupKey()
    const event = await buildPresenceEvent(GROUP_ID, key, 'call1', 'audio')
    expect(await parsePresenceEvent(event, generateGroupKey())).toBeNull()
    expect(await parsePresenceEvent({ ...event, kind: 24100 }, key)).toBeNull()
    const { encryptWithGroupKey } = await import('../lib/groupCrypto')
    const bad = { ...event, content: await encryptWithGroupKey(JSON.stringify({ type: 'presence', callId: '', mediaType: 'audio' }), key) }
    expect(await parsePresenceEvent(bad, key)).toBeNull()
    const longId = { ...event, content: await encryptWithGroupKey(JSON.stringify({ type: 'presence', callId: 'x'.repeat(129), mediaType: 'audio' }), key) }
    expect(await parsePresenceEvent(longId, key)).toBeNull()
    const badMedia = { ...event, content: await encryptWithGroupKey(JSON.stringify({ type: 'presence', callId: 'c', mediaType: 'screen' }), key) }
    expect(await parsePresenceEvent(badMedia, key)).toBeNull()
  })
})

describe('deriveRoster', () => {
  const hb = (callId: string, receivedAt: number): Heartbeat => ({ callId, mediaType: 'audio', receivedAt })

  it('returns null when no live heartbeats exist', () => {
    expect(deriveRoster(new Map(), 1_000_000)).toBeNull()
    const stale = new Map([['pk1', hb('c1', 1_000_000 - PRESENCE_EXPIRY_MS - 1)]])
    expect(deriveRoster(stale, 1_000_000)).toBeNull()
  })

  it('returns live participants sorted, expiring stale ones', () => {
    const now = 1_000_000
    const map = new Map([
      ['pkB', hb('c1', now - 1_000)],
      ['pkA', hb('c1', now - PRESENCE_EXPIRY_MS + 1)],
      ['pkC', hb('c1', now - PRESENCE_EXPIRY_MS - 1)],
    ])
    expect(deriveRoster(map, now)).toEqual({ callId: 'c1', mediaType: 'audio', participants: ['pkA', 'pkB'] })
  })

  it('converges on the lexicographically smallest live callId', () => {
    const now = 1_000_000
    const map = new Map([
      ['pk1', hb('bbb', now - 1_000)],
      ['pk2', hb('aaa', now - 1_000)],
    ])
    expect(deriveRoster(map, now)?.callId).toBe('aaa')
    expect(deriveRoster(map, now)?.participants).toEqual(['pk2'])
  })
})

describe('activeCallPeers', () => {
  const hb = (callId: string, receivedAt: number): Heartbeat => ({ callId, mediaType: 'audio', receivedAt })

  it('returns only pubkeys live on the given callId', () => {
    const now = 1_000_000
    const map = new Map([
      ['pkA', hb('c1', now - 1_000)],
      ['pkB', hb('c1', now - 2_000)],
      ['pkC', hb('c2', now - 1_000)],
    ])
    expect(activeCallPeers(map, 'c1', now).sort()).toEqual(['pkA', 'pkB'])
  })

  it('excludes heartbeats past PRESENCE_EXPIRY_MS even on the active call', () => {
    const now = 1_000_000
    const map = new Map([
      ['pkA', hb('c1', now - PRESENCE_EXPIRY_MS - 1)],
      ['pkB', hb('c1', now - 1_000)],
    ])
    expect(activeCallPeers(map, 'c1', now)).toEqual(['pkB'])
  })

  it('does not let a stale, lexicographically-smaller callId displace peers on the current call', () => {
    // Regression: deriveRoster would converge on 'a-old' here (smallest live
    // callId), wrongly dropping pkCurrent even though it is still heartbeating
    // on the actually-active call 'c1'.
    const now = 1_000_000
    const map = new Map([
      ['pkCurrent', hb('c1', now - 1_000)],
      ['pkStale', hb('a-old', now - PRESENCE_EXPIRY_MS + 1)],
    ])
    expect(deriveRoster(map, now)?.callId).toBe('a-old')
    expect(activeCallPeers(map, 'c1', now)).toEqual(['pkCurrent'])
  })
})

describe('myOfferWins', () => {
  it('smaller pubkey wins', () => {
    expect(myOfferWins('aaa', 'bbb')).toBe(true)
    expect(myOfferWins('bbb', 'aaa')).toBe(false)
  })
})

describe('deriveJoinState', () => {
  const base = { participants: ['p1', 'p2'], myPubkey: 'me', inCallLocally: false, busyWithDmCall: false }
  it.each<[JoinState, Parameters<typeof deriveJoinState>[0]]>([
    ['can-join', base],
    ['in-call', { ...base, inCallLocally: true }],
    ['busy', { ...base, busyWithDmCall: true }],
    ['other-device', { ...base, participants: ['p1', 'me'] }],
    ['full', { ...base, participants: ['1', '2', '3', '4', '5', '6'] }],
  ])('returns %s', (expected, args) => {
    expect(deriveJoinState(args)).toBe(expected)
  })

  it('cap uses MAX_GROUP_CALL_PARTICIPANTS', () => {
    const five = { ...base, participants: ['1', '2', '3', '4', '5'] }
    expect(MAX_GROUP_CALL_PARTICIPANTS).toBe(6)
    expect(deriveJoinState(five)).toBe('can-join')
  })
})

describe('call-start payload', () => {
  it('round-trips', () => {
    expect(parseCallStartPayload(serializeCallStart('c1'))).toEqual({ type: 'call-start', callId: 'c1' })
  })
  it('rejects malformed payloads', () => {
    expect(parseCallStartPayload('not json')).toBeNull()
    expect(parseCallStartPayload(JSON.stringify({ type: 'call-start', callId: '' }))).toBeNull()
    expect(parseCallStartPayload(JSON.stringify({ type: 'call-start', callId: 'x'.repeat(129) }))).toBeNull()
    expect(parseCallStartPayload(JSON.stringify({ type: 'reaction', callId: 'c' }))).toBeNull()
  })
})
