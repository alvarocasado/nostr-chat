import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const getPeerRelays = vi.fn()
vi.mock('../lib/peerRelays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/peerRelays')>()
  return { ...actual, getPeerRelays: (...a: unknown[]) => getPeerRelays(...a) }
})
vi.mock('../store/nostrStore', () => {
  const hook = () => ({})
  hook.getState = () => ({ readRelays: () => ['wss://mine'] })
  return { useNostrStore: hook }
})

import { usePeerRelays } from '../hooks/usePeerRelays'

beforeEach(() => { getPeerRelays.mockReset() })

describe('usePeerRelays', () => {
  it('returns empty then the peer relays after the fetch resolves', async () => {
    getPeerRelays.mockResolvedValue({ read: ['wss://pr'], write: ['wss://pw'] })
    const { result } = renderHook(() => usePeerRelays('peerX'))
    expect(result.current).toEqual({ read: [], write: [] })
    await waitFor(() => expect(result.current.write).toEqual(['wss://pw']))
  })

  it('stays empty for a null pubkey and does not fetch', () => {
    const { result } = renderHook(() => usePeerRelays(null))
    expect(result.current).toEqual({ read: [], write: [] })
    expect(getPeerRelays).not.toHaveBeenCalled()
  })
})
