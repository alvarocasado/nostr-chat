# NIP-65 Relay List + Read/Write Routing (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-relay read/write markers, publish a kind-10002 relay list, and route the user's own writes to their write relays and own reads from their read relays — defaulting to behavior-identical for existing users.

**Architecture:** Keep `relays: string[]` (the full connection set) and add a parallel `relayModes` map. Pure `filterRead`/`filterWrite` helpers derive the routed subsets (empty→all fallback). kind-10002 becomes the canonical relay list, published on change and adopted on login. Relay-I/O call sites route through `readRelays()`/`writeRelays()` (store) and `useReadRelays()`/`useWriteRelays()` (reactive hooks).

**Tech Stack:** TypeScript, React 19, Zustand, nostr-tools, Vitest.

## Global Constraints

- No emojis in code, comments, or documentation.
- `relays: string[]` keeps its type; add `relayModes: Record<string, { read: boolean; write: boolean }>`. A relay absent from the map defaults to `{ read: true, write: true }`.
- `filterRead`/`filterWrite` must fall back to the full `relays` list when their filtered subset is empty (never strand the app).
- Default-safety: with all relays read+write, read-set == write-set == `relays`, so behavior must be byte-identical to today. Existing tests stay green under the default config.
- kind-10002 is the canonical relay list: build `['r',url]` (both) / `['r',url,'read']` / `['r',url,'write']`; a bare `['r',url]` parses to read+write. It is the source of truth; stop writing `relays` into the kind-30078 settings blob, but keep reading the blob's `relays` as the no-10002 fallback.
- Publishes of own events → write relays; reads of own inbox/data → read relays. The relay pool still connects to the full `relays` set.
- A relay must always have at least one of read/write enabled (UI enforces).

---

## Phase 1 — Routing helpers + kind-10002

### Task 1: Pure read/write routing helpers

**Files:**
- Create: `src/lib/relayRouting.ts`
- Test: `src/__tests__/relayRouting.test.ts`

**Interfaces:**
- Produces: `RelayMode = { read: boolean; write: boolean }`; `RelayModes = Record<string, RelayMode>`; `filterRead(relays: string[], modes: RelayModes): string[]`; `filterWrite(relays: string[], modes: RelayModes): string[]`. Both fall back to the full `relays` list when the filtered subset is empty; a relay missing from `modes` counts as read+write.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/relayRouting.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterRead, filterWrite } from '../lib/relayRouting'

const R = ['wss://a', 'wss://b', 'wss://c']

