import { it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResyncTick, RESYNC_AFTER_HIDDEN_MS } from '../hooks/useResyncTick'

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

it('bumps when the network comes back', () => {
  const { result } = renderHook(() => useResyncTick())
  expect(result.current).toBe(0)
  act(() => { window.dispatchEvent(new Event('online')) })
  expect(result.current).toBe(1)
})

it('bumps on return after a long background, not after a short one', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useResyncTick())

  act(() => setVisibility('hidden'))
  vi.advanceTimersByTime(RESYNC_AFTER_HIDDEN_MS - 1000)
  act(() => setVisibility('visible'))
  expect(result.current).toBe(0)

  act(() => setVisibility('hidden'))
  vi.advanceTimersByTime(RESYNC_AFTER_HIDDEN_MS)
  act(() => setVisibility('visible'))
  expect(result.current).toBe(1)
})
