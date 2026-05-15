# Scoped Search: Individual Message Results

**Date:** 2026-05-15  
**Status:** Approved

## Overview

Extend the scoped search bars in the Messages and Channels sidebar panels to show individual message results below the filtered conversation list (Option B — split view). Clicking a message result jumps directly to that message in the thread with a brief highlight.

## Architecture

### Store (`nostrStore.ts`)

Add two fields to state:

```ts
targetMessageId: string | null
```

Add one new action:

```ts
jumpToMessage: (chatId: string, type: ChatType, messageId: string) => void
```

This action sets `activeChatId`, `activeChatType`, and `targetMessageId` in a single `set()` call. Also add `clearTargetMessage: () => void` which sets `targetMessageId` to `null`.

### MessageItem (`MessageItem.tsx`)

Add `data-message-id={message.id}` to the outermost element. No other changes.

### MessageList (`MessageThread.tsx`)

Accept a new optional prop: `targetMessageId?: string`.

On mount and when `targetMessageId` changes (via `useEffect`):
1. If `targetMessageId` is set, query `containerRef.current?.querySelector('[data-message-id="<id>"]')`.
2. Call `scrollIntoView({ block: 'center' })`.
3. Add a CSS class that plays a one-shot highlight flash animation (e.g. `ring-2 ring-purple-400` fading over ~1.5s via a keyframe).
4. Call `clearTargetMessage()` from the store to prevent re-triggering on re-renders.

The highlight animation is a CSS `@keyframes` that fades `ring` opacity from full to zero over 1.5s, applied once.

### MessageThread (`MessageThread.tsx`)

Read `targetMessageId` and `clearTargetMessage` from `useNostrStore()` and pass `targetMessageId` as a prop to `MessageList`.

### Sidebar — Messages panel

Revert `filteredContacts` to **name-only** filtering (undo the earlier content-match fix). Message content matches are now surfaced in the Messages section below, so showing a contact in both sections would be redundant.

Add a memoised `dmMessageResults` computation:

```ts
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

Layout when `dmSearchQuery.trim().length >= 2`:

```
[ search bar ]
"Conversations"          ← section label
  <filtered contact rows>
─────────────────────    ← divider (only when dmMessageResults.length > 0)
"Messages · N"           ← section label (only when dmMessageResults.length > 0)
  <SearchResultItem × N> ← clicking calls jumpToMessage(chatId, 'dm', message.id)
```

When query is empty, the panel renders as before (full contact list, no sections).

Empty states:
- No conversations match + no message results → single "No conversations matching…" message (existing).
- Conversations match but no message results → omit the divider and Messages section entirely.
- No conversations match but message results exist → show "Conversations" label + empty note, then divider + Messages section.

### Sidebar — Channels panel

Same: revert `filteredChannels` to **name-only** filtering for the same reason.

Identical pattern, using `channelSearchQuery` and scoping iteration to `joinedChannels`:

```ts
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

Clicking calls `jumpToMessage(chatId, 'channel', message.id)`.

## Data Flow

```
User types in scoped search bar
  → dmSearchQuery / channelSearchQuery state updates
  → dmMessageResults / channelMessageResults memos recompute
  → Split layout renders: contacts/channels + message results

User clicks a message result
  → jumpToMessage(chatId, type, messageId) in store
    → activeChatId, activeChatType, targetMessageId all set atomically
  → Sidebar closes (closePanel called)
  → MessageThread mounts for the new chat
  → MessageList useEffect fires on targetMessageId
    → scrollIntoView({ block: 'center' })
    → highlight flash applied
    → clearTargetMessage() called
```

## Constraints

- Message results cap: 20 per panel (global search caps at 50; panels are narrower).
- Minimum query length: 2 characters (matches existing global search behaviour).
- `SearchResultItem` receives a small extension: an optional `targetMessageId` prop. When set, `handleClick` calls `jumpToMessage(chatId, type, targetMessageId)` instead of `setActiveChat`. This keeps one component for both use cases.
- Highlight must be a one-shot animation that doesn't repeat on subsequent re-renders.
- Jump behaviour must not conflict with the existing divider-scroll-on-mount logic — `targetMessageId` takes priority when set.