describe('filterRead / filterWrite', () => {
  it('returns all relays when no modes are set (default both)', () => {
    expect(filterRead(R, {})).toEqual(R)
    expect(filterWrite(R, {})).toEqual(R)
  })

  it('filters by marker', () => {
    const modes = {
      'wss://a': { read: true, write: false },
      'wss://b': { read: false, write: true },
      'wss://c': { read: true, write: true },
    }
    expect(filterRead(R, modes)).toEqual(['wss://a', 'wss://c'])
    expect(filterWrite(R, modes)).toEqual(['wss://b', 'wss://c'])
  })

  it('treats a relay missing from modes as read+write', () => {
    const modes = { 'wss://a': { read: false, write: false } }
    expect(filterRead(R, modes)).toEqual(['wss://b', 'wss://c'])
    expect(filterWrite(R, modes)).toEqual(['wss://b', 'wss://c'])
  })

  it('falls back to the full list when a side is empty', () => {
    const modes = {
      'wss://a': { read: false, write: true },
      'wss://b': { read: false, write: true },
      'wss://c': { read: false, write: true },
    }
    expect(filterRead(R, modes)).toEqual(R)   // no read relays -> fall back to all
    expect(filterWrite(R, modes)).toEqual(R)  // all write -> unchanged
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/relayRouting.test.ts`
Expected: FAIL — `src/lib/relayRouting.ts` does not exist.

- [ ] **Step 3: Implement `relayRouting.ts`**

Create `src/lib/relayRouting.ts`:

```ts
export interface RelayMode { read: boolean; write: boolean }
export type RelayModes = Record<string, RelayMode>

function filterBy(relays: string[], modes: RelayModes, side: 'read' | 'write'): string[] {
  const subset = relays.filter(url => {
    const m = modes[url]
    if (!m) return true // unmarked = read + write
    return m[side]
  })
  return subset.length > 0 ? subset : relays
}

export function filterRead(relays: string[], modes: RelayModes): string[] {
  return filterBy(relays, modes, 'read')
}

export function filterWrite(relays: string[], modes: RelayModes): string[] {
  return filterBy(relays, modes, 'write')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/relayRouting.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/relayRouting.ts src/__tests__/relayRouting.test.ts
git commit -m "feat: pure read/write relay routing helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: kind-10002 relay list in nostrSync

**Files:**
- Modify: `src/lib/nostrSync.ts` (add build/fetch/publish + extend `SyncResult`/`syncFromRelays`)
- Test: `src/__tests__/nostrSync.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `RelayModes` from `./relayRouting`.
- Produces: `buildRelayListEvent(relays: string[], modes: RelayModes): Promise<Event>`; `fetchRelayList(relays: string[], pubkey: string): Promise<{ urls: string[]; modes: RelayModes; createdAt: number } | null>`; `publishRelayList(writeRelays: string[], relays: string[], modes: RelayModes): Promise<void>`; `SyncResult.relayList: { urls: string[]; modes: RelayModes; createdAt: number } | null`.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/nostrSync.test.ts` (the file installs a test signer; follow its existing setup). If the file does not import `installTestSigner`/`generateSecretKey`, add them as the existing tests do:

```ts
import { buildRelayListEvent } from '../lib/nostrSync'
import type { RelayModes } from '../lib/relayRouting'

describe('buildRelayListEvent (kind 10002)', () => {
  it('emits r tags with the correct markers', async () => {
    installTestSigner(generateSecretKey())
    const relays = ['wss://a', 'wss://b', 'wss://c']
    const modes: RelayModes = {
      'wss://a': { read: true, write: true },
      'wss://b': { read: true, write: false },
      'wss://c': { read: false, write: true },
    }
    const ev = await buildRelayListEvent(relays, modes)
    expect(ev.kind).toBe(10002)
    expect(ev.tags).toEqual([
      ['r', 'wss://a'],
      ['r', 'wss://b', 'read'],
      ['r', 'wss://c', 'write'],
    ])
  })

  it('treats an unmarked relay as read+write (bare r tag)', async () => {
    installTestSigner(generateSecretKey())
    const ev = await buildRelayListEvent(['wss://a'], {})
    expect(ev.tags).toEqual([['r', 'wss://a']])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/nostrSync.test.ts -t "kind 10002"`
Expected: FAIL — `buildRelayListEvent` is not exported.

- [ ] **Step 3: Implement the kind-10002 functions**

In `src/lib/nostrSync.ts`, add the import and the functions (place after the kind-3 section):

```ts
import type { RelayModes } from './relayRouting'

// ── Kind 10002 – NIP-65 relay list ───────────────────────────────────────────

export async function buildRelayListEvent(relays: string[], modes: RelayModes): Promise<Event> {
  const tags: string[][] = []
  for (const url of relays) {
    const m = modes[url] ?? { read: true, write: true }
    if (m.read && m.write) tags.push(['r', url])
    else if (m.read) tags.push(['r', url, 'read'])
    else if (m.write) tags.push(['r', url, 'write'])
    // neither -> omitted
  }
  return requireSigner().signEvent({
    kind: 10002,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })
}

export async function fetchRelayList(
  relays: string[],
  pubkey: string,
): Promise<{ urls: string[]; modes: RelayModes; createdAt: number } | null> {
  const event = await fetchEvent(relays, { kinds: [10002], authors: [pubkey], limit: 1 })
  if (!event) return null
  const urls: string[] = []
  const modes: RelayModes = {}
  for (const t of event.tags) {
    if (t[0] !== 'r' || !t[1]) continue
    const url = t[1]
    const marker = t[2]
    urls.push(url)
    if (marker === 'read') modes[url] = { read: true, write: false }
    else if (marker === 'write') modes[url] = { read: false, write: true }
    else modes[url] = { read: true, write: true }
  }
  return { urls, modes, createdAt: event.created_at }
}

export async function publishRelayList(writeRelays: string[], relays: string[], modes: RelayModes): Promise<void> {
  await publishEvent(writeRelays, await buildRelayListEvent(relays, modes))
}
```

- [ ] **Step 4: Extend `SyncResult` and `syncFromRelays`**

In `src/lib/nostrSync.ts`:
- Add to the `SyncResult` interface: `relayList: { urls: string[]; modes: RelayModes; createdAt: number } | null`.
- In `syncFromRelays`, add `fetchRelayList(relays, pubkey)` to the `Promise.allSettled([...])` array and include it in the returned object:

```ts
export async function syncFromRelays(relays: string[]): Promise<SyncResult> {
  const pubkey = requireSigner().pubkey
  const [contacts, channels, settings, groupKeysResult, relayList] = await Promise.allSettled([
    fetchContactList(relays, pubkey),
    fetchChannelBookmarks(relays, pubkey),
    fetchAppSettings(relays),
    fetchGroupKeys(relays),
    fetchRelayList(relays, pubkey),
  ])
  return {
    contacts: contacts.status === 'fulfilled' ? contacts.value : null,
    channels: channels.status === 'fulfilled' ? channels.value : null,
    settings: settings.status === 'fulfilled' ? settings.value : null,
    groupKeys: groupKeysResult.status === 'fulfilled' ? groupKeysResult.value : {},
    relayList: relayList.status === 'fulfilled' ? relayList.value : null,
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/nostrSync.test.ts`
Expected: PASS — new kind-10002 tests and existing nostrSync tests green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/nostrSync.ts src/__tests__/nostrSync.test.ts
git commit -m "feat: kind-10002 relay list build/fetch/publish + sync

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — Store

### Task 3: relayModes, routing helpers, publish + adopt kind-10002

**Files:**
- Modify: `src/store/nostrStore.ts`
- Test: `src/__tests__/store.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `filterRead`/`filterWrite` from `../lib/relayRouting`; `publishRelayList`/`buildRelayListEvent` from `../lib/nostrSync`; `RelayModes` type.
- Produces: store state `relayModes: RelayModes`; actions `setRelayMode(url: string, read: boolean, write: boolean)`, `readRelays(): string[]`, `writeRelays(): string[]`; `addRelay`/`removeRelay` maintain `relayModes`; kind-10002 republished on relay/marker change; kind-10002 adopted on login; `relays` no longer written into the settings blob.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/store.test.ts`:

```ts
describe('relay modes + routing', () => {
  beforeEach(() => {
    useNostrStore.setState({ relays: ['wss://a', 'wss://b'], relayModes: {} })
  })

  it('readRelays / writeRelays default to all relays', () => {
    expect(useNostrStore.getState().readRelays()).toEqual(['wss://a', 'wss://b'])
    expect(useNostrStore.getState().writeRelays()).toEqual(['wss://a', 'wss://b'])
  })

  it('setRelayMode splits read/write routing', () => {
    useNostrStore.getState().setRelayMode('wss://a', true, false)  // read-only
    useNostrStore.getState().setRelayMode('wss://b', false, true)  // write-only
    expect(useNostrStore.getState().readRelays()).toEqual(['wss://a'])
    expect(useNostrStore.getState().writeRelays()).toEqual(['wss://b'])
  })

  it('addRelay seeds both markers; removeRelay drops the mode', () => {
    useNostrStore.getState().addRelay('wss://c')
    expect(useNostrStore.getState().relayModes['wss://c']).toEqual({ read: true, write: true })
    useNostrStore.getState().removeRelay('wss://c')
    expect(useNostrStore.getState().relayModes['wss://c']).toBeUndefined()
    expect(useNostrStore.getState().relays).not.toContain('wss://c')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/store.test.ts -t "relay modes"`
Expected: FAIL — `relayModes`/`setRelayMode`/`readRelays`/`writeRelays` do not exist.

- [ ] **Step 3: Add state, type, and imports**

In `src/store/nostrStore.ts`:
- Imports: add `import { filterRead, filterWrite, type RelayModes } from '../lib/relayRouting'` and add `publishRelayList` to the existing `../lib/nostrSync` import.
- In the `NostrState` interface, next to `relays: string[]` add:

```ts
  relayModes: RelayModes
```
and next to `addRelay`/`removeRelay` add:

```ts
  setRelayMode: (url: string, read: boolean, write: boolean) => void
  readRelays: () => string[]
  writeRelays: () => string[]
```

- In the initial state object (near `relays: DEFAULT_RELAYS`), add:

```ts
        relayModes: {},
```

- In `partialize`, next to `relays: state.relays,` add:

```ts
        relayModes: state.relayModes,
```

- [ ] **Step 4: Implement the actions and helpers**

In `src/store/nostrStore.ts`, replace `addRelay`/`removeRelay` and add the new methods:

```ts
        addRelay: (url) => {
          const relays = get().relays
          if (!relays.includes(url)) {
            set({
              relays: [...relays, url],
              relayModes: { ...get().relayModes, [url]: { read: true, write: true } },
            })
            scheduleSettingsSync()
          }
        },

        removeRelay: (url) => {
          const { [url]: _removed, ...restModes } = get().relayModes
          set({
            relays: get().relays.filter(r => r !== url),
            relayModes: restModes,
          })
          scheduleSettingsSync()
        },

        setRelayMode: (url, read, write) => {
          // never allow neither — keep at least read
          const safe = read || write ? { read, write } : { read: true, write: false }
          set({ relayModes: { ...get().relayModes, [url]: safe } })
          scheduleSettingsSync()
        },

        readRelays: () => filterRead(get().relays, get().relayModes),
        writeRelays: () => filterWrite(get().relays, get().relayModes),
```

- [ ] **Step 5: Publish kind-10002 on change; stop writing relays to the settings blob**

In `scheduleSettingsSync` (the debounced body), make two changes:
1. Remove `relays` from the published settings payload — change the destructure and the `publishAppSettings` call so the blob no longer carries relays:

```ts
            const { notificationSettings, mutedChats, blockedPubkeys, dismissedRequests } = get()
            // ...callsSettings unchanged...
            const wr = get().writeRelays()
            void Promise.all([
              publishAppSettings({ notificationSettings, mutedChats, callsSettings, blockedPubkeys, dismissedRequests }, wr),
              publishRelayList(wr, get().relays, get().relayModes),
            ]).then(() => set({ syncedSettingsAt: now })).catch(() => {})
```

(Remove the old single `publishAppSettings(..., relays)` call. Note `relays` is no longer destructured here.)

- [ ] **Step 6: Adopt kind-10002 on login; publish if missing**

In `applySyncResult` (module-level function), add relay-list handling before/after the settings block:

```ts
  // Relay list (kind 10002): adopt as source of truth when present.
  if (result.relayList && result.relayList.urls.length > 0) {
    set({ relays: result.relayList.urls, relayModes: result.relayList.modes })
  } else {
    // No published relay list yet — publish current relays so future logins find it.
    get().triggerSettingsSync()
  }
```

Leave the existing `s.relays` settings-blob branch in place (it remains the fallback for users whose data predates kind-10002 and who have no relay-list event; when a relayList IS present it is applied after and wins).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/store.test.ts`
Expected: PASS — new relay-mode tests and all existing store tests green.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/store/nostrStore.ts src/__tests__/store.test.ts
git commit -m "feat: relay modes, read/write helpers, publish+adopt kind-10002

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3 — Route call sites

### Task 4: Reactive relay hooks + route reads to read relays

**Files:**
- Create: `src/hooks/useRelays.ts`
- Modify: `src/hooks/useNostrSubscriptions.ts` (read subscriptions), `src/hooks/useChatHistory.ts`, `src/hooks/useTypingIndicator.ts`, `src/contexts/CallContext.tsx`, `src/components/Chat/AddContactModal.tsx`
- Test: `src/__tests__/useRelays.test.tsx`

**Interfaces:**
- Consumes: `filterRead`/`filterWrite` from `../lib/relayRouting`; the store's `relays`/`relayModes`; `useStableArray`.
- Produces: `useReadRelays(): string[]` and `useWriteRelays(): string[]` (stable-referenced, reactive to relays+modes).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/useRelays.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useNostrStore } from '../store/nostrStore'
import { useReadRelays, useWriteRelays } from '../hooks/useRelays'

beforeEach(() => {
  useNostrStore.setState({
    relays: ['wss://a', 'wss://b'],
    relayModes: { 'wss://a': { read: true, write: false }, 'wss://b': { read: false, write: true } },
  })
})

describe('useReadRelays / useWriteRelays', () => {
  it('return the marker-filtered subsets', () => {
    expect(renderHook(() => useReadRelays()).result.current).toEqual(['wss://a'])
    expect(renderHook(() => useWriteRelays()).result.current).toEqual(['wss://b'])
  })

  it('default config returns all relays', () => {
    useNostrStore.setState({ relayModes: {} })
    expect(renderHook(() => useReadRelays()).result.current).toEqual(['wss://a', 'wss://b'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/useRelays.test.tsx`
Expected: FAIL — `src/hooks/useRelays.ts` does not exist.

- [ ] **Step 3: Implement the hooks**

Create `src/hooks/useRelays.ts`:

```ts
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
```

- [ ] **Step 4: Run the hook test to verify it passes**

Run: `npx vitest run src/__tests__/useRelays.test.tsx`
Expected: PASS.

- [ ] **Step 5: Route read subscriptions in `useNostrSubscriptions.ts`**

In `src/hooks/useNostrSubscriptions.ts`, in EACH read-subscription hook (`useProfileLoader`, `useChannelMessages`, `useDMMessages`, `useChannelDiscovery`, `useGroupMessages`, `useGlobalInbox`), replace the relay source. Each currently does:

```ts
  const { relays } = useNostrStore()
  const stableRelays = useStableArray(relays)
```
(or `const relays = useNostrStore(...)`). Replace with:

```ts
  const stableRelays = useReadRelays()
```

Add `import { useReadRelays } from './useRelays'` at the top, and remove the now-unused local `relays`/`useStableArray(relays)` lines (keep `useStableArray` import only if still used elsewhere in the file — `useGlobalInbox` uses `useStableArray` for joinedChannelIds/groupIds, so keep the import). The hooks pass `stableRelays` into `subscribeEvents` and into `process*Event(...)` (which forwards to `ensureProfile`) — leave those usages, now fed by read relays.

- [ ] **Step 6: Route `useChatHistory.ts` backfill to read relays**

In `src/hooks/useChatHistory.ts`, the relay backfill currently reads `const relays = useNostrStore.getState().relays`. Change it to:

```ts
      const relays = useNostrStore.getState().readRelays()
```

(`loadOlder` already calls `useNostrStore.getState()`; use the `readRelays()` helper. The `process*Event(ev, ..., relays, ...)` calls then forward read relays to `ensureProfile`.)

- [ ] **Step 7: Route typing-indicator subscription; call-signal subscription; contact fetch**

- `src/hooks/useTypingIndicator.ts`: the subscription at line ~38 uses `stableRelays` derived from `relays`. Change `const { publicKey, relays } = useNostrStore()` / `const stableRelays = useStableArray(relays)` so the SUBSCRIBE uses read relays and the PUBLISH uses write relays. Concretely: `const publicKey = useNostrStore(s => s.publicKey)`, `const readR = useReadRelays()`, and for the publish call use `useNostrStore.getState().writeRelays()`. Use `readR` (already stable) in the subscription effect (replace `stableRelays` there and in deps). Import `useReadRelays` from `./useRelays`.
- `src/contexts/CallContext.tsx`: the subscription at line ~386 uses `relays`. Change the subscribe to read relays: add `import { useReadRelays } from '../hooks/useRelays'`, `const readR = useReadRelays()`, and use `readR` in the `subscribeEvents(readR, ...)` call and its effect deps. (The publish at line 84 is handled in Task 5.)
- `src/components/Chat/AddContactModal.tsx`: the profile fetch at line ~148 uses `relays`. Change to read relays: `fetchEvent(useNostrStore.getState().readRelays(), { kinds: [0], authors: [pk] })` (or select `readRelays` via the store). Keep the rest of the destructure.

- [ ] **Step 8: Type-check and run the affected suites**

Run: `npx tsc --noEmit`
Expected: PASS — no unused-import or missing-symbol errors.

Run: `npx vitest run src/__tests__/useRelays.test.tsx src/__tests__/inbox.test.ts src/__tests__/useChatHistory.test.tsx`
Expected: PASS (default-safe: read relays == all in tests with no modes set).

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useRelays.ts src/hooks/useNostrSubscriptions.ts src/hooks/useChatHistory.ts src/hooks/useTypingIndicator.ts src/contexts/CallContext.tsx src/components/Chat/AddContactModal.tsx src/__tests__/useRelays.test.tsx
git commit -m "feat: route inbox/data reads to read relays (NIP-65)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Route own-event publishes to write relays

**Files:**
- Modify: `src/components/Chat/MessageThread.tsx`, `src/hooks/useTypingIndicator.ts`, `src/contexts/CallContext.tsx`, `src/components/Chat/AddGroupModal.tsx`, `src/components/Chat/AddChannelModal.tsx`, `src/lib/inbox.ts`
- Test: none new (default-safe mechanical routing; covered by the full suite + tsc). The full-suite run is the gate.

**Interfaces:**
- Consumes: `useWriteRelays()` (components) / `useNostrStore.getState().writeRelays()` (imperative + lib).

- [ ] **Step 1: Route message publishes in `MessageThread.tsx`**

In `src/components/Chat/MessageThread.tsx`, each thread component destructures `relays` from the store and uses it for `publishEvent(relays, event)`, `buildChannelMessageEvent(content, channelId, relays[0], ...)` / `buildGroupMessageEvent(..., relays[0], ...)`, and retry. Add `import { useWriteRelays } from '../../hooks/useRelays'`, and in each of `ChannelThread`, `DMThread`, `GroupThread` add `const writeR = useWriteRelays()` and replace the publish-side `relays` usages:
- `publishEvent(relays, event)` → `publishEvent(writeR, event)` (in `handleSend` and `handleRetry`).
- `buildChannelMessageEvent(content, channelId, relays[0], replyTo?.id)` → use `writeR[0]` as the relay hint.
- `buildGroupMessageEvent(encryptedContent, groupId, writeR[0], replyTo?.id)` likewise.

Keep the `relays` destructure only if still used elsewhere in the component; otherwise remove it. (The MessageList/useChatHistory read path is already routed in Task 4.)

- [ ] **Step 2: Route the typing publish and call-signal publish**

- `src/hooks/useTypingIndicator.ts`: the publish at line ~70 (`void publishEvent(stableRelays, event)`) → `void publishEvent(useNostrStore.getState().writeRelays(), event)`.
- `src/contexts/CallContext.tsx`: the publish at line ~84 (`await publishEvent(relays, event)`) → `await publishEvent(useNostrStore.getState().writeRelays(), event)`; update the `useCallback` dependency that referenced `relays` (drop `relays` from deps since it now reads from `getState()` at call time, or keep a `relays` selection if simpler — prefer reading at call time).

- [ ] **Step 3: Route the group/channel creation publishes**

- `src/components/Chat/AddGroupModal.tsx`: the three `publishEvent(relays, ...)` calls (metadata, key backup, invites) → `publishEvent(useNostrStore.getState().writeRelays(), ...)`. The `relayUrl: relays[0]` group field → `useNostrStore.getState().writeRelays()[0]`.
- `src/components/Chat/AddChannelModal.tsx`: `createChannel(name, about, relays)` → pass write relays: `createChannel(name.trim(), about.trim(), useNostrStore.getState().writeRelays())`. The `relayUrl: relays[0]` channel field → `useNostrStore.getState().writeRelays()[0]`.

- [ ] **Step 4: Route the group-invite key-backup publish in `inbox.ts`**

In `src/lib/inbox.ts`, `handleGroupInvite` publishes the user's own kind-30041 key backup using the `relays` passed in (which now originates from a read subscription). Since this is a publish of the user's own event, route it to write relays. Add `import { useNostrStore } from '../store/nostrStore'` if not present (it is already imported), and change the backup publish:

```ts
    const backup = await buildGroupKeyBackupEvent(groupId, groupKeyHex)
    publishEvent(useNostrStore.getState().writeRelays(), backup).catch(() => {})
```

(Leave the rest of `handleGroupInvite` unchanged.)

- [ ] **Step 5: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS — entire suite green (default-safe: write relays == all when no modes set).

- [ ] **Step 6: Manual verification note**

Cannot be automated — record as outstanding: in the running app with a split relay config (mark one relay read-only, another write-only), confirm messages still send/receive on default config; confirm a kind-10002 event is published (visible on a relay explorer); confirm marking changes persist and republish.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/MessageThread.tsx src/hooks/useTypingIndicator.ts src/contexts/CallContext.tsx src/components/Chat/AddGroupModal.tsx src/components/Chat/AddChannelModal.tsx src/lib/inbox.ts
git commit -m "feat: route own-event publishes to write relays (NIP-65)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 4 — Settings UI

### Task 6: Read/write toggles in relay settings

**Files:**
- Modify: `src/components/Settings/SettingsScreen.tsx` (relays section, ~lines 291-304)
- Modify: `src/components/Settings/SettingsPanel.tsx` (its relays list, if present)
- Test: `src/__tests__/Sidebar.test.tsx` stays green; no new component test (the toggles are simple store-bound controls — verified via tsc + the store test from Task 3).

**Interfaces:**
- Consumes: `relayModes`, `setRelayMode` from the store.

- [ ] **Step 1: Add read/write toggles to the relay rows in `SettingsScreen.tsx`**

In `src/components/Settings/SettingsScreen.tsx`, the relays section destructures `relays`, `addRelay`, `removeRelay` from the store. Add `relayModes` and `setRelayMode`. Replace the relay row (the `relays.map(relay => ...)` block, ~lines 292-302) with one that shows Read/Write toggles:

```tsx
                {relays.map(relay => {
                  const mode = relayModes[relay] ?? { read: true, write: true }
                  return (
                    <div key={relay} className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3">
                      <Wifi size={16} className="text-green-400 flex-shrink-0" />
                      <span className="flex-1 text-sm font-mono text-gray-200 truncate">{relay}</span>
                      <button
                        onClick={() => setRelayMode(relay, !mode.read, mode.write)}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${mode.read ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                        title="Read from this relay"
                      >
                        Read
                      </button>
                      <button
                        onClick={() => setRelayMode(relay, mode.read, !mode.write)}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${mode.write ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                        title="Publish to this relay"
                      >
                        Write
                      </button>
                      <button
                        onClick={() => removeRelay(relay)}
                        className="text-gray-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-500/10"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )
                })}
```

Add `relayModes` and `setRelayMode` to the `useNostrStore()` destructure in this component. (`setRelayMode` enforces at least one marker, so toggling the last-enabled side off keeps read on.)

- [ ] **Step 2: Mirror the toggles in `SettingsPanel.tsx`**

In `src/components/Settings/SettingsPanel.tsx`, if it renders a relays list (it imports relay state), apply the same Read/Write toggle treatment to its relay rows, pulling `relayModes`/`setRelayMode` from the store. If `SettingsPanel` does not render a relays tab, skip this step and note it in the report.

- [ ] **Step 3: Type-check and run settings/sidebar tests**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 4: Manual verification note**

Record as outstanding: in the running app, open Settings → Relays, toggle Read/Write on a relay, confirm the toggle persists across reload and that at least one marker always stays on.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/SettingsScreen.tsx src/components/Settings/SettingsPanel.tsx
git commit -m "feat: per-relay read/write toggles in settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Relay model: `relays` unchanged + `relayModes` map, default both → Task 3.
- `readRelays`/`writeRelays` helpers with empty→all fallback → Task 1 (pure) + Task 3 (store) + Task 4 (hooks).
- kind-10002 build (`r` tags both/read/write), parse (bare = both), publish, fetch, SyncResult → Task 2.
- Publish kind-10002 on relay/marker change → Task 3 Step 5.
- Adopt kind-10002 on login; publish if missing; stop writing relays to settings blob; keep blob relays as fallback → Task 3 Steps 5-6.
- Routing rule — publishes → write relays → Task 5; reads → read relays → Task 4.
- Pool still connects to full `relays` → unchanged (routing is per-call arrays only).
- Default-safety (behavior identical when all both-marked) → asserted by existing suites staying green in Tasks 4/5, and the default cases in Tasks 1/3/4.
- Settings read/write toggles, at-least-one-marker enforcement → Task 6 + `setRelayMode` guard (Task 3).
- Mobile: only the Settings toggles change; no perf/layout work → Task 6.
- Phase-A DM limitation: documented in the spec; no code needed (peer routing is Phase B, out of scope).

All spec sections map to a task. No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows complete code or an exact old→new edit; every run step states the command and expected result.

**Type consistency:** `RelayModes`/`RelayMode` from `relayRouting.ts` are used consistently in `nostrSync.ts` (Task 2), the store (Task 3), and the hooks (Task 4). `filterRead`/`filterWrite(relays, modes)` signatures match between Task 1 (def) and Tasks 3/4 (use). `readRelays()`/`writeRelays()` (store, Task 3) and `useReadRelays()`/`useWriteRelays()` (hooks, Task 4) are named and used consistently across Tasks 4/5. `buildRelayListEvent`/`fetchRelayList`/`publishRelayList` signatures match between Task 2 (def) and Task 3 (use). `setRelayMode(url, read, write)` matches between Task 3 (def) and Task 6 (use).
