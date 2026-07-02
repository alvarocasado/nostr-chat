# Read Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in, reciprocal read receipts for DMs using an ephemeral encrypted watermark event (kind 24102).

**Architecture:** A new `lib/readReceipts.ts` holds the protocol (build/parse/decision logic). A `useReadReceipts` hook (modeled on `useTypingIndicator`) sends a "read up to timestamp X" watermark when a DM thread is open and visible, and stores incoming peer watermarks in the Zustand store. `MessageItem` derives read ticks at render time from the single watermark number.

**Tech Stack:** React 19 + TypeScript, Zustand (persist via Dexie-backed storage), nostr-tools, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-01-read-receipts-design.md`

**One deviation from spec:** the spec suggested a new Dexie table for peer watermarks. This plan instead stores `readUntilByPeer` in the Zustand store and persists it via the existing `partialize` (which writes to the per-user Dexie `settings` table) — the exact pattern already used for `seenAt`. Same durability guarantee, no schema version bump.

## Global Constraints

- No emojis in code, comments, or documentation.
- Conventional commits: `feat:`, `fix:`, `test:`, etc.
- Tests: `npm test` (vitest); run a single file with `npx vitest run <path>`.
- The `readReceiptsEnabled` setting defaults to `false` (opt-in) and is reciprocal: when off, incoming receipts are ignored and read ticks are hidden.
- Receipts apply to DMs only. Never in channels or groups.
- Kind 24102 is ephemeral (2xxxx range); relays relay but do not store it.

---

### Task 1: Receipt protocol library

**Files:**
- Create: `src/lib/readReceipts.ts`
- Test: `src/__tests__/readReceipts.test.ts`

**Interfaces:**
- Consumes: `requireSigner`, `getSigner` from `src/lib/signer.ts` (existing).
- Produces (used by Tasks 3 and later):
  - `READ_RECEIPT_KIND = 24102`
  - `buildReadReceiptEvent(peerPubkey: string, readUntil: number): Promise<Event>`
  - `parseReadReceiptEvent(event: Event): Promise<number | null>`
  - `clampReadUntil(value: unknown, nowS?: number): number | null`
  - `shouldSendReceipt(args: { enabled: boolean; visible: boolean; newestReceivedAt: number | undefined; lastSent: number }): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/readReceipts.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installTestSigner } from '../test/signer'
import { clearSigner, getSigner } from '../lib/signer'
import {
  READ_RECEIPT_KIND,
  buildReadReceiptEvent,
  parseReadReceiptEvent,
  clampReadUntil,
  shouldSendReceipt,
} from '../lib/readReceipts'

beforeEach(() => { installTestSigner() })
afterEach(() => clearSigner())

describe('buildReadReceiptEvent', () => {
  it('uses ephemeral kind 24102 with a p tag and encrypted content', async () => {
    const me = getSigner()!.pubkey
    const event = await buildReadReceiptEvent(me, 1234)
    expect(event.kind).toBe(READ_RECEIPT_KIND)
    expect(event.kind).toBeGreaterThanOrEqual(20000)
    expect(event.kind).toBeLessThan(30000)
    expect(event.tags).toEqual([['p', me]])
    expect(event.content).not.toContain('read_until') // encrypted, not plaintext
  })
})

describe('parseReadReceiptEvent', () => {
  it('round-trips a watermark (self-encrypted)', async () => {
    const me = getSigner()!.pubkey
    const now = Math.floor(Date.now() / 1000)
    const event = await buildReadReceiptEvent(me, now - 10)
    expect(await parseReadReceiptEvent(event)).toBe(now - 10)
  })

  it('returns null for undecryptable content', async () => {
    const me = getSigner()!.pubkey
    const event = await buildReadReceiptEvent(me, 100)
    expect(await parseReadReceiptEvent({ ...event, content: 'garbage' })).toBeNull()
  })

  it('returns null for a wrong kind', async () => {
    const me = getSigner()!.pubkey
    const event = await buildReadReceiptEvent(me, 100)
    expect(await parseReadReceiptEvent({ ...event, kind: 4 })).toBeNull()
  })

  it('clamps far-future watermarks to now + 5 min', async () => {
    const me = getSigner()!.pubkey
    const now = Math.floor(Date.now() / 1000)
    const event = await buildReadReceiptEvent(me, now + 100_000)
    const parsed = await parseReadReceiptEvent(event)
    expect(parsed).not.toBeNull()
    expect(parsed!).toBeLessThanOrEqual(now + 301)
  })
})

