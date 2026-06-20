import { useMemo } from 'react'
import { useNostrStore } from '../store/nostrStore'
import { filterRead, filterWrite } from '../lib/relayRouting'
import { useStableArray } from './useStableArray'

export function useReadRelays(): string[] {
  const relays = useNostrStore(s => s.relays)
  const modes = useNostrStore(s => s.relayModes)
  return useStableArray(useMemo(() => filterRead(relays, modes), [relays, modes]))
}

export function useWriteRelays(): string[] {
  const relays = useNostrStore(s => s.relays)
  const modes = useNostrStore(s => s.relayModes)
  return useStableArray(useMemo(() => filterWrite(relays, modes), [relays, modes]))
}
