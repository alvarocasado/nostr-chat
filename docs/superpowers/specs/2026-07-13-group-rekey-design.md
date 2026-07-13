# Group Member Management + Key Rotation — Design

Date: 2026-07-13
Status: Approved
Source: Priority 1 item 3 of `docs/Nostr-Chat — Functional Analysis & Impro.md`

## Problem

Groups use one shared AES-GCM key with no rotation and no membership changes
after creation. Anyone who ever held the key reads all past and future
messages. `memberPubkeys` is set once at creation; invitees only ever see
themselves in the list (known member-count bug). Nothing re-reads the kind-30040
metadata after creation.

## Decisions (settled with user)

- **Creator-only management.** Only `creatorPubkey` can add/remove members.
  Payloads claiming membership changes are honored only when signed by the
  group's creator.
- **New members get the current epoch only.** Invites carry only the current
  key. Messages from before the last rotation stay unreadable to them.
- **Rotation is automatic on removal, and only then.** Adding a member never
  rotates. No manual rotate button in v1.
- **Distribution mechanism: per-member NIP-04 rekey DMs** (Approach A),
  reusing the existing invite pipeline (build → publish → inbox dispatch →
  relay-stored kind-4 backfill for offline members). A single key-package
  event (Approach B) and MLS/NIP-104 (Approach C) were considered; B invents a
  parallel distribution channel, C is the long-term answer and out of scope.

## Key epochs

- `groupKeys[groupId]` remains "the current key" — every existing
  encrypt/decrypt call site keeps its shape.
- New store field `groupKeyHistory: Record<string, string[]>` holds retired
  keys (oldest → newest).
- Kind-1042 decryption tries the current key, then falls back through history
  newest → oldest. New helper in `groupCrypto.ts`:
  `decryptWithGroupKeys(ciphertext, keys: string[])` — first success wins.
  Call sites: inbox processor, live subscription, history backfill.
- Kind-30041 key backup content (NIP-04 self-encrypted) changes from a bare
  hex string to `JSON {keys: [...oldest→newest]}`. Parser accepts both
  formats; existing backups keep restoring. Backup publishes include the full
  key list.

## Flows

### Removal (creator's client)

1. Generate new key (`generateGroupKey`).
2. Publish updated kind-30040 metadata encrypted with the **new** key, member
   list without the removed pubkey.
3. Publish new kind-30041 backup (full key list).
4. Send `group_rekey` DM to each remaining member.
5. Send `group_remove` DM to the removed member (courtesy notice; enforcement
   is the crypto).
6. Send in-group `members` control message encrypted with the new key.
7. Locally: `rotateGroupKey(groupId, newKey)` (old key → history),
   `setGroupMembers(groupId, newList)`.

### Add (creator's client)

No rotation. Send existing `group_invite` (now carrying `memberPubkeys`) with
the current key, publish updated 30040, send in-group `members` control
message. This also fixes the invitee member-count bug.

Note: clients still do not subscribe to or read 30040 in v1 — membership
state propagates via the invite/rekey payloads and the in-group `members`
control. The 30040 republish keeps the durable record current for future
use only.

## Payloads

All kind-4 NIP-04 DM payloads dispatch in `lib/inbox.ts` alongside
`group_invite`:

- `{type:'group_rekey', groupId, groupKeyHex, groupName, memberPubkeys}` —
  receiver: current key moves to history, new key becomes current, member
  list updated, new 30041 backup published once (same pattern as invites).
  Rejected unless the DM sender is the group's `creatorPubkey`.
- `{type:'group_remove', groupId}` — receiver marks the group `removed: true`
  locally. Keys are kept so pre-removal history stays readable. Same
  creator-sender check.
- `group_invite` gains `memberPubkeys` (optional; absent → today's behavior).

In-group control (serialized like edit/delete ops in `lib/messageOps.ts`,
sent via `sendGroupControl`, not rendered as a chat row, applied
idempotently):

- `{type:'members', memberPubkeys}` — honored only when the 1042 event is
  signed by `creatorPubkey`.

## Store

- `groupKeyHistory: Record<string, string[]>` (persisted + synced like
  `groupKeys`).
- `removed?: boolean` on `Group`.
- Actions: `rotateGroupKey(groupId, newKeyHex)`,
  `setGroupMembers(groupId, pubkeys)`, `markGroupRemoved(groupId)`.

## UI

- Group header's member count becomes a button opening a **Members panel**
  (modal, AddGroupModal pattern): avatar + name per member from `profiles`.
- Creator additionally sees an add-contact picker and per-member remove
  buttons; removal has a confirm step (it rotates the key).
- Panel footer trust note: "Anyone who was a member can still read messages
  from before their removal. Removing a member rotates the key so they can't
  read anything new."
- Removed-group thread state: banner "You were removed from this group",
  input disabled, history readable.

## Failure handling

- Rekey is a multi-publish sequence. Kind-4 DMs are relay-stored, so members
  who are offline converge on next connect — the same delivery guarantee
  invites have today.
- Creator UI surfaces partial publish failure as a retryable error on the
  panel.
- A member who missed a rekey sees new messages silently skipped (existing
  wrong-key behavior) until the DM backfill delivers the key.

## Testing

- Unit: decrypt fallback across epochs; inbox handling of
  `group_rekey`/`group_remove`/`members` including non-creator rejection and
  idempotency; 30041 backup round-trip for both old (hex) and new (JSON)
  formats.
- Component: Members panel render, creator-only affordances, remove confirm;
  removed-group thread state.

## Accepted limits (v1)

- No admin transfer: if the creator leaves or loses their key, membership is
  frozen (chat continues to work).
- No forward secrecy within an epoch; MLS (NIP-104) remains the long-term
  path.
- Removed members keep pre-removal history — inherent to the model, disclosed
  in-UI.
- Membership authorization is client-side validation of creator signatures;
  relays cannot enforce it (inherent to Nostr).
