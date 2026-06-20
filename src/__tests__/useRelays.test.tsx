import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useNostrStore } from '../store/nostrStore'
import { useReadRelays, useWriteRelays } from '../hooks/useRelays'

beforeEach(() => {
  useNostrStore.setState({
    relays: ['wss://a', 'wss://b'],
    relayModes: { 'wss://a': { read: true, write: false }, 'wss://b': { read: false, write: true } },
  })
})

describe('useReadRelays / useWriteRelays', () => {
  it('return the marker-filtered subsets', () => {
    expect(renderHook(() => useReadRelays()).result.current).toEqual(['wss://a'])
    expect(renderHook(() => useWriteRelays()).result.current).toEqual(['wss://b'])
  })

  it('default config returns all relays', () => {
    useNostrStore.setState({ relayModes: {} })
    expect(renderHook(() => useReadRelays()).result.current).toEqual(['wss://a', 'wss://b'])
  })
})
