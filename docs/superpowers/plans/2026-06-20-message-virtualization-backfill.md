# Scalable Message History (Virtualization + Backfill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make large chats performant and full history reachable by virtualizing the message list, capping the in-memory window, and paging older messages from local Dexie then relays.

**Architecture:** Replace `MessageList`'s render-every-message loop with the free `react-virtuoso` `Virtuoso` component. A `useChatHistory` hook pages older messages (Dexie first, then relays via `until` filters) on scroll-up, prepending into the Zustand store with `firstItemIndex` scroll anchoring. Pure helpers (`messageRows.ts`, `history.ts`) carry the testable logic; the Virtuoso wrapper stays thin.

**Tech Stack:** TypeScript, React 19, Zustand, Dexie, nostr-tools, react-virtuoso (free `Virtuoso` component only), Vitest, fake-indexeddb.

## Global Constraints

- No emojis in code, comments, or documentation.
- Use ONLY the free MIT `Virtuoso` component from `react-virtuoso`. Do NOT use `@virtuoso.dev/message-list` (it requires a `licenseKey`).
- Prefer immutability; mutate store state only through store actions.
- Pagination constants live in `src/lib/pagination.ts`: `INITIAL_PAGE = 50`, `OLDER_PAGE = 50`, `MAX_JUMP_PAGES = 20`, `START_INDEX = 1_000_000`.
- DM `until` backfill needs TWO filters (sent + received); channel/group need one with the correct kinds.
- `exhausted` is set ONLY by a successful, empty relay response (or a relay round that adds zero new messages) — NEVER by a thrown error.
- Mobile/PWA: `Virtuoso` must flex inside the existing flex-column layout with no fixed pixel heights.
- Existing MessageThread, Sidebar, store, inbox, and db tests must stay green.

---

## Phase 1 — Virtualize rendering

### Task 1: Pure row-decoration helper

**Files:**
- Create: `src/lib/messageRows.ts`
- Test: `src/__tests__/messageRows.test.ts`

**Interfaces:**
- Produces: `decorateRow(msg: Message, prevMsg: Message | undefined, dividerTimestamp: number | undefined, myPubkey: string): { showDateSeparator: boolean; showDivider: boolean; showAvatar: boolean }` and `sameDay(aSec: number, bSec: number): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/messageRows.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { decorateRow, sameDay } from '../lib/messageRows'
import type { Message } from '../store/nostrStore'

const ME = 'me'.padEnd(64, '0')
const THEM = 'them'.padEnd(64, '1')

function msg(over: Partial<Message>): Message {
  return { id: 'x', pubkey: THEM, content: 'hi', createdAt: 1000, tags: [], kind: 42, ...over }
}

// 2024-01-01 12:00:00Z and same-day later; next day
const DAY1_NOON = Math.floor(Date.parse('2024-01-01T12:00:00Z') / 1000)
const DAY1_LATER = Math.floor(Date.parse('2024-01-01T18:00:00Z') / 1000)
const DAY2 = Math.floor(Date.parse('2024-01-02T09:00:00Z') / 1000)

describe('sameDay', () => {
  it('is true within a day and false across days', () => {
    expect(sameDay(DAY1_NOON, DAY1_LATER)).toBe(true)
    expect(sameDay(DAY1_NOON, DAY2)).toBe(false)
  })
})

describe('decorateRow', () => {
  it('shows a date separator for the first message and on day change', () => {
    expect(decorateRow(msg({ createdAt: DAY1_NOON }), undefined, undefined, ME).showDateSeparator).toBe(true)
    expect(decorateRow(msg({ createdAt: DAY2 }), msg({ createdAt: DAY1_LATER }), undefined, ME).showDateSeparator).toBe(true)
    expect(decorateRow(msg({ createdAt: DAY1_LATER }), msg({ createdAt: DAY1_NOON }), undefined, ME).showDateSeparator).toBe(false)
  })

  it('shows the divider only on the first message strictly newer than dividerTimestamp', () => {
    const prev = msg({ createdAt: 1000 })
    const cur = msg({ createdAt: 2000 })
    expect(decorateRow(cur, prev, 1500, ME).showDivider).toBe(true)
    // previous already past the divider -> not the boundary
    expect(decorateRow(msg({ createdAt: 3000 }), msg({ createdAt: 2000 }), 1500, ME).showDivider).toBe(false)
    // no divider timestamp
    expect(decorateRow(cur, prev, undefined, ME).showDivider).toBe(false)
  })

  it('hides the avatar for own messages and consecutive same-sender, shows it after a date change', () => {
    expect(decorateRow(msg({ pubkey: ME }), undefined, undefined, ME).showAvatar).toBe(false)
    expect(decorateRow(msg({ pubkey: THEM, createdAt: DAY1_LATER }), msg({ pubkey: THEM, createdAt: DAY1_NOON }), undefined, ME).showAvatar).toBe(false)
    expect(decorateRow(msg({ pubkey: THEM, createdAt: DAY2 }), msg({ pubkey: THEM, createdAt: DAY1_LATER }), undefined, ME).showAvatar).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/messageRows.test.ts`
Expected: FAIL — `src/lib/messageRows.ts` does not exist (import error).

- [ ] **Step 3: Implement the helper**

Create `src/lib/messageRows.ts`:

