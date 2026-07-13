import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Event } from 'nostr-tools'

const publishEvent = vi.fn(async (..._args: unknown[]) => {})
const subscribeEvents = vi.fn(() => ({ close: vi.fn() }))
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    publishEvent: (...a: unknown[]) => publishEvent(...(a as [])),
    subscribeEvents: (...a: unknown[]) => subscribeEvents(...(a as [])),
  }
})

import { useReadReceipts } from '../hooks/useReadReceipts'
import { useNostrStore } from '../store/nostrStore'
import { installTestSigner } from '../test/signer'
import { clearSigner, getSigner } from '../lib/signer'
import { READ_RECEIPT_KIND } from '../lib/readReceipts'
import { generateKeys } from '../lib/nostr'

const PEER = generateKeys().pk

beforeEach(() => {
  vi.clearAllMocks()
  installTestSigner()
  const me = getSigner()!.pubkey
  useNostrStore.setState({
    publicKey: me,
    readReceiptsEnabled: true,
    readUntilByPeer: {},
    relays: ['wss://test.example'],
    relayModes: {},
    messages: {
      [PEER]: [
        { id: 'a', pubkey: PEER, content: 'hi', createdAt: 100, tags: [], kind: 4 },
        { id: 'b', pubkey: me, content: 'yo', createdAt: 150, tags: [], kind: 4 },
      ],
    },
  })
})
afterEach(() => clearSigner())

it('publishes an encrypted 24102 watermark for the newest received message', async () => {
  renderHook(() => useReadReceipts(PEER))
  await waitFor(() => expect(publishEvent).toHaveBeenCalledTimes(1))
  const event = publishEvent.mock.calls[0][1] as Event
  expect(event.kind).toBe(READ_RECEIPT_KIND)
  expect(event.tags).toEqual([['p', PEER]])
  expect(event.content).not.toContain('read_until')
})

it('subscribes to the peer receipt filter when enabled', () => {
  renderHook(() => useReadReceipts(PEER))
  const me = getSigner()!.pubkey
  expect(subscribeEvents).toHaveBeenCalledWith(
    expect.anything(),
    { kinds: [READ_RECEIPT_KIND], authors: [PEER], '#p': [me] },
    expect.any(Function),
  )
})

it('does nothing when the setting is off', async () => {
  useNostrStore.setState({ readReceiptsEnabled: false })
  renderHook(() => useReadReceipts(PEER))
  await new Promise(r => setTimeout(r, 50))
  expect(publishEvent).not.toHaveBeenCalled()
  expect(subscribeEvents).not.toHaveBeenCalled()
})

it('does not send when inactive (pending message request)', async () => {
  renderHook(() => useReadReceipts(PEER, false))
  await new Promise(r => setTimeout(r, 50))
  expect(publishEvent).not.toHaveBeenCalled()
})

it('ignores a receipt event whose pubkey does not match the subscribed peer', async () => {
  renderHook(() => useReadReceipts(PEER))
  await waitFor(() => expect(subscribeEvents).toHaveBeenCalled())
  const onEvent = (subscribeEvents.mock.calls[0] as unknown[])[2] as (event: Event) => void

  const forged: Event = {
    id: 'forged',
    pubkey: 'not-the-peer'.padEnd(64, '0'),
    kind: READ_RECEIPT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', getSigner()!.pubkey]],
    content: 'irrelevant',
    sig: 'sig',
  }
  onEvent(forged)
  await new Promise(r => setTimeout(r, 50))

  expect(useNostrStore.getState().readUntilByPeer).toEqual({})
})
