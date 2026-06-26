# NIP-65 Outbox Routing (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lazily fetch and cache other users' kind-10002 relay lists, and route DM sends to the recipient's read relays, DM reads from the peer's write relays, and per-author profile fetches from the author's write relays — falling back to the user's own relays when a peer is unknown.

**Architecture:** A per-peer relay-list cache (memory + a new Dexie `relayLists` table, 24h TTL, negative-cached) exposed as `getPeerRelays(pubkey, discoveryRelays)` (imperative) and `usePeerRelays(pubkey)` (reactive). A pure `combineRelays(mine, peer, cap)` unions the user's relays with up to `MAX_PEER_RELAYS` of the peer's, so an unknown peer reduces every rule to its Phase-A form.

**Tech Stack:** TypeScript, React 19, Zustand, Dexie, nostr-tools, Vitest, fake-indexeddb.

## Global Constraints

- No emojis in code, comments, or documentation.
- Lazy fetch: a peer's kind-10002 is fetched on first need from the user's own read relays (the discovery set), cached in memory + Dexie with `PEER_RELAY_TTL_MS = 24h`; a missing/failed/empty result is negative-cached (empty arrays) for the same TTL.
- `combineRelays(mine, peer, cap = MAX_PEER_RELAYS=4)` = `unique([...mine, ...peer.slice(0, cap)])`; empty `peer` yields exactly `mine` (Phase-A fallback).
- Routing: DM send → `combineRelays(myWrite, peerRead)`; DM read received-direction → `combineRelays(myRead, peerWrite)`; `ensureProfile` → `combineRelays(relays, peerWrite)`.
- Unchanged (stay Phase A): the global inbox DM subscription (`#p:[me]`), the user's own sent-DM subscription (`authors:[me]`), channels, groups, and the bulk `useProfileLoader`.
- Fallback must never strand a chat: unknown peer ⇒ my relays only.
- Mutate store state only through store actions.

---

## Task 1: Dexie `relayLists` table

**Files:**
- Modify: `src/lib/db.ts`
- Test: `src/__tests__/db.test.ts` (add a `describe` block)

**Interfaces:**
- Produces: `RelayListRecord = { pubkey: string; read: string[]; write: string[]; fetchedAt: number }`; `UserDatabase.relayLists: Table<RelayListRecord, string>` (keyed by `pubkey`), via schema version 4.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/db.test.ts`:

```ts
import type { RelayListRecord } from '../lib/db'

