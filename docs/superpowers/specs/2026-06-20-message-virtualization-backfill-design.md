# Scalable Message History: Virtualization + Backfill — Design

Date: 2026-06-20
Status: Approved (design); pending implementation plan

## Goal

Make large chats performant and full history reachable. Two problems from the
functional analysis (Priority 2, item #5):

1. **Rendering.** `MessageList` renders *every* message in the chat into the DOM
   (the `elements` loop in `MessageThread.tsx`). Worse, `setActiveChat`
   (`nostrStore.ts`) loads the chat's *entire* locally-persisted history from
   Dexie into memory on open. Large chats jank and bloat the DOM.
2. **History reach.** Per-chat relay subscriptions use `limit: 200` with no
   `until` backfill, so on a device without a local copy, history older than the
   most recent ~200 relay events is unreachable. There is no "load older".

The fix: virtualize rendering, cap the in-memory window, and page older messages
in on scroll-up — first from local Dexie, then from relays via `until` filters.

## Decisions (from brainstorming)

- **Scope:** all of item #5, delivered in three phases, each independently
  shippable.
- **Virtualizer:** the **free, MIT `Virtuoso` component** from `react-virtuoso`.
  NOT the separately-licensed `@virtuoso.dev/message-list` package (it requires a
  `licenseKey`). Use the documented `firstItemIndex` + `startReached` prepend
  pattern from the open-source component.
- **Jump-to-message out of window:** load older (Dexie, then relay) until the
  target is in the window, bounded by `MAX_JUMP_PAGES`; if still not found, show
  a transient inline notice. Keeps the existing `jumpToMessage → targetMessageId`
  wiring.
- **No toast system exists.** The "not found" notice is a small auto-dismissing
  inline banner in `MessageList`, matching the existing `attachError` banner
  style in `MessageInput`.

## Phasing

Each phase is a shippable increment; the implementation plan will sequence them.

- **Phase 1 — Virtualize rendering.** Replace `MessageList`'s render-every-message
  loop with `Virtuoso` over the *current* in-memory list. Data loading is
  unchanged in this phase. Immediate jank/DOM fix, lowest risk.
- **Phase 2 — Cap in-memory + load-older from Dexie.** Open a chat with only the
  most-recent page in memory; page older messages from local Dexie on scroll-up.
- **Phase 3 — Relay backfill.** When local history is exhausted, fetch older from
  relays via `until` filters, decrypt/persist/prepend; terminal "no more history"
  state.

## Background (current code)

- `src/components/Chat/MessageThread.tsx`
  - `MessageList` (inner component) builds a flat `elements` array from all
    `messages`, interleaving `DateSeparator`, `NewMessagesDivider`, and
    `MessageItem`. Scroll behaviors: mount scroll-to-bottom, divider
    `scrollIntoView`, jump-to-message via `querySelector([data-message-id])` +
    highlight animation, near-bottom detection driving a scroll-to-bottom button,
    and sticky-to-bottom on new message only when already at bottom.
  - Three thread wrappers (`ChannelThread`, `DMThread`, `GroupThread`) each call a
    per-chat subscription hook and render `MessageList`. File is ~1000 lines.
- `src/store/nostrStore.ts`
  - `setActiveChat(id, type)` loads ALL persisted messages for the chat
    (`db.messages.where('[chatId+createdAt]').between([id,-Infinity],[id,Infinity])`)
    and merges into `messages[id]`.
  - `addMessage(chatId, msg)` dedups by id, appends, sorts ascending by
    `createdAt`, persists to Dexie.
- `src/hooks/useNostrSubscriptions.ts`
  - `useChannelMessages`, `useDMMessages`, `useGroupMessages` subscribe with
    `limit: 200` and route events through the shared `process*Event` processors.
- `src/lib/nostr.ts`
  - `subscribeEvents(relays, filter, onEvent, onEose)` (live) and
    `fetchEvents(relays, filter): Promise<Event[]>` (one-shot, collects until
    EOSE). `fetchEvents` is the tool for one-shot `until` backfill.
- `src/components/Chat/Sidebar.tsx`
  - Search results call `jumpToMessage(chatId, chatType, messageId)`, which
    (`nostrStore.ts`) runs `setActiveChat` then sets `targetMessageId`.

## Architecture & components

### New: `src/components/Chat/MessageList.tsx`

Extracted from `MessageThread.tsx` and rebuilt on `Virtuoso`. This shrinks
`MessageThread.tsx` well under the 800-line guideline. Responsibilities:

- Render the free `Virtuoso` component:
  - `data={messages}` (or `totalCount` + `itemContent` by index).
  - `followOutput="smooth"` — sticks to bottom only when already at bottom.
  - `firstItemIndex={firstItemIndex}` + `startReached={onStartReached}` — the
    open-source prepend pattern: `firstItemIndex` starts at a large constant
    (e.g. `START_INDEX = 1_000_000`) and is decremented by the number of
    prepended messages on each load-older, so Virtuoso preserves scroll position.
  - `initialTopMostItemIndex={messages.length - 1}` — opens at the newest message.
  - `itemContent={(index, msg) => ...}` — renders a row: a `DateSeparator` when
    the day changes vs the previous message, the `NewMessagesDivider` at the
    first message newer than `dividerTimestamp`, and the `MessageItem` with
    `showAvatar` computed vs the previous message. The flags come from a pure
    `decorateRow(msg, prevMsg, dividerTimestamp, myPubkey)` helper.
  - `ref` (`VirtuosoHandle`) → `scrollToIndex({ index, align:'center' })` for
    jump-to-message and the scroll-to-bottom button.
  - Scroll-to-bottom button visibility from `atBottomStateChange`.
- Owns the inline "Message not available" auto-dismissing notice for failed jumps.
- `DateSeparator`, `NewMessagesDivider`, and the empty-state move here.

The Virtuoso wrapper stays thin; all pageable logic lives in `useChatHistory` and
`history.ts`.

### New: `src/hooks/useChatHistory.ts`

`useChatHistory(chatId, chatType, myPubkey)` returns
`{ loadOlder: () => Promise<void>, loading: boolean, exhausted: boolean }`.

- `loadOlder()`:
  1. Read `oldestLoaded = messages[chatId][0]?.createdAt`.
  2. Query Dexie for older messages (`pageOlderFromDexie(chatId, oldestLoaded,
     OLDER_PAGE)`). If any → `prependMessages(chatId, page)` and return.
  3. Else fetch from relays: `fetchEvents(relays, olderFilterFor(chatType,
     chatId, myPubkey, oldestLoaded, OLDER_PAGE))` (DM needs two filters — see
     `history.ts`), run each event through the existing
     `processChannelEvent` / `processDMEvent` / `processGroupEvent`
     (decrypt + persist + dedup), then re-read the now-persisted older page from
     Dexie and `prependMessages`.
  4. If the relay step returned zero events → set `exhausted = true`.
- `loading` guards against overlapping calls (Virtuoso may fire `startReached`
  repeatedly). `exhausted` short-circuits further calls.
- Resets `exhausted`/`loading` when `chatId` changes.

### New: `src/lib/history.ts` (pure helpers)

- `olderFilterFor(chatType, chatId, myPubkey, until, limit): Filter[]`
  - `channel`: `[{ kinds:[42], '#e':[chatId], until, limit }]`
  - `group`: `[{ kinds:[GROUP_MESSAGE_KIND, LEGACY_GROUP_MESSAGE_KIND],
    '#e':[chatId], until, limit }]`
  - `dm`: two filters —
    `[{ kinds:[4], authors:[myPubkey], '#p':[chatId], until, limit },
      { kinds:[4], authors:[chatId], '#p':[myPubkey], until, limit }]`
- `pageOlderFromDexie(chatId, before, limit): Promise<Message[]>` — Dexie query
  for `createdAt < before`, newest-first limited, returned ascending.
- A dedup/merge helper if the store's `prependMessages` needs one (otherwise
  fold dedup into the store action).

