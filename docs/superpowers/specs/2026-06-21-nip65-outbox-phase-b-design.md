# NIP-65 Outbox Routing (Phase B) — Design

Date: 2026-06-21
Status: Approved (design); pending implementation plan

## Goal

Complete the NIP-65 "outbox model" begun in Phase A. Phase A added per-relay
read/write markers, published the user's own kind-10002 relay list, and routed
the user's *own* reads/writes by marker. Phase B adds the **peer** half of the
model: discover other users' relay lists (kind 10002) and route per-author I/O to
where each peer actually reads and writes.

Scope (from brainstorming): **DMs and profiles only**, fetched **lazily and
cached**. Channels, groups, group-member profiles, eager prefetch, and relay
scoring are out of scope.

## Decisions (from brainstorming)

- **Fetch strategy:** lazy — fetch a peer's kind-10002 the first time it is needed
  (opening/sending a DM, loading a profile), cache it (memory + Dexie) with a 24h
  TTL, refetch when stale.
- **Routing scope:** DM send, DM read (received direction), and the per-author
  profile fetch (`ensureProfile`). Channels, groups, the bulk profile loader, the
  global inbox subscription, and the user's own sent-DM subscription stay on
  Phase-A routing.
- **Fallback is always safe:** an unknown / unfetched / failed / empty peer list
  falls back to the user's own relays — exactly Phase-A behavior. Phase B only
  ever *adds* reach.

## Background (current code, post Phase A)

- `src/lib/relayRouting.ts` — `filterRead`/`filterWrite`.
- `src/store/nostrStore.ts` — `relays`, `relayModes`, `readRelays()`/
  `writeRelays()`.
