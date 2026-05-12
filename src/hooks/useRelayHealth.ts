import { useEffect, useState } from 'react'
import { getPool } from '../lib/nostr'

export type RelayStatus = 'connected' | 'disconnected' | 'pending'

const POLL_MS = 5_000

export function useRelayHealth(relays: string[]): Record<string, RelayStatus> {
  const [status, setStatus] = useState<Record<string, RelayStatus>>({})

  useEffect(() => {
    if (relays.length === 0) return

    const pool = getPool()

    // Proactively open connections so the pool knows about each relay.
    // Safe to call multiple times — the pool deduplicates by URL.
    for (const url of relays) {
      pool.ensureRelay(url).catch(() => {})
    }

    function refresh() {
      const map = pool.listConnectionStatus()
      const next: Record<string, RelayStatus> = {}
      for (const url of relays) {
        if (!map.has(url)) next[url] = 'pending'
        else next[url] = map.get(url) ? 'connected' : 'disconnected'
      }
      setStatus(next)
    }

    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [relays.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  return status
}

export function aggregateRelayHealth(status: Record<string, RelayStatus>): {
  connected: number
  total: number
} {
  const values = Object.values(status)
  return {
    connected: values.filter(s => s === 'connected').length,
    total: values.length,
  }
}
