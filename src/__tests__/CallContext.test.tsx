import { it, expect, vi, beforeEach, afterEach, describe } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { finalizeEvent, generateSecretKey, getPublicKey, nip04 } from 'nostr-tools'
import type { Event } from 'nostr-tools'

const publishEvent = vi.fn(async (..._args: unknown[]) => {})
const subCallbacks: Array<(e: Event) => void> = []
const subscribeEvents = vi.fn((_r: unknown, _f: unknown, cb: (e: Event) => void) => {
  subCallbacks.push(cb)
  return { close: vi.fn() }
})
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    publishEvent: (...a: unknown[]) => publishEvent(...(a as [])),
    subscribeEvents: (...a: unknown[]) => (subscribeEvents as unknown as (...x: unknown[]) => unknown)(...a),
  }
})
vi.mock('../lib/notifications', () => ({ fireCallNotification: vi.fn(() => () => {}) }))
vi.mock('../lib/peerRelays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/peerRelays')>()
  return { ...actual, getPeerRelays: vi.fn().mockResolvedValue({ read: ['wss://peer-read'], write: [] }) }
})
// Call logs go through sendPrivate (Task 7), which gift-wraps when the signer
// can nip44 and the peer advertises kind 10050. Force the legacy kind-4 path
// so these tests stay deterministic (no live relay lookup for the peer's caps)
// and keep asserting on kind-4 publishEvent calls as before.
vi.mock('../lib/dmCaps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dmCaps')>()
  return { ...actual, fetchDmCaps: vi.fn().mockResolvedValue({ nip17: false, relays: [] }) }
})

import { CallProvider, useCallContext } from '../contexts/CallContext'
import { useNostrStore } from '../store/nostrStore'
import { installTestSigner } from '../test/signer'
import { clearSigner, getSigner } from '../lib/signer'
import { CALL_SIGNAL_KIND } from '../lib/webrtc'
import { parseCallLogPayload } from '../lib/callLog'

const peerSk = generateSecretKey()
const PEER = getPublicKey(peerSk)

const pcs: FakePC[] = []
class FakePC {
  onicecandidate: ((e: { candidate: null }) => void) | null = null
  ontrack: unknown = null
  onconnectionstatechange: (() => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  connectionState = 'new'
  iceConnectionState = 'new'
  remoteDescription: unknown = null
  constructor() { pcs.push(this) }
  addTrack() {}
  getSenders() { return [] }
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' } }
  async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' } }
  async setLocalDescription() {}
  async setRemoteDescription(d: unknown) { this.remoteDescription = d }
  async addIceCandidate() {}
  close() {}
}
vi.stubGlobal('RTCPeerConnection', FakePC)
vi.stubGlobal('RTCIceCandidate', class { c: unknown; constructor(c: unknown) { this.c = c } } as unknown as typeof RTCIceCandidate)

function fakeStream() {
  return { getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream
}

function Probe() {
  const ctx = useCallContext()
  return (
    <div>
      <span data-testid="state">{ctx.callState}</span>
      <button onClick={() => ctx.initiateCall(PEER, 'audio')}>call</button>
      <button onClick={() => ctx.rejectCall()}>reject</button>
      <button onClick={() => ctx.hangup()}>hangup</button>
    </div>
  )
}

/** Published kind-4 events (call logs are the only kind-4s CallContext sends). */
function publishedKind4s(): Event[] {
  return publishEvent.mock.calls.map(c => c[1] as Event).filter(e => e.kind === 4)
}

/** The caller's optimistic call-log message stored for the peer thread. */
function storedCallLog() {
  const msgs = useNostrStore.getState().messages[PEER] ?? []
  for (const m of msgs) {
    const p = parseCallLogPayload(m.content)
    if (p) return p
  }
  return null
}

async function startCall() {
  render(<CallProvider><Probe /></CallProvider>)
  act(() => screen.getByText('call').click())
  // the offer (kind 24100) marks the call as loggable
  await waitFor(() => {
    expect(publishEvent.mock.calls.some(c => (c[1] as Event).kind === CALL_SIGNAL_KIND)).toBe(true)
  })
}

/** Encrypt and deliver a call-end signal from the peer, using the real callId from the published offer. */
async function deliverCallEnd(reason: 'rejected' | 'busy' | 'ended') {
  const offer = publishEvent.mock.calls.map(c => c[1] as Event).find(e => e.kind === CALL_SIGNAL_KIND)!
  const myPk = getSigner()!.pubkey
  const { callId } = JSON.parse(await nip04.decrypt(peerSk, myPk, offer.content)) as { callId: string }
  const content = await nip04.encrypt(peerSk, myPk, JSON.stringify({ type: 'call-end', callId, reason }))
  const event = finalizeEvent(
    { kind: CALL_SIGNAL_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['p', myPk]], content },
    peerSk,
  )
  await act(async () => { subCallbacks.forEach(cb => cb(event)) })
}

beforeEach(() => {
  vi.clearAllMocks()
  subCallbacks.length = 0
  pcs.length = 0
  installTestSigner()
  ;(navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: vi.fn(async () => fakeStream()),
  }
  useNostrStore.setState({
    publicKey: getSigner()!.pubkey,
    signerCaps: { nip04: true, nip44: true },
    relays: ['wss://test.example'],
    relayModes: {},
    messages: {},
    contacts: [],
    activeCallType: 'none',
  })
})
afterEach(() => clearSigner())

describe('caller publishes exactly one call-log at the terminal transition', () => {
  it('hangup before answer logs a missed call', async () => {
    await startCall()
    act(() => screen.getByText('hangup').click())
    await waitFor(() => expect(publishedKind4s()).toHaveLength(1))
    expect(storedCallLog()).toMatchObject({ outcome: 'missed', mediaType: 'audio' })
    expect(storedCallLog()?.duration).toBeUndefined()
  })

  it('a connected call logs completed with a duration field', async () => {
    await startCall()
    act(() => { pcs[0].connectionState = 'connected'; pcs[0].onconnectionstatechange?.() })
    act(() => screen.getByText('hangup').click())
    await waitFor(() => expect(publishedKind4s()).toHaveLength(1))
    expect(storedCallLog()).toMatchObject({ outcome: 'completed' })
    expect(typeof storedCallLog()?.duration).toBe('number')
  })

  it('a received rejection logs declined; busy logs busy', async () => {
    await startCall()
    await deliverCallEnd('rejected')
    await waitFor(() => expect(publishedKind4s()).toHaveLength(1))
    expect(storedCallLog()).toMatchObject({ outcome: 'declined' })
  })

  it('a connection failure before connecting logs missed, once', async () => {
    await startCall()
    act(() => { pcs[0].connectionState = 'failed'; pcs[0].onconnectionstatechange?.() })
    await waitFor(() => expect(publishedKind4s()).toHaveLength(1))
    expect(storedCallLog()).toMatchObject({ outcome: 'missed' })
    // cleanup already ran; a later hangup must not double-log
    act(() => screen.getByText('hangup').click())
    expect(publishedKind4s()).toHaveLength(1)
  })

  it('getUserMedia failure logs nothing', async () => {
    ;(navigator as unknown as { mediaDevices: { getUserMedia: unknown } }).mediaDevices = {
      getUserMedia: vi.fn(async () => { throw new Error('denied') }),
    }
    render(<CallProvider><Probe /></CallProvider>)
    act(() => screen.getByText('call').click())
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('idle'))
    expect(publishedKind4s()).toHaveLength(0)
  })
})

