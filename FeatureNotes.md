# Feature Notes

## Unreleased

### Cross-device sync via Nostr relays

Contacts, joined channels, and settings are now stored on the user's own relays and automatically synced across devices — no external service required.

**What syncs:**
- **Contacts** (NIP-02, kind 3) — DM contact list published as a replaceable event; merged (additive) on login
- **Joined channels** (NIP-51, kind 30001, `d=joined-channels`) — list of joined channel IDs; merged (additive) on login
- **Settings** (NIP-78, kind 30078, `d=nostr-chat-settings`) — notification preferences, muted chats, and relay list; NIP-04 encrypted to the user's own public key; applied on login if the relay event is newer than the last known sync

**How it works:**
- On login, the app fetches all three event kinds from the user's relays via `syncFromRelays()` and merges the results into local state in the background (login is never blocked)
- After any contact, channel, or settings mutation the relevant event is republished to relays with a 1.5 s debounce to avoid spamming
- Settings conflicts use a `syncedSettingsAt` timestamp: relay settings only overwrite local ones when the relay event is strictly newer than the last settings event received or published from this device

**New files:** `src/lib/nostrSync.ts` — all event builders, fetch functions, publish helpers, and debounce utility

**Limitations:**
- Contact *removals* do not propagate (union-only merge); removed contacts must be deleted on each device separately
- Message history is not synced separately — it is already relay-sourced via live subscriptions

---

### Relay Connection Health

Live connection status for each configured relay, visible without leaving the app.

**What's new:**
- **Settings → Relays tab** — each relay row now shows a colored status dot (green = connected, amber pulsing = connecting, red = disconnected) and a text label (`ok` / `…` / `error`); the header copy changes from "Connected to N relays" to "X / N relays connected"
- **Sidebar — Settings menu** — the Relays item shows a live `connected/total` count badge (e.g. `4/6`) in amber when any relay is unreachable
- **Desktop nav rail** — a small amber dot appears on the Settings icon whenever one or more relays are down, drawing attention without being intrusive; disappears once all relays are healthy or Settings is open

**How it works:**
- `useRelayHealth(relays)` calls `pool.ensureRelay(url)` for each configured relay on mount (proactively opens connections; the pool deduplicates by URL so this is safe to call multiple times), then polls `pool.listConnectionStatus()` every 5 seconds to read the live `relay.connected` boolean from each open WebSocket
- Returns `Record<string, 'connected' | 'disconnected' | 'pending'>` — `pending` for relays not yet in the pool's connection table
- `aggregateRelayHealth(status)` is a pure helper that returns `{ connected, total }` for compact display

**New files:** `src/hooks/useRelayHealth.ts`

---

### Smart Auto-Scroll

The message list no longer forcibly scrolls to the bottom when new messages arrive while you are reading history.

**Before:** `MessageList` called `scrollIntoView` on every `messages.length` change, interrupting any upward scroll.

**After:** A scroll listener tracks whether the bottom of the list is within 120 px of the viewport. New incoming messages scroll to the bottom only when the view is already near the bottom. On initial chat open the view scrolls to the "New messages" divider (if present) or the bottom, and `atBottomRef` is set accordingly so the first real-time message behaves correctly.

---

### Bug Fixes

- **Chunked file transfer message ID collision** — completed transfers were stored in the message list with an ID of `transfer-${senderPubkey}-${createdAt}`, which could collide when the same sender transferred two files within the same second. The `IncomingTransfer` type now carries the `transferId` field (128-bit cryptographically random hex, set in `handleFileStart`), and the stored message ID is `transfer-${transferId}`.

---

### Test Coverage

Added 22 new unit tests covering store actions that were previously untested: `updateMessageStatus`, `markRead`, `setProfile`, `updateContactLastMessage`, `updateChannelLastMessage`, `muteChatUntil`, `unmuteChat`, `setDraft`, `clearDraft`, `updateSeenAt`, and `loginFromHex`. Suite grows from 127 to 149 tests.