describe('userDb – relayLists table', () => {
  beforeEach(() => { openUserDb(TEST_PUBKEY) })
  afterEach(async () => {
    const db = getUserDb()
    if (db) await db.relayLists.clear()
    closeUserDb()
  })

  it('stores and retrieves a relay list by pubkey', async () => {
    const db = getUserDb()!
    const rec: RelayListRecord = { pubkey: 'p1', read: ['wss://r'], write: ['wss://w'], fetchedAt: 123 }
    await db.relayLists.put(rec)
    const found = await db.relayLists.get('p1')
    expect(found?.read).toEqual(['wss://r'])
    expect(found?.write).toEqual(['wss://w'])
    expect(found?.fetchedAt).toBe(123)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/db.test.ts -t "relayLists"`
Expected: FAIL — `RelayListRecord` is not exported and `db.relayLists` is undefined.

- [ ] **Step 3: Add the record type, table, and schema version**

In `src/lib/db.ts`:
- Add the record interface near the other record types:

```ts
export interface RelayListRecord {
  pubkey: string
  read: string[]
  write: string[]
  fetchedAt: number
}
```

- In the `UserDatabase` class, add the table field next to the existing ones:

```ts
  relayLists!: Table<RelayListRecord, string>
```

- After the existing `this.version(3).stores({...})` block, add version 4 (Dexie requires the full schema per version):

```ts
    this.version(4).stores({
      settings: 'key',
      messages: 'id, [chatId+createdAt], createdAt',
      crypto: 'id',
      relayLists: 'pubkey',
    })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/db.test.ts`
Expected: PASS — new relayLists test plus all existing db tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/__tests__/db.test.ts
git commit -m "feat: add Dexie relayLists table for peer relay-list cache

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Peer relay-list cache (`peerRelays.ts`)

**Files:**
- Create: `src/lib/peerRelays.ts`
- Test: `src/__tests__/peerRelays.test.ts`

**Interfaces:**
- Consumes: `getUserDb` from `./userDb`; `fetchRelayList` from `./nostrSync`; `RelayListRecord` (implicitly, via the Dexie table).
- Produces: `PeerRelays = { read: string[]; write: string[] }`; `PEER_RELAY_TTL_MS`, `MAX_PEER_RELAYS`; `combineRelays(mine: string[], peer: string[], cap?: number): string[]`; `getPeerRelays(pubkey: string, discoveryRelays: string[]): Promise<PeerRelays>`; `resetPeerRelayCache(): void`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/peerRelays.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, getUserDb } from '../lib/userDb'

const fetchRelayList = vi.fn()
vi.mock('../lib/nostrSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostrSync')>()
  return { ...actual, fetchRelayList: (...a: unknown[]) => fetchRelayList(...a) }
})

import { combineRelays, getPeerRelays, resetPeerRelayCache, MAX_PEER_RELAYS } from '../lib/peerRelays'

const PK = 'd'.repeat(64)
const MINE = ['wss://mine1', 'wss://mine2']

beforeEach(() => {
  openUserDb(PK)
  resetPeerRelayCache()
  fetchRelayList.mockReset()
})
afterEach(async () => {
  const db = getUserDb()
  if (db) await db.relayLists.clear()
  closeUserDb()
})

describe('combineRelays', () => {
  it('unions mine with the peer set, deduped', () => {
    expect(combineRelays(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })
  it('caps the peer additions at MAX_PEER_RELAYS', () => {
    const peer = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
    expect(combineRelays(['m'], peer)).toEqual(['m', ...peer.slice(0, MAX_PEER_RELAYS)])
  })
  it('returns exactly mine when peer is empty', () => {
    expect(combineRelays(['a', 'b'], [])).toEqual(['a', 'b'])
  })
})

describe('getPeerRelays', () => {
  it('fetches on a miss, maps markers, and caches (no second fetch within TTL)', async () => {
    fetchRelayList.mockResolvedValueOnce({
      urls: ['wss://both', 'wss://ronly', 'wss://wonly'],
      modes: {
        'wss://both': { read: true, write: true },
        'wss://ronly': { read: true, write: false },
        'wss://wonly': { read: false, write: true },
      },
      createdAt: 1,
    })
    const first = await getPeerRelays('peerA', MINE)
    expect(first.read).toEqual(['wss://both', 'wss://ronly'])
    expect(first.write).toEqual(['wss://both', 'wss://wonly'])
    expect(fetchRelayList).toHaveBeenCalledTimes(1)

    resetPeerRelayCache() // drop memory; should hit fresh Dexie, still no refetch
    const second = await getPeerRelays('peerA', MINE)
    expect(second.write).toEqual(['wss://both', 'wss://wonly'])
    expect(fetchRelayList).toHaveBeenCalledTimes(1)
  })

  it('negative-caches an empty result on a null fetch (no refetch within TTL)', async () => {
    fetchRelayList.mockResolvedValue(null)
    const a = await getPeerRelays('peerB', MINE)
    expect(a).toEqual({ read: [], write: [] })
    const b = await getPeerRelays('peerB', MINE)
    expect(b).toEqual({ read: [], write: [] })
    expect(fetchRelayList).toHaveBeenCalledTimes(1)
  })

  it('negative-caches on a fetch error', async () => {
    fetchRelayList.mockRejectedValue(new Error('relay down'))
    const a = await getPeerRelays('peerC', MINE)
    expect(a).toEqual({ read: [], write: [] })
    expect(fetchRelayList).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/peerRelays.test.ts`
Expected: FAIL — `src/lib/peerRelays.ts` does not exist.

- [ ] **Step 3: Implement `peerRelays.ts`**

Create `src/lib/peerRelays.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/peerRelays.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/peerRelays.ts src/__tests__/peerRelays.test.ts
git commit -m "feat: peer relay-list cache (lazy fetch, TTL, negative cache)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `usePeerRelays` hook

**Files:**
- Create: `src/hooks/usePeerRelays.ts`
- Test: `src/__tests__/usePeerRelays.test.tsx`

**Interfaces:**
- Consumes: `getPeerRelays`, `PeerRelays` from `../lib/peerRelays`; the store's `readRelays()`.
- Produces: `usePeerRelays(pubkey: string | null): PeerRelays` — empty arrays until resolved, then the peer's lists; resets on `pubkey` change.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/usePeerRelays.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const getPeerRelays = vi.fn()
vi.mock('../lib/peerRelays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/peerRelays')>()
  return { ...actual, getPeerRelays: (...a: unknown[]) => getPeerRelays(...a) }
})
vi.mock('../store/nostrStore', () => {
  const hook = () => ({})
  hook.getState = () => ({ readRelays: () => ['wss://mine'] })
  return { useNostrStore: hook }
})

import { usePeerRelays } from '../hooks/usePeerRelays'

beforeEach(() => { getPeerRelays.mockReset() })

describe('usePeerRelays', () => {
  it('returns empty then the peer relays after the fetch resolves', async () => {
    getPeerRelays.mockResolvedValue({ read: ['wss://pr'], write: ['wss://pw'] })
    const { result } = renderHook(() => usePeerRelays('peerX'))
    expect(result.current).toEqual({ read: [], write: [] })
    await waitFor(() => expect(result.current.write).toEqual(['wss://pw']))
  })

  it('stays empty for a null pubkey and does not fetch', () => {
    const { result } = renderHook(() => usePeerRelays(null))
    expect(result.current).toEqual({ read: [], write: [] })
    expect(getPeerRelays).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/usePeerRelays.test.tsx`
Expected: FAIL — `src/hooks/usePeerRelays.ts` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/usePeerRelays.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/usePeerRelays.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePeerRelays.ts src/__tests__/usePeerRelays.test.tsx
git commit -m "feat: usePeerRelays reactive hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Route live DMs (send + received subscription)

**Files:**
- Modify: `src/hooks/useNostrSubscriptions.ts` (`useDMMessages` received subscription)
- Modify: `src/components/Chat/MessageThread.tsx` (`DMThread` send + retry)
- Test: `src/__tests__/useDMMessages.routing.test.tsx`

**Interfaces:**
- Consumes: `usePeerRelays` from `./usePeerRelays`; `getPeerRelays`, `combineRelays` from `../lib/peerRelays`; existing `useReadRelays`/`useWriteRelays`, `useStableArray`.
- Produces: the DM received subscription reads from `combineRelays(myRead, peerWrite)`; the DM send publishes to `combineRelays(myWrite, peerRead)`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/useDMMessages.routing.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const subscribeEvents = vi.fn(() => ({ close: vi.fn() }))
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, subscribeEvents: (...a: unknown[]) => subscribeEvents(...a), publishEvent: vi.fn() }
})
vi.mock('./useRelays', () => ({ useReadRelays: () => ['wss://myread'], useWriteRelays: () => ['wss://mywrite'] }))
vi.mock('../hooks/usePeerRelays', () => ({ usePeerRelays: () => ({ read: ['wss://peerread'], write: ['wss://peerwrite'] }) }))
// keep a signer present so the effect runs
vi.mock('../lib/signer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/signer')>()
  return { ...actual, getSigner: () => ({ pubkey: 'me', type: 'local', caps: { nip04: true } }) }
})

