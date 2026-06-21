import { useEffect, useState } from 'react'
import { useNostrStore } from '../store/nostrStore'
import { getPeerRelays, type PeerRelays } from '../lib/peerRelays'

const EMPTY: PeerRelays = { read: [], write: [] }

export function usePeerRelays(pubkey: string | null): PeerRelays {
  const [relays, setRelays] = useState<PeerRelays>(EMPTY)

  useEffect(() => {
    if (!pubkey) { setRelays(EMPTY); return }
    let cancelled = false
    setRelays(EMPTY)
    getPeerRelays(pubkey, useNostrStore.getState().readRelays())
      .then(r => { if (!cancelled) setRelays(r) })
      .catch(() => { if (!cancelled) setRelays(EMPTY) })
    return () => { cancelled = true }
  }, [pubkey])

  return relays
}