```ts
import type { Message } from '../store/nostrStore'

export function sameDay(aSec: number, bSec: number): boolean {
  return new Date(aSec * 1000).toDateString() === new Date(bSec * 1000).toDateString()
}

export interface RowDecoration {
  showDateSeparator: boolean
  showDivider: boolean
  showAvatar: boolean
}

/**
 * Per-row display flags for the message list. Pure: depends only on the message,
 * its predecessor, the unread-divider timestamp, and the local pubkey.
 */
export function decorateRow(
  msg: Message,
  prevMsg: Message | undefined,
  dividerTimestamp: number | undefined,
  myPubkey: string,
): RowDecoration {
  const showDateSeparator = !prevMsg || !sameDay(prevMsg.createdAt, msg.createdAt)
  const showDivider =
    dividerTimestamp !== undefined &&
    msg.createdAt > dividerTimestamp &&
    (!prevMsg || prevMsg.createdAt <= dividerTimestamp)
  const showAvatar =
    msg.pubkey !== myPubkey && (showDateSeparator || msg.pubkey !== prevMsg?.pubkey)
  return { showDateSeparator, showDivider, showAvatar }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/messageRows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/messageRows.ts src/__tests__/messageRows.test.ts
git commit -m "feat: pure row-decoration helper for message list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Extract and virtualize MessageList

**Files:**
- Create: `src/components/Chat/MessageList.tsx`
- Test: `src/__tests__/MessageList.test.tsx`
- Modify: `src/components/Chat/MessageThread.tsx` (remove the inner `MessageList`, `DateSeparator`, `NewMessagesDivider`, `NEAR_BOTTOM_PX`; import the new `MessageList`)
- Dependency: add `react-virtuoso`

**Interfaces:**
- Consumes: `decorateRow` from `../../lib/messageRows`.
- Produces: `export function MessageList(props: { messages: Message[]; myPubkey: string; profiles: Record<string, { name?: string; display_name?: string; picture?: string; pubkey: string }>; onReply: (m: Message) => void; onRetry: (id: string) => void; dividerTimestamp?: number; targetMessageId?: string }): JSX.Element`. (Same prop shape the three thread wrappers already pass.)

- [ ] **Step 1: Install react-virtuoso**

Run: `npm install react-virtuoso`
Then verify it resolves with React 19 and the build types are intact:
Run: `npx tsc --noEmit`
Expected: PASS (no peer-dependency error blocking install; types resolve). If npm reports a React 19 peer conflict, stop and report — do not force-install.

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/MessageList.test.tsx`. It mocks `react-virtuoso` with a passthrough that renders every item through `itemContent`, so the component's row composition is testable in jsdom:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Message } from '../store/nostrStore'

// Passthrough mock: render all items so itemContent runs in jsdom.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data: Message[]; itemContent: (i: number, m: Message) => React.ReactNode }) => (
    <div data-testid="virtuoso">{data.map((m, i) => <div key={m.id}>{itemContent(i, m)}</div>)}</div>
  ),
}))

import { MessageList } from '../components/Chat/MessageList'

const ME = 'me'.padEnd(64, '0')
const THEM = 'them'.padEnd(64, '1')

function msg(over: Partial<Message>): Message {
  return { id: Math.random().toString(36), pubkey: THEM, content: 'hello', createdAt: 1000, tags: [], kind: 42, ...over }
}

const noop = () => {}

beforeEach(() => { vi.clearAllMocks() })

describe('MessageList', () => {
  it('shows the empty state when there are no messages', () => {
    render(<MessageList messages={[]} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} />)
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
  })

  it('renders each message content through itemContent', () => {
    const messages = [msg({ id: 'a', content: 'first' }), msg({ id: 'b', content: 'second' })]
    render(<MessageList messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} />)
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/MessageList.test.tsx`
Expected: FAIL — `src/components/Chat/MessageList.tsx` does not exist.

- [ ] **Step 4: Create the MessageList component**

Create `src/components/Chat/MessageList.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Wifi, ChevronDown } from 'lucide-react'
import { useNostrStore, type Message } from '../../store/nostrStore'
import { MessageItem } from './MessageItem'
import { decorateRow } from '../../lib/messageRows'

function NewMessagesDivider() {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-purple-500/40" />
      <span className="text-xs text-purple-400 font-semibold px-2 flex-shrink-0">New messages</span>
      <div className="flex-1 border-t border-purple-500/40" />
    </div>
  )
}

function DateSeparator({ date }: { date: Date }) {
  const label = (() => {
    const now = new Date()
    const d = new Date(date)
    if (d.toDateString() === now.toDateString()) return 'Today'
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  })()

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-gray-800" />
      <span className="text-xs text-gray-500 px-2">{label}</span>
      <div className="flex-1 border-t border-gray-800" />
    </div>
  )
}

