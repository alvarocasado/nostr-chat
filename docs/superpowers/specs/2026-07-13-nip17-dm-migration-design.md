# NIP-44/NIP-17 Gift-Wrapped DM Migration — Design

Date: 2026-07-13
Status: Approved
Source: Priority 1 item 1 of `docs/Nostr-Chat — Functional Analysis & Impro.md`
(the doc's "single highest-value change": read legacy NIP-04, write NIP-44/17).

## Problem

All private traffic rides deprecated NIP-04 kind-4 events. Every relay sees
the recipient (`p` tag), exact timestamps, message frequency, and the whole
conversation graph; the cipher itself is weak by modern standards. This
covers not just chat DMs but every kind-4 control payload: group invites,
group rekey/remove, call logs, and DM reactions/edits/deletes.

## Decisions (settled with user)

- **Send gating: kind 10050.** A peer gets NIP-17 gift wrap iff they publish
  a kind-10050 DM-relay list AND our signer has NIP-44 caps; otherwise
  legacy NIP-04. A peer's 10050 exists only if their client reads kind 1059,
  so rollout self-coordinates in a single release — no two-phase deploy.
- **Ephemeral 241xx signals are out of scope** (call signaling 24100, typing
  24101, read receipts 24102). They stay NIP-04-encrypted ephemerals: relays
  do not store them, and gift wrap's ±2-day timestamp fuzz would break the
  stale-call gate and receipt ordering. Revisit later as a nip44-content
  upgrade only.
- **Read both transports forever.** Kind-4 history must stay decryptable and
  legacy peers must keep working; no re-encryption of old messages.
- **Approach A** (full NIP-17 with 10050 gating) over B (NIP-44 inside kind
  4 — keeps the metadata leak) and C (two-phase releases — unnecessary given
  the gate).

## 1. Signer layer

- `Signer` interface gains `nip44Encrypt(peer, plaintext)` /
  `nip44Decrypt(peer, ciphertext)` and `caps.nip44: boolean`.
- `LocalSigner`: implement via nostr-tools `nip44` (v2, conversation key
  from own sk + peer pubkey). `caps.nip44 = true`.
- `Nip07Provider` type gains optional `nip44 { encrypt, decrypt }`
  (`window.nostr.nip44` in modern extensions). `Nip07Signer.caps.nip44 =
  !!provider.nip44`.
- We publish our own kind 10050 only when `caps.nip44` is true — nobody
  advertises a capability their signer cannot decrypt.

## 2. Gift-wrap module (`src/lib/giftWrap.ts`)

- Build: unsigned kind-14 rumor (real `created_at`, `['p', recipient]` tag,
  plaintext content) → kind-13 seal signed via `signer.signEvent`, content =
  `signer.nip44Encrypt(recipient, rumorJson)` → kind-1059 wrap signed by a
  throwaway ephemeral key (local `finalizeEvent`; no signer involvement),
  content = nip44 to recipient from the ephemeral key, `['p', recipient]`,
  `created_at` randomized 0–2 days into the past.
- Hand-rolled from the two signer primitives so one code path serves
  LocalSigner and NIP-07 (nostr-tools' nip17 helpers require a raw private
  key, which NIP-07 never exposes).
- Every send produces two wraps: recipient copy + self copy (how our own
  other devices and backfill see sent messages).
- Unwrap (`unwrapGiftWrap(event)` → `{ senderPubkey, content, createdAt,
  rumorId, tags } | null`): two `nip44Decrypt` calls (wrap, then seal);
  enforce the NIP-17 anti-spoof rule — seal's signing pubkey must equal the
  rumor's `pubkey`, else discard. Size caps mirror the existing
  MAX_ENCRYPTED_CONTENT_LEN / MAX_CONTENT_LEN limits at each layer.
- Message identity = rumor id (stable across both copies); message ordering
  = rumor `created_at`. Wrap `created_at` matters only for relay pagination.

## 3. Capability + relay discovery (`src/lib/dmCaps.ts`)

- Kind 10050 is both the capability signal and the DM-delivery relay list.
- Own 10050: published on login/settings sync (same pattern as the existing
  kind-10002 publish), listing our read relays; only when `caps.nip44`.
- Peer 10050: fetched and cached like the existing `peerRelays` cache (same
  TTL semantics). Peer supports NIP-17 ⇔ has a 10050.
- Delivery: recipient's wrap publishes to their 10050 relays (fallback:
  today's combined-relay targeting when the list is empty/unreachable);
  self-wrap publishes to our own write relays.

## 4. Send path

One builder for all private sends:

```
buildPrivateSend(peer, content) →
  { msgId, createdAt, publishables: [{ event, relays }] }
```

- Gift-wrap path (own `caps.nip44` ∧ peer 10050): msgId = rumor id, two
  publishables (recipient wrap → their DM relays, self wrap → own write
  relays).
- Legacy path: msgId = kind-4 event id, one publishable, targeted exactly as
  today (write relays + peer read relays).
- Migrating call sites: DMThread `handleSend`, `sendDM` helper (DM
  reactions/edits/deletes), CallContext call-log DM, and the three group
  control builders (invite/rekey/remove). Group rekey gates per recipient —
  mixed groups work (10050 members get wraps, legacy members get kind 4).
- `useChatThread`'s pending-retry map widens from one event to the
  publishables list; retry republishes each to its recorded relays. The
  optimistic sending → sent/failed flow is otherwise unchanged.

## 5. Receive path

- Refactor `processDMEvent`: keep decrypt, extract everything after it into
  a shared `routePrivatePayload(senderPubkey, peer, plaintext, createdAt,
  msgId, tags, opts)` — transfer routing, group_invite/rekey/remove
  dispatch, reactions/edits/deletes, call logs, request gating, message
  insert. All kind-4 control payloads are JSON in decrypted content, so they
  migrate with zero payload-level changes.
- New `processGiftWrap(event, myPubkey, relays, opts)`: unwrap → validate →
  dedup on rumor id (existing `claimSideEffects` + Dexie `alreadyStored`,
  already keyed by message id) → same router. Self-wrap and recipient-wrap
  copies share the rumor id, so dedup collapses them.
- Subscriptions: wraps cannot be filtered by author/peer (ephemeral signing
  keys), so a per-chat 1059 filter would be identical to the global one.
  Therefore ONLY the global inbox owns the live `{kinds:[1059], '#p':[me]}`
  subscription (added alongside its kind-4 filter, both forever); the router
  sorts messages to the right chat by unwrapped sender. Per-DM hooks keep
  their kind-4 filters unchanged and gain an initial-page 1059 fetch;
  `history.ts` loadOlder adds the 1059 filter for backfill paging.
- History backfill: wrap filters pad the `until` cursor by 2 days to absorb
  timestamp fuzz. Pagination is approximate for wrapped messages, exact for
  legacy.
- Stored messages: `Message.kind` = 14 for wrapped. Rendering, search,
  previews, and call-log rows are content-driven and do not branch on kind
  (verified).

## 6. UI and gating

- `signerCaps.nip04` remains the DM input gate in v1: every nip44-capable
  signer today also exposes nip04, and the legacy fallback requires it.
- No new UI. The upgrade is invisible; the DM header's "End-to-end
  encrypted" stays truthful in both modes.

## 7. Failure handling

- Publish failures: unchanged optimistic flow (failed → retry republishes
  stored publishables).
- Stale peer-10050 cache: worst case a wrap lands on relays the peer still
  reads; NIP-17 clients read wraps regardless of which relay delivered them.
- NIP-07 strict-prompt configs: two nip44 decrypts per inbound wrap may
  prompt; documented limit (auto-allow the extension or use a local key).

## 8. Testing

- Unit: gift-wrap round trip on both signer types (mocked NIP-07 provider);
  seal/rumor pubkey-mismatch rejection; wrap created_at within [now-2d,
  now]; rumor-id stability across both copies; `buildPrivateSend` gating
  matrix (caps × peer-10050); 10050 build/parse/cache.
- Inbox: wrapped DM inserts with rumor id + rumor createdAt; wrapped
  group_invite routes identically to legacy; dedup across self/recipient
  copies; the entire existing kind-4 suite keeps passing untouched.
- Component: DM send/retry over the widened publishables map.

## Accepted limits (v1)

- No forward secrecy / ratcheting — NIP-17 hides metadata, it does not add
  PFS. MLS (NIP-104) remains the long-term path.
- Wrap backfill over-fetches (all my wraps, not per-peer) — the cost of
  hiding the conversation graph; fine at this app's scale.
- Wrapped-message pagination is approximate (±2-day fuzz).
- Ephemeral 241xx signals keep NIP-04 encryption and visible p-tags (relays
  do not store them; revisit separately).
- A NIP-07 signer without nip44 stays fully on legacy NIP-04 and does not
  publish 10050.
