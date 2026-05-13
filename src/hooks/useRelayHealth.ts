import { useEffect, useState } from 'react'
import { getPool } from '../lib/nostr'

export type RelayStatus = 'connected' | 'disconnected' | 'pending'

const POLL_MS = 5_000

export function useRelayHealth(relays: string[]): Record<string, RelayStatus> {
  const [status, setStatus] = useState<Record<string, RelayStatus>>({})

  useEffect(() => {
    if (relays.length === 0) return

    const pool = getPool()

    // Try to connect each relay; record the outcome.
    for (const url of relays) {
      pool.ensureRelay(url)
        .then(() => setStatus(prev => ({ ...prev, [url]: 'connected' })))
        .catch(() => setStatus(prev => ({ ...prev, [url]: 'disconnected' })))
    }

    function refresh() {
      const map = pool.listConnectionStatus()
      setStatus(prev => {
        const next = { ...prev }
        for (const url of relays) {
          if (map.has(url)) {
            // Relay is actively tracked by the pool — use its live state.
            next[url] = map.get(url) ? 'connected' : 'disconnected'
          }
          // Not in pool (idle/pruned): keep the last known state so a
          // temporarily idle relay doesn't flip back to 'pending'.
        }
        return next
      })
    }

    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [relays.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  return status
}

export function aggregateRelayHealth(status: Record<string, RelayStatus>): {
  connected: number
  total: number
  resolved: number
} {
  const values = Object.values(status)
  return {
    connected: values.filter(s => s === 'connected').length,
    total: values.length,
    resolved: values.filter(s => s !== 'pending').length,
  }
}