import { useDMMessages } from '../hooks/useNostrSubscriptions'

beforeEach(() => { subscribeEvents.mockClear() })

describe('useDMMessages routing', () => {
  it('reads the received direction from my read + peer write relays', () => {
    renderHook(() => useDMMessages('me', 'them'))
    // two subscriptions: [sent, received]
    const calls = subscribeEvents.mock.calls
    const received = calls.find(c => (c[1] as { authors: string[] }).authors?.[0] === 'them')!
    const relaysArg = received[0] as string[]
    expect(relaysArg).toContain('wss://myread')
    expect(relaysArg).toContain('wss://peerwrite')
  })
})
```

Note: the mock path for `useRelays` is `'./useRelays'` because `useNostrSubscriptions.ts` imports it relatively; if Vitest requires the rooted path, use `'../hooks/useRelays'`. Use whichever matches the import in the file under test (it imports `from './useRelays'`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/useDMMessages.routing.test.tsx`
Expected: FAIL — the received subscription currently uses only my read relays (no `wss://peerwrite`).

- [ ] **Step 3: Route the received subscription in `useDMMessages`**

In `src/hooks/useNostrSubscriptions.ts`:
- Add imports:

```ts
import { usePeerRelays } from './usePeerRelays'
import { combineRelays } from '../lib/peerRelays'
```