export function MessageList({ messages, myPubkey, profiles, onReply, onRetry, dividerTimestamp, targetMessageId }: {
  messages: Message[]
  myPubkey: string
  profiles: Record<string, { name?: string; display_name?: string; picture?: string; pubkey: string }>
  onReply: (msg: Message) => void
  onRetry: (msgId: string) => void
  dividerTimestamp?: number
  targetMessageId?: string
}) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)
  const { clearTargetMessage } = useNostrStore()

  // Open at the first unread message when a divider exists, otherwise at the bottom.
  const initialIndex = (() => {
    if (dividerTimestamp !== undefined) {
      const i = messages.findIndex(m => m.createdAt > dividerTimestamp)
      if (i >= 0) return i
    }
    return messages.length - 1
  })()

  // Jump to a target message already in the window.
  useEffect(() => {
    if (!targetMessageId) return
    const idx = messages.findIndex(m => m.id === targetMessageId)
    if (idx < 0) return
    virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' })
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-message-id="${targetMessageId}"]`)
      if (el) {
        el.classList.add('message-highlight')
        el.addEventListener('animationend', () => el.classList.remove('message-highlight'), { once: true })
      }
      clearTargetMessage()
    })
  }, [targetMessageId, messages, clearTargetMessage])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-6">
          <Wifi size={40} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No messages yet. Say hello!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 relative min-h-0">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        style={{ height: '100%' }}
        className="scrollbar-thin"
        initialTopMostItemIndex={initialIndex}
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        atBottomStateChange={setAtBottom}
        increaseViewportBy={600}
        itemContent={(index, msg) => {
          const prev = messages[index - 1]
          const { showDateSeparator, showDivider, showAvatar } = decorateRow(msg, prev, dividerTimestamp, myPubkey)
          return (
            <div className="px-3">
              {showDateSeparator && <DateSeparator date={new Date(msg.createdAt * 1000)} />}
              {showDivider && <NewMessagesDivider />}
              <div className="py-0.5">
                <MessageItem
                  message={msg}
                  profile={profiles[msg.pubkey]}
                  isOwn={msg.pubkey === myPubkey}
                  showAvatar={showAvatar}
                  onReply={onReply}
                  onRetry={onRetry}
                />
              </div>
            </div>
          )
        }}
      />
      {!atBottom && (
        <button
          onClick={() => virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: 'end', behavior: 'smooth' })}
          className="absolute bottom-4 right-4 w-10 h-10 bg-gray-800/90 hover:bg-gray-700 border border-gray-700/50 rounded-full flex items-center justify-center shadow-lg transition-colors"
          aria-label="Scroll to bottom"
        >
          <ChevronDown size={20} className="text-white" />
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/MessageList.test.tsx`
Expected: PASS.

- [ ] **Step 6: Remove the old inner MessageList from MessageThread and import the new one**

In `src/components/Chat/MessageThread.tsx`:
- Delete the inner `function MessageList(...)` (the block currently spanning the `NEAR_BOTTOM_PX` constant through the end of that component), the `function DateSeparator(...)`, the `function NewMessagesDivider(...)`, and the `const NEAR_BOTTOM_PX = 120` line.
- Add at the top with the other imports:

```ts
import { MessageList } from './MessageList'
```

- Remove now-unused imports from `MessageThread.tsx`: `Wifi`, `ChevronDown` are still used elsewhere? `WifiOff` is used by the empty/placeholder states — keep it. Remove `Wifi` and `ChevronDown` from the lucide-react import ONLY if no remaining reference exists (search the file first). Keep `ArrowLeft`, `Hash`, `Lock`, `Users`, `Images`, etc. that the headers use.

The three thread wrappers already render `<MessageList messages={...} myPubkey={...} profiles={...} onReply={...} onRetry={...} dividerTimestamp={...} targetMessageId={...} />` — leave those call sites unchanged.

- [ ] **Step 7: Type-check, lint, and run the affected suites**

Run: `npx tsc --noEmit`
Expected: PASS — no unused-import or missing-reference errors.

Run: `npx vitest run src/__tests__/MessageList.test.tsx src/__tests__/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 8: Manual verification note**

The following are layout-dependent and cannot be asserted in jsdom — verify manually in the running app (`npm run dev`) on desktop and a mobile viewport before considering Phase 1 done: large channel scrolls smoothly; opening a chat lands at the bottom (or at the unread divider); the scroll-to-bottom button appears when scrolled up and works; jump-to-message from search highlights the target; a new incoming message sticks to bottom only when already at bottom.

- [ ] **Step 9: Commit**

```bash
git add src/components/Chat/MessageList.tsx src/components/Chat/MessageThread.tsx src/__tests__/MessageList.test.tsx package.json package-lock.json
git commit -m "feat: virtualize MessageList with react-virtuoso

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — Cap in-memory window + load older from Dexie

### Task 3: Pagination constants + Dexie paging helper

**Files:**
- Create: `src/lib/pagination.ts`
- Create: `src/lib/history.ts`
- Test: `src/__tests__/history.test.ts`

**Interfaces:**
- Produces: constants `INITIAL_PAGE`, `OLDER_PAGE`, `MAX_JUMP_PAGES`, `START_INDEX` in `pagination.ts`; `pageOlderFromDexie(chatId: string, before: number, limit: number): Promise<Message[]>` in `history.ts` (returns ascending). (`olderFilterFor` is added in Task 7.)

- [ ] **Step 1: Create the constants module**

Create `src/lib/pagination.ts`:

```ts
// Message-history pagination tunables. Kept dependency-free so any module can
// import them without risking an import cycle.
export const INITIAL_PAGE = 50
export const OLDER_PAGE = 50
export const MAX_JUMP_PAGES = 20
export const START_INDEX = 1_000_000
```

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/history.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openUserDb, closeUserDb, getUserDb } from '../lib/userDb'
import { messageToRecord } from '../lib/db'
import { pageOlderFromDexie } from '../lib/history'
import type { Message } from '../store/nostrStore'

const PK = 'a'.repeat(64)

function rec(id: string, createdAt: number): Message {
  return { id, pubkey: 'p', content: id, createdAt, tags: [], kind: 42 }
}

