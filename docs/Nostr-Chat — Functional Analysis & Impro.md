 Nostr-Chat — Functional Analysis & Improvement Proposal

  1. What the app is

  A decentralized, installable PWA chat client (React 19 + TypeScript + Vite + Zustand) that uses the Nostr protocol as its entire backend. There is no 
  server you own — all state lives in relays + the browser's IndexedDB (Dexie, namespaced per user pubkey). Settings/contacts/keys are synced across
  devices by self-encrypting them into Nostr events.

  2. Functional map (what works today)

  ┌──────────────────┬────────────────────────────────────────────────────────────────────────────────────────────┬─────────────────────────────────┐   
  │      Domain      │                                       Implementation                                       │              Notes              │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ Auth             │ keygen, nsec/hex import, QR share; per-pubkey Dexie DB                                     │ Private key persisted as        │   
  │                  │                                                                                            │ plaintext hex in IndexedDB      │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ DMs              │ NIP-04 (kind 4), optimistic send, send/sent/failed status + retry                          │ NIP-04 is legacy                │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ Public channels  │ kind 40 create/discover, kind 42 messages, NIP-10 replies                                  │                                 │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ Groups           │ Symmetric AES-GCM key per group (kind 1042 msgs, 30040 metadata, 30041 self-backup),       │ No member mgmt / rekey          │   
  │                  │ invites via NIP-04 DM                                                                      │                                 │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ Files            │ Chunked over events (≤50 MB, 100 KB base64 chunks), MIME allowlist, image compression      │ Not supported in groups         │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ Voice            │ MediaRecorder → attachment                                                                 │                                 │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ Calls            │ 1:1 WebRTC audio/video signaled over kind 24100, STUN + optional TURN (Metered/custom),    │ 1:1 only                        │   
  │                  │ ICE-failure banner                                                                         │                                 │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ Presence         │ Ephemeral typing indicator (kind 24101)                                                    │ DM + channel only, not groups   │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ Inbox            │ Global subscriptions for DMs/channels/groups → unread counts, previews, notifications;     │ Solid design                    │   
  │                  │ dedup via processedIds + Dexie                                                             │                                 │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ Requests/privacy │ Unsolicited-DM gating (pending/accept/dismiss/block), Privacy tab                          │ Client-side only                │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ Sync             │ NIP-02 contacts, NIP-51 channel bookmarks, NIP-78 settings, group-key backups; debounced   │                                 │   
  │                  │ publish                                                                                    │                                 │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ Notifications    │ Browser notifications, per-type toggles, sound, DND scheduling, per-chat mute              │                                 │   
  ├──────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────┤   
  │ UX               │ Drafts, unread divider, date separators, jump-to-message, scoped search, media gallery,    │                                 │   
  │                  │ link previews, sanitized markdown, mobile/desktop responsive                               │                                 │   
  └──────────────────┴────────────────────────────────────────────────────────────────────────────────────────────┴─────────────────────────────────┘   

  The architecture is genuinely good: shared idempotent event processors (lib/inbox.ts), a clean Zustand store, debounced relay sync, careful dedup
  across subscription overlap, and defensive validation on every inbound payload (file manifests, call signals). This is well above typical
  hobby-project quality.

  3. Key findings & proposed improvements

  I've grouped these by priority. The top three are the ones I'd act on first.

  🔴 Priority 1 — Security & privacy (the app's whole reason to exist)

  1. Migrate DMs off NIP-04 to NIP-44 + NIP-17 gift-wrap. NIP-04 is deprecated: it leaks the recipient (p tag), exact message length, and conversation
  graph to every relay, and its crypto is weak by modern standards. NIP-44 (ChaCha20 + HMAC + padding) plus NIP-17 sealed/gift-wrapped DMs hides
  metadata. For a "censorship-resistant private chat" this is the single highest-value change. Suggest: support both, read legacy NIP-04, write
  NIP-44/17.

  2. Stop storing the private key in plaintext. privateKeyHex is persisted via partialize into IndexedDB unencrypted — any XSS or local access yields
  the nsec. Two complementary fixes:
  - Add NIP-07 support (window.nostr) so power users sign with Alby/nos2x and never paste an nsec into the page.
  - For pasted keys, encrypt at rest with a passphrase (PBKDF2/Argon2 → WebCrypto), decrypt into memory on unlock.

  3. Fix the group security model. The current model is a shared symmetric key with no rotation and no membership enforcement — anyone who ever held the
  key can read all past and future messages, and memberPubkeys is set once at creation with no add/remove or rekey. At minimum: document this clearly
  in-UI, add member-management with key rotation on removal, and consider moving toward MLS (NIP-104) longer term.

  🟠 Priority 2 — Reliability & scalability

  4. Replace event-chunked file transfer with NIP-94 / Blossom. Pushing 50 MB as ~500 sequential kind-4/42 events is fragile (no per-chunk ack or resend
  — one dropped chunk silently fails the whole transfer, GC'd after 15 min) and abusive to public relays that rate-limit or cap event size. Upload to a 
  Blossom/NIP-96 media server and send a link + hash instead. Keep small inline images as-is.

  5. Add message pagination / virtualization. MessageList renders every message and subscriptions use limit: 200 with no "load older." Large channels
  will jank and memory-bloat. Add windowed rendering (e.g. virtualization) and an infinite-scroll backfill using until filters.

  6. Adopt the NIP-65 outbox model. The app fan-outs every read/write to all relays. NIP-65 (kind 10002 relay lists, per-relay read/write marking)
  improves deliverability, reduces duplicate load, and is how the wider Nostr ecosystem finds users.

  7. Deduplicate overlapping subscriptions. useGlobalInbox and useGroupInviteListener both subscribe to {kinds:[4], '#p':[me]} — two identical relay
  subscriptions. Merge them.

  🟡 Priority 3 — Features users will expect

  - Reactions (NIP-25) and edit/delete (NIP-09) — currently none.
  - Delivery/read receipts — status is local-only; no "delivered/read."
  - Real mentions (NIP-27) — mention detection is content.includes(pubkey) (substring-fragile, false positives); render proper nostr: mentions and
  notify reliably.
  - Group calls and call history / missed-call records.
  - NIP-05 / profile search for discovering and verifying contacts.

  🟢 Priority 4 — Code quality & DX

  - Test coverage: good lib coverage (crypto, inbox, sync, fileUtils) but the large UI components (MessageThread, Sidebar) are untested. Your own
  standard targets 80%.
  - Mention check correctness (see above) is also a latent bug, not just a feature gap.
  - MessageThread.tsx is ~990 lines — over your 800 max; the three thread variants share enough to extract a useChatThread hook.

  4. Suggested sequencing

  1. NIP-07 signer + encrypt-key-at-rest (security, self-contained)
  2. NIP-44/NIP-17 DMs (security, highest user value)
  3. NIP-94/Blossom file transfer (reliability)
  4. Message virtualization + pagination (scalability)
  5. Group key rotation + member management
  6. NIP-65 outbox, reactions, receipts

  ---
  Want me to go deeper on any one of these? I'd suggest starting with a focused design pass on #1 (NIP-07 + key-at-rest) or #2 (NIP-44/17 DMs) — both
  are well-scoped and address the app's core value proposition. If you pick one, I can run it through the brainstorming/planning flow and produce an
  implementation plan.