### Store changes (`src/store/nostrStore.ts`)

- `setActiveChat`: load only the most-recent `INITIAL_PAGE` messages from Dexie
  (`orderBy [chatId+createdAt]` desc, `limit INITIAL_PAGE`, returned ascending),
  instead of the whole chat.
- New action `prependMessages(chatId, msgs)`: dedup against existing ids, merge,
  sort ascending by `createdAt`. Does not re-persist (these came from Dexie or
  were already persisted by the processors).

### Subscription changes (`src/hooks/useNostrSubscriptions.ts`)

- Lower the per-chat live-subscription `limit` from `200` to `INITIAL_PAGE` (50)
  in `useChannelMessages`, `useDMMessages`, and `useGroupMessages`, so live
  backfill matches the initial window. The global inbox limits are unchanged.

### Constants

`INITIAL_PAGE = 50`, `OLDER_PAGE = 50`, `MAX_JUMP_PAGES = 20`,
`START_INDEX = 1_000_000`. Defined as named constants so they are tunable.

## Data flow

```
open chat
  setActiveChat -> load recent INITIAL_PAGE from Dexie
  live subscription -> backfill recent ~INITIAL_PAGE
  Virtuoso opens at bottom (initialTopMostItemIndex)

scroll to top (startReached)
  useChatHistory.loadOlder():
    Dexie older page?  yes -> prependMessages + firstItemIndex -= n
                       no  -> relay until-fetch -> process* -> re-read Dexie -> prepend
    relay returned 0   -> exhausted = true (startReached no-ops)

new live message
  addMessage appends -> followOutput pins to bottom only if already at bottom
                        else scroll-to-bottom button appears

jump-to-message (targetMessageId set by jumpToMessage)
  in window? scrollToIndex(center) + highlight
  else loop loadOlder() until found | MAX_JUMP_PAGES | exhausted
       found -> scroll + highlight ; not found -> inline notice
```

