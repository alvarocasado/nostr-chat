# Scoped Search: Individual Message Results — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show individual message results in a split layout below the conversation list when the user types in the Messages or Channels scoped search bars, with click-to-jump-to-message.

**Architecture:** Add `targetMessageId` to the store with a `jumpToMessage` action. `MessageList` scrolls to and highlights the target element on mount. Both scoped search panels compute a memoised message results list and render it below the conversation list using the existing `SearchResultItem`, extended with an optional `targetMessageId` prop.

**Tech Stack:** React, Zustand (nostrStore), Tailwind CSS, Vitest + Testing Library

---

### Task 1: Store — add `targetMessageId`, `jumpToMessage`, `clearTargetMessage`

**Files:**
- Modify: `src/store/nostrStore.ts` (interface ~line 160, initial state ~line 365, actions ~line 507)
- Test: `src/__tests__/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useNostrStore } from '../store/nostrStore'

describe('jumpToMessage / clearTargetMessage', () => {
  beforeEach(() => {
    useNostrStore.setState({ activeChatId: null, activeChatType: null, targetMessageId: null })
  })

  it('jumpToMessage sets activeChatId, activeChatType, and targetMessageId', () => {
    useNostrStore.getState().jumpToMessage('aaa', 'dm', 'msg-42')
    const s = useNostrStore.getState()
    expect(s.activeChatId).toBe('aaa')
    expect(s.activeChatType).toBe('dm')
    expect(s.targetMessageId).toBe('msg-42')
  })

  it('clearTargetMessage sets targetMessageId to null', () => {
    useNostrStore.setState({ targetMessageId: 'msg-42' })
    useNostrStore.getState().clearTargetMessage()
    expect(useNostrStore.getState().targetMessageId).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/store.test.ts
```

Expected: FAIL — `jumpToMessage is not a function` (or `targetMessageId` not in state)

- [ ] **Step 3: Add to the store interface** (`src/store/nostrStore.ts`, after line 160 `clearActiveChat`)

```ts
  targetMessageId: string | null

  jumpToMessage: (chatId: string, type: ChatType, messageId: string) => void
  clearTargetMessage: () => void
```

- [ ] **Step 4: Add to initial state** (`src/store/nostrStore.ts`, after `activeChatType: null,` ~line 366)

```ts
        targetMessageId: null,
```

- [ ] **Step 5: Add action implementations** (`src/store/nostrStore.ts`, after the `setActiveChat` implementation ~line 507)

```ts
        jumpToMessage: (chatId, type, messageId) => {
          get().setActiveChat(chatId, type)
          set({ targetMessageId: messageId })
        },

        clearTargetMessage: () => set({ targetMessageId: null }),
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/store.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/store/nostrStore.ts src/__tests__/store.test.ts
git commit -m "feat: add targetMessageId and jumpToMessage to store"
```

---

### Task 2: CSS — add highlight keyframe animation

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add the keyframe and utility class** to `src/index.css` inside the `@layer utilities` block, after `.pb-safe`:

```css
  @keyframes msg-highlight {
    0%   { box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.8); }
    100% { box-shadow: 0 0 0 2px rgba(167, 139, 250, 0); }
  }

  .message-highlight {
    border-radius: 10px;
    animation: msg-highlight 1.5s ease-out forwards;
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/index.css
git commit -m "feat: add message-highlight CSS animation"
```

---

### Task 3: MessageItem — add `data-message-id` attribute

**Files:**
- Modify: `src/components/Chat/MessageItem.tsx` (lines 272 and 294)

- [ ] **Step 1: Add the attribute to the own-message branch** (line 272). Change:

```tsx
      <div ref={rowRef} className="flex flex-col items-end gap-1 group">
```
to:
```tsx
      <div ref={rowRef} data-message-id={message.id} className="flex flex-col items-end gap-1 group">
```

- [ ] **Step 2: Add the attribute to the other-message branch** (line 294). Change:

```tsx
    <div ref={rowRef} className="flex items-end gap-2 group">
```
to:
```tsx
    <div ref={rowRef} data-message-id={message.id} className="flex items-end gap-2 group">
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/MessageItem.tsx
git commit -m "feat: add data-message-id attribute to MessageItem"
```

---

### Task 4: MessageList — scroll to target and apply highlight

**Files:**
- Modify: `src/components/Chat/MessageThread.tsx` (function `MessageList` ~line 473, and its two call sites at lines 665 and 759)

- [ ] **Step 1: Extend the `MessageList` props** (~line 473). Change the destructured params from:

```tsx
function MessageList({ messages, myPubkey, profiles, onReply, onRetry, dividerTimestamp }: {
  messages: Message[]
  myPubkey: string
  profiles: Record<string, { name?: string; display_name?: string; picture?: string; pubkey: string }>
  onReply: (msg: Message) => void
  onRetry: (msgId: string) => void
  dividerTimestamp?: number
}) {
```
to:
```tsx
function MessageList({ messages, myPubkey, profiles, onReply, onRetry, dividerTimestamp, targetMessageId }: {
  messages: Message[]
  myPubkey: string
  profiles: Record<string, { name?: string; display_name?: string; picture?: string; pubkey: string }>
  onReply: (msg: Message) => void
  onRetry: (msgId: string) => void
  dividerTimestamp?: number
  targetMessageId?: string
}) {
```

- [ ] **Step 2: Read `clearTargetMessage` from the store** inside `MessageList`, after the existing `useRef` declarations (~line 484). Add:

```tsx
  const { clearTargetMessage } = useNostrStore()
```

- [ ] **Step 3: Add the scroll+highlight effect** inside `MessageList`, after the existing `mountedRef` declaration and before the empty-state early return (~line 486). Add:

```tsx
  useEffect(() => {
    if (!targetMessageId) return
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-message-id="${targetMessageId}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.classList.add('message-highlight')
    clearTargetMessage()
  }, [targetMessageId, clearTargetMessage])
```

- [ ] **Step 4: Pass `targetMessageId` at the channel call site** (line 665). Change:

```tsx
          <MessageList messages={messages[channelId] || []} myPubkey={publicKey || ''} profiles={profiles} onReply={setReplyTo} onRetry={handleRetry} dividerTimestamp={dividerTimestampRef.current} />
```
to:
```tsx
          <MessageList messages={messages[channelId] || []} myPubkey={publicKey || ''} profiles={profiles} onReply={setReplyTo} onRetry={handleRetry} dividerTimestamp={dividerTimestampRef.current} targetMessageId={targetMessageId ?? undefined} />
```

- [ ] **Step 5: Pass `targetMessageId` at the DM call site** (line 759). Change:

```tsx
          <MessageList messages={messages[theirPubkey] || []} myPubkey={publicKey || ''} profiles={profiles} onReply={setReplyTo} onRetry={handleRetry} dividerTimestamp={dividerTimestampRef.current} />
```
to:
```tsx
          <MessageList messages={messages[theirPubkey] || []} myPubkey={publicKey || ''} profiles={profiles} onReply={setReplyTo} onRetry={handleRetry} dividerTimestamp={dividerTimestampRef.current} targetMessageId={targetMessageId ?? undefined} />
```

- [ ] **Step 6: Read `targetMessageId` from the store** in both chat components. There are two `useNostrStore()` destructures to update:

Line 582 (channel chat component). Change:
```tsx
  const { publicKey, messages, profiles, relays, getPrivateKey, addMessage, updateMessageStatus, seenAt, updateSeenAt } = useNostrStore()
```
to:
```tsx
  const { publicKey, messages, profiles, relays, getPrivateKey, addMessage, updateMessageStatus, seenAt, updateSeenAt, targetMessageId } = useNostrStore()
```

