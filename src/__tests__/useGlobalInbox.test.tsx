import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'

const subscribeEvents = vi.fn((..._args: unknown[]) => ({ close: vi.fn() }))
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    subscribeEvents: (...a: unknown[]) => (subscribeEvents as unknown as (...x: unknown[]) => unknown)(...a),
  }
})

import { useGlobalInbox } from '../hooks/useNostrSubscriptions'
import { useNostrStore } from '../store/nostrStore'
import { installTestSigner } from '../test/signer'
import { clearSigner } from '../lib/signer'

function Probe() {
  useGlobalInbox()
  return null
}

const PK = 'b'.repeat(64)

beforeEach(() => {
  vi.clearAllMocks()
  clearSigner()
  useNostrStore.setState({
    publicKey: PK,
    relays: ['wss://test.example'],
    relayModes: {},
    joinedChannelIds: [],
    groups: [],
    signerCaps: { nip04: true, nip44: false },
  })
})
afterEach(() => clearSigner())

// Restored-session ordering: the store rehydrates (publicKey set) BEFORE the
// async key unlock installs the signer. The inbox subscription must start
// once the signer arrives, not stay dead for the whole session.
it('subscribes to the DM inbox when the signer is installed after mount', async () => {
  render(<Probe />)
  expect(subscribeEvents).not.toHaveBeenCalled() // no signer yet — guard holds

  act(() => {
    installTestSigner()
    useNostrStore.getState().setSignerCaps({ nip04: true, nip44: true })
  })

  await waitFor(() => {
    const filters = subscribeEvents.mock.calls.map(c => JSON.stringify(c[1]))
    expect(filters.some(f => f.includes('"kinds":[4]') && f.includes(PK))).toBe(true)
  })
})

it('subscribes immediately when the signer is already present at mount', () => {
  installTestSigner()
  useNostrStore.setState({ publicKey: PK })
  render(<Probe />)
  const filters = subscribeEvents.mock.calls.map(c => JSON.stringify(c[1]))
  expect(filters.some(f => f.includes('"kinds":[4]') && f.includes(PK))).toBe(true)
})

it('subscribes to groups with an #h filter and routes by the h tag', () => {
  installTestSigner()
  useNostrStore.setState({
    publicKey: PK,
    groups: [{ id: 'uuid-1', name: 'g', creatorPubkey: 'x', memberPubkeys: [], relayUrl: 'wss://test.example', unread: 0 }],
  })
  render(<Probe />)
  const filters = subscribeEvents.mock.calls.map(c => JSON.stringify(c[1]))
  expect(filters.some(f => f.includes('"#h":["uuid-1"]'))).toBe(true)
  expect(filters.some(f => f.includes('"#e":["uuid-1"]'))).toBe(false)
})

it('subscribes to kind-1059 gift wraps addressed to me when the signer can nip44', () => {
  installTestSigner() // LocalSigner caps: { nip04: true, nip44: true }
  useNostrStore.setState({ publicKey: PK })
  render(<Probe />)
  const filters = subscribeEvents.mock.calls.map(c => c[1])
  expect(filters).toContainEqual(expect.objectContaining({ kinds: [1059], '#p': [PK] }))
})
