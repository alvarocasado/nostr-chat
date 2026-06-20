# Dedup Overlapping kind-4 Subscriptions — Design

Date: 2026-06-20
Status: Approved (design); pending implementation plan

## Goal

Eliminate the duplicate Nostr subscription for incoming direct messages and the
redundant NIP-04 decryption it causes. Today two hooks open the identical filter

```
{ kinds: [4], '#p': [myPubkey], limit: 100 }
```

against the relay pool:

- `useGlobalInbox` (DM effect) — runs `processDMEvent`, which decrypts the event,
  then **explicitly skips** group-invite payloads (`inbox.ts`, the
  `decrypted.startsWith('{')` branch returns on `type === 'group_invite'`).
- `useGroupInviteListener` — decrypts the same event **again** and handles **only**
  group-invite payloads.

So every inbound DM is fetched twice (two identical relay subscriptions) and
decrypted twice. The two handlers are complementary halves of one stream that was
never consolidated.

This is item #7 of the "Priority 2 — Reliability & scalability" cluster from the
functional analysis. It is intentionally small, self-contained, and low-risk.

## Background

- `src/hooks/useNostrSubscriptions.ts`
  - `useGlobalInbox()` — DM effect subscribes `{ kinds:[4], '#p':[me], limit:100 }`
    and calls `processDMEvent(event, publicKey, relays, { live })`.
  - `useGroupInviteListener()` — subscribes the same filter, decrypts inline, and
    on a `group_invite` payload calls `addGroup` / `setGroupKey`, then publishes a
    group-key backup (`buildGroupKeyBackupEvent` → `publishEvent`).
- `src/lib/inbox.ts`
  - `processDMEvent` is the shared, idempotent processor used by both the global
    inbox and per-chat `useDMMessages` subscriptions. It already detects
    `group_invite` payloads and returns early, deferring to the listener hook.
- `src/App.tsx` mounts both `useGroupInviteListener()` and `useGlobalInbox()`.

## Approach

One subscription, one decrypt, branch inside the shared processor. Move invite
handling down into `inbox.ts` where the kind-4 stream is already decrypted.

### Components

1. **`src/lib/inbox.ts`**
   - Add an internal async helper `handleGroupInvite(event, decrypted)`.
     - Parses the payload (`groupId`, `groupKeyHex`, `groupName`); bails if any
       field is missing.
     - Idempotency guard: if a group with `groupId` already exists in the store,
       return without side effects (covers replays from per-chat subscriptions
       and relay backfill).
     - Otherwise `addGroup(...)` + `setGroupKey(groupId, groupKeyHex)`, then
       publish the user's own key backup
       (`buildGroupKeyBackupEvent` → `publishEvent`, fire-and-forget with
       `.catch(() => {})`).
     - Wrapped so parse/decrypt/build failures are swallowed (current behavior).
   - In `processDMEvent`, the existing `group_invite` branch calls
     `handleGroupInvite(event, decrypted)` and then returns (invites are not chat
     messages and must not be added to the message list).
   - Add imports: `buildGroupKeyBackupEvent`, `publishEvent` from `./nostr`.

2. **`src/hooks/useNostrSubscriptions.ts`**
   - Delete `useGroupInviteListener` entirely (its subscription and inline decrypt
     logic are now redundant).
   - Remove the now-unused imports it required (`decryptDM`,
     `buildGroupKeyBackupEvent`, `publishEvent`, `Group` type) **only if** no other
     export in the file still uses them; verify before removing.

3. **`src/App.tsx`**
   - Remove the `useGroupInviteListener()` call and drop it from the import of
     `./hooks/useNostrSubscriptions`.

### Data flow (after)

```
incoming kind-4 (#p = me)
  └─ useGlobalInbox DM subscription (single)
       └─ processDMEvent: decrypt once
            ├─ group_invite  → handleGroupInvite (add group, set key, publish backup once)
            └─ otherwise     → existing DM message flow (store, unread, notify)
```

Per-chat `useDMMessages` subscriptions also route through `processDMEvent`, so an
invite that arrives while a conversation is open is now handled there too — a
strict improvement over today, made safe by the existing dedup guards
(`claimSideEffects`, `alreadyStored`) and the group-exists guard.

### Error handling

- `handleGroupInvite` swallows parse/decrypt/build errors, matching the current
  listener behavior.
- The key-backup publish stays fire-and-forget (`.catch(() => {})`); a failed
  backup must not block joining the group.

## Testing

- Convert the existing `ignores group invite payloads` test in
  `src/__tests__/inbox.test.ts` into `handles group invite payloads`: assert the
  group is added and the key set, and that no chat message is created for the
  sender. Spy on `publishEvent` to confirm the backup is published.
- Add an idempotency test: processing the same invite event twice adds the group
  exactly once and publishes the backup exactly once (no throw).
- All existing DM and request-gate tests remain unchanged and must stay green.

## Alternatives considered (rejected)

- **Keep both hooks but share one subscription.** Removes the duplicate relay
  subscription but still decrypts every DM twice. Misses half the win.
- **Decrypt once in the hook, pass plaintext to both processors.** Forces a
  `processDMEvent` signature change to accept pre-decrypted text; more invasive
  and leaks decryption out of the shared processor seam.

## Out of scope

- The other Priority 2 items (NIP-94/Blossom files, pagination/virtualization,
  NIP-65 outbox) — each gets its own spec.
- Any change to invite payload format or group membership/rekey semantics.
