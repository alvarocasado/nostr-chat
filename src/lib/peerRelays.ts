import { getUserDb } from './userDb'
import { fetchRelayList } from './nostrSync'

export const PEER_RELAY_TTL_MS = 24 * 60 * 60 * 1000
export const MAX_PEER_RELAYS = 4

export interface PeerRelays {
  read: string[]
  write: string[]
}

interface CacheEntry {
  read: string[]
  write: string[]
  fetchedAt: number
}

const memCache = new Map<string, CacheEntry>()

export function resetPeerRelayCache(): void {
  memCache.clear()
}

/** Union `mine` with up to `cap` of the peer's relays, deduped. Empty peer -> mine. */
export function combineRelays(mine: string[], peer: string[], cap = MAX_PEER_RELAYS): string[] {
  const out = [...mine]
  for (const url of peer.slice(0, cap)) {
    if (!out.includes(url)) out.push(url)
  }
  return out
}

function isFresh(entry: { fetchedAt: number }): boolean {
  return Date.now() - entry.fetchedAt < PEER_RELAY_TTL_MS
}

/**
 * The peer's own read/write relays from their kind-10002, fetched lazily from
 * `discoveryRelays` and cached (memory + Dexie, TTL). Returns empty arrays when
 * unknown/failed (negative-cached); callers fall back via combineRelays.
 */
export async function getPeerRelays(pubkey: string, discoveryRelays: string[]): Promise<PeerRelays> {
  const mem = memCache.get(pubkey)
  if (mem && isFresh(mem)) return { read: mem.read, write: mem.write }

  const db = getUserDb()
  if (db) {
    try {
      const rec = await db.relayLists.get(pubkey)
      if (rec && isFresh(rec)) {
        memCache.set(pubkey, { read: rec.read, write: rec.write, fetchedAt: rec.fetchedAt })
        return { read: rec.read, write: rec.write }
      }
    } catch { /* fall through to fetch */ }
  }

  const read: string[] = []
  const write: string[] = []
  try {
    const list = await fetchRelayList(discoveryRelays, pubkey)
    if (list) {
      for (const url of list.urls) {
        const m = list.modes[url]
        if (!m || m.read) read.push(url)
        if (!m || m.write) write.push(url)
      }
    }
  } catch { /* negative-cache below */ }

  const fetchedAt = Date.now()
  memCache.set(pubkey, { read, write, fetchedAt })
  if (db) {
    try { await db.relayLists.put({ pubkey, read, write, fetchedAt }) } catch { /* ignore */ }
  }
  return { read, write }
}