- Update `useDMMessages` so the received subscription uses the combined set (the sent subscription stays on my read relays):

```ts
export function useDMMessages(myPubkey: string | null, theirPubkey: string | null) {
  const stableRelays = useReadRelays()
  const peer = usePeerRelays(theirPubkey)
  const receivedRelays = useStableArray(combineRelays(stableRelays, peer.write))

  useEffect(() => {
    if (!myPubkey || !theirPubkey) return
    if (!getSigner()) return

    // Messages I sent to them — my relays
    let live1 = false
    const sub1 = subscribeEvents(
      stableRelays,
      { kinds: [4], authors: [myPubkey], '#p': [theirPubkey], limit: INITIAL_PAGE },
      (event) => { void processDMEvent(event, myPubkey, stableRelays, { live: live1 }) },
      () => { live1 = true },
    )
    // Messages they sent to me — my read relays + their write relays (outbox)
    let live2 = false
    const sub2 = subscribeEvents(
      receivedRelays,
      { kinds: [4], authors: [theirPubkey], '#p': [myPubkey], limit: INITIAL_PAGE },
      (event) => { void processDMEvent(event, myPubkey, receivedRelays, { live: live2 }) },
      () => { live2 = true },
    )
    return () => {
      sub1.close()
      sub2.close()
    }
  }, [myPubkey, theirPubkey, stableRelays, receivedRelays])
}
```

(`useStableArray` is already imported in this file.)

- [ ] **Step 4: Route the DM send + retry in `DMThread`**

In `src/components/Chat/MessageThread.tsx`, add imports:

```ts
import { getPeerRelays, combineRelays } from '../../lib/peerRelays'
import { useNostrStore } from '../../store/nostrStore'
```

(`useNostrStore` is already imported — do not duplicate.)

In `DMThread`'s `handleSend`, after `const event = await buildDMEvent(theirPubkey, content)` and before the publish, compute the outbox target and publish to it (replace `publishEvent(writeR, event)`):

```ts
    const peerRead = (await getPeerRelays(theirPubkey, useNostrStore.getState().readRelays())).read
    const target = combineRelays(writeR, peerRead)
    // ...optimistic addMessage stays as-is...
    try {
      await publishEvent(target, event)
```

In `DMThread`'s `handleRetry`, compute the same target for the retried event and replace its `publishEvent(writeR, event)` with `publishEvent(target, event)` where:

```ts
    const peerRead = (await getPeerRelays(theirPubkey, useNostrStore.getState().readRelays())).read
    const target = combineRelays(writeR, peerRead)
```

