# Read Receipts (DMs, opt-in, ephemeral) — Design Spec

Date: 2026-07-01
Status: Approved for planning

## Goal

Show the sender when a DM peer has read their messages, without creating a
persistent metadata trail on relays and without sending anything unless the
user explicitly opts in.

## Scope

- DMs only. No receipts in channels or groups (v1).
- "Read" only. No "delivered" acks.
- Global opt-in toggle, default OFF, reciprocal: a user who does not send
  receipts also does not see others' receipts.

## Protocol

- New ephemeral event kind `24102`, exported as `READ_RECEIPT_KIND` in
  `src/lib/readReceipts.ts`.
- Content: NIP-04-encrypted to the peer, plaintext JSON
  `{ "read_until": <unix seconds> }`.
- Tags: `[['p', peerPubkey]]`.
- Semantics: a watermark. All of the peer's messages with
  `created_at <= read_until` are considered read. No per-message acks.
- Ephemeral (2xxxx range): relays relay but do not store. If the sender is
  offline when the receipt fires, they miss it until the peer next reads the
  conversation. Accepted trade-off for privacy.

## Send side

New hook `useReadReceipts(peerPubkey)` in `src/hooks/`, modeled on
`useTypingIndicator`:

- Fires only when ALL hold:
  - `readReceiptsEnabled` setting is ON,
  - the DM thread with `peerPubkey` is open,
  - `document.visibilityState === 'visible'`,
  - the newest received message's `created_at` is greater than the last
    watermark sent for this peer.
- Publishes one kind-24102 event with `read_until` = newest received
  message's `created_at`, throttled to at most one event per ~10 s.
- Signing/publishing via existing `getSigner()` / `publishEvent()` helpers.

## Receive side

Same hook (or a small shared subscription) subscribes to
`{ kinds: [24102], authors: [peerPubkey], '#p': [myPubkey] }`:

- Ignore entirely if `readReceiptsEnabled` is OFF (reciprocity).
- Decrypt with NIP-04; validate that `read_until` is a finite number and not
  unreasonably in the future (clamp to `now + 5 min`); drop malformed events.
- Store the max `read_until` per peer in the store's `readUntilByPeer` map,
  persisted like other settings: via the store's persist `partialize` into
  the per-user Dexie settings blob (the same `seenAt`-style pattern used for
  other synced settings), not a new Dexie table or schema bump.
- The Nostr event is ephemeral; the local copy persists so read ticks survive
  reload.

## UI

- `MessageItem` (DM threads only): own messages with `status === 'sent'` and
  `created_at <= readUntil` for that peer render a "read" double-check in
  place of the existing single sent check.
- Derived at render time from the single watermark number; no change to
  stored message `status` values (`sending | sent | failed` unchanged).
- No read ticks shown when the setting is OFF, including previously stored
  watermarks.

## Settings

- New boolean `readReceiptsEnabled`, default `false`.
- Toggle lives in the Privacy tab (`src/components/Settings/PrivacyTab.tsx`)
  with copy explaining reciprocity ("When on, contacts see when you read
  their messages, and you see theirs").
- Synced across devices via the existing NIP-78 settings sync
  (`src/lib/nostrSync.ts`), same as other toggles.

## Error handling

- Decrypt failures and malformed JSON: drop silently (same posture as other
  inbound-event validation in `lib/inbox.ts`).
- Publish failures: ignore; the next read of the conversation retries
  naturally via the watermark check.

## Testing

- Unit: build/parse receipt event round-trip (encrypt/decrypt, kind, tags);
  "should send?" decision (setting off, thread hidden, watermark not
  advanced, throttle window); watermark clamp and malformed-payload
  rejection; derived read-state given messages + watermark.
- UI: `MessageItem` renders read tick when watermark covers the message and
  setting is ON; renders plain sent tick otherwise.
- Follows existing patterns in `src/__tests__/nostr.test.ts`,
  `inbox.test.ts`, and component tests.

## Known limits (accepted)

- Offline senders miss receipts until the peer next opens the conversation.
- Peer with multiple devices: read state converges to whichever device read
  last (max watermark wins).
- Kind 24102 is a custom ephemeral kind, not a finalized NIP; other clients
  will not interoperate.

## Out of scope

- Delivered receipts, per-conversation toggles, receipts in groups/channels,
  persisted receipt events. Group calls are a separate spec.
