import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Pure logic extracted from useRateLimit for unit testing without React hooks
const MAX_MESSAGES = 5
const WINDOW_MS = 10_000

function makeRateLimiter() {
  const timestamps: number[] = []

  const tryRecord = (): boolean => {
    const now = Date.now()
    const pruned = timestamps.filter(t => now - t < WINDOW_MS)
    timestamps.length = 0
    timestamps.push(...pruned)

    if (timestamps.length >= MAX_MESSAGES) return false
    timestamps.push(now)
    return true
  }

  const isBlocked = (): boolean => {
    const now = Date.now()
    const recent = timestamps.filter(t => now - t < WINDOW_MS)
    return recent.length >= MAX_MESSAGES
  }

  return { tryRecord, isBlocked }
}

describe('rate limiter logic', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows up to MAX_MESSAGES sends within the window', () => {
    const { tryRecord } = makeRateLimiter()
    for (let i = 0; i < MAX_MESSAGES; i++) {
      expect(tryRecord()).toBe(true)
    }
  })

  it('blocks the (MAX_MESSAGES + 1)th send within the window', () => {
    const { tryRecord } = makeRateLimiter()
    for (let i = 0; i < MAX_MESSAGES; i++) tryRecord()
    expect(tryRecord()).toBe(false)
  })

  it('unblocks after the window elapses', () => {
    const { tryRecord, isBlocked } = makeRateLimiter()
    for (let i = 0; i < MAX_MESSAGES; i++) tryRecord()

    expect(isBlocked()).toBe(true)

    vi.advanceTimersByTime(WINDOW_MS + 1)
    expect(isBlocked()).toBe(false)
    expect(tryRecord()).toBe(true)
  })

  it('sliding window: allows sends after oldest timestamp expires', () => {
    const { tryRecord } = makeRateLimiter()
    // Send MAX_MESSAGES - 1 messages, then wait half the window
    for (let i = 0; i < MAX_MESSAGES - 1; i++) tryRecord()
    vi.advanceTimersByTime(WINDOW_MS / 2)

    // Send the last one within the window — still fine
    expect(tryRecord()).toBe(true)

    // Now 5 messages in window — should be blocked
    expect(tryRecord()).toBe(false)

    // Advance past the first batch
    vi.advanceTimersByTime(WINDOW_MS / 2 + 1)

    // Only the last message is still in window → allowed again
    expect(tryRecord()).toBe(true)
  })

  it('independent limiters do not share state', () => {
    const a = makeRateLimiter()
    const b = makeRateLimiter()
    for (let i = 0; i < MAX_MESSAGES; i++) a.tryRecord()
    expect(a.tryRecord()).toBe(false)
    expect(b.tryRecord()).toBe(true)
  })
})
