# Message Requests — Design

**Date:** 2026-06-12
**Status:** Approved, pending implementation

## Problem

The global inbox added in this session subscribes to all kind-4 DMs addressed
to the user. As a result, a DM from any stranger now silently creates a contact
and fires a notification — there is no gate between "someone you've never talked
to messaged you" and "this is a conversation in your list." This is the spam /
unsolicited-contact surface that every chat app gates behind a request flow.

## Goals

- Unknown senders land in a **Message requests** holding area, not the main DM list.
- Requests are visible and openable; the user can **Accept**, **Dismiss**, or **Block**.
- Blocking is durable, synced across the user's devices, and **reversible** from a
  Settings screen.
- No browser notification for a pending request (badge-only), so the gate also
  suppresses notification spam.

## Non-goals

- Block-from-profile-card (can be added later; out of scope here).
- Private/encrypted contact lists — accepting publishes to the public kind-3
  NIP-02 list as all contacts do today. Revisited with the NIP-17 work.
- Block TTL / auto-expiry. Considered and rejected: blocking is a deliberate
  anti-harassment action, and the management UI below makes blocks visible and
  one-click reversible, so a safety-net timer is both redundant and wrong for the
  intent. "Dismiss" is the soft, non-permanent decline; "Block" is the hard one.

## Data model (`src/store/nostrStore.ts`)

**`Contact` gains one field:**
- `pending?: boolean` — true for a contact created from an unsolicited DM. Cleared
  on accept (or on reply, or on manual Add Contact).

**New persisted + relay-synced state:**
- `blockedPubkeys: string[]` — sender pubkeys whose events are dropped at the inbox gate.
- `dismissedRequests: Record<pubkey, number>` — pubkey → unix-seconds timestamp of
  the dismissal. Used so relay backfill of the *same old* messages doesn't resurrect
  a dismissed request; only a message with `created_at` newer than the dismissal
  re-opens it.

Both are added to `partialize` (local persistence) and to the kind-30078 settings
sync (`SyncedSettings` in `src/lib/nostrSync.ts`, alongside `mutedChats`), and applied
in `completeLogin`'s settings-merge block. Default empty.

**New actions:**
- `acceptMessageRequest(pubkey)` — sets `pending: false` on the contact, triggers
  contacts sync (publishes kind-3). Idempotent.
- `dismissMessageRequest(pubkey)` — removes the contact and its messages from state
  (and Dexie), records `dismissedRequests[pubkey] = now`. Does **not** add to blocklist.
- `blockPubkey(pubkey)` — everything `dismissMessageRequest` does, plus adds to
  `blockedPubkeys`, triggers settings sync.
- `unblockPubkey(pubkey)` — removes from `blockedPubkeys` and clears any
  `dismissedRequests` entry (so they can reach the user again), triggers settings sync.
- `addContact(pubkey)` (existing) — extended to also remove the pubkey from
  `blockedPubkeys`/`dismissedRequests` and never set `pending`. Manually adding
  someone is the explicit unblock-and-trust path.

## Inbox gate (`src/lib/inbox.ts`, `processDMEvent`)

Applied to **incoming** events only (`event.pubkey !== myPubkey`); the user's own
sent DMs are never gated. After decrypt + group-invite filtering, before storing:

1. **Blocked sender** (`blockedPubkeys.includes(peer)`) → drop event entirely. No
   store write, no message, no notification.
2. **Dismissed sender** with `event.created_at <= dismissedRequests[peer]` → drop.
   (A newer message falls through and re-opens the request.)
3. **Unknown sender** (no existing contact) → create contact with `pending: true`,
   store message, count unread. **Suppress notification** (badge only).
4. **Pending sender** (existing contact, `pending: true`) → store + count unread,
   suppress notification.
5. **Accepted contact** → unchanged from today (store, count, notify).

Notification suppression is implemented by passing the pending/unknown state into
the existing `fireNotification` call site — when pending, skip it.

The gate reads `blockedPubkeys` / `dismissedRequests` / `contacts` from
`useNostrStore.getState()` at event time (consistent with how the processors
already read fresh state).

## UI

**Sidebar DMs tab (`src/components/Chat/Sidebar.tsx`):**
- Derive `pendingRequests = contacts.filter(c => c.pending)` and
  `acceptedContacts = contacts.filter(c => !c.pending)`.
- The conversation list renders `acceptedContacts` (replacing the current
  `contacts`). Search filters operate on accepted only.
- Above the list, when `pendingRequests.length > 0`, a collapsible
  **"Message requests · n"** section listing pending contacts using the existing
  `ContactItem`. The DM tab badge (`totalUnreadDMs`) continues to count accepted
  unread; requests get their own count on the section header.

**Message thread (`src/components/Chat/MessageThread.tsx`):**
- When the active DM contact is `pending`, render a banner above the composer with
  three actions: **Accept** · **Dismiss** · **Block**.
- Replying to a pending request implicitly calls `acceptMessageRequest` before send
  (so answering a request accepts it — standard behavior).
- Accept clears the banner in place; Dismiss/Block close the thread (contact removed)
  and return to the DM list.

**Settings → Privacy tab (new):**
- `SettingsTab` union gains `'privacy'`; `SettingsScreen.tsx` adds the label + panel,
  following the `NotificationsTab` pattern.
- New `src/components/Settings/PrivacyTab.tsx`: a "Blocked users" list. Each row shows
  avatar + display name (npub fallback via `getDisplayName`) and an **Unblock** button
  wired to `unblockPubkey`. Empty state: "You haven't blocked anyone."
- A small hint line above the list, e.g. "You've blocked N people," for reassurance.

## Testing (TDD)

Store (`store.test.ts`):
- `acceptMessageRequest` clears `pending`.
- `dismissMessageRequest` removes contact + messages, records timestamp, does not block.
- `blockPubkey` removes contact and adds to `blockedPubkeys`.
- `unblockPubkey` removes from blocklist and clears dismissal.
- `addContact` clears block/dismissal and never sets pending.

Inbox (`inbox.test.ts`):
- Blocked sender → event dropped, no contact, no message.
- Dismissed sender, older message → dropped; newer message → re-opens request.
- Unknown sender → contact created `pending: true`, message stored, **no notification**.
- Accepted contact → unchanged (stored + notified).

Sync (`nostrSync.test.ts`):
- `blockedPubkeys` / `dismissedRequests` round-trip through `SyncedSettings`
  serialize/parse.

## Migration / compatibility

- New fields default empty; existing users see no behavior change until they receive
  a DM from a non-contact.
- Existing contacts have `pending` undefined → treated as accepted (falsy). No
  backfill needed.
- Blocklist is best-effort cross-client: other Nostr clients won't honor it, but the
  relay-synced state means all of *this* app's devices share one blocklist.