describe('pageOlderFromDexie', () => {
  beforeEach(async () => {
    openUserDb(PK)
    const db = getUserDb()!
    await db.messages.clear()
    for (let t = 1; t <= 10; t++) await db.messages.put(messageToRecord('chat', rec(`m${t}`, t)))
  })

  afterEach(async () => {
    const db = getUserDb()
    if (db) await db.messages.clear()
    closeUserDb()
  })

  it('returns up to `limit` messages older than `before`, ascending', async () => {
    const page = await pageOlderFromDexie('chat', 8, 3)
    expect(page.map(m => m.createdAt)).toEqual([5, 6, 7])
  })

  it('excludes the boundary message at exactly `before`', async () => {
    const page = await pageOlderFromDexie('chat', 5, 10)
    expect(page.map(m => m.createdAt)).toEqual([1, 2, 3, 4])
  })

  it('returns an empty array when nothing is older', async () => {
    expect(await pageOlderFromDexie('chat', 1, 10)).toEqual([])
  })

  it('returns an empty array when the DB is closed', async () => {
    closeUserDb()
    expect(await pageOlderFromDexie('chat', 8, 3)).toEqual([])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/history.test.ts`
Expected: FAIL — `src/lib/history.ts` does not exist.

- [ ] **Step 4: Implement `pageOlderFromDexie`**

Create `src/lib/history.ts`:

```ts
import { getUserDb } from './userDb'
import { recordToMessage } from './db'
import type { Message } from '../store/nostrStore'

/**
 * Older messages from local Dexie with createdAt strictly less than `before`,
 * newest-first limited to `limit`, returned in ascending order for prepending.
 */
export async function pageOlderFromDexie(
  chatId: string,
  before: number,
  limit: number,
): Promise<Message[]> {
  const db = getUserDb()
  if (!db) return []
  const records = await db.messages
    .where('[chatId+createdAt]')
    .between([chatId, -Infinity], [chatId, before], true, false)
    .reverse()
    .limit(limit)
    .toArray()
  return records.map(recordToMessage).reverse()
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/history.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pagination.ts src/lib/history.ts src/__tests__/history.test.ts
git commit -m "feat: pagination constants and Dexie older-page helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Cap initial load + prependMessages action

**Files:**
- Modify: `src/store/nostrStore.ts` (`setActiveChat` body; add `prependMessages` action + its type in `NostrState`)
- Test: `src/__tests__/store.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `INITIAL_PAGE` from `../lib/pagination`.
- Produces: store action `prependMessages: (chatId: string, msgs: Message[]) => void`; `setActiveChat` loads at most `INITIAL_PAGE` recent messages from Dexie.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/store.test.ts` (uses fake-indexeddb via the existing test env; open a DB so persistence paths run):

```ts
import { openUserDb, closeUserDb, getUserDb } from '../lib/userDb'
import { messageToRecord } from '../lib/db'
import type { Message } from '../store/nostrStore'

describe('prependMessages', () => {
  it('prepends older messages, dedups by id, and keeps ascending order', () => {
    const m = (id: string, t: number): Message => ({ id, pubkey: 'p', content: id, createdAt: t, tags: [], kind: 42 })
    useNostrStore.setState({ messages: { chat: [m('c', 3), m('d', 4)] } })
    useNostrStore.getState().prependMessages('chat', [m('a', 1), m('b', 2), m('c', 3)])
    const ids = useNostrStore.getState().messages['chat'].map(x => x.id)
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })

  it('is a no-op for an empty input', () => {
    useNostrStore.setState({ messages: { chat: [] } })
    useNostrStore.getState().prependMessages('chat', [])
    expect(useNostrStore.getState().messages['chat']).toEqual([])
  })
})

describe('setActiveChat initial load cap', () => {
  const PK = 'b'.repeat(64)
  beforeEach(async () => {
    openUserDb(PK)
    const db = getUserDb()!
    await db.messages.clear()
    for (let t = 1; t <= 120; t++) {
      await db.messages.put(messageToRecord('chatX', { id: `n${t}`, pubkey: 'p', content: `n${t}`, createdAt: t, tags: [], kind: 42 }))
    }
    useNostrStore.setState({ messages: {}, contacts: [], channels: [], groups: [] })
  })
  afterEach(async () => {
    const db = getUserDb()
    if (db) await db.messages.clear()
    closeUserDb()
  })

  it('loads only the most recent INITIAL_PAGE messages, ascending', async () => {
    useNostrStore.getState().setActiveChat('chatX', 'channel')
    // setActiveChat loads asynchronously; wait a microtask-tick for the Dexie promise
    await new Promise(r => setTimeout(r, 0))
    const loaded = useNostrStore.getState().messages['chatX'] || []
    expect(loaded).toHaveLength(50)
    expect(loaded[0].createdAt).toBe(71)
    expect(loaded[loaded.length - 1].createdAt).toBe(120)
  })
})
```

Add `afterEach` import if not present (the file already imports `beforeEach`; add `afterEach` to the vitest import).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/store.test.ts -t "prependMessages"`
Expected: FAIL — `prependMessages` is not a function.

Run: `npx vitest run src/__tests__/store.test.ts -t "initial load cap"`
Expected: FAIL — `setActiveChat` loads all 120, not 50.

- [ ] **Step 3: Add the import and the `prependMessages` type**

In `src/store/nostrStore.ts`:
- Add near the existing `../lib/db` import:

```ts
import { INITIAL_PAGE } from '../lib/pagination'
```

- In the `NostrState` interface, next to `addMessage: (chatId: string, message: Message) => void`, add:

```ts
  prependMessages: (chatId: string, msgs: Message[]) => void
```

- [ ] **Step 4: Implement `prependMessages` and cap `setActiveChat`**

In `src/store/nostrStore.ts`, add the action next to `addMessage`:

```ts
        prependMessages: (chatId, msgs) => {
          if (msgs.length === 0) return
          const existing = get().messages[chatId] || []
          const existingIds = new Set(existing.map(m => m.id))
          const fresh = msgs.filter(m => !existingIds.has(m.id))
          if (fresh.length === 0) return
          const merged = [...fresh, ...existing].sort((a, b) => a.createdAt - b.createdAt)
          set({ messages: { ...get().messages, [chatId]: merged } })
        },
```

Replace the Dexie load inside `setActiveChat` (the `db.messages.where('[chatId+createdAt]').between([id, -Infinity], [id, Infinity]).toArray().then(...)` block) with a capped, newest-first query:

```ts
            void db.messages
              .where('[chatId+createdAt]')
              .between([id, -Infinity], [id, Infinity])
              .reverse()
              .limit(INITIAL_PAGE)
              .toArray()
              .then(records => {
                if (records.length === 0) return
                const existing = get().messages[id] || []
                const existingIds = new Set(existing.map(m => m.id))
                const fresh = records.map(recordToMessage).filter(m => !existingIds.has(m.id))
                if (fresh.length === 0) return
                const merged = [...existing, ...fresh].sort((a, b) => a.createdAt - b.createdAt)
                set({ messages: { ...get().messages, [id]: merged } })
              })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/store.test.ts`
Expected: PASS — both new blocks green and all existing store tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/store/nostrStore.ts src/__tests__/store.test.ts
git commit -m "feat: cap initial chat load and add prependMessages action

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: useChatHistory hook (Dexie-only load-older)

**Files:**
- Create: `src/hooks/useChatHistory.ts`
- Test: `src/__tests__/useChatHistory.test.tsx`

**Interfaces:**
- Consumes: `pageOlderFromDexie` from `../lib/history`; `OLDER_PAGE` from `../lib/pagination`; store action `prependMessages`.
- Produces: `useChatHistory(chatId: string, chatType: 'dm' | 'channel' | 'group', myPubkey: string): { loadOlder: () => Promise<number>; loading: boolean; exhausted: boolean }`. `loadOlder` returns the number of messages prepended. (Relay fallback is added in Task 8.)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/useChatHistory.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { openUserDb, closeUserDb, getUserDb } from '../lib/userDb'
import { messageToRecord } from '../lib/db'
import { useNostrStore } from '../store/nostrStore'
import { useChatHistory } from '../hooks/useChatHistory'
import type { Message } from '../store/nostrStore'

const PK = 'c'.repeat(64)
const m = (id: string, t: number): Message => ({ id, pubkey: 'p', content: id, createdAt: t, tags: [], kind: 42 })

describe('useChatHistory (Dexie load-older)', () => {
  beforeEach(async () => {
    openUserDb(PK)
    const db = getUserDb()!
    await db.messages.clear()
    // 1..10 persisted; window starts with 8,9,10 in memory
    for (let t = 1; t <= 10; t++) await db.messages.put(messageToRecord('chat', m(`m${t}`, t)))
    useNostrStore.setState({ relays: ['wss://r'], messages: { chat: [m('m8', 8), m('m9', 9), m('m10', 10)] } })
  })
  afterEach(async () => {
    const db = getUserDb()
    if (db) await db.messages.clear()
    closeUserDb()
  })

  it('prepends an older page from Dexie and reports the count', async () => {
    const { result } = renderHook(() => useChatHistory('chat', 'channel', PK))
    let added = 0
    await act(async () => { added = await result.current.loadOlder() })
    expect(added).toBe(7) // createdAt 1..7 are all older than 8 and fit within OLDER_PAGE
    expect(useNostrStore.getState().messages['chat'][0].createdAt).toBe(1)
    expect(result.current.exhausted).toBe(false)
  })

  it('marks exhausted when Dexie has nothing older (relay added later)', async () => {
    useNostrStore.setState({ messages: { chat: [m('m1', 1), m('m2', 2)] } })
    const { result } = renderHook(() => useChatHistory('chat', 'channel', PK))
    await act(async () => { await result.current.loadOlder() })
    expect(result.current.exhausted).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/useChatHistory.test.tsx`
Expected: FAIL — `src/hooks/useChatHistory.ts` does not exist.

- [ ] **Step 3: Implement the Dexie-only hook**

Create `src/hooks/useChatHistory.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNostrStore } from '../store/nostrStore'
import { pageOlderFromDexie } from '../lib/history'
import { OLDER_PAGE } from '../lib/pagination'

export function useChatHistory(
  chatId: string,
  _chatType: 'dm' | 'channel' | 'group',
  _myPubkey: string,
) {
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const loadingRef = useRef(false)
  const exhaustedRef = useRef(false)

  useEffect(() => {
    setLoading(false)
    setExhausted(false)
    loadingRef.current = false
    exhaustedRef.current = false
  }, [chatId])

  const loadOlder = useCallback(async (): Promise<number> => {
    if (loadingRef.current || exhaustedRef.current) return 0
    loadingRef.current = true
    setLoading(true)
    try {
      const msgs = useNostrStore.getState().messages[chatId] || []
      const oldest = msgs[0]?.createdAt
      if (oldest === undefined) return 0

      const dexiePage = await pageOlderFromDexie(chatId, oldest, OLDER_PAGE)
      if (dexiePage.length === 0) {
        exhaustedRef.current = true
        setExhausted(true)
        return 0
      }
      const before = (useNostrStore.getState().messages[chatId] || []).length
      useNostrStore.getState().prependMessages(chatId, dexiePage)
      const after = (useNostrStore.getState().messages[chatId] || []).length
      return after - before
    } catch {
      return 0 // never exhaust on error
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [chatId])

  return { loadOlder, loading, exhausted }
}
```

(`_chatType` and `_myPubkey` are unused in Phase 2 and consumed by the relay path in Task 8; the underscore prefix documents that.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/useChatHistory.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useChatHistory.ts src/__tests__/useChatHistory.test.tsx
git commit -m "feat: useChatHistory hook with Dexie load-older

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire load-older into MessageList + lower live-sub limits

**Files:**
- Modify: `src/components/Chat/MessageList.tsx` (add `chatId`/`chatType` props; call `useChatHistory`; `firstItemIndex` + `startReached`)
- Modify: `src/components/Chat/MessageThread.tsx` (pass `chatId`/`chatType` to `MessageList` from all three thread wrappers)
- Modify: `src/hooks/useNostrSubscriptions.ts` (per-chat `limit: 200` -> `INITIAL_PAGE`)
- Test: `src/__tests__/MessageList.test.tsx` (extend the react-virtuoso mock to capture `startReached`/`firstItemIndex`)

**Interfaces:**
- Consumes: `useChatHistory` from `../../hooks/useChatHistory`; `START_INDEX` from `../../lib/pagination`.
- Produces: `MessageList` now requires `chatId: string` and `chatType: 'dm' | 'channel' | 'group'` props.

- [ ] **Step 1: Write the failing test**

Replace the `react-virtuoso` mock at the top of `src/__tests__/MessageList.test.tsx` so it records the props and exposes a trigger for `startReached`:

```tsx
let lastVirtuosoProps: Record<string, unknown> = {}
vi.mock('react-virtuoso', () => ({
  Virtuoso: (props: Record<string, unknown>) => {
    lastVirtuosoProps = props
    const data = props.data as Message[]
    const itemContent = props.itemContent as (i: number, m: Message) => React.ReactNode
    return <div data-testid="virtuoso">{data.map((m, i) => <div key={m.id}>{itemContent(i, m)}</div>)}</div>
  },
}))
```

Mock the hook so the test controls load-older:

```tsx
const loadOlder = vi.fn().mockResolvedValue(2)
vi.mock('../hooks/useChatHistory', () => ({
  useChatHistory: () => ({ loadOlder, loading: false, exhausted: false }),
}))
```

Add a test (the existing render calls must now pass `chatId="chat"` and `chatType="channel"`):

```tsx
it('calls loadOlder when startReached fires and decrements firstItemIndex', async () => {
  const messages = [msg({ id: 'a', createdAt: 1 }), msg({ id: 'b', createdAt: 2 })]
  render(<MessageList chatId="chat" chatType="channel" messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} />)
  const startReached = lastVirtuosoProps.startReached as (i: number) => void
  await act(async () => { await startReached(0) })
  expect(loadOlder).toHaveBeenCalledTimes(1)
  // firstItemIndex starts at START_INDEX and drops by the 2 prepended items
  expect(lastVirtuosoProps.firstItemIndex).toBe(1_000_000 - 2)
})
```

Import `act` from `@testing-library/react` and update the two existing render calls in this file to include `chatId="chat"` and `chatType="channel"`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/MessageList.test.tsx`
Expected: FAIL — `MessageList` does not accept `chatId`/`chatType`, does not set `firstItemIndex`/`startReached`.

- [ ] **Step 3: Add load-older wiring to MessageList**

In `src/components/Chat/MessageList.tsx`:
- Add imports:

```ts
import { useChatHistory } from '../../hooks/useChatHistory'
import { START_INDEX } from '../../lib/pagination'
```

- Add `chatId` and `chatType` to the props type:

```ts
  chatId: string
  chatType: 'dm' | 'channel' | 'group'
```

- Inside the component, before the return, add:

```ts
  const { loadOlder } = useChatHistory(chatId, chatType, myPubkey)
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX)

  const handleStartReached = async () => {
    const added = await loadOlder()
    if (added > 0) setFirstItemIndex(i => i - added)
  }

  // Reset the prepend anchor when switching chats.
  useEffect(() => { setFirstItemIndex(START_INDEX) }, [chatId])
```

- Add the two props to `<Virtuoso ...>`:

```tsx
        firstItemIndex={firstItemIndex}
        startReached={() => { void handleStartReached() }}
```

- [ ] **Step 4: Pass the new props from MessageThread**

In `src/components/Chat/MessageThread.tsx`, update the three `<MessageList .../>` usages:
- In `ChannelThread`: add `chatId={channelId} chatType="channel"`.
- In `DMThread`: add `chatId={theirPubkey} chatType="dm"`.
- In `GroupThread`: add `chatId={groupId} chatType="group"`.

- [ ] **Step 5: Lower the per-chat live subscription limits**

In `src/hooks/useNostrSubscriptions.ts`:
- Add import:

```ts
import { INITIAL_PAGE } from '../lib/pagination'
```

- In `useChannelMessages`, change `{ kinds: [42], '#e': [channelId], limit: 200 }` to use `limit: INITIAL_PAGE`.
- In `useDMMessages`, change BOTH `limit: 200` filters (sent + received) to `limit: INITIAL_PAGE`.
- In `useGroupMessages`, change `{ kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#e': [groupId], limit: 200 }` to `limit: INITIAL_PAGE`.
- Leave the `useGlobalInbox` limits (100 / 50) unchanged.

- [ ] **Step 6: Run tests + type-check**

Run: `npx vitest run src/__tests__/MessageList.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Manual verification note**

Verify in the running app: scrolling to the top of a long chat loads older messages without the viewport jumping (scroll position stays anchored on the message you were reading); this works on a mobile viewport with momentum scrolling; reaching the start of locally-stored history stops loading (until relay backfill lands in Phase 3).

- [ ] **Step 8: Commit**

```bash
git add src/components/Chat/MessageList.tsx src/components/Chat/MessageThread.tsx src/hooks/useNostrSubscriptions.ts src/__tests__/MessageList.test.tsx
git commit -m "feat: load older from Dexie on scroll-up with anchored prepend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3 — Relay backfill + jump-to-message across the window

### Task 7: olderFilterFor helper

**Files:**
- Modify: `src/lib/history.ts` (add `olderFilterFor` + the `ChatType` type)
- Test: `src/__tests__/history.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `GROUP_MESSAGE_KIND`, `LEGACY_GROUP_MESSAGE_KIND` from `./nostr`.
- Produces: `export type ChatType = 'dm' | 'channel' | 'group'`; `olderFilterFor(chatType: ChatType, chatId: string, myPubkey: string, until: number, limit: number): Filter[]`.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/history.test.ts`:

```ts
import { olderFilterFor } from '../lib/history'
import { GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND } from '../lib/nostr'

describe('olderFilterFor', () => {
  it('builds a single #e filter for channels', () => {
    expect(olderFilterFor('channel', 'chan', 'me', 1000, 50)).toEqual([
      { kinds: [42], '#e': ['chan'], until: 1000, limit: 50 },
    ])
  })

  it('builds a kinds filter for groups including the legacy kind', () => {
    expect(olderFilterFor('group', 'grp', 'me', 1000, 50)).toEqual([
      { kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#e': ['grp'], until: 1000, limit: 50 },
    ])
  })

  it('builds two directional filters for DMs', () => {
    expect(olderFilterFor('dm', 'them', 'me', 1000, 50)).toEqual([
      { kinds: [4], authors: ['me'], '#p': ['them'], until: 1000, limit: 50 },
      { kinds: [4], authors: ['them'], '#p': ['me'], until: 1000, limit: 50 },
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/history.test.ts -t "olderFilterFor"`
Expected: FAIL — `olderFilterFor` is not exported.

- [ ] **Step 3: Implement `olderFilterFor`**

In `src/lib/history.ts`, add at the top:

```ts
import type { Filter } from 'nostr-tools'
import { GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND } from './nostr'

export type ChatType = 'dm' | 'channel' | 'group'

export function olderFilterFor(
  chatType: ChatType,
  chatId: string,
  myPubkey: string,
  until: number,
  limit: number,
): Filter[] {
  if (chatType === 'channel') {
    return [{ kinds: [42], '#e': [chatId], until, limit }]
  }
  if (chatType === 'group') {
    return [{ kinds: [GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND], '#e': [chatId], until, limit }]
  }
  return [
    { kinds: [4], authors: [myPubkey], '#p': [chatId], until, limit },
    { kinds: [4], authors: [chatId], '#p': [myPubkey], until, limit },
  ]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/history.ts src/__tests__/history.test.ts
git commit -m "feat: olderFilterFor relay backfill filter builder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Relay fallback in useChatHistory

**Files:**
- Modify: `src/hooks/useChatHistory.ts` (relay branch when Dexie is empty)
- Test: `src/__tests__/useChatHistory.test.tsx` (add relay-path tests with mocked `fetchEvents` + processors)

**Interfaces:**
- Consumes: `olderFilterFor` from `../lib/history`; `fetchEvents` from `../lib/nostr`; `processChannelEvent`, `processDMEvent`, `processGroupEvent` from `../lib/inbox`.
- Produces: `loadOlder` now falls back to relays; `exhausted` becomes true only when the relay round returns zero events OR adds zero new in-memory messages; thrown errors never exhaust.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/useChatHistory.test.tsx`. Mock the relay + processor boundaries at the top of the file:

```tsx
import { vi } from 'vitest'

const fetchEvents = vi.fn()
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, fetchEvents: (...args: unknown[]) => fetchEvents(...args) }
})

// Processors append to the store; simulate that for the relay path.
const processChannelEvent = vi.fn(async (ev: { id: string; created_at: number }) => {
  const s = useNostrStore.getState()
  s.prependMessages('chat', [{ id: ev.id, pubkey: 'p', content: ev.id, createdAt: ev.created_at, tags: [], kind: 42 }])
})
vi.mock('../lib/inbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/inbox')>()
  return { ...actual, processChannelEvent: (...a: unknown[]) => processChannelEvent(a[0] as { id: string; created_at: number }) }
})
```

Then add tests (in these, Dexie has no older messages than the in-memory window, forcing the relay branch):

```tsx
it('falls back to relays when Dexie is empty and prepends fetched events', async () => {
  // window already holds the oldest local messages
  useNostrStore.setState({ messages: { chat: [m('m1', 1), m('m2', 2)] }, relays: ['wss://r'] })
  fetchEvents.mockResolvedValueOnce([{ id: 'r0', created_at: 0 }])
  const { result } = renderHook(() => useChatHistory('chat', 'channel', PK))
  let added = 0
  await act(async () => { added = await result.current.loadOlder() })
  expect(fetchEvents).toHaveBeenCalledTimes(1)
  expect(added).toBe(1)
  expect(useNostrStore.getState().messages['chat'][0].id).toBe('r0')
  expect(result.current.exhausted).toBe(false)
})

it('marks exhausted when relays return no events', async () => {
  useNostrStore.setState({ messages: { chat: [m('m1', 1)] }, relays: ['wss://r'] })
  fetchEvents.mockResolvedValueOnce([])
  const { result } = renderHook(() => useChatHistory('chat', 'channel', PK))
  await act(async () => { await result.current.loadOlder() })
  expect(result.current.exhausted).toBe(true)
})

it('does not exhaust when the relay fetch throws', async () => {
  useNostrStore.setState({ messages: { chat: [m('m1', 1)] }, relays: ['wss://r'] })
  fetchEvents.mockRejectedValueOnce(new Error('relay down'))
  const { result } = renderHook(() => useChatHistory('chat', 'channel', PK))
  await act(async () => { await result.current.loadOlder() })
  expect(result.current.exhausted).toBe(false)
})
```

Note: the existing Dexie `beforeEach` seeds ids `m1..m10`. For these relay tests the in-memory window must start at the oldest local message so the Dexie page is empty — each test sets `messages` explicitly as shown.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/useChatHistory.test.tsx -t "relays"`
Expected: FAIL — current hook sets `exhausted` whenever Dexie is empty and never calls `fetchEvents`.

- [ ] **Step 3: Implement the relay fallback**

In `src/hooks/useChatHistory.ts`:
- Update the signature to use the params (drop the underscores) and add imports:

```ts
import { pageOlderFromDexie, olderFilterFor } from '../lib/history'
import { OLDER_PAGE } from '../lib/pagination'
import { fetchEvents } from '../lib/nostr'
import { processChannelEvent, processDMEvent, processGroupEvent } from '../lib/inbox'
```

- Change the function signature to `useChatHistory(chatId: string, chatType: 'dm' | 'channel' | 'group', myPubkey: string)`.
- Read `relays` inside `loadOlder` from the store: `const relays = useNostrStore.getState().relays`.
- Replace the `if (dexiePage.length === 0) { exhausted... }` branch with:

```ts
      if (dexiePage.length > 0) {
        const before = (useNostrStore.getState().messages[chatId] || []).length
        useNostrStore.getState().prependMessages(chatId, dexiePage)
        const after = (useNostrStore.getState().messages[chatId] || []).length
        return after - before
      }

      // No local history older than the window: backfill from relays.
      const relays = useNostrStore.getState().relays
      const filters = olderFilterFor(chatType, chatId, myPubkey, oldest, OLDER_PAGE)
      const events = (await Promise.all(filters.map(f => fetchEvents(relays, f)))).flat()
      if (events.length === 0) {
        exhaustedRef.current = true
        setExhausted(true)
        return 0
      }
      const before = (useNostrStore.getState().messages[chatId] || []).length
      for (const ev of events) {
        if (chatType === 'channel') await processChannelEvent(ev, chatId, relays, { live: false })
        else if (chatType === 'group') {
          const key = useNostrStore.getState().groupKeys[chatId]
          if (key) await processGroupEvent(ev, chatId, key, relays, { live: false })
        } else await processDMEvent(ev, myPubkey, relays, { live: false })
      }
      const after = (useNostrStore.getState().messages[chatId] || []).length
      const added = after - before
      if (added === 0) {
        exhaustedRef.current = true
        setExhausted(true)
      }
      return added
```

- Update the `useCallback` dependency array to `[chatId, chatType, myPubkey]`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/useChatHistory.test.tsx`
Expected: PASS — Dexie-path tests from Task 5 and the new relay-path tests all green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useChatHistory.ts src/__tests__/useChatHistory.test.tsx
git commit -m "feat: relay until-backfill fallback in useChatHistory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Jump-to-message across the loaded window

**Files:**
- Modify: `src/components/Chat/MessageList.tsx` (load-older-until-found loop + inline not-found notice)
- Modify: `src/lib/history.ts` (add pure `indexOfMessage` helper)
- Test: `src/__tests__/history.test.ts` (test `indexOfMessage`); `src/__tests__/MessageList.test.tsx` (target found after paging; not-found notice)

**Interfaces:**
- Consumes: `MAX_JUMP_PAGES` from `../../lib/pagination`; `loadOlder`/`exhausted` from `useChatHistory`.
- Produces: `indexOfMessage(messages: Message[], id: string): number` in `history.ts`; jump resolution that pages older up to `MAX_JUMP_PAGES` then shows an inline notice.

- [ ] **Step 1: Write the failing test for `indexOfMessage`**

Add to `src/__tests__/history.test.ts`:

```ts
import { indexOfMessage } from '../lib/history'

describe('indexOfMessage', () => {
  const msgs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as unknown as import('../store/nostrStore').Message[]
  it('finds the index of a message by id', () => {
    expect(indexOfMessage(msgs, 'b')).toBe(1)
  })
  it('returns -1 when not present', () => {
    expect(indexOfMessage(msgs, 'z')).toBe(-1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/history.test.ts -t "indexOfMessage"`
Expected: FAIL — `indexOfMessage` is not exported.

- [ ] **Step 3: Implement `indexOfMessage`**

In `src/lib/history.ts` add:

```ts
import type { Message } from '../store/nostrStore'

export function indexOfMessage(messages: Message[], id: string): number {
  return messages.findIndex(m => m.id === id)
}
```

(If `Message` is already imported in the file, do not duplicate the import.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/__tests__/history.test.ts -t "indexOfMessage"`
Expected: PASS.

- [ ] **Step 5: Write the failing MessageList jump tests**

In `src/__tests__/MessageList.test.tsx`, extend the `useChatHistory` mock so `loadOlder` can grow the rendered window, and add tests. Replace the static hook mock with a controllable one:

```tsx
let exhausted = false
const loadOlder = vi.fn()
vi.mock('../hooks/useChatHistory', () => ({
  useChatHistory: () => ({ loadOlder, loading: false, exhausted }),
}))
```

Add tests:

```tsx
it('shows a not-found notice when the jump target never loads', async () => {
  exhausted = false
  loadOlder.mockResolvedValue(0) // paging yields nothing new
  const messages = [msg({ id: 'a', createdAt: 1 })]
  render(<MessageList chatId="chat" chatType="channel" messages={messages} myPubkey={ME} profiles={{}} onReply={noop} onRetry={noop} targetMessageId="missing" />)
  expect(await screen.findByText(/message not available/i)).toBeInTheDocument()
})
```

(A "target found after paging" assertion is layout-dependent for the actual scroll; the unit test asserts the notice path. The found-and-scroll path is covered by the manual verification note.)

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/__tests__/MessageList.test.tsx -t "not-found"`
Expected: FAIL — no not-found notice is rendered today.

- [ ] **Step 7: Implement the jump loop + notice in MessageList**

In `src/components/Chat/MessageList.tsx`:
- Add import:

```ts
import { MAX_JUMP_PAGES } from '../../lib/pagination'
```

- Pull `exhausted` from the hook: change to `const { loadOlder, exhausted } = useChatHistory(chatId, chatType, myPubkey)`.
- Add notice state: `const [jumpNotice, setJumpNotice] = useState(false)`.
- Replace the existing `targetMessageId` effect with a paging-aware version:

```ts
  useEffect(() => {
    if (!targetMessageId) return
    let cancelled = false

    const highlight = () => {
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-message-id="${targetMessageId}"]`)
        if (el) {
          el.classList.add('message-highlight')
          el.addEventListener('animationend', () => el.classList.remove('message-highlight'), { once: true })
        }
        clearTargetMessage()
      })
    }

    const resolve = async () => {
      for (let page = 0; page < MAX_JUMP_PAGES; page++) {
        if (cancelled) return
        const idx = useNostrStore.getState().messages[chatId]?.findIndex(m => m.id === targetMessageId) ?? -1
        if (idx >= 0) {
          virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' })
          highlight()
          return
        }
        if (exhausted) break
        const added = await loadOlder()
        if (added === 0) break
      }
      if (!cancelled) {
        setJumpNotice(true)
        clearTargetMessage()
        setTimeout(() => setJumpNotice(false), 4000)
      }
    }
    void resolve()
    return () => { cancelled = true }
  }, [targetMessageId, chatId, exhausted, loadOlder, clearTargetMessage])
```

- Render the notice inside the outer `<div className="flex-1 relative min-h-0">`, above the scroll-to-bottom button:

```tsx
      {jumpNotice && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700/50 rounded-xl px-3 py-2 shadow-lg">
          <p className="text-xs text-gray-300">Message not available</p>
        </div>
      )}
