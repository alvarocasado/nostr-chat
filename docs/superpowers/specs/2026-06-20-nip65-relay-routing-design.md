# NIP-65 Relay List + Read/Write Routing (Phase A) — Design

Date: 2026-06-20
Status: Approved (design); pending implementation plan

## Goal

Adopt NIP-65 (the "outbox model") starting with the foundational, self-contained
slice (Priority 2, item #6 of the functional analysis). Today the app holds a
single flat `relays: string[]` and fans out **every** read and write to **all**
relays. NIP-65 introduces a per-user relay list (kind 10002) with per-relay
read/write markers and routes I/O accordingly: publish where you write, read
where the data is.

This spec covers **Phase A only**:
- Model relays with read/write markers.
- Publish your kind-10002 relay list (making you discoverable the NIP-65 way).
- Route **your own** writes to your **write** relays and **your own** inbox/data
  reads from your **read** relays.

Peer/outbox routing (reading others from their write relays, sending DMs to
recipients' read relays) is explicitly deferred to a later Phase B spec.

## Decisions (from brainstorming)

- **Scope:** Phase A only (own routing). Phase B (peer/outbox routing) is a
  separate later spec.
- **Model:** keep `relays: string[]` unchanged (all existing consumers keep
  working) and add a parallel `relayModes: Record<url, { read, write }>`. A relay
  absent from the map defaults to read+write.
- **Source of truth:** kind-10002 is the canonical, public relay list. Stop
  writing `relays` into the encrypted settings blob; keep reading it only as the
  fallback when no kind-10002 exists yet.
- **Safety:** with the migration default (every relay read+write),
  `readRelays()` === `writeRelays()` === `relays`, so behavior is identical to
  today; routing only diverges for users who deliberately split read/write.

## Background (current code)

- `src/store/nostrStore.ts` — `relays: string[]`, `addRelay`/`removeRelay`,
  persisted via `partialize`. Relays are also synced inside the encrypted kind
  30078 settings blob (`SyncedSettings.relays`).
- `src/lib/nostr.ts` — `subscribeEvents(relays, ...)`, `publishEvent(relays, ...)`,
  `fetchEvent(s)(relays, ...)`; `DEFAULT_RELAYS`.
- `src/lib/nostrSync.ts` — publishes/fetches list events (kind 3 contacts, 30001
  channel bookmarks, 30078 settings, 30041 group-key backups) against a passed
  relay array; `syncFromRelays(relays)` runs the on-login fetch; `debounce(...)`
  backs the debounced settings sync.
- Relay I/O call sites that pass `get().relays`: `useNostrSubscriptions.ts`,
  `MessageThread.tsx`, `useChatHistory.ts`, `inbox.ts` (`ensureProfile`),
  `useTypingIndicator.ts`, `contexts/CallContext.tsx`, the Add*Modal components,
  and `nostrSync.ts`.
- Relay settings UI: inline in `SettingsScreen.tsx` under
  `activeSettingsTab === 'relays'` (and a parallel list in `SettingsPanel.tsx`).

## Relay model & source of truth

### Store shape

- Keep `relays: string[]` — the full set the app connects to. Type unchanged.
- Add `relayModes: Record<string, { read: boolean; write: boolean }>`, persisted
  via `partialize`. Any relay **absent** from the map is treated as
  `{ read: true, write: true }`.
- Actions:
  - `setRelayMode(url: string, read: boolean, write: boolean)` — updates the map;
    must keep at least one of read/write true (the UI enforces this).
  - `addRelay(url)` — appends to `relays` and seeds `relayModes[url] =
    { read: true, write: true }`.
  - `removeRelay(url)` — removes from `relays` and deletes its `relayModes` entry.
- Helpers (store selectors or a small `lib/relayRouting.ts`):
  - `writeRelays(): string[]` = `relays.filter(r => (relayModes[r]?.write ?? true))`;
    if the result is empty, return `relays` (never strand the app).
  - `readRelays(): string[]` = `relays.filter(r => (relayModes[r]?.read ?? true))`;
    same empty→all fallback.

### kind-10002 as canonical list

- Build from `relays` + `relayModes`: for each relay,
  - read && write → `['r', url]`
  - read only → `['r', url, 'read']`
  - write only → `['r', url, 'write']`
  - neither → omit (cannot occur; UI forces at least one).
- Publish kind-10002 (to write relays) whenever the relay set or markers change,
  via the existing debounced sync path that already republishes kind-3/30001/30078.
- kind-10002 is a NIP-01 replaceable event (10000-19999); relays keep the latest
  per author.

### Migration / login

- On login, `syncFromRelays` additionally fetches the user's kind-10002.
  - If present → adopt it as the source of truth for `relays` + `relayModes`.
  - If absent → fall back to the relays in the encrypted settings blob (current
    behavior) with default both-markers, then publish a fresh kind-10002.
- Going forward, **stop writing** `relays` into the settings blob; kind-10002
  owns the relay list. Keep `relays` in `SyncedSettings` as a read-only fallback
  field for the no-10002 case (do not populate it on publish).
- `relayModes` is also persisted locally so reloads do not depend on a fetch.

## Routing rule & safety

One consistent rule, applied at the relay-I/O call sites:

- **Publishes of your own events → `writeRelays()`.** DMs, channel messages,
  group messages, profile (kind 0), contacts (kind 3), channel bookmarks
  (30001), settings (30078), group-key backups (30041), typing indicators, call
  signaling, and kind-10002 itself.
- **Reads of your own inbox/data → `readRelays()`.** Global-inbox subscriptions
  (DMs to me, my channels, my groups), on-login sync fetches, channel discovery,
  and message history backfill (`useChatHistory`), plus `ensureProfile`.

The relay **pool still connects to the full `relays` set**; routing is purely the
relay array passed to each `publishEvent`/`subscribeEvents`/`fetchEvent(s)` call.

**Default-safety:** with all relays defaulting to read+write, both helpers return
the full list, so every routed call is identical to today. Behavior only changes
for a user who deliberately marks some relays read-only or write-only.

**Known Phase-A limitation (resolved by Phase B):** peers' relay lists are not
consulted, so a DM you send is published only to your write relays. NIP-65-aware
clients still find it there, and default configs are unaffected; but two app
users with deliberately **disjoint** custom relays could miss each other's DMs
until Phase B routes sends to the recipient's read relays. This is a documented,
accepted limitation of Phase A — not a silent regression.

## Components & files

- **`src/store/nostrStore.ts`** — add `relayModes` (+ persist in `partialize`);
  add `setRelayMode`; update `addRelay`/`removeRelay`; add `readRelays`/
  `writeRelays` helpers (or import from `lib/relayRouting.ts`); hook a kind-10002
  publish into the debounced sync on relay/marker change; drop `relays` from the
  written settings blob; adopt fetched kind-10002 in the login apply path.
- **`src/lib/nostrSync.ts`** — `buildRelayListEvent(relays, modes)`,
  `fetchRelayList(relays, pubkey): { urls, modes } | null`,
  `publishRelayList(relays, modes, writeRelays)`; extend `SyncResult` and
  `syncFromRelays` with the relay list.
- **(optional) `src/lib/relayRouting.ts`** — pure `filterRead(relays, modes)` /
  `filterWrite(relays, modes)` with empty→all fallback, so the routing logic is
  unit-testable independent of the store.
- **Routing call sites** — swap the relay argument for `writeRelays()` (publishes)
  or `readRelays()` (reads) in: `useNostrSubscriptions.ts`, `MessageThread.tsx`,
  `useChatHistory.ts`, `inbox.ts` (`ensureProfile`), `useTypingIndicator.ts`,
  `contexts/CallContext.tsx`, the Add*Modal components, and `nostrSync.ts`.
- **`src/components/Settings/SettingsScreen.tsx`** and
  **`src/components/Settings/SettingsPanel.tsx`** — each relay row gains Read and
  Write toggles bound to `relayModes` via `setRelayMode`; adding a relay defaults
  to both; the UI prevents a relay from having neither marker.

## Testing

- **kind-10002 build/parse (pure):** `buildRelayListEvent` emits `['r',url]` for
  both, `['r',url,'read']` / `['r',url,'write']` for one-sided, omits neither;
  `fetchRelayList` parses all three forms back into `{ urls, modes }` (mocked
  fetch). A bare `['r',url]` parses to read+write.
- **Routing helpers:** `filterRead`/`filterWrite` (or `readRelays`/`writeRelays`)
  return the marked subset; an empty side falls back to the full list; no modes
  (all default) returns all.
- **Store:** `setRelayMode` updates markers; `addRelay` seeds both; `removeRelay`
  drops the mode; a relay/marker change publishes a kind-10002 (spy on publish).
- **Migration/login:** adopt fetched kind-10002 when present; fall back to
  settings-blob relays and publish a kind-10002 when absent.
- **Routing applied:** with a split config, a representative publish targets the
  write subset and a representative read targets the read subset (mocked
  `publishEvent`/`subscribeEvents`); the default config targets the full list.
- **Regression:** existing store, sync, subscription, and Sidebar tests stay
  green under the default (both-markers) configuration.

## Mobile / PWA

No performance or layout implications — this is relay routing. The only UI change
is the per-relay read/write toggles in Settings, which behave identically on
mobile browsers and the installed PWA.

## Out of scope

- **Phase B (peer/outbox routing):** fetching/caching contacts' kind-10002 and
  routing DM sends to recipients' read relays / reads to authors' write relays —
  a separate later spec.
- Relay hints in event tags, automatic relay discovery/scoring, and periodic
  relay-list refresh.
- Changing the relay **connection** strategy (the pool still connects to the full
  set).
- Migrating the message envelope crypto (NIP-04 → NIP-44/17).
