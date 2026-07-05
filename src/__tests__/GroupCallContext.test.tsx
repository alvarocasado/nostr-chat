import { it, expect, vi, beforeEach, afterEach, describe } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
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
const sendGroupCallStart = vi.fn(async () => ({}))
vi.mock('../hooks/useNostrSubscriptions', () => ({
  sendGroupCallStart: (...a: unknown[]) => sendGroupCallStart(...(a as [])),
}))

import { GroupCallProvider, useGroupCallContext } from '../contexts/GroupCallContext'
import { useNostrStore } from '../store/nostrStore'
import { installTestSigner } from '../test/signer'
import { clearSigner, getSigner } from '../lib/signer'
import { generateGroupKey, encryptWithGroupKey } from '../lib/groupCrypto'
import { GROUP_CALL_PRESENCE_KIND } from '../lib/groupCall'

const GROUP_ID = 'g'.repeat(64)
const KEY = generateGroupKey()

function fakeStream() {
  return {
    getTracks: () => [],
    getAudioTracks: () => [],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

function Probe() {
  const ctx = useGroupCallContext()
  return (
    <div>
      <span data-testid="state">{ctx.groupCallState}</span>
      <span data-testid="join">{ctx.joinState}</span>
      <span data-testid="live">{ctx.liveCall ? ctx.liveCall.participants.length : 'none'}</span>
      <button onClick={() => ctx.watchGroup(GROUP_ID)}>watch</button>
      <button onClick={() => ctx.startOrJoin(GROUP_ID, 'audio')}>join</button>
      <button onClick={() => ctx.leave()}>leave</button>
    </div>
  )
}

async function presenceEvent(pubkey: string, callId: string): Promise<Event> {
  const content = await encryptWithGroupKey(JSON.stringify({ type: 'presence', callId, mediaType: 'audio' }), KEY)
  return {
    id: Math.random().toString(36).slice(2), pubkey, created_at: Math.floor(Date.now() / 1000),
    kind: GROUP_CALL_PRESENCE_KIND, tags: [['h', GROUP_ID]], content, sig: 'sig',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  subCallbacks.length = 0
  installTestSigner()
  // src/test/setup.ts already defines navigator.mediaDevices as writable
  // (but not configurable), so plain assignment replaces it per-test instead
  // of Object.defineProperty, which throws on a non-configurable property.
  ;(navigator as unknown as { mediaDevices: unknown }).mediaDevices = { getUserMedia: vi.fn(async () => fakeStream()) }
  useNostrStore.setState({
    publicKey: getSigner()!.pubkey,
    groupKeys: { [GROUP_ID]: KEY },
    relays: ['wss://test.example'],
    relayModes: {},
    activeCallType: 'none',
  })
})
afterEach(() => clearSigner())

it('watchGroup subscribes to presence for the group', async () => {
  render(<GroupCallProvider><Probe /></GroupCallProvider>)
  act(() => screen.getByText('watch').click())
  await waitFor(() => {
    expect(subscribeEvents).toHaveBeenCalledWith(
      expect.anything(),
      { kinds: [GROUP_CALL_PRESENCE_KIND], '#h': [GROUP_ID] },
      expect.any(Function),
    )
  })
})

it('derives the live call and joinState from incoming heartbeats', async () => {
  render(<GroupCallProvider><Probe /></GroupCallProvider>)
  act(() => screen.getByText('watch').click())
  await waitFor(() => expect(subCallbacks.length).toBeGreaterThan(0))
  const e = await presenceEvent('a'.repeat(64), 'c1')
  await act(async () => { subCallbacks.forEach(cb => cb(e)) })
  await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('1'))
  expect(screen.getByTestId('join').textContent).toBe('can-join')
})

it('startOrJoin publishes a presence heartbeat and the call-start announcement when starting fresh', async () => {
  render(<GroupCallProvider><Probe /></GroupCallProvider>)
  act(() => screen.getByText('join').click())
  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('in-call'))
  await waitFor(() => {
    const kinds = publishEvent.mock.calls.map(c => (c[1] as Event).kind)
    expect(kinds).toContain(GROUP_CALL_PRESENCE_KIND)
  })
  expect(sendGroupCallStart).toHaveBeenCalledTimes(1)
  expect(useNostrStore.getState().activeCallType).toBe('group')
})

it('leave stops the call and clears the busy flag', async () => {
  render(<GroupCallProvider><Probe /></GroupCallProvider>)
  act(() => screen.getByText('join').click())
  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('in-call'))
  act(() => screen.getByText('leave').click())
  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('idle'))
  expect(useNostrStore.getState().activeCallType).toBe('none')
})

describe('re-entrancy', () => {
  it('a second join click during the getUserMedia prompt does not start a duplicate call', async () => {
    let resolveMedia: (s: MediaStream) => void = () => {}
    const mediaPromise = new Promise<MediaStream>(resolve => { resolveMedia = resolve })
    const getUserMediaMock = vi.fn(() => mediaPromise)
    ;(navigator as unknown as { mediaDevices: unknown }).mediaDevices = { getUserMedia: getUserMediaMock }

    render(<GroupCallProvider><Probe /></GroupCallProvider>)

    // First click starts the getUserMedia prompt; state flips to 'joining'
    // synchronously, before the permission promise resolves.
    act(() => screen.getByText('join').click())
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('joining'))

    // Second click while the prompt is still pending must be a no-op.
    act(() => screen.getByText('join').click())
    act(() => screen.getByText('join').click())

    expect(getUserMediaMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('state').textContent).toBe('joining')

    await act(async () => { resolveMedia(fakeStream()) })
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('in-call'))

    // Still only one getUserMedia call, one call-start announcement, and one
    // heartbeat interval's worth of initial publish.
    expect(getUserMediaMock).toHaveBeenCalledTimes(1)
    expect(sendGroupCallStart).toHaveBeenCalledTimes(1)
  })
})

describe('join refusals', () => {
  it('refuses when a 1:1 call is active', async () => {
    useNostrStore.setState({ activeCallType: 'dm' })
    render(<GroupCallProvider><Probe /></GroupCallProvider>)
    act(() => screen.getByText('join').click())
    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByTestId('state').textContent).toBe('idle')
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('refuses when the roster is full', async () => {
    render(<GroupCallProvider><Probe /></GroupCallProvider>)
    act(() => screen.getByText('watch').click())
    await waitFor(() => expect(subCallbacks.length).toBeGreaterThan(0))
    for (let i = 0; i < 6; i++) {
      const e = await presenceEvent(String(i).repeat(64), 'c1')
      await act(async () => { subCallbacks.forEach(cb => cb(e)) })
    }
    await waitFor(() => expect(screen.getByTestId('join').textContent).toBe('full'))
    act(() => screen.getByText('join').click())
    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })

  it('aborts cleanly when getUserMedia fails (no heartbeat published)', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('denied'))
    render(<GroupCallProvider><Probe /></GroupCallProvider>)
    act(() => screen.getByText('join').click())
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('idle'))
    expect(publishEvent).not.toHaveBeenCalled()
    expect(useNostrStore.getState().activeCallType).toBe('none')
  })
})
