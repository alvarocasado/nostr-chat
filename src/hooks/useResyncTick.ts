import { useEffect, useState } from 'react'

// How long the app must have been in the background before coming back
// triggers a resync. Short tab switches don't need one.
export const RESYNC_AFTER_HIDDEN_MS = 30_000

/**
 * A counter that bumps when the network comes back or the app returns to the
 * foreground after a while. Subscriptions that list it as an effect dependency
 * reopen, which reconnects relays that failed (or never connected) and
 * backfills events missed meanwhile. That covers gift wraps the pool's own
 * reconnect can skip: their created_at is randomized up to two days into the
 * past, so a `since` resume filter can exclude them.
 */
export function useResyncTick(): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0
    const bump = () => setTick(t => t + 1)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
      } else if (hiddenAt && Date.now() - hiddenAt >= RESYNC_AFTER_HIDDEN_MS) {
        hiddenAt = 0
        bump()
      } else {
        hiddenAt = 0
      }
    }
    window.addEventListener('online', bump)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', bump)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return tick
}