```

Note: this effect reads the live window via `useNostrStore.getState()` each iteration (the prop `messages` is captured at effect start and would be stale across `await loadOlder()`).

- [ ] **Step 8: Run the MessageList suite**

Run: `npx vitest run src/__tests__/MessageList.test.tsx`
Expected: PASS — empty-state, render, startReached/firstItemIndex, and not-found tests all green.

- [ ] **Step 9: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS — entire suite green.

- [ ] **Step 10: Manual verification note**

Verify in the running app (desktop + mobile): searching for and jumping to a message older than the loaded window pages history until it appears, then scrolls to and highlights it; jumping to a truly missing id shows the "Message not available" notice and stops paging at the bound.

- [ ] **Step 11: Commit**

```bash
git add src/components/Chat/MessageList.tsx src/lib/history.ts src/__tests__/history.test.ts src/__tests__/MessageList.test.tsx
git commit -m "feat: jump-to-message pages history until the target loads

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Free `Virtuoso` only (no licensed package) → Global Constraints + Task 2 Step 1.
- Virtualize MessageList → Task 2.
- `firstItemIndex` + `startReached` prepend anchoring → Task 6.
- `initialTopMostItemIndex` opens at bottom / unread divider → Task 2 (`initialIndex`).
- `followOutput` sticky-bottom only when at bottom → Task 2.
- Scroll-to-bottom button via `atBottomStateChange` → Task 2.
- Date separator / divider / avatar via pure `decorateRow` → Task 1, used in Task 2.
- Cap initial in-memory load (`setActiveChat` → `INITIAL_PAGE`) → Task 4.
- `prependMessages` action → Task 4.
- Lower per-chat live-sub `limit` → Task 6 Step 5.
- `useChatHistory` (Dexie → relay → exhausted; error never exhausts; loading guard; reset on chat change) → Tasks 5 + 8.
- `pageOlderFromDexie` → Task 3; `olderFilterFor` (DM two filters; channel/group kinds) → Task 7.
- Relay backfill routes through existing processors → Task 8.
- Jump-to-message across window, bounded by `MAX_JUMP_PAGES`, inline notice → Task 9.
- Constants in `pagination.ts` → Task 3.
- Mobile/PWA (flex height, anchored prepend, startReached coalescing, manual verification) → Task 2/6/9 manual notes + `style={{ height: '100%' }}`.
- Testing limitations of jsdom stated → Task 2 Step 8 and throughout via the react-virtuoso passthrough mock.

All spec sections map to a task. No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows complete code; every run step shows the command and expected result.

**Type consistency:** `loadOlder(): Promise<number>` is defined in Task 5 and consumed with the same return type in Tasks 6 and 9. `useChatHistory(chatId, chatType, myPubkey)` signature is consistent across Tasks 5/6/8 (params unused until Task 8, prefixed with `_` in Task 5, de-underscored in Task 8). `prependMessages(chatId, msgs)` matches between Task 4 (definition) and Tasks 5/8 (use). `olderFilterFor`/`pageOlderFromDexie`/`indexOfMessage` signatures match their call sites. `MessageList` prop additions (`chatId`, `chatType`) are introduced in Task 6 and the MessageThread call sites are updated in the same task.