- `src/hooks/useRelays.ts` — `useReadRelays()`/`useWriteRelays()`.
- `src/lib/nostrSync.ts` — `buildRelayListEvent`, `fetchRelayList(relays, pubkey):
  { urls, modes, createdAt } | null` (already used for the user's own list).
- `src/hooks/useNostrSubscriptions.ts` — `useDMMessages(my, their)` opens two subs
  (sent: `authors:[my] '#p':[their]`; received: `authors:[their] '#p':[my]`),
  both on `useReadRelays()`. `useProfileLoader` bulk-fetches kind-0 on
  `useReadRelays()`. The global inbox DM sub (`'#p':[me]`) is on read relays.
- `src/hooks/useChatHistory.ts` — DM backfill builds two directional filters
  (`olderFilterFor`) and fetches from `readRelays()`.
- `src/components/Chat/MessageThread.tsx` — `DMThread` send publishes to
  `useWriteRelays()`.
- `src/lib/inbox.ts` — `ensureProfile(pubkey, relays)` fetches kind-0 from the
  passed relays (read relays).
- `src/lib/db.ts` — `UserDatabase` (Dexie) with `settings`, `messages`, `crypto`
  tables (current schema version 3).

## Peer relay-list cache & access

### Storage

- New Dexie table `relayLists`, keyed by `pubkey`, record shape
  `{ pubkey: string; read: string[]; write: string[]; fetchedAt: number }`,
  added via a new schema **version 4** (additive; existing tables unchanged).
- An in-memory `Map<pubkey, { read, write, fetchedAt }>` fronts Dexie to avoid
  repeated reads within a session.

### `src/lib/peerRelays.ts`

- `getPeerRelays(pubkey: string, discoveryRelays: string[]): Promise<{ read: string[]; write: string[] }>`
  - Memory cache hit and fresh (`now - fetchedAt < PEER_RELAY_TTL_MS`) → return it.
  - Else read Dexie; if present and fresh → populate memory and return.
  - Else fetch the peer's kind-10002 via `fetchRelayList(discoveryRelays, pubkey)`.
    Map the result to `{ read, write }` (read = urls with read marker; write =
    urls with write marker; a bare `r` tag counts as both). Cache in memory +
    persist to Dexie with `fetchedAt = now`.
  - On no event / fetch error → cache an **empty** result `{ read: [], write: [] }`
    with `fetchedAt = now` (negative caching, same TTL) so we do not refetch on
    every interaction; return the empty result.
  - The peer's *own* lists are returned (empty when unknown). Combining with the
    user's relays and the fallback happens in `combineRelays`.
- `combineRelays(mine: string[], peer: string[], cap = MAX_PEER_RELAYS): string[]`
  — pure: `unique([...mine, ...peer.slice(0, cap)])`. An empty `peer` yields
  exactly `mine` (the Phase-A fallback). `cap` bounds per-peer fan-out.
- Constants: `PEER_RELAY_TTL_MS = 24 * 60 * 60 * 1000`, `MAX_PEER_RELAYS = 4`.
- `resetPeerRelayCache()` for test isolation / logout.

### `src/hooks/usePeerRelays.ts`

- `usePeerRelays(pubkey: string): { read: string[]; write: string[] }`
  - Holds `{ read, write }` state, initialised empty.
  - On `pubkey` change, calls `getPeerRelays(pubkey, useNostrStore.getState().readRelays())`
    and sets state when it resolves (guarded against unmount / pubkey change).
  - Returns empty arrays until resolved (callers combine with my relays, so empty
    = Phase-A fallback during the brief fetch window), then the peer's lists.

`discoveryRelays` (where to query a peer's kind-10002) is always the user's own
read relays — the bootstrap set.

## Routing rules

Let `myRead = readRelays()`, `myWrite = writeRelays()`, and for a peer `P`,
`P.read` / `P.write` from the cache.

- **DM send to P** → `combineRelays(myWrite, P.read)`. Publishes to the recipient's
  read relays (where they receive) plus the user's own write relays.
- **DM read, received direction (`authors:[P]`)** → `combineRelays(myRead, P.write)`.
  Reads P's messages where P publishes. Applies to the per-chat `useDMMessages`
  received subscription and the history-backfill received-direction filter.
- **Profile fetch (`ensureProfile(P)`)** → `combineRelays(relays, P.write)` where
  `relays` is the existing passed-in read-relay set. Fetches the author's kind-0
  from the author's write relays. Fire-and-forget (non-blocking).

**Caps & fallback:** each combine adds at most `MAX_PEER_RELAYS` of the peer's
relays; an unknown peer (empty lists) reduces every rule to its Phase-A form.

### Unchanged (intentional)

- **Global inbox DM subscription** (`'#p':[me]`) — by NIP-65, senders deliver to
  the recipient's read relays, so reading my inbox from my read relays is already
  correct.
- **The user's own sent-DM subscription** (`authors:[me]`) — my own events are on
  my relays.
- **Channels and groups** — keep Phase-A routing.
- **Bulk `useProfileLoader`** — its single multi-author subscription cannot do
  per-author routing; the per-author `ensureProfile` path covers the outbox case.
  Bulk loading stays on my read relays.

## Data flow

```
open DM with P
  usePeerRelays(P): empty -> getPeerRelays(P, myRead)
    cache fresh? use it
    else fetch kind 10002 (from myRead) -> cache (memory + Dexie, TTL 24h)
  received sub relays = combineRelays(myRead, P.write)
  (until resolved: empty P.write -> myRead only = Phase A)

send DM to P
  target = combineRelays(myWrite, (await getPeerRelays(P, myRead)).read)
  publishEvent(target, event)

incoming message from author A
  ensureProfile(A): fetch kind 0 from combineRelays(readRelays, (await getPeerRelays(A, myRead)).write)
```

## Error handling

- Fetch failure / no kind-10002 → empty result, negative-cached for the TTL;
  routing falls back to my relays. No user-visible error (peers without a relay
  list simply use the default path).
- Dexie unavailable → memory-only cache; still functional for the session.
- A malformed kind-10002 (no valid `r` tags) → treated as empty (same as Phase A's
  `fetchRelayList` returning null / empty).

## Testing

- **`combineRelays` (pure):** unique, peer capped at `MAX_PEER_RELAYS`, empty peer
  → exactly `mine`, dedup across mine/peer overlap.
- **`getPeerRelays`:** cache hit returns without fetching; miss fetches (mock
  `fetchRelayList`) and persists to Dexie (fake-indexeddb); a fresh Dexie entry is
  used without fetching; stale (`fetchedAt` older than TTL) refetches; fetch
  failure / null → empty result, negative-cached (second call within TTL does not
  refetch).
- **`usePeerRelays`:** returns empty initially, then the peer's lists after the
  fetch resolves (mock `getPeerRelays`); resets on `pubkey` change.
- **Routing:** with a known peer (mock `getPeerRelays`), DM send targets
  `unique(myWrite ∪ P.read)`, the received DM read targets `unique(myRead ∪
  P.write)`, and `ensureProfile` targets `unique(myRead ∪ P.write)`; with an
  unknown peer each falls back to the Phase-A set. Existing DM, inbox, and history
  tests stay green (unknown-peer default).
- **Dexie v4 migration:** opening an existing v3 DB upgrades cleanly; existing
  `settings`/`messages`/`crypto` data is intact.

## Mobile / PWA

No UI changes — pure routing and a background cache. Behaves identically on mobile
browsers and the installed PWA.

## Out of scope

- Channel and group message routing; group-member profile outbox.
- Eager prefetch of all contacts' relay lists on login.
- Relay scoring, relay hints in event tags, periodic background refresh beyond the
  TTL-on-demand model.
- Migrating the message envelope from NIP-04 to NIP-44/NIP-17.
