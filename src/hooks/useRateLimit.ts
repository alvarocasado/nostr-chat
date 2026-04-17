import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_MESSAGES = 5   // max sends allowed in the window
const WINDOW_MS    = 10_000  // 10-second sliding window

/**
 * Sliding-window rate limiter scoped to the component instance.
 *
 * tryRecord() → true  : message allowed, timestamp recorded
 *             → false : rate limit exceeded, cooldown started
 *
 * isLimited   : true while the user must wait
 * cooldownSec : whole seconds remaining (for display), 0 when clear
 */
export function useRateLimit() {
  const timestamps  = useRef<number[]>([])
  const [blockedUntil, setBlockedUntil] = useState(0)
  const [cooldownSec, setCooldownSec]   = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (blockedUntil <= 0) return

    const tick = () => {
      const rem = Math.ceil((blockedUntil - Date.now()) / 1000)
      if (rem <= 0) {
        setCooldownSec(0)
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      } else {
        setCooldownSec(rem)
      }
    }
    tick()
    intervalRef.current = setInterval(tick, 250)
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null } }
  }, [blockedUntil])

  const tryRecord = useCallback((): boolean => {
    const now = Date.now()
    timestamps.current = timestamps.current.filter(t => now - t < WINDOW_MS)

    if (timestamps.current.length >= MAX_MESSAGES) {
      // Still in window — refresh the block end time
      setBlockedUntil(timestamps.current[0] + WINDOW_MS)
      return false
    }

    timestamps.current.push(now)

    // If this send filled the bucket, pre-arm the cooldown for the next attempt
    if (timestamps.current.length >= MAX_MESSAGES) {
      setBlockedUntil(timestamps.current[0] + WINDOW_MS)
    }

    return true
  }, [])

  return { isLimited: cooldownSec > 0, cooldownSec, tryRecord }
}