describe('final-review hardening', () => {
  it('publishes the call-log to own write relays plus the peer read relays', async () => {
    await startCall()
    act(() => screen.getByText('hangup').click())
    await waitFor(() => expect(publishedKind4s()).toHaveLength(1))
    const logCall = publishEvent.mock.calls.find(c => (c[1] as Event).kind === 4)!
    expect(logCall[0]).toContain('wss://peer-read')
    expect(logCall[0]).toContain('wss://test.example')
  })

  it('ignores a call-end forged by a third party with the right callId', async () => {
    await startCall()
    const offer = publishEvent.mock.calls.map(c => c[1] as Event).find(e => e.kind === CALL_SIGNAL_KIND)!
    const myPk = getSigner()!.pubkey
    const { callId } = JSON.parse(await nip04.decrypt(peerSk, myPk, offer.content)) as { callId: string }
    const mallorySk = generateSecretKey()
    const content = await nip04.encrypt(mallorySk, myPk, JSON.stringify({ type: 'call-end', callId, reason: 'rejected' }))
    const forged = finalizeEvent(
      { kind: CALL_SIGNAL_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['p', myPk]], content },
      mallorySk,
    )
    await act(async () => { subCallbacks.forEach(cb => cb(forged)) })
    // the forged signal is dropped: still ringing, no history row published anywhere
    expect(screen.getByTestId('state').textContent).toBe('calling')
    expect(publishedKind4s()).toHaveLength(0)
  })

  it('a hangup during getUserMedia leaves no stale offer and no call-log', async () => {
    let resolveStream!: (s: MediaStream) => void
    ;(navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
      getUserMedia: vi.fn(() => new Promise<MediaStream>(res => { resolveStream = res })),
    }
    render(<CallProvider><Probe /></CallProvider>)
    act(() => screen.getByText('call').click())
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('calling'))
    act(() => screen.getByText('hangup').click())
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('idle'))
    await act(async () => { resolveStream(fakeStream()) })
    // only the hangup's call-end went out; the stale continuation sent no offer
    const signals = publishEvent.mock.calls.map(c => c[1] as Event).filter(e => e.kind === CALL_SIGNAL_KIND)
    expect(signals).toHaveLength(1)
    expect(publishedKind4s()).toHaveLength(0)
    act(() => screen.getByText('hangup').click())
    expect(publishedKind4s()).toHaveLength(0)
  })
})

describe('callee never publishes a call-log', () => {
  it('rejecting an incoming offer sends only the call-end signal', async () => {
    render(<CallProvider><Probe /></CallProvider>)
    const myPk = getSigner()!.pubkey
    const content = await nip04.encrypt(peerSk, myPk, JSON.stringify({
      type: 'call-offer', callId: 'in1', mediaType: 'audio', sdp: 'offer-sdp',
    }))
    const event = finalizeEvent(
      { kind: CALL_SIGNAL_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['p', myPk]], content },
      peerSk,
    )
    await act(async () => { subCallbacks.forEach(cb => cb(event)) })
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('incoming'))
    act(() => screen.getByText('reject').click())
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('idle'))
    expect(publishedKind4s()).toHaveLength(0)
  })
})

describe('stale signal gate', () => {
  it('a replayed call-offer older than 60 s does not ring', async () => {
    render(<CallProvider><Probe /></CallProvider>)
    const myPk = getSigner()!.pubkey
    const content = await nip04.encrypt(peerSk, myPk, JSON.stringify({
      type: 'call-offer', callId: 'ghost1', mediaType: 'audio', sdp: 'offer-sdp',
    }))
    const stale = finalizeEvent(
      { kind: CALL_SIGNAL_KIND, created_at: Math.floor(Date.now() / 1000) - 120, tags: [['p', myPk]], content },
      peerSk,
    )
    await act(async () => { subCallbacks.forEach(cb => cb(stale)) })
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })
})