Line 675 (DM chat component). Change:
```tsx
  const { publicKey, messages, profiles, relays, getPrivateKey, addMessage, updateMessageStatus, seenAt, updateSeenAt } = useNostrStore()
```
to:
```tsx
  const { publicKey, messages, profiles, relays, getPrivateKey, addMessage, updateMessageStatus, seenAt, updateSeenAt, targetMessageId } = useNostrStore()
```

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/MessageThread.tsx
git commit -m "feat: scroll to and highlight target message in MessageList"
```

---

### Task 5: SearchResultItem — add optional `targetMessageId` prop

**Files:**
- Modify: `src/components/Chat/Sidebar.tsx` (~line 41)

- [ ] **Step 1: Write the failing test** in `src/__tests__/Sidebar.test.tsx`. Add a new describe block at the end of the file:

```ts
describe('SearchResultItem — jumpToMessage', () => {
  beforeEach(() => {
    useNostrStore.setState({
      jumpToMessage: vi.fn(),
      clearTargetMessage: vi.fn(),
      messages: {
        aaa: [{ id: 'msg1', pubkey: 'aaa', content: 'hello world', createdAt: 1000, status: 'sent', chatId: 'aaa' }],
      },
    })
  })

  it('calls jumpToMessage when a message result row is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    await openPanel('Messages')
    await user.type(screen.getByPlaceholderText('Search conversations…'), 'hello')
    const resultBtn = screen.getByRole('button', { name: /hello world/i })
    await user.click(resultBtn)
    expect(useNostrStore.getState().jumpToMessage).toHaveBeenCalledWith('aaa', 'dm', 'msg1')
  })
})
```

Also add `jumpToMessage: vi.fn()` and `clearTargetMessage: vi.fn()` to the global `beforeEach` store state (lines 23-53):

```ts
    jumpToMessage: vi.fn(),
    clearTargetMessage: vi.fn(),
    targetMessageId: null,
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/__tests__/Sidebar.test.tsx
```

Expected: FAIL — `jumpToMessage` not called / message result not visible

- [ ] **Step 3: Update `SearchResultItem`** in `src/components/Chat/Sidebar.tsx`. Change the component (~line 41):

```tsx
function SearchResultItem({ result, query, onSelect }: { result: SearchResult; query: string; onSelect: () => void }) {
  const { setActiveChat } = useNostrStore()

  const handleClick = () => {
    setActiveChat(result.chatId, result.chatType)
    onSelect()
  }
```
to:
```tsx
function SearchResultItem({ result, query, onSelect, targetMessageId }: { result: SearchResult; query: string; onSelect: () => void; targetMessageId?: string }) {
  const { setActiveChat, jumpToMessage } = useNostrStore()

  const handleClick = () => {
    if (targetMessageId) {
      jumpToMessage(result.chatId, result.chatType, targetMessageId)
    } else {
      setActiveChat(result.chatId, result.chatType)
    }
    onSelect()
  }
```

(The rest of the component body is unchanged.)

- [ ] **Step 4: Run tests — the new test still fails** (the message results section doesn't exist until Task 6). That's expected. The test drives Task 6; the `SearchResultItem` prop change will be verified when the section renders.

---

### Task 6: Sidebar Messages panel — split layout

**Files:**
- Modify: `src/components/Chat/Sidebar.tsx` (~lines 310–493)

- [ ] **Step 1: Revert `filteredContacts` to name-only** (~line 446). Replace the current content-match implementation with:

```tsx
  const filteredContacts = dmSearchQuery.trim()
    ? contacts.filter(c => {
        const p = c.profile || profiles[c.pubkey]
        return getDisplayName(p, c.pubkey, 10).toLowerCase().includes(dmSearchQuery.trim().toLowerCase())
      })
    : contacts
```

- [ ] **Step 2: Add `dmMessageResults` memo** after `filteredContacts`:

```tsx
  const dmMessageResults = useMemo(() => {
    const q = dmSearchQuery.trim().toLowerCase()
    if (q.length < 2) return []
    const results: SearchResult[] = []
    for (const contact of contacts) {
      const msgs = messages[contact.pubkey] || []
      for (const msg of msgs) {
        if (!msg.content.toLowerCase().includes(q)) continue
        const p = contact.profile || profiles[contact.pubkey]
        results.push({
          chatId: contact.pubkey,
          chatType: 'dm',
          chatName: getDisplayName(p, contact.pubkey, 10),
          message: msg,
          senderName: getDisplayName(profiles[msg.pubkey] || p, msg.pubkey),
        })
      }
    }
    return results.sort((a, b) => b.message.createdAt - a.message.createdAt).slice(0, 20)
  }, [dmSearchQuery, contacts, messages, profiles])
```

- [ ] **Step 3: Update `messagesSection` layout** (~line 453). Replace the inner scrollable list:

```tsx
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1 px-2 space-y-0.5">
        {filteredContacts.length === 0 && dmSearchQuery.trim() ? (
          <p className="text-gray-500 text-xs text-center px-4 py-6">No conversations matching "{dmSearchQuery.trim()}"</p>
        ) : filteredContacts.length === 0 ? (
          <p className="text-gray-500 text-xs text-center px-4 py-6">No conversations yet.</p>
        ) : (
          filteredContacts.map(c => (
            <ContactItem
              key={c.pubkey}
              contact={c}
              isActive={activeChatId === c.pubkey && activeChatType === 'dm'}
              onSelect={closePanel}
            />
          ))
        )}
      </div>
```
with:
```tsx
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1 px-2 space-y-0.5">
        {dmSearchQuery.trim().length >= 2 && (
          <p className="text-gray-600 text-[10px] uppercase tracking-wide px-2 py-1">Conversations</p>
        )}
        {filteredContacts.length === 0 && dmSearchQuery.trim() ? (
          <p className="text-gray-500 text-xs text-center px-4 py-6">No conversations matching "{dmSearchQuery.trim()}"</p>
        ) : filteredContacts.length === 0 ? (
          <p className="text-gray-500 text-xs text-center px-4 py-6">No conversations yet.</p>
        ) : (
          filteredContacts.map(c => (
            <ContactItem
              key={c.pubkey}
              contact={c}
              isActive={activeChatId === c.pubkey && activeChatType === 'dm'}
              onSelect={closePanel}
            />
          ))
        )}
        {dmMessageResults.length > 0 && (
          <>
            <div className="h-px bg-gray-800 my-1 mx-2" />
            <p className="text-gray-600 text-[10px] uppercase tracking-wide px-2 py-1">Messages · {dmMessageResults.length}</p>
            {dmMessageResults.map(result => (
              <SearchResultItem
                key={result.message.id}
                result={result}
                query={dmSearchQuery.trim()}
                onSelect={closePanel}
                targetMessageId={result.message.id}
              />
            ))}
          </>
        )}
      </div>
```

- [ ] **Step 4: Run the Sidebar tests**

```bash
npx vitest run src/__tests__/Sidebar.test.tsx
```

Expected: The previously failing `jumpToMessage` test now passes. All existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/Sidebar.tsx src/__tests__/Sidebar.test.tsx
git commit -m "feat: show message results in Messages panel scoped search"
```

---

### Task 7: Sidebar Channels panel — split layout

**Files:**
- Modify: `src/components/Chat/Sidebar.tsx` (~lines 495–540)

- [ ] **Step 1: Write the failing test** — add to the `describe('Sidebar — Channels panel scoped search')` block in `src/__tests__/Sidebar.test.tsx`:

```ts
  it('shows message results when query matches channel message content', async () => {
    useNostrStore.setState({
      messages: {
        ch1: [{ id: 'cmsg1', pubkey: 'testpubkey', content: 'hello world', createdAt: 1000, status: 'sent', chatId: 'ch1' }],
      },
    })
    const user = userEvent.setup()
    render(<Sidebar />)
    await openPanel('Channels')
    await user.type(screen.getByPlaceholderText('Search channels…'), 'hello')
    expect(screen.getByText(/Messages ·/)).toBeInTheDocument()
    expect(screen.getByText(/hello world/)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/__tests__/Sidebar.test.tsx
```

Expected: FAIL — `Messages ·` not found

- [ ] **Step 3: Revert `filteredChannels` to name-only** (~line 495):

```tsx
  const filteredChannels = channelSearchQuery.trim()
    ? joinedChannels.filter(ch =>
        ch.name.toLowerCase().includes(channelSearchQuery.trim().toLowerCase())
      )
    : joinedChannels
```

- [ ] **Step 4: Add `channelMessageResults` memo** after `filteredChannels`:

```tsx
  const channelMessageResults = useMemo(() => {
    const q = channelSearchQuery.trim().toLowerCase()
    if (q.length < 2) return []
    const results: SearchResult[] = []
    for (const ch of joinedChannels) {
      const msgs = messages[ch.id] || []
      for (const msg of msgs) {
        if (!msg.content.toLowerCase().includes(q)) continue
        results.push({
          chatId: ch.id,
          chatType: 'channel',
          chatName: ch.name,
          message: msg,
          senderName: getDisplayName(profiles[msg.pubkey], msg.pubkey),
        })
      }
    }
    return results.sort((a, b) => b.message.createdAt - a.message.createdAt).slice(0, 20)
  }, [channelSearchQuery, joinedChannels, messages, profiles])
```

- [ ] **Step 5: Update `channelsSection` layout** (~line 524). Replace the inner scrollable list:

```tsx
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1 px-2 space-y-0.5">
        {filteredChannels.length === 0 && channelSearchQuery.trim() ? (
          <p className="text-gray-500 text-xs text-center px-4 py-6">No channels matching "{channelSearchQuery.trim()}"</p>
        ) : filteredChannels.length === 0 ? (
          <p className="text-gray-500 text-xs text-center px-4 py-6">No channels yet. Use the + button above to discover or create one.</p>
        ) : (
          filteredChannels.map(ch => (
            <ChannelItem
              key={ch.id}
              channel={ch}
              isActive={activeChatId === ch.id && activeChatType === 'channel'}
              onSelect={closePanel}
            />
          ))
        )}
      </div>
```
with:
```tsx
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1 px-2 space-y-0.5">
        {channelSearchQuery.trim().length >= 2 && (
          <p className="text-gray-600 text-[10px] uppercase tracking-wide px-2 py-1">Channels</p>
        )}
        {filteredChannels.length === 0 && channelSearchQuery.trim() ? (
          <p className="text-gray-500 text-xs text-center px-4 py-6">No channels matching "{channelSearchQuery.trim()}"</p>
        ) : filteredChannels.length === 0 ? (
          <p className="text-gray-500 text-xs text-center px-4 py-6">No channels yet. Use the + button above to discover or create one.</p>
        ) : (
          filteredChannels.map(ch => (
            <ChannelItem
              key={ch.id}
              channel={ch}
              isActive={activeChatId === ch.id && activeChatType === 'channel'}
              onSelect={closePanel}
            />
          ))
        )}
        {channelMessageResults.length > 0 && (
          <>
            <div className="h-px bg-gray-800 my-1 mx-2" />
            <p className="text-gray-600 text-[10px] uppercase tracking-wide px-2 py-1">Messages · {channelMessageResults.length}</p>
            {channelMessageResults.map(result => (
              <SearchResultItem
                key={result.message.id}
                result={result}
                query={channelSearchQuery.trim()}
                onSelect={closePanel}
                targetMessageId={result.message.id}
              />
            ))}
          </>
        )}
      </div>
```

- [ ] **Step 6: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/Sidebar.tsx src/__tests__/Sidebar.test.tsx
git commit -m "feat: show message results in Channels panel scoped search"
```