describe('clampReadUntil', () => {
  it('rejects non-numeric and non-positive values', () => {
    expect(clampReadUntil('x')).toBeNull()
    expect(clampReadUntil(NaN)).toBeNull()
    expect(clampReadUntil(-5)).toBeNull()
    expect(clampReadUntil(0)).toBeNull()
    expect(clampReadUntil(undefined)).toBeNull()
  })

  it('passes sane values through and clamps future ones', () => {
    expect(clampReadUntil(500, 1000)).toBe(500)
    expect(clampReadUntil(99999, 1000)).toBe(1300)
  })
})

describe('shouldSendReceipt', () => {
  const base = { enabled: true, visible: true, newestReceivedAt: 100, lastSent: 50 }

  it('sends when enabled, visible, and the watermark advanced', () => {
    expect(shouldSendReceipt(base)).toBe(true)
  })

  it.each([
    ['setting off', { ...base, enabled: false }],
    ['tab hidden', { ...base, visible: false }],
    ['no received messages', { ...base, newestReceivedAt: undefined }],
    ['watermark not advanced', { ...base, newestReceivedAt: 50 }],
  ])('does not send when %s', (_label, args) => {
    expect(shouldSendReceipt(args)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/readReceipts.test.ts`
Expected: FAIL — cannot resolve `../lib/readReceipts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/readReceipts.ts`:

```ts
import type { Event } from 'nostr-tools'
import { getSigner, requireSigner } from './signer'

// Read receipts: ephemeral range, in the app's 241xx block next to the
// call-signal kind (24100) and typing indicator (24101). Relays relay but
// never store these, so no persistent metadata trail is created.
export const READ_RECEIPT_KIND = 24102

// Never trust a peer watermark further than slightly ahead of our clock.
const MAX_CLOCK_SKEW_S = 300

// Validates a decrypted watermark value. Returns the (possibly clamped)
// unix-seconds timestamp, or null when the value is unusable.
export function clampReadUntil(value: unknown, nowS = Math.floor(Date.now() / 1000)): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.min(value, nowS + MAX_CLOCK_SKEW_S)
}

// Pure decision: should the client emit a receipt right now?
export function shouldSendReceipt(args: {
  enabled: boolean
  visible: boolean
  newestReceivedAt: number | undefined
  lastSent: number
}): boolean {
  const { enabled, visible, newestReceivedAt, lastSent } = args
  return enabled && visible && newestReceivedAt !== undefined && newestReceivedAt > lastSent
}

// Build the ephemeral receipt event. Content is NIP-04-encrypted to the peer
// so relays only see that *some* 24102 event passed between the two pubkeys
// while it is in flight.
export async function buildReadReceiptEvent(peerPubkey: string, readUntil: number): Promise<Event> {
  const signer = requireSigner()
  const content = await signer.nip04Encrypt(peerPubkey, JSON.stringify({ read_until: readUntil }))
  return signer.signEvent({
    kind: READ_RECEIPT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', peerPubkey]],
    content,
  })
}

// Decrypt and validate an incoming receipt. Returns the clamped watermark,
// or null for wrong-kind, undecryptable, or malformed payloads.
export async function parseReadReceiptEvent(event: Event): Promise<number | null> {
  const signer = getSigner()
  if (!signer || event.kind !== READ_RECEIPT_KIND) return null
  try {
    const plaintext = await signer.nip04Decrypt(event.pubkey, event.content)
    const parsed = JSON.parse(plaintext) as { read_until?: unknown }
    return clampReadUntil(parsed.read_until)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/readReceipts.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/readReceipts.ts src/__tests__/readReceipts.test.ts
git commit -m "feat: read receipt protocol lib (ephemeral kind 24102 watermark)"
```

---

### Task 2: Store state and settings sync

**Files:**
- Modify: `src/lib/nostrSync.ts` (SyncedSettings interface, ~line 78)
- Modify: `src/store/nostrStore.ts` (state interface, defaults, actions, applySyncResult, scheduleSettingsSync, partialize)
- Test: `src/__tests__/store.test.ts` (append)

**Interfaces:**
- Consumes: existing store/persist/sync infrastructure.
- Produces (used by Tasks 3-5):
  - Store state: `readReceiptsEnabled: boolean` (default `false`), `readUntilByPeer: Record<string, number>` (default `{}`)
  - Store actions: `setReadReceiptsEnabled(enabled: boolean): void`, `setPeerReadUntil(peerPubkey: string, readUntil: number): void` (keeps the max watermark per peer)
  - `SyncedSettings.readReceiptsEnabled?: boolean`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/store.test.ts`:

```ts
describe('read receipts state', () => {
  it('setPeerReadUntil keeps the max watermark per peer', () => {
    useNostrStore.setState({ readUntilByPeer: {} })
    useNostrStore.getState().setPeerReadUntil('peer1', 100)
    useNostrStore.getState().setPeerReadUntil('peer1', 50)   // stale, ignored
    useNostrStore.getState().setPeerReadUntil('peer2', 70)
    expect(useNostrStore.getState().readUntilByPeer).toEqual({ peer1: 100, peer2: 70 })
  })

  it('setReadReceiptsEnabled flips the flag', () => {
    useNostrStore.setState({ readReceiptsEnabled: false })
    useNostrStore.getState().setReadReceiptsEnabled(true)
    expect(useNostrStore.getState().readReceiptsEnabled).toBe(true)
  })

  it('applySyncResult applies readReceiptsEnabled from newer synced settings', () => {
    useNostrStore.setState({ readReceiptsEnabled: false, syncedSettingsAt: null })
    applySyncResult(
      {
        contacts: null,
        channels: null,
        groupKeys: {},
        relayList: null,
        settings: { createdAt: 999, settings: { readReceiptsEnabled: true } },
      },
      s => useNostrStore.setState(s),
      () => useNostrStore.getState(),
    )
    expect(useNostrStore.getState().readReceiptsEnabled).toBe(true)
    expect(useNostrStore.getState().syncedSettingsAt).toBe(999)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/store.test.ts`
Expected: FAIL — `setPeerReadUntil` / `setReadReceiptsEnabled` are not functions; `readReceiptsEnabled` stays `false` after applySyncResult.

- [ ] **Step 3: Implement**

In `src/lib/nostrSync.ts`, extend `SyncedSettings`:

```ts
export interface SyncedSettings {
  notificationSettings?: NotificationSettings
  mutedChats?: Record<string, number | null>
  relays?: string[]
  callsSettings?: CallsSyncedSettings
  blockedPubkeys?: string[]
  dismissedRequests?: Record<string, number>
  readReceiptsEnabled?: boolean
}
```

In `src/store/nostrStore.ts`:

3a. State interface — after the `dismissedRequests: Record<string, number>` line (~167), add:

```ts
  // Read receipts (opt-in, reciprocal; DMs only). readUntilByPeer maps peer
  // pubkey to the newest watermark received from them. The receipt events are
  // ephemeral; this local copy is what survives reload (persisted like seenAt).
  readReceiptsEnabled: boolean
  readUntilByPeer: Record<string, number>
```

3b. Actions interface — after `unblockPubkey: (pubkey: string) => void` (~206), add:

```ts
  setReadReceiptsEnabled: (enabled: boolean) => void
  setPeerReadUntil: (peerPubkey: string, readUntil: number) => void
```

3c. `applySyncResult` — in the settings `set({...})` block (~line 328), after the `dismissedRequests` spread line, add:

```ts
        ...(s.readReceiptsEnabled !== undefined ? { readReceiptsEnabled: s.readReceiptsEnabled } : {}),
```

3d. `scheduleSettingsSync` — change the destructure (~line 417) to include the flag:

```ts
            const { notificationSettings, mutedChats, blockedPubkeys, dismissedRequests, readReceiptsEnabled } = get()
```

and include it in the publish call (~line 436):

```ts
              publishAppSettings({ notificationSettings, mutedChats, callsSettings, blockedPubkeys, dismissedRequests, readReceiptsEnabled }, wr),
```

3e. Defaults — after `dismissedRequests: {},` (~line 473), add:

```ts
        readReceiptsEnabled: false,
        readUntilByPeer: {},
```

3f. Action implementations — immediately after the `unblockPubkey` action implementation (~line 711), add:

```ts
        setReadReceiptsEnabled: (enabled) => {
          set({ readReceiptsEnabled: enabled })
          scheduleSettingsSync()
        },

        setPeerReadUntil: (peerPubkey, readUntil) => {
          const current = get().readUntilByPeer[peerPubkey] ?? 0
          if (readUntil <= current) return
          set({ readUntilByPeer: { ...get().readUntilByPeer, [peerPubkey]: readUntil } })
        },
```

3g. Persistence — in the `partialize` block (~line 948), after `dismissedRequests: state.dismissedRequests,`, add:

```ts
        readReceiptsEnabled: state.readReceiptsEnabled,
        readUntilByPeer: state.readUntilByPeer,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/store.test.ts src/__tests__/nostrSync.test.ts`
Expected: PASS (new tests pass, no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/nostrSync.ts src/store/nostrStore.ts src/__tests__/store.test.ts
git commit -m "feat: read receipts store state and NIP-78 settings sync"
```

---

### Task 3: useReadReceipts hook

**Files:**
- Create: `src/hooks/useReadReceipts.ts`
- Test: `src/__tests__/useReadReceipts.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`READ_RECEIPT_KIND`, `buildReadReceiptEvent`, `parseReadReceiptEvent`, `shouldSendReceipt`), Task 2 (`readReceiptsEnabled`, `setPeerReadUntil`), existing `subscribeEvents` / `publishEvent` from `src/lib/nostr.ts`, `useReadRelays` from `src/hooks/useRelays.ts`, `getSigner` from `src/lib/signer.ts`.
- Produces: `useReadReceipts(peerPubkey: string, active?: boolean): void` — mounted by the DM thread (Task 5). `active=false` suppresses sending (used for pending message requests).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/useReadReceipts.test.tsx`:

```tsx
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Event, Filter } from 'nostr-tools'

const publishEvent = vi.fn(async () => {})
const subscribeEvents = vi.fn(() => ({ close: vi.fn() }))
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    publishEvent: (...a: unknown[]) => publishEvent(...(a as [])),
    subscribeEvents: (...a: unknown[]) => subscribeEvents(...(a as [])),
  }
})

import { useReadReceipts } from '../hooks/useReadReceipts'
import { useNostrStore } from '../store/nostrStore'
import { installTestSigner } from '../test/signer'
import { clearSigner, getSigner } from '../lib/signer'
import { READ_RECEIPT_KIND } from '../lib/readReceipts'
import { generateKeys } from '../lib/nostr'

const PEER = generateKeys().pk

beforeEach(() => {
  vi.clearAllMocks()
  installTestSigner()
  const me = getSigner()!.pubkey
  useNostrStore.setState({
    publicKey: me,
    readReceiptsEnabled: true,
    readUntilByPeer: {},
    relays: ['wss://test.example'],
    relayModes: {},
    messages: {
      [PEER]: [
        { id: 'a', pubkey: PEER, content: 'hi', createdAt: 100, tags: [], kind: 4 },
        { id: 'b', pubkey: me, content: 'yo', createdAt: 150, tags: [], kind: 4 },
      ],
    },
  })
})
afterEach(() => clearSigner())

it('publishes an encrypted 24102 watermark for the newest received message', async () => {
  renderHook(() => useReadReceipts(PEER))
  await waitFor(() => expect(publishEvent).toHaveBeenCalledTimes(1))
  const event = publishEvent.mock.calls[0][1] as Event
  expect(event.kind).toBe(READ_RECEIPT_KIND)
  expect(event.tags).toEqual([['p', PEER]])
  expect(event.content).not.toContain('read_until')
})

it('subscribes to the peer receipt filter when enabled', () => {
  renderHook(() => useReadReceipts(PEER))
  const me = getSigner()!.pubkey
  expect(subscribeEvents).toHaveBeenCalledWith(
    expect.anything(),
    { kinds: [READ_RECEIPT_KIND], authors: [PEER], '#p': [me] },
    expect.any(Function),
  )
})

it('does nothing when the setting is off', async () => {
  useNostrStore.setState({ readReceiptsEnabled: false })
  renderHook(() => useReadReceipts(PEER))
  await new Promise(r => setTimeout(r, 50))
  expect(publishEvent).not.toHaveBeenCalled()
  expect(subscribeEvents).not.toHaveBeenCalled()
})

it('does not send when inactive (pending message request)', async () => {
  renderHook(() => useReadReceipts(PEER, false))
  await new Promise(r => setTimeout(r, 50))
  expect(publishEvent).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/useReadReceipts.test.tsx`
Expected: FAIL — cannot resolve `../hooks/useReadReceipts`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useReadReceipts.ts`:

```ts
import { useEffect, useRef } from 'react'
import { subscribeEvents, publishEvent } from '../lib/nostr'
import {
  READ_RECEIPT_KIND,
  buildReadReceiptEvent,
  parseReadReceiptEvent,
  shouldSendReceipt,
} from '../lib/readReceipts'
import { useNostrStore } from '../store/nostrStore'
import { useReadRelays } from './useRelays'
import { getSigner } from '../lib/signer'

const THROTTLE_MS = 10_000  // at most one receipt per 10 s per peer

/**
 * Read receipts for an open DM thread (opt-in, reciprocal; DMs only).
 *
 * Send side: publishes an encrypted ephemeral "read up to X" watermark when
 * the thread is mounted, the tab is visible, and the newest received message
 * is newer than the last watermark sent.
 *
 * Receive side: subscribes to the peer's watermarks and stores the max per
 * peer via setPeerReadUntil. Skipped entirely when the setting is off.
 *
 * `active=false` suppresses sending (e.g. pending message requests).
 */
export function useReadReceipts(peerPubkey: string, active = true) {
  const publicKey = useNostrStore(s => s.publicKey)
  const enabled = useNostrStore(s => s.readReceiptsEnabled)
  const setPeerReadUntil = useNostrStore(s => s.setPeerReadUntil)
  const newestReceivedAt = useNostrStore(s => {
    const msgs = s.messages[peerPubkey]
    if (!msgs) return undefined
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].pubkey === peerPubkey) return msgs[i].createdAt
    }
    return undefined
  })
  const readR = useReadRelays()
  const lastSentWatermark = useRef(0)
  const lastSentAt = useRef(0)

  // Receive side: peer watermarks -> store. Reciprocity: ignored when off.
  useEffect(() => {
    if (!publicKey || !enabled) return
    const sub = subscribeEvents(
      readR,
      { kinds: [READ_RECEIPT_KIND], authors: [peerPubkey], '#p': [publicKey] },
      (event) => {
        void parseReadReceiptEvent(event).then(readUntil => {
          if (readUntil !== null) setPeerReadUntil(peerPubkey, readUntil)
        })
      },
    )
    return () => sub.close()
  }, [publicKey, peerPubkey, enabled, readR, setPeerReadUntil])

  // Send side: watermark when visible and new peer messages arrived.
  useEffect(() => {
    if (!active || !publicKey || !getSigner()) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const maybeSend = () => {
      const visible = document.visibilityState === 'visible'
      if (!shouldSendReceipt({ enabled, visible, newestReceivedAt, lastSent: lastSentWatermark.current })) return
      const wait = THROTTLE_MS - (Date.now() - lastSentAt.current)
      if (wait > 0) {
        clearTimeout(timer)
        timer = setTimeout(maybeSend, wait)
        return
      }
      const watermark = newestReceivedAt as number
      lastSentWatermark.current = watermark
      lastSentAt.current = Date.now()
      void (async () => {
        const event = await buildReadReceiptEvent(peerPubkey, watermark)
        void publishEvent(useNostrStore.getState().writeRelays(), event)
      })()
    }

    maybeSend()
    document.addEventListener('visibilitychange', maybeSend)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', maybeSend)
    }
  }, [active, publicKey, enabled, peerPubkey, newestReceivedAt])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/useReadReceipts.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useReadReceipts.ts src/__tests__/useReadReceipts.test.tsx
git commit -m "feat: useReadReceipts hook (send watermark, receive peer receipts)"
```

---

### Task 4: Read ticks in MessageItem

**Files:**
- Modify: `src/components/Chat/MessageItem.tsx` (StatusIndicator ~line 234, own-message render ~line 442, lucide import line 4)
- Test: `src/__tests__/MessageItem.readReceipts.test.tsx`

**Interfaces:**
- Consumes: Task 2 store state (`readReceiptsEnabled`, `readUntilByPeer`); `message.recipientPubkey` identifies the DM peer on own messages.
- Produces: `StatusIndicator` gains an optional `read?: boolean` prop; a sent+read own DM message renders a `CheckCheck` icon with `aria-label="Read"`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/MessageItem.readReceipts.test.tsx`:

```tsx
import { it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageItem } from '../components/Chat/MessageItem'
import { useNostrStore } from '../store/nostrStore'
import type { Message } from '../store/nostrStore'

const PEER = 'peer'.padEnd(64, '2')
const ME = 'me'.padEnd(64, '1')
const noop = () => {}

function ownDM(createdAt: number): Message {
  return { id: 'm1', pubkey: ME, content: 'hi', createdAt, tags: [], kind: 4, recipientPubkey: PEER, status: 'sent' }
}

beforeEach(() => {
  useNostrStore.setState({
    readReceiptsEnabled: true,
    readUntilByPeer: {},
    reactions: {},
    deletedMessages: {},
    editedMessages: {},
  })
})

it('shows a read tick when the peer watermark covers the message', () => {
  useNostrStore.setState({ readUntilByPeer: { [PEER]: 1000 } })
  render(<MessageItem message={ownDM(900)} isOwn={true} showAvatar={false} onReply={noop} />)
  expect(screen.getByLabelText('Read')).toBeInTheDocument()
})

it('shows a plain sent tick when the watermark is older than the message', () => {
  useNostrStore.setState({ readUntilByPeer: { [PEER]: 1000 } })
  render(<MessageItem message={ownDM(1100)} isOwn={true} showAvatar={false} onReply={noop} />)
  expect(screen.queryByLabelText('Read')).toBeNull()
})

it('shows no read tick when receipts are disabled (reciprocity)', () => {
  useNostrStore.setState({ readReceiptsEnabled: false, readUntilByPeer: { [PEER]: 1000 } })
  render(<MessageItem message={ownDM(900)} isOwn={true} showAvatar={false} onReply={noop} />)
  expect(screen.queryByLabelText('Read')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/MessageItem.readReceipts.test.tsx`
Expected: FAIL — `getByLabelText('Read')` finds nothing.

- [ ] **Step 3: Implement**

In `src/components/Chat/MessageItem.tsx`:

3a. Add `CheckCheck` to the lucide-react import (line 4), next to `Check`.

3b. Extend `StatusIndicator`:

```tsx
function StatusIndicator({ status, read, onRetry, msgId }: {
  status?: 'sending' | 'sent' | 'failed'
  read?: boolean
  onRetry?: (id: string) => void
  msgId: string
}) {
  if (status === 'sending') {
    return <Loader2 size={12} className="text-gray-500 animate-spin flex-shrink-0 mb-1" />
  }
  if (status === 'failed') {
    return (
      <button
        onClick={() => onRetry?.(msgId)}
        title="Failed — tap to retry"
        className="flex-shrink-0 mb-1"
      >
        <AlertCircle size={13} className="text-red-400" />
      </button>
    )
  }
  if (status === 'sent') {
    if (read) {
      return <CheckCheck size={13} aria-label="Read" className="text-purple-400 flex-shrink-0 mb-1" />
    }
    return <Check size={12} className="text-gray-500 flex-shrink-0 mb-1" />
  }
  return null
}
```

3c. In the `MessageItem` component body (near the other store reads, ~line 264), derive read state:

```tsx
  const readUntil = useNostrStore(s =>
    isOwn && s.readReceiptsEnabled && message.recipientPubkey
      ? s.readUntilByPeer[message.recipientPubkey]
      : undefined)
  const isRead = readUntil !== undefined && message.createdAt <= readUntil
```

3d. In the own-message render (~line 442), pass it through:

```tsx
          <StatusIndicator status={message.status} read={isRead} onRetry={onRetry} msgId={message.id} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/MessageItem.readReceipts.test.tsx src/__tests__/MessageItem.remote.test.tsx`
Expected: PASS (new tests pass, remote-attachment tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/MessageItem.tsx src/__tests__/MessageItem.readReceipts.test.tsx
git commit -m "feat: render read tick on own DM messages covered by peer watermark"
```

---

### Task 5: Wire into DM thread and Privacy tab

**Files:**
- Modify: `src/components/Chat/MessageThread.tsx` (DMThread, ~line 628)
- Modify: `src/components/Settings/NotificationsTab.tsx` (export Toggle, line 13)
- Modify: `src/components/Settings/PrivacyTab.tsx`
- Test: `src/__tests__/PrivacyTab.test.tsx`

**Interfaces:**
- Consumes: Task 3 `useReadReceipts(peerPubkey, active)`, Task 2 `readReceiptsEnabled` / `setReadReceiptsEnabled`, existing `Toggle` component from NotificationsTab (props: `checked: boolean; onChange: (v: boolean) => void; label: string; sublabel?: string`).
- Produces: user-facing feature complete.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/PrivacyTab.test.tsx`:

```tsx
import { it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PrivacyTab } from '../components/Settings/PrivacyTab'
import { useNostrStore } from '../store/nostrStore'

beforeEach(() => {
  useNostrStore.setState({
    readReceiptsEnabled: false,
    blockedPubkeys: [],
    profiles: {},
  })
})

it('renders the read receipts toggle off by default', () => {
  render(<PrivacyTab />)
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
})

it('toggles readReceiptsEnabled in the store', () => {
  render(<PrivacyTab />)
  fireEvent.click(screen.getByRole('switch'))
  expect(useNostrStore.getState().readReceiptsEnabled).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/PrivacyTab.test.tsx`
Expected: FAIL — no element with role `switch`.

- [ ] **Step 3: Implement**

3a. In `src/components/Settings/NotificationsTab.tsx` line 13, change `function Toggle({` to `export function Toggle({`.

3b. In `src/components/Settings/PrivacyTab.tsx`, import the toggle and add the section above "Blocked users":

```tsx
import { useNostrStore } from '../../store/nostrStore'
import { Avatar } from '../Chat/Avatar'
import { getDisplayName } from '../../lib/fileUtils'
import { Toggle } from './NotificationsTab'

export function PrivacyTab() {
  const { blockedPubkeys, profiles, unblockPubkey, readReceiptsEnabled, setReadReceiptsEnabled } = useNostrStore()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1">Read receipts</h2>
        <Toggle
          checked={readReceiptsEnabled}
          onChange={setReadReceiptsEnabled}
          label="Send read receipts"
          sublabel="When on, contacts see when you read their direct messages, and you see theirs. Off means neither."
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-white mb-1">Blocked users</h2>
        {/* ...existing blocked-users content unchanged... */}
```

(The rest of the component stays exactly as it is.)

3c. In `src/components/Chat/MessageThread.tsx`, inside `DMThread` directly after the `useTypingIndicator` line (~628), add:

```tsx
  useReadReceipts(theirPubkey, !isPending)
```

and add the import at the top of the file:

```tsx
import { useReadReceipts } from '../../hooks/useReadReceipts'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/PrivacyTab.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Full verification**

Run: `npm test`
Expected: entire suite PASS.

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: `tsc -b` and vite build succeed.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat/MessageThread.tsx src/components/Settings/NotificationsTab.tsx src/components/Settings/PrivacyTab.tsx src/__tests__/PrivacyTab.test.tsx
git commit -m "feat: opt-in read receipts toggle and DM thread wiring"
```

---

## Manual verification (after all tasks)

Requires two accounts in two browser profiles connected to a live relay:

1. Enable "Send read receipts" in Privacy on both accounts.
2. A sends B a DM; B opens the conversation while A watches — A's message should switch from single check to purple double-check within ~10 s.
3. Disable the toggle on A; B reads a new message — A should see no read tick (reciprocity).
4. Reload A after a receipt arrived — the read tick should persist.