(Leave `ChannelThread` and `GroupThread` publishes on `writeR` unchanged.)

- [ ] **Step 5: Run the routing test + type-check**

Run: `npx vitest run src/__tests__/useDMMessages.routing.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Run the affected suites**

Run: `npx vitest run src/__tests__/inbox.test.ts src/__tests__/messageInputSend.test.tsx`
Expected: PASS (unknown peer in those tests → combineRelays returns my relays → Phase-A behavior).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useNostrSubscriptions.ts src/components/Chat/MessageThread.tsx src/__tests__/useDMMessages.routing.test.tsx
git commit -m "feat: route DM send to recipient read relays, DM read from peer write relays

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Route DM backfill + profile fetch

**Files:**
- Modify: `src/hooks/useChatHistory.ts` (DM backfill received-direction filter)
- Modify: `src/lib/inbox.ts` (`ensureProfile`)
- Test: `src/__tests__/inbox.test.ts` (add an `ensureProfile` routing test)

**Interfaces:**
- Consumes: `getPeerRelays`, `combineRelays` from `../lib/peerRelays`; existing `olderFilterFor`, `fetchEvents`, `fetchEvent`.
- Produces: DM history backfill fetches the received-direction filter from `combineRelays(myRead, peerWrite)`; `ensureProfile` fetches kind-0 from `combineRelays(relays, peerWrite)`.

- [ ] **Step 1: Write the failing test (ensureProfile routing)**

Add to `src/__tests__/inbox.test.ts`. The file already mocks `../lib/nostr` with `fetchEvent: vi.fn()`. Add a `getPeerRelays` mock and a test asserting the kind-0 fetch targets the combined relays. At the top with the other `vi.mock` calls:

```ts
vi.mock('../lib/peerRelays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/peerRelays')>()
  return { ...actual, getPeerRelays: vi.fn().mockResolvedValue({ read: [], write: ['wss://authorwrite'] }) }
})
```

Then add a test (place near other inbox tests):

```ts
import { ensureProfile } from '../lib/inbox'
import { fetchEvent } from '../lib/nostr'

