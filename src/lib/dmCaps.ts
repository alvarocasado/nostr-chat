// Kind 10050 (NIP-17): both the "I read gift wraps" capability signal and the
// DM-delivery relay list. A peer's 10050 exists only if their client reads
// kind 1059, so gating sends on it makes the rollout self-coordinating.
// ponytail: session memory cache only (24h TTL) — no Dexie table; a cold app
// re-fetches one small replaceable event per peer per day.
import type { Event } from 'nostr-tools'
import { fetchEvent, publishEvent } from './nostr'
import { requireSigner, getSigner } from './signer'

export const DM_RELAY_LIST_KIND = 10050
const TTL_MS = 24 * 60 * 60 * 1000
const MAX_DM_RELAYS = 4

export interface DmCaps {
  nip17: boolean
  relays: string[]
}

const cache = new Map<string, { caps: DmCaps; fetchedAt: number }>()

export function resetDmCapsCache(): void {
  cache.clear()
}

export function parseDmRelayList(event: Event): string[] {
  return event.tags
    .filter(t => t[0] === 'relay' && typeof t[1] === 'string' && /^wss?:\/\//.test(t[1]))
    .map(t => t[1])
    .slice(0, MAX_DM_RELAYS)
}

export async function buildDmRelayListEvent(relays: string[]): Promise<Event> {
  return requireSigner().signEvent({
    kind: DM_RELAY_LIST_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: relays.map(url => ['relay', url]),
    content: '',
  })
}

export async function fetchDmCaps(pubkey: string, discoveryRelays: string[]): Promise<DmCaps> {
  const hit = cache.get(pubkey)
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.caps

  let caps: DmCaps = { nip17: false, relays: [] }
  try {
    const event = await fetchEvent(discoveryRelays, { kinds: [DM_RELAY_LIST_KIND], authors: [pubkey], limit: 1 })
    if (event) caps = { nip17: true, relays: parseDmRelayList(event) }
  } catch { /* negative-cache below */ }

  cache.set(pubkey, { caps, fetchedAt: Date.now() })
  return caps
}

/** Publish our own 10050 once if none exists. Only when the signer can nip44. */
export async function ensureOwnDmRelayList(relays: string[]): Promise<void> {
  const signer = getSigner()
  if (!signer || !signer.caps.nip44) return
  try {
    const existing = await fetchEvent(relays, { kinds: [DM_RELAY_LIST_KIND], authors: [signer.pubkey], limit: 1 })
    if (existing) return
    await publishEvent(relays, await buildDmRelayListEvent(relays))
  } catch { /* best-effort; retried next login */ }
}