## Error handling

- A relay or Dexie failure inside `loadOlder` leaves the current window intact,
  surfaces nothing destructive, and does **not** set `exhausted` — only a
  *successful empty* relay response sets exhaustion. The next `startReached`
  retries.
- Decrypt failures during relay backfill are skipped by the existing
  `process*Event` processors (unchanged).
- Jump not found within `MAX_JUMP_PAGES` (or after exhaustion) → transient inline
  "Message not available" notice; the window is left where paging stopped.

## Testing

- **`history.ts` (pure):** `olderFilterFor` produces the correct filter(s) per
  chat type with `until`/`limit` (DM = two directional filters; channel/group =
  `#e` + correct kinds). `pageOlderFromDexie` returns the right slice and order
  (fake-indexeddb). Dedup/merge ordering.
- **Store:** `setActiveChat` loads only the recent `INITIAL_PAGE` (not the whole
  chat). `prependMessages` dedups by id and preserves ascending sort.
- **`useChatHistory`:** `loadOlder` transitions Dexie → relay → `exhausted`
  with `fetchEvents` mocked and a fake Dexie; the error path does NOT set
  `exhausted`; `loading` prevents overlap; state resets on `chatId` change.
- **`decorateRow` (pure):** date-separator boundary, divider placement at first
  message newer than `dividerTimestamp`, `showAvatar` vs previous message and own
  messages.
- **`MessageList` (Virtuoso wrapper):** jsdom cannot measure layout, so this is a
  smoke test (renders without crashing; empty state shows). Scroll position
  anchoring on prepend, sticky-to-bottom, and `scrollToIndex` are layout-
  dependent and are verified manually / via e2e — called out explicitly here
  rather than asserted with fake layout.
- **Regression:** existing `MessageThread`, `Sidebar`, store, and inbox tests
  stay green.

## File structure

- New: `src/components/Chat/MessageList.tsx`, `src/hooks/useChatHistory.ts`,
  `src/lib/history.ts`.
- Modified: `src/components/Chat/MessageThread.tsx` (consumes `MessageList` +
  `useChatHistory`, loses the inline list and separators), `src/store/nostrStore.ts`
  (`setActiveChat`, `prependMessages`), `src/hooks/useNostrSubscriptions.ts`
  (per-chat `limit`).
- New dependency: `react-virtuoso` (free `Virtuoso` component; peer deps include
  React 19 — verify exact version supports React 19 at install).

## Out of scope

- The other Priority 2 items (NIP-94/Blossom files, NIP-65 outbox).
- Forward pagination / "jump to bottom then load newer" beyond what `followOutput`
  and the live subscription already provide.
- Changing the message persistence schema or the `process*Event` decrypt paths.
- A general-purpose toast system (the inline notice suffices here).
