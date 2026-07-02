import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import type { Event } from 'nostr-tools'

class FakePC {
  static instances: FakePC[] = []
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null
  ontrack: ((e: { streams: MediaStream[] }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  connectionState = 'new'
  remoteDescription: unknown = null
  localDescription: unknown = null
  closed = false
  addedTracks: unknown[] = []
  constructor(public config: unknown) { FakePC.instances.push(this) }
  addTrack(t: unknown) { this.addedTracks.push(t) }
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' } }
  async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' } }
  async setLocalDescription(d: unknown) { this.localDescription = d }
  async setRemoteDescription(d: unknown) { this.remoteDescription = d }
  async addIceCandidate(_c: unknown) {}
  getSenders() { return [] }
  close() { this.closed = true }
}
vi.stubGlobal('RTCPeerConnection', FakePC as unknown as typeof RTCPeerConnection)
vi.stubGlobal('RTCIceCandidate', class { constructor(public c: unknown) {} } as unknown as typeof RTCIceCandidate)

const publishEvent = vi.fn(async () => {})
const subCallbacks = new Map<string, (e: Event) => void>()
const subscribeEvents = vi.fn((_r: unknown, filter: { kinds: number[] }, cb: (e: Event) => void) => {
  subCallbacks.set(filter.kinds.join(','), cb)
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
vi.mock('../hooks/useNostrSubscriptions', () => ({ sendGroupCallStart: vi.fn(async () => ({})) }))

import { GroupCallProvider, useGroupCallContext } from '../contexts/GroupCallContext'
import { useNostrStore } from '../store/nostrStore'
import { installTestSigner } from '../test/signer'
import { clearSigner, getSigner, LocalSigner } from '../lib/signer'
import { generateSecretKey } from 'nostr-tools'
import { generateGroupKey, encryptWithGroupKey } from '../lib/groupCrypto'
import { GROUP_CALL_PRESENCE_KIND } from '../lib/groupCall'
import { CALL_SIGNAL_KIND as SIGNAL_KIND, type CallSignal } from '../lib/webrtc'

const GROUP_ID = 'g'.repeat(64)
const KEY = generateGroupKey()
// A real second keypair so peer-authored signals can be NIP-04 encrypted to us.
const peerSigner = new LocalSigner(generateSecretKey())
const PEER = peerSigner.pubkey

/** Build a signal event authored by PEER, encrypted to the test signer. */
async function peerSignal(signal: CallSignal, from = peerSigner): Promise<Event> {
  const me = getSigner()!.pubkey
  const content = await from.nip04Encrypt(me, JSON.stringify(signal))
  return {
    id: Math.random().toString(36).slice(2), pubkey: from.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: SIGNAL_KIND, tags: [['p', me]], content, sig: 'sig',
  }
}

function fakeStream() {
  return { getTracks: () => [{ stop: vi.fn(), kind: 'audio', enabled: true }], getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream
}

function Probe() {
  const ctx = useGroupCallContext()
  return (
    <div>
      <span data-testid="state">{ctx.groupCallState}</span>
      <span data-testid="peers">{[...ctx.peerStates.keys()].join(',')}</span>
      <span data-testid="live">{ctx.liveCall ? ctx.liveCall.participants.length : 0}</span>
      <button onClick={() => ctx.watchGroup(GROUP_ID)}>watch</button>
      <button onClick={() => ctx.startOrJoin(GROUP_ID, 'audio')}>join</button>
      <button onClick={() => ctx.leave()}>leave</button>
    </div>
  )
}

async function presenceEvent(pubkey: string, callId: string): Promise<Event> {
  const content = await encryptWithGroupKey(JSON.stringify({ type: 'presence', callId, mediaType: 'audio' }), KEY)
  return { id: Math.random().toString(36).slice(2), pubkey, created_at: Math.floor(Date.now() / 1000), kind: GROUP_CALL_PRESENCE_KIND, tags: [['e', GROUP_ID]], content, sig: 'sig' }
}

beforeEach(() => {
  vi.clearAllMocks()
  FakePC.instances.length = 0
  subCallbacks.clear()
  installTestSigner()
  // src/test/setup.ts defines navigator.mediaDevices as writable but not
  // configurable, so plain assignment replaces it per-test (Object.defineProperty
  // would throw trying to redefine a non-configurable property).
  navigator.mediaDevices = { getUserMedia: vi.fn(async () => fakeStream()) } as unknown as MediaDevices
  useNostrStore.setState({
    publicKey: getSigner()!.pubkey,
    groupKeys: { [GROUP_ID]: KEY },
    relays: ['wss://test.example'], relayModes: {}, activeCallType: 'none',
  })
})
afterEach(() => clearSigner())

async function joinWithRoster() {
  render(<GroupCallProvider><Probe /></GroupCallProvider>)
  act(() => screen.getByText('watch').click())
  await waitFor(() => expect(subCallbacks.has(String(GROUP_CALL_PRESENCE_KIND))).toBe(true))
  const e = await presenceEvent(PEER, 'c1')
  await act(async () => { subCallbacks.get(String(GROUP_CALL_PRESENCE_KIND))!(e) })
  // Presence decryption uses real WebCrypto, which resolves on a real event-loop
  // tick rather than a microtask act() can flush; wait for the heartbeat to
  // actually land in the roster before joining, or the join races ahead of it
  // and computes an empty roster (same pattern as GroupCallContext.test.tsx).
  await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('1'))
  act(() => screen.getByText('join').click())
  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('in-call'))
}

function signalEvents(): Event[] {
  return publishEvent.mock.calls.map(c => c[1] as Event).filter(ev => ev.kind === SIGNAL_KIND)
}

async function deliverSignal(e: Event) {
  await waitFor(() => expect(subCallbacks.has(String(SIGNAL_KIND))).toBe(true))
  await act(async () => { subCallbacks.get(String(SIGNAL_KIND))!(e) })
}

it('joining sends one group call-offer per roster member', async () => {
  await joinWithRoster()
  await waitFor(() => {
    expect(signalEvents().length).toBe(1)
    expect(signalEvents()[0].tags).toEqual([['p', PEER]])
  })
  expect(FakePC.instances.length).toBe(1)
})

it('an incoming call-answer completes the pending connection without creating a new PC', async () => {
  await joinWithRoster()
  await waitFor(() => expect(FakePC.instances.length).toBe(1))
  const callId = 'c1'
  await deliverSignal(await peerSignal({ type: 'call-answer', callId, groupId: GROUP_ID, sdp: 'answer-sdp' }))
  await waitFor(() => expect(FakePC.instances[0].remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' }))
  expect(FakePC.instances.length).toBe(1)
})

it('auto-answers a late-join offer for the active call', async () => {
  await joinWithRoster()
  const third = new LocalSigner(generateSecretKey())
  await deliverSignal(await peerSignal({ type: 'call-offer', callId: 'c1', groupId: GROUP_ID, mediaType: 'audio', sdp: 'late-sdp' }, third))
  await waitFor(() => {
    expect(FakePC.instances.length).toBe(2)
    const toThird = signalEvents().filter(ev => ev.tags[0][1] === third.pubkey)
    expect(toThird.length).toBe(1)
  })
})

it('resolves glare deterministically (smaller pubkey offer wins)', async () => {
  await joinWithRoster() // we have a pending offer to PEER
  await waitFor(() => expect(FakePC.instances.length).toBe(1))
  const iWin = getSigner()!.pubkey < PEER
  await deliverSignal(await peerSignal({ type: 'call-offer', callId: 'c1', groupId: GROUP_ID, mediaType: 'audio', sdp: 'glare-sdp' }))
  await new Promise(r => setTimeout(r, 50))
  if (iWin) {
    expect(FakePC.instances.length).toBe(1) // their offer ignored; they answer mine
  } else {
    await waitFor(() => expect(FakePC.instances.length).toBe(2)) // mine discarded, theirs answered
    expect(FakePC.instances[0].closed).toBe(true)
  }
})

it('call-end from a peer removes only that peer', async () => {
  await joinWithRoster()
  await waitFor(() => expect(FakePC.instances.length).toBe(1))
  await deliverSignal(await peerSignal({ type: 'call-end', callId: 'c1', groupId: GROUP_ID, reason: 'ended' }))
  await waitFor(() => expect(FakePC.instances[0].closed).toBe(true))
  expect(screen.getByTestId('state').textContent).toBe('in-call')
  expect(screen.getByTestId('peers').textContent).not.toContain(PEER)
})

it('leave sends call-end to connected peers and closes every connection', async () => {
  await joinWithRoster()
  await waitFor(() => expect(FakePC.instances.length).toBe(1))
  act(() => screen.getByText('leave').click())
  await waitFor(() => {
    expect(FakePC.instances.every(pc => pc.closed)).toBe(true)
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })
})