it('ensureProfile fetches the author profile from author write relays + given relays', async () => {
  useNostrStore.setState({ profiles: {} })
  ensureProfile('authorPk', ['wss://myread'])
  // ensureProfile is fire-and-forget through getPeerRelays; allow the microtasks to settle
  await new Promise(r => setTimeout(r, 0))
  const call = (fetchEvent as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)!
  const relaysArg = call[0] as string[]
  expect(relaysArg).toContain('wss://myread')
  expect(relaysArg).toContain('wss://authorwrite')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/inbox.test.ts -t "ensureProfile fetches"`
Expected: FAIL — `ensureProfile` currently fetches from the passed relays only (no `wss://authorwrite`).

- [ ] **Step 3: Route `ensureProfile` in `inbox.ts`**

In `src/lib/inbox.ts`:
- Add the import:

```ts
import { getPeerRelays, combineRelays } from './peerRelays'
```

- Replace `ensureProfile` so it fetches from the author's write relays combined with the given relays:

```ts
export function ensureProfile(pubkey: string, relays: string[]): void {
  const { profiles, setProfile } = useNostrStore.getState()
  if (profiles[pubkey] || fetchingProfiles.has(pubkey)) return
  fetchingProfiles.add(pubkey)
  getPeerRelays(pubkey, relays)
    .then(pr => fetchEvent(combineRelays(relays, pr.write), { kinds: [0], authors: [pubkey] }))
    .then(profileEvent => { if (profileEvent) setProfile(profileEvent.pubkey, parseProfile(profileEvent)) })
    .catch(() => {})
    .finally(() => fetchingProfiles.delete(pubkey))
}
```

- [ ] **Step 4: Route the DM backfill received filter in `useChatHistory.ts`**

In `src/hooks/useChatHistory.ts`:
- Add the import:

```ts
import { getPeerRelays, combineRelays } from '../lib/peerRelays'
```

- In `loadOlder`, replace the relay-fetch line
  `const events = (await Promise.all(filters.map(f => fetchEvents(relays, f)))).flat()`
  with a DM-aware version (for DMs, fetch the received-direction filter from the peer's write relays):

```ts
      const filters = olderFilterFor(chatType, chatId, myPubkey, oldest, OLDER_PAGE)
      let events
      if (chatType === 'dm') {
        // olderFilterFor('dm', ...) returns [sent (authors:[me]), received (authors:[peer])]
        const [sentFilter, receivedFilter] = filters
        const peer = await getPeerRelays(chatId, relays)
        const receivedRelays = combineRelays(relays, peer.write)
        events = (await Promise.all([
          fetchEvents(relays, sentFilter),
          fetchEvents(receivedRelays, receivedFilter),
        ])).flat()
      } else {
        events = (await Promise.all(filters.map(f => fetchEvents(relays, f)))).flat()
      }
```

(Leave the rest of `loadOlder` — the empty-check, processor loop, and counting — unchanged.)

- [ ] **Step 5: Run the tests + type-check**

Run: `npx vitest run src/__tests__/inbox.test.ts`
Expected: PASS — the new ensureProfile routing test plus all existing inbox tests green.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — entire suite green (unknown-peer fallback keeps existing behavior).

- [ ] **Step 7: Manual verification note**

Cannot be automated here — record as outstanding: across two real accounts on a real network, confirm that a DM reaches a recipient whose read relays differ from the sender's relays, that the sender sees the peer's replies (read from peer write relays), and that a contact's profile resolves from their write relays. (Same live-network gap noted for Phase A.)

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useChatHistory.ts src/lib/inbox.ts src/__tests__/inbox.test.ts
git commit -m "feat: route DM backfill and profile fetch via peer write relays

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Dexie `relayLists` table (v4) → Task 1.
- Cache + `getPeerRelays` (memory→Dexie→fetch, TTL, negative cache) + `combineRelays` + constants → Task 2.
- `usePeerRelays` reactive hook → Task 3.
- DM send → `combineRelays(myWrite, peerRead)` → Task 4.
- DM read received-direction (live sub) → `combineRelays(myRead, peerWrite)` → Task 4; (backfill) → Task 5.
- Profile fetch (`ensureProfile`) → `combineRelays(relays, peerWrite)` → Task 5.
- Discovery from my read relays → Tasks 2/3/4/5 (pass `readRelays()` as `discoveryRelays`).
- Fallback to my relays when peer unknown → `combineRelays` empty-peer behavior (Task 2), exercised by existing suites staying green (Tasks 4/5).
- Unchanged sites (global inbox, own sent sub, channels, groups, bulk profile loader) → not modified (Tasks 4/5 touch only the received DM sub, DM send, DM backfill, ensureProfile).
- Dexie v4 migration intact → Task 1 (existing db tests stay green).
- Mobile: no UI changes → inherent.

All spec sections map to a task. No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step has complete code or an exact old→new edit; every run step states the command and expected result.

**Type consistency:** `PeerRelays = { read, write }` and `combineRelays(mine, peer, cap?)` / `getPeerRelays(pubkey, discoveryRelays)` are defined in Task 2 and used with the same signatures in Tasks 3/4/5. `usePeerRelays(pubkey)` (Task 3) returns `PeerRelays`, consumed in Task 4. `RelayListRecord` (Task 1) matches the Dexie `put`/`get` shape used by `getPeerRelays` (Task 2). `fetchRelayList`'s `{ urls, modes }` shape (Phase A) is consumed correctly in Task 2's marker mapping. `olderFilterFor('dm', ...)` returns `[sent, received]` (Phase A order), relied on in Task 5.
