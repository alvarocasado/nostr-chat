import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const subscribeEvents = vi.fn((..._a: unknown[]) => ({ close: vi.fn() }))
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, subscribeEvents: (...a: unknown[]) => subscribeEvents(...a), publishEvent: vi.fn() }
})
vi.mock('../hooks/useRelays', () => ({ useReadRelays: () => ['wss://myread'], useWriteRelays: () => ['wss://mywrite'] }))
vi.mock('../hooks/usePeerRelays', () => ({ usePeerRelays: () => ({ read: ['wss://peerread'], write: ['wss://peerwrite'] }) }))
// keep a signer present so the effect runs
vi.mock('../lib/signer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/signer')>()
  return { ...actual, getSigner: () => ({ pubkey: 'me', type: 'local', caps: { nip04: true, nip44: true } }) }
})

import { useDMMessages } from '../hooks/useNostrSubscriptions'

beforeEach(() => { subscribeEvents.mockClear() })

describe('useDMMessages routing', () => {
  it('reads the received direction from my read + peer write relays', () => {
    renderHook(() => useDMMessages('me', 'them'))
    // two subscriptions: [sent, received]
    const calls = subscribeEvents.mock.calls
    const received = calls.find(c => (c[1] as { authors: string[] }).authors?.[0] === 'them')!
    const relaysArg = received[0] as string[]
    expect(relaysArg).toContain('wss://myread')
    expect(relaysArg).toContain('wss://peerwrite')
  })
})
