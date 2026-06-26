# Release Notes

## 1.0.0-alpha.15 — 2026-06-25

### Features

#### Signer Abstraction
All signing and encryption now flow through a single `Signer` interface (a module singleton, like the existing relay pool and per-user database) instead of passing the raw secret key around the app. Two implementations back it: a `LocalSigner` that holds a key in memory, and a `Nip07Signer` that delegates to a browser extension. This is the seam the rest of this work — and the planned NIP-44/NIP-17 encrypted-DM work — builds on; it carries a `caps` capability flag (currently `nip04`) that the UI reads to enable or degrade features per signer.

#### Private Key Encrypted at Rest
The Nostr private key is no longer stored in plaintext. Previously the key sat unencrypted in the browser's IndexedDB, readable by anyone with device access or any script-injection. Now, by default, the key is wrapped with a non-extractable device key (AES-GCM) so its raw bytes can't be read out of the database. This is honest obfuscation, not a vault — on-device code can still ask the browser to decrypt — but it removes plaintext-at-rest and is the baseline for the opt-in passphrase below. Existing users are migrated transparently on next load: the old plaintext key is re-wrapped and stripped from storage with no action required. The in-memory `nsec` for export is recomputed from the unlocked key and is never persisted.

#### Opt-in Passphrase
You can protect your key with a passphrase (Settings → Keys). When set, the key is encrypted with a passphrase-derived key (PBKDF2-SHA-256, 600k iterations, salt and iteration count stored per record) and the device key is removed — the passphrase becomes the only way in. On a cold start, a new Unlock screen asks for it before the app loads; a wrong passphrase is rejected cleanly. You can set, change, or remove the passphrase at any time (removing reverts to device protection). Re-logging in with the same key no longer silently downgrades passphrase protection back to device mode.

#### Login with a Browser Extension (NIP-07)
On desktop browsers with a Nostr signer extension installed (Alby, nos2x, etc.), a "Login with Extension" option lets you sign in without ever pasting your nsec into the app — the extension holds the key and performs signing. No secret is stored locally for extension logins. On reload the app re-acquires the signer from the extension; if the extension is missing, a Reconnect screen lets you retry or switch to a different account. The option only appears when an extension is present, so mobile and extension-less browsers are unaffected and continue to use the local-key path (which works on every platform).

#### Graceful Degradation for Limited Signers
Some extensions implement newer encryption (NIP-44) but not the NIP-04 this app currently uses for DMs, calls, and group-key backups. When you sign in with such a signer, those features are disabled with a clear in-app notice and public channels keep working — rather than failing silently. This is forward-compatible with the planned NIP-44 migration.

#### Scalable Message History (Virtualization + Backfill)
Long conversations are now fast and their full history is reachable. Previously the app loaded a chat's entire local history into memory and rendered every message into the page at once, so big channels janked and bloated memory; and history older than the most recent batch the relays returned was simply unreachable. Now the message list is virtualized — only the messages on screen are rendered — so scrolling stays smooth no matter how long the chat is. Opening a chat loads just the most recent page; scrolling up loads older messages a page at a time, first from the local database and then, once local history runs out, by backfilling from the relays. The list stays anchored to the message you're reading while older ones load in above. Jumping to a message (for example from search) now pages history back until it finds the target, then scrolls to and highlights it; if it truly can't be found, a brief "Message not available" notice appears. Virtualization especially helps lower-powered phones, and the scroll, anchoring, and keyboard behavior are tuned for mobile browsers and the installed PWA.

#### Off-Relay File Transfer (Blossom)
Files no longer travel over relays. Previously a large attachment was split into hundreds of sequential events and reassembled on the other side — fragile (one dropped piece silently failed the whole transfer), abusive to relays, and discarded after 15 minutes. Now files above 150 KB are uploaded to a Blossom media server and the message carries just a link plus a content hash. Privacy is preserved: files in direct messages and groups are encrypted on your device before upload (a fresh per-file key that travels only inside the already-encrypted message), so the server stores nothing but opaque ciphertext; public-channel files are uploaded as-is. On the receiving side the app downloads the file, verifies its SHA-256 hash before showing it (a tampered or substituted file is rejected, never rendered), and decrypts it for private chats. The media server is configurable in Settings → Files (default included) and only the sender needs one — recipients fetch from the link. Group chats can now send files for the first time. Small images stay inline as before, and files sent with the old chunked method still display.

#### Relay Read/Write Lists (NIP-65)
The app now follows the NIP-65 "outbox" convention for relays. Each relay can be marked Read, Write, or both in Settings → Relays, and the app publishes a standard relay-list event (kind 10002) so other Nostr clients can discover where to reach you. Your own messages and events are sent to your write relays, and your inbox is read from your read relays, instead of fanning every request out to every relay. On sign-in the app adopts your published relay list as the source of truth. This is a behavior-preserving change by default: until you deliberately split a relay into read-only or write-only, every relay stays both, so routing is identical to before.

The app now also routes through *other people's* relay lists — the full outbox model. The first time you message someone, open their profile, or load their messages, the app looks up their published relay list (cached for a day) and uses it: a direct message is sent to the recipient's read relays so it reaches them, their replies are read from their write relays, and a contact's profile is fetched from where they publish it. If someone hasn't published a relay list, the app falls back to your own relays exactly as before, so nothing breaks. This makes direct messages far more likely to be delivered and seen across the wider Nostr network, with less wasted traffic. (Channels and groups continue to use your own relays.)

### Changes

#### Full Sign-out Cleanup
Logging out now deletes the encrypted key, the device wrap key, and the stored sign-in method (in addition to clearing the in-memory key and active account), so no key material is left at rest for the next person to use the device. The deletion completes before the database is closed.

#### Deduplicated Direct-Message Subscriptions
Incoming direct messages were being fetched and decrypted twice. Two separate listeners — the global inbox and a dedicated group-invite watcher — each opened the same relay subscription for kind-4 DMs addressed to you and independently ran the NIP-04 decryption on every one. Group-invite handling now lives in the shared message processor, so a single subscription decrypts each DM once and routes it to either the chat flow or the invite-join flow. This halves the relay load and per-message decryption work for DMs, and removes a redundant subscription. Joining a group from an invite remains idempotent — replays from overlapping subscriptions or relay backfill can't add a group twice or re-publish its key backup.

---

## 1.0.0-alpha.14 — 2026-06-12

### Features

#### Global Message Inbox
DMs, channel messages, and group messages now arrive while their chat is closed. App-level subscriptions keep unread badges, sidebar previews, and notifications current for every conversation — previously these only updated for the chat you had open. Relay backfill is distinguished from live messages (via EOSE), so logging in no longer floods you with notifications or inflated unread counts for old history, and shared event processors deduplicate side effects between the global and per-chat subscriptions.

#### Message Requests
Direct messages from people who aren't your contacts are held as message requests instead of landing directly in your conversation list. Requests appear in a dedicated "Message requests" section of the Messages panel and never trigger a notification (badge only). Opening one shows Accept, Dismiss, and Block actions; replying accepts automatically. Pending requests are never published to your public contact list — only accepting adds you.

#### Blocking and Privacy Settings
Block durably hides a sender across all your devices (synced via your relays); dismiss quietly drops a request and records a timestamp so old relay backfill can't resurrect it. A new Settings → Privacy tab lists everyone you've blocked with one-click Unblock.

### Bug Fixes

#### Nostr Event Kinds
- Group messages moved off kind 10042, which sits in NIP-01's replaceable range where relays keep only the latest event per author — group history was at risk of collapsing to one message per member. They now use regular-range kind 1042, and both kinds are read for backward compatibility with messages already on relays.
- Typing indicators moved off kind 24133, which collides with NIP-46 (Nostr Connect), to kind 24101.
- Accepting a previously dismissed request now clears its dismissal record so the contact's earlier history is no longer silently filtered out.

---

## 1.0.0-alpha.13 — 2026-06-12

### Changes

#### Public README
New public-facing README with feature overview and screenshot.

#### Code Quality
Maintenance release reducing technical debt; no user-facing behavior changes.
- Repaired the ESLint flat config (lint was failing to run at all) and resolved every lint error and warning: intentional empty `catch` blocks and `_`-prefixed unused vars are now configured, `coverage/` is ignored
- Fixed stale-closure reads of profiles in relay subscription hooks; callbacks now read the latest profiles from the store
- New `useStableArray` hook keys relay subscriptions on relay-list contents, preventing unnecessary teardown/resubscribe when settings sync rewrites the relay array with identical values
- QR scanner `start`/`stop` callbacks are now referentially stable
- Moved `formatDuration` out of the `AudioMessage` component into `src/lib/format.ts`
- `package.json` version re-aligned with release tags (was stuck at 1.0.0-alpha.9)

---

## 1.0.0-alpha.12.1 — 2026-05-15

### Bug Fixes

#### Test Suite — CI Stability and Node.js 25 Compatibility
- Fixed an uncaught exception that caused CI to fail despite all 177 tests passing: `fetchEvents` was not mocked in the test setup, so `syncFromRelays` made real `SimplePool` WebSocket connections on login; these resolved asynchronously after tests ended, triggering an undici/JSDOM cross-realm `Event` class mismatch
- Fixed `localStorage` failures on Node.js 25+, which ships a native `localStorage` stub that shadows JSDOM's implementation and doesn't function without `--localstorage-file`; replaced with an in-memory mock in the test setup

---

## 1.0.0-alpha.12 — 2026-05-15

### Features

#### Encrypted Private Group Chats
Create groups with AES-256-GCM symmetric encryption; group keys distributed via NIP-04 DMs and backed up to relays via self-encrypted kind-30041 events for cross-device recovery; Contacts section replaced by Groups in the sidebar.

#### Scoped Search Bars in Messages and Channels
Filter conversations or channels by name in the Messages and Channels sidebar panels, with individual message results shown below; clicking a result jumps directly to that message with a highlight animation; queries reset automatically when switching panels.

#### Icon Action Buttons
New message and add channel icon buttons replace the previous text-only action buttons in sidebar panels.

---

## 1.0.0-alpha.11 — 2026-05-13

### Features

#### Scroll-to-Bottom Button
Floating circular button in the bottom-right corner of the chat that appears when scrolled up and disappears when at the bottom. Tapping scrolls smoothly to the latest message.

---

## 1.0.0-alpha.10 — 2026-05-12

### Features

#### Mobile Bottom Nav Always Visible
The bottom navigation bar on mobile is now always accessible, even when a section sheet (Messages, Channels, etc.) is open.
- Bottom nav raised to `z-[60]`, sitting above the section sheet (`z-50`) at all times
- Sheet height shortened so it stops at the nav's top edge instead of extending behind it
- All true overlays (modals, lightboxes, call overlay, toasts) raised to `z-[70]` so they correctly cover the nav when active

#### TURN Server Cross-Device Sync
TURN server configuration (Settings → Calls) now syncs across devices via NIP-78 (kind 30078) Nostr events, encrypted to the user's own key.
- Save your TURN config on one device and it's available when you log in with the same key on another
- Media device preferences (microphone/camera) remain local-only

### Changes
- Log out moved from the navigation rail (desktop) and sheet footer (mobile) into the Settings section, as the last item below a divider

---

## 1.0.0-alpha.9 — 2026-05-11

### Features

#### Cross-Device Sync via Nostr Relays
Contacts, joined channels, and settings are now stored on the user's own relays and automatically synced across devices — no external service required.
- **Contacts** (NIP-02, kind 3) — contact list published as a replaceable event; merged additively on login
- **Joined channels** (NIP-51, kind 30001) — list of joined channel IDs; merged additively on login
- **Settings** (NIP-78, kind 30078) — notification preferences, muted chats, and relay list; NIP-04 encrypted to the user's own public key; applied on login if the relay event is strictly newer than the last known sync
- On login all three are fetched in parallel via `syncFromRelays()`; login is never blocked by the sync
- Mutations debounced at 1.5 s before republishing to avoid relay floods
- Settings conflicts resolved by `syncedSettingsAt` timestamp: relay settings only overwrite local when newer

#### Relay Connection Health
Live per-relay connection status, visible without leaving the app.
- **Settings → Relays tab** — each relay row shows a colored dot (green = connected, pulsing gray = connecting, red = disconnected) and an `ok` / `…` / `error` label; header updates to "X / N relays connected"
- **Sidebar Settings menu** — Relays item shows a live `connected/total` count badge, highlighted amber when any relay is unreachable
- **Desktop nav rail** — small amber dot on the Settings icon when one or more relays are down; disappears when Settings is open or all relays recover
- Powered by `useRelayHealth` hook: calls `pool.ensureRelay()` on mount then polls `pool.listConnectionStatus()` every 5 seconds

#### Smart Auto-Scroll
The message list no longer interrupts reading history when new messages arrive.
- A scroll listener tracks whether the bottom of the list is within 120 px of the viewport
- Incoming messages only trigger a scroll-to-bottom when the view is already near the bottom
- Initial open still scrolls to the "New messages" divider (if present) or the bottom

### Bug Fixes
- **Chunked file transfer message ID collision** — completed transfers were stored with ID `transfer-${senderPubkey}-${createdAt}`, which could collide when the same sender transferred two files within the same second; ID is now `transfer-${transferId}` (128-bit cryptographically random hex)

### Testing
- Added 22 unit tests covering previously untested store actions: `updateMessageStatus`, `markRead`, `setProfile`, `updateContactLastMessage`, `updateChannelLastMessage`, `muteChatUntil`, `unmuteChat`, `setDraft`, `clearDraft`, `updateSeenAt`, `loginFromHex`; suite grows from 127 to 149 tests

---

## 1.0.0-alpha.8.1 — 2026-04-29

### Bug Fixes
- After opening settings, cannot open later messages or other actions outside settings

---

## 1.0.0-alpha.8 — 2026-04-29

### Features

#### Per-User IndexedDB Storage (Dexie.js)
- All app data is now stored in a per-user IndexedDB database (`nostr-chat-<pubkey>`), fully scoped to the logged-in Nostr identity
- Switching users loads that user's own contacts, channels, and settings — no data leakage between accounts
- Chat messages are cached for offline viewing with a 7-day rolling TTL; old messages are automatically evicted on startup
- On startup the app reads `nostr-active-pubkey` from localStorage, opens the matching Dexie DB, evicts stale messages, then rehydrates Zustand — all before rendering
- Persisted per user: contacts (with profiles, last message, unread counts), channels, joined channel IDs, cached Nostr profiles, notification settings, relays, auth credentials, and call settings

### Bug Fixes
- **TURN subdomain double-suffix** — Saving a Metered.ca subdomain would produce `<subdomain>.metered.live.metered.live` (double domain suffix). The subdomain input now strips any trailing `.metered.live` before saving.

---

## 1.0.0-alpha.7 — 2026-04-29

### Features

#### Sidebar Redesign — Icon Rail + Collapsible Sections
- Replaced the single full-width sidebar with a narrow 56 px icon rail whose icons open collapsible section panels
- Icon rail order: Search · Messages · Channels · Contacts — spacer — Settings · Avatar · Logout
- Clicking the active icon collapses its panel; selecting a chat auto-collapses the panel on mobile
- Section panel slides in next to the rail on desktop (300 ms ease-in-out); panel replaces the rail on mobile
- Mobile: fixed bottom nav bar (Search / Messages / Channels / Contacts / Settings) replaces the previous hamburger drawer; tapping an icon slides up a sheet from above the nav bar; profile + logout live in the sheet footer
- Removed the mobile "Open Menu" top bar and the hamburger button from the empty-chat state

#### Settings as a First-Class Screen
- Settings is no longer a modal; it opens in the main area as a full-width page
- The Settings section in the sidebar shows a vertical menu: Profile · Relays · Keys · Calls · Notifications
- Clicking a menu item opens that settings screen in the main area, replacing the chat view
- `IceFailureBanner` "Settings → Calls" link navigates directly to the Calls settings screen

#### Profile Card on Avatar Tap
- Tapping any avatar (message list, DM header, contact list) opens a modal profile card
- Card shows: avatar, display name, NIP-05 identifier, about text, copyable public key (npub)
- "Send Message" button adds the contact and navigates to their DM; hidden when viewing your own profile
- Backdrop click or X button closes the card

#### TURN Server Sharing via Encrypted Call Offer
- The caller fetches fresh time-scoped TURN credentials at call-initiation time and includes them in the encrypted `call-offer` Nostr signal
- The callee merges the caller's ICE servers with their own when creating the `RTCPeerConnection`, so both parties can relay through the caller's TURN server for that call
- Credentials are NIP-04 encrypted in transit and expire automatically; no extra revocation needed
- Custom and "none" TURN modes are unaffected — their ICE config continues to come from the local cache

---

## 1.0.0-alpha.6.1 — 2026-04-27

### Bug Fixes
- **Horizontal scroll in chat** — Long URLs in messages caused the entire chat pane to scroll horizontally on all platforms. Fixed by adding `break-all` to link text in the markdown renderer, `min-w-0 overflow-hidden` to message bubbles so they cannot push past their flex container's `max-width`, and `overflow-x-hidden` on the message list scroll container as a final backstop.

---

## 1.0.0-alpha.6 — 2026-04-27

### Features

#### Unread Message Divider
- A purple "New messages" separator appears before the first unread message when you open a chat that received messages since your last visit
- The view scrolls to the divider on open so the first unread message is immediately visible
- The cutoff timestamp is persisted across page refreshes and updated when you leave the chat

#### Media Gallery
- Photos icon in every channel and DM header opens a "Shared Media" grid of all images shared in that conversation
- Tapping a thumbnail opens a full-screen lightbox with prev/next navigation (←/→ keys on desktop), download button, and image counter
- Newest images shown first; empty state displayed when no images have been shared yet

#### Draft Persistence
- Unsent text is saved per-chat when you switch away and restored when you return
- Drafts are held in memory for the session and cleared automatically on send

#### Message Send Status
- Own messages show a live status indicator next to the timestamp: spinner while sending, checkmark on success, red alert icon on failure
- Tapping the red alert icon retries the failed send — the original signed event is reused, no re-signing
- Optimistic messages use the real event ID so the relay echo is silently deduplicated with no duplicate bubbles
- Applies to regular text and inline-attachment messages in both channels and DMs; chunked file transfers are unaffected

### Fixes
- Message timestamps are now always visible next to each bubble instead of appearing only on hover, fixing mobile where hover never fires

---

## 1.0.0-alpha.5.5 — 2026-04-26

### Features

#### Reply / Quote Messages
- Swipe right on any message bubble to quote-reply on mobile; hover to reveal the reply icon button on desktop
- A reply banner appears above the input showing the original sender's name and a text preview; tap × to cancel
- Replied-to messages render a quoted block inside the bubble — purple left border, sender name, and preview text
- Channel replies include a NIP-10 `['e', replyEventId, '', 'reply']` tag for interoperability with other Nostr clients
- DM reply context is serialised into the encrypted JSON envelope, preserving end-to-end encryption

#### File Attachment Limit Raised to 50 MB
- Maximum attachment size raised from 10 MB to 50 MB — covers typical iPhone videos
- Chunk size doubled (53 KB → 100 KB base64) so event count for a 50 MB file (~500) stays comparable to the old 10 MB limit
- Receive-side GC timeout extended from 5 min to 15 min so large transfers are not pruned mid-flight

### Bug Fixes
- **Attachment preview showed raw JSON** — sidebar last-message preview and desktop notifications for messages with file attachments now display human-readable text (`Image: photo.jpg`, `Voice message`, `File: doc.pdf`) instead of the raw JSON envelope

---

## 1.0.0-alpha.5.4 — 2026-04-22

### Features

#### Settings → Calls Tab
- New **Calls** tab in the Settings modal (between Keys and Notifications)
- **TURN Server** section with three options:
  - *None* (default) — public STUN only, no setup required
  - *Metered.ca* — enter project subdomain + API key; ephemeral credentials are fetched from the Metered.ca API on save and stored in `localStorage` under `turn_config`
  - *Custom* — enter a `turn:`/`turns:` URL with optional username and password; stored in `localStorage` under `turn_config`
- **Test Connection** button: creates an `RTCPeerConnection` with the saved config, looks for a relay ICE candidate within 10 seconds, and shows ✅ Relay reachable or ❌ Could not reach relay inline
- **Media Devices** section: Microphone and Camera dropdowns populated via `enumerateDevices()`; selections persist to `localStorage` (`media_audio_device` / `media_video_device`) and are applied automatically when calls start; permission unlock button shown when device labels are hidden by the browser
- `getIceServers()` utility replaces the hard-coded ICE server list throughout the app — always includes Google + Cloudflare STUN as the base, appends saved TURN config if present
- **ICE failure banner**: non-blocking dismissible toast shown when a call's ICE negotiation fails; includes a deep-link that opens Settings directly on the Calls tab
- **CSP**: added `turns:` scheme (TLS-wrapped TURN, distinct from `turn:`) and `https://*.metered.live` (Metered credential API) to `connect-src`

### Incoming Call Notifications
- Repeating two-tone ringtone (880 / 1100 Hz, 1.5 s cycle, up to 60 s) plays when an incoming call arrives; stops automatically when the call is accepted, declined, or cancelled
- Browser Notification banner shown with the caller's name when the app is backgrounded and notification permission is granted
- Do Not Disturb suppresses both ringtone and banner
- **Settings → Notifications → Calls** section added below Channels with independent toggles for "Show incoming call notification" and "Play ringtone" (both on by default)

---

## 1.0.0-alpha.5.3 — 2026-04-20

### Bug Fixes
- **No audio in audio calls** — Remote stream was received and the WebRTC connection was established (video calls confirmed P2P works), but for `mediaType === 'audio'` no DOM element was given the stream to play — the branch only rendered an avatar. Added a hidden `<RemoteAudio>` component (`<audio autoPlay>`) that mounts unconditionally for both call types and keeps `srcObject` synced to `remoteStream`; `<VideoEl>` continues handling visuals only.
- **CI main deploy cancelled by develop push** — Shared `concurrency.group: pages` caused git flow's simultaneous push of `main` and `develop` to cancel each other (`cancel-in-progress: true`); `main` consistently lost. Changed to `${{ github.workflow }}-${{ github.ref }}` so each branch has its own independent queue.

---

## 1.0.0-alpha.5.2 — 2026-04-20

### Bug Fixes
- **Video/audio calls not connecting** — Two root causes fixed: (1) CSP `connect-src` used specific STUN host URIs; switched to `stun:` / `turn:` scheme wildcards (same pattern as `wss:`) so Chrome resolves ICE server URIs correctly. (2) Nostr relays do not guarantee event ordering — ICE candidates from the caller can arrive at the callee before the `call-offer`; the callId guard was dropping them because `callIdRef` was still empty. Added a `preOfferCandidates` buffer keyed by callId that is flushed into `pendingCandidates` when the offer arrives, so all candidates are applied after `setRemoteDescription`.
- **File attachments silently not delivered** — The 100 KB DoS content-size guard was applied to all incoming events. Inline image attachments encode to up to 150 KB base64; NIP-04 encryption inflates that to ~200 KB, so both exceeded the limit and were silently dropped on the receive side. Split into two limits: `MAX_CONTENT_LEN = 200 KB` for plaintext content (channels and decrypted DMs) and `MAX_ENCRYPTED_CONTENT_LEN = 300 KB` for raw NIP-04 DM events before decryption. DoS protection is maintained — genuinely oversized events are still rejected.

---

## 1.0.0-alpha.5.1 — 2026-04-19

### Bug Fixes
- **WebRTC calls not connecting after CSP hardening** — Chrome 90+ enforces `connect-src` for `RTCPeerConnection` ICE server URIs; the alpha.5 CSP omitted STUN URIs, blocking server-reflexive candidate gathering and preventing cross-network calls from connecting; `stun:stun.l.google.com:19302` and `stun:stun1.l.google.com:19302` added to `connect-src`
- **Voice messages silent on iOS** — `MediaRecorder.start(250)` timeslice caused empty recordings on iOS Safari, which only fires `ondataavailable` reliably on `stop()`; timeslice removed
- **Voice message false "too large" error** — 200 KB guard rejected recordings before they could take the chunked-transfer path (up to 10 MB); guard removed

---

## 1.0.0-alpha.5 — 2026-04-19

### Security Hardening (SAST / DAST / Pentest)
- **Content Security Policy** — `<meta http-equiv="Content-Security-Policy">` added to `index.html`; restricts scripts to `'self'`, blocks `object-src`, locks `base-uri` and `form-action`; `connect-src wss:` allows user-chosen Nostr relays while `https://api.microlink.io` covers link previews
- **Referrer-Policy** — `<meta name="referrer" content="no-referrer">` prevents `?contact=npub1…` share URLs from leaking in `Referer` headers to external sites
- **Avatar URL validation** — `picture` fields from Nostr profiles now validated to `https://` or `http://` only before rendering; `data:`, `javascript:`, and other schemes are dropped; `referrerpolicy="no-referrer"` added to `<img>` to prevent tracking-pixel IP leaks
- **Relay URL validation** — relay input now parsed with `new URL()` and restricted to `wss:` protocol only; non-wss and malformed URLs are rejected with a clear error
- **Transfer ID entropy** — file transfer IDs switched from `Date.now() + Math.random()` to `crypto.getRandomValues()` (cryptographically random 128-bit ID)
- **File transfer input validation** — `handleFileStart` validates name length, MIME type (allowlist: image/audio/video/text/pdf), declared size, and chunk count; `handleFileChunk` validates chunk data size, index bounds, and orphan accumulation ceiling
- **CallSignal type guard** — `decryptCallSignal` now uses a full `isValidCallSignal()` guard validating signal type enum, callId length (≤128), SDP length (≤64 KB), and mediaType enum before accepting any WebRTC signaling message
- **Link preview hardening** — microlink.io fetch uses `credentials: 'omit'`; image URL from API response validated to `^https://` before rendering
- **Event content size limit** — channel messages and decrypted DMs over 100 KB are silently dropped, preventing memory/render DoS from oversized relay events
- **`nsec` removed from localStorage** — `nsec` (bech32-encoded private key) is no longer persisted to localStorage; it is derived from `privateKeyHex` via `onRehydrateStorage`, eliminating the duplicate key copy in storage

### Bug Fixes
- **Call overlay desktop layout** — call controls were invisible on landscape/widescreen desktops because they sat in a flex row below a `flex-1` video area that consumed all available height; controls moved to an `absolute` overlay anchored at the bottom of the video area; remote video switched from `object-cover` (over-cropped portrait camera) to `object-contain` with letterboxing

### Refactor / Technical Debt
- `CallContext` SDP non-null assertions replaced with runtime type guards
- `AudioMessage` pause-on-unmount cleanup prevents post-unmount state updates
- Sidebar tab switcher collapsed from three repeated blocks to a mapped constant array
- `MessageThread` max-textarea-height magic number extracted to a named constant
- `nostr.ts` profile JSON cast narrowed from `any` to `Partial<NostrProfile>`

---

## 1.0.0-alpha.4 — 2026-04-18

### Audio & Video Calls
- Phone and video call buttons in DM headers — disabled while a call is already active
- **Signaling** via NIP-04-encrypted ephemeral Nostr events (kind 24100): offer / answer / ICE candidates / hangup are relayed but not stored
- **Media** streams are WebRTC peer-to-peer — audio and video never touch the relay
- **Incoming call** full-screen overlay: caller avatar, Accept (green) and Decline (red) buttons
- **Active call UI**: remote video fullscreen (or animated audio-pulse avatar for audio-only), local video picture-in-picture (mirrored, bottom-right), mute / camera toggle / hang-up controls, live duration timer
- Busy-rejection: a second incoming call while already connected receives an automatic busy signal
- ICE candidates buffered until remote SDP is applied to handle out-of-order arrival
- STUN via Google's public servers (`stun.l.google.com`); P2P on same-network and open-NAT connections

### Screen Sharing
- Share your screen during any active video call via the screen-share button in the call controls
- Button is disabled until the WebRTC P2P connection is established
- Screen track replaces the outgoing video track via `RTCRtpSender.replaceTrack()` — no renegotiation
- "Sharing your screen" badge visible in the video overlay
- Stop by clicking the button again or using the OS "Stop sharing" button — both revert to camera
- Cancelling the browser picker is silently ignored; the call continues unaffected

### Image Lightbox
- Tap any image in chat to open a full-screen preview overlay
- `Escape` or click outside to dismiss; zoom-in cursor and icon hint on hover
- Download button and close button in the overlay corner

### Bug Fixes
- **QR code unreadable** — QR was rendered white-on-dark; fixed to standard black-on-white so phone cameras can scan it
- **Voice message Infinity:NaN duration** — `MediaRecorder` blobs lack a duration header; fixed by seeking to `1e10` to force the browser to scan and resolve the real duration
- **Chunked image appears twice for sender** — sender's own subscription re-triggered `finishTransfer`; fixed by skipping when `senderPubkey === publicKey`

### Refactor / Technical Debt
- `getDisplayName()` utility extracted from 8 inline copies across four files
- ReactMarkdown component maps pre-built at module level (previously rebuilt on every render)
- In-flight profile fetch deduplication via module-level `Set`
- Abandoned file-transfer GC (5-minute timeout) prevents unbounded `Map` growth
- `CallContext` SDP validation guards replace non-null assertions
- `LinkPreview` switched to `AbortController`; session cache capped at 100 entries
- Sidebar tab switcher collapsed from three repeated blocks to a mapped array
- `AudioMessage` pauses on unmount to prevent `setState` after unmount

---

## 1.0.0-alpha.3 — 2026-04-17

### Typing Indicators
- Live "Alice is typing ···" feedback powered by ephemeral Nostr events (kind 24133 — relays forward but do not store them)
- Works in both encrypted DMs and public channels
- Sending throttled to one event per 3 seconds to avoid relay floods
- Indicator auto-expires after 5 seconds of silence — no explicit "stopped typing" event needed
- Handles multiple simultaneous typists: "Alice and Bob are typing", "Alice and 2 others are typing"
- Fixed-height row between message list and input prevents layout shift

### Rate Limiting
- Sliding-window limiter: maximum 5 messages per 10 seconds per chat
- On the 6th attempt the send button is replaced with an amber countdown badge (e.g. `3s`) that ticks down to zero
- Each chat thread has its own independent limiter; applies to both text and chunked file transfers

### Chunked File Transfer (up to 10 MB)
- Large files automatically split into ~40 KB binary chunks and sent as sequential Nostr events, bypassing the 64 KB relay message limit
- Raises the effective attachment ceiling from ~150 KB (inline) to **10 MB** per file
- Works for both encrypted DMs (NIP-04) and public channels (NIP-28)
- Upload progress bar shows "Chunk N / total" count with animated fill
- Out-of-order chunk delivery handled via orphan buffer
- Files under 150 KB continue to send inline as before

### Markdown & Link Previews
- Messages render full GitHub-Flavored Markdown: bold, italic, strikethrough, inline/block code, blockquotes, lists, headings, horizontal rules
- Single newlines preserved as line breaks (natural chat behaviour)
- XSS-safe — `rehype-sanitize` strips `<script>`, `<style>`, and event handlers
- Links auto-linkified and open in a new tab
- **Link preview cards** — first URL in a message fetches Open Graph metadata (title, description, thumbnail) via `microlink.io`; results cached per session; silently hidden on error
- Markdown rendered on display only; input stays plain text

### Desktop Notifications
- Browser `Notification` API with urgency hierarchy: DMs (critical) → @mentions (high) → group messages (low/FYI)
- **DMs**: amber badge + desktop banner + sound by default
- **@mentions**: amber badge + desktop banner + sound by default; detected by matching the user's npub/hex pubkey in channel message content
- **Group channels**: gray badge indicator only — no banner, no sound by default (configurable)
- **Contextual suppression** — no popup when the app is focused and the user is already in that chat
- **Per-chat mute** via bell icon in the sidebar (revealed on hover): 8 h, 24 h, 1 week, or always
- **Settings → Notifications tab**: permission request UI, per-type show/sound toggles, Do Not Disturb with presets (1 h / 8 h / 24 h / until I turn off) and live countdown
- Notification sounds generated via Web Audio API oscillator — no audio file required

---

## 1.0.0-alpha.2 — 2026-04-16

### Share Contact via Link
- New "Share Contact Link" card in Settings > Keys (alongside the QR code)
- **Web link** — `https://[app-url]/?contact=npub1…` — works in any browser; opening it pre-fills the Add Contact modal and auto-looks up the profile
- **Nostr URI** — `nostr:npub1…` — for Nostr-native apps that handle the `nostr:` scheme
- Both links have individual copy buttons; "Share via…" button uses Web Share API on supporting devices
- URL handler strips `?contact=` from the address bar via `history.replaceState` after consumption

### Voice Messages
- Microphone button in the message input (shown when text field and attachment are empty)
- Live recording indicator with pulsing red dot and elapsed / max time (0:00 / 1:00)
- Stop button ends recording; Cancel discards it; auto-stops at 60 seconds
- Audio encoded as base64 data URL, validated against 200 KB relay-safe limit before sending
- Inline audio player in chat (play/pause, scrub bar, elapsed/total time) for sender and receiver
- Supports `audio/webm;codecs=opus` (Chrome/Firefox/Edge) and `audio/mp4` (Safari)

### File Attachments
- Paperclip button attaches images, PDFs, audio, video, and text files
- Images compressed client-side (canvas → JPEG, max 1280px, progressive quality) to fit the 150 KB relay limit
- Non-image files accepted up to 100 KB raw; oversized files rejected with a clear error message
- Attachment preview before sending: thumbnail for images, audio player for voice, filename+size for files
- Images render inline (max 300px); other files as a downloadable card with type icon, name, and size
- Backwards-compatible: plain text messages are unaffected

### Search Messages
- Search bar in the sidebar filters across all loaded messages (channels + DMs)
- Requires 2+ characters; results show chat name, sender, highlighted match snippet, and timestamp
- Sorted by most recent first, capped at 50 results; tab switcher hides while searching

### Cache Busting / Update Prompt
- Service worker switched to `prompt` mode — new versions install silently and wait for user confirmation
- "New version available" toast with **Update** and dismiss buttons
- `clientsClaim: true` — new SW claims all open tabs immediately on activation
- `cleanupOutdatedCaches: true` — removes stale Workbox caches automatically
- `Cache-Control: no-cache` meta tags on `index.html` to bypass browser-level HTML caching

### Bug Fix — Sidebar Width
- Desktop sidebar no longer shrinks when switching to the Messages or Contacts tab
- Root cause: `sidebarContent` div was missing `w-full`

---

## 1.0.0-alpha.1 — 2026-04-15

### Mobile Rendering Compatibility
- `100dvh` container + `env(safe-area-inset-bottom)` for virtual keyboard and iOS notch/home-indicator support
- Sidebar becomes a slide-over drawer on mobile with backdrop dismiss and ✕ close button; static column on `md+`
- Chat headers show `←` back button on mobile to return to the sidebar
- All modals (Add Channel, Add Contact, Settings) use a bottom-sheet pattern on mobile; centered cards on desktop
- Touch targets increased across list items and icon buttons
- "Enter to send" hint hidden on mobile

### Automated Testing
- Vitest + React Testing Library with `jsdom` environment
- 40 tests across 4 suites: Nostr utilities, store actions, QR pubkey extraction, and LoginScreen component flows
- `@vitest/coverage-v8` coverage reporting
- CI pipeline gates build and deploy behind the test job on all branches

### Share Public Key via QR Code (Settings → Keys)
- Collapsible QR code panel in Settings → Keys tab
- QR rendered with `qrcode` library using `nostr:npub1...` URI format
- Download button saves QR as PNG; Share button uses Web Share API on mobile

### QR Code Contact Scanner (Add Contact)
- "Scan QR" tab in the Add Contact modal
- `useQRScanner` hook opens the rear camera, decodes frames via `jsQR`, stops on match
- Supports `npub1`, `nostr:npub1`, `nprofile1`, and raw hex pubkey QR payloads
- Animated scan-line overlay with corner bracket guides

### Core Application
- Login / signup with keypair generation (nsec/npub) or import of existing key
- Public channels (NIP-28 kind-40/42) — discover, join, and create channels
- Encrypted direct messages (NIP-04 kind-4)
- User profiles (NIP-01 kind-0) with avatar, display name, and NIP-05
- Contact list with last-message preview and unread badge
- Relay management — add/remove relays with live connection via SimplePool
- Zustand store with localStorage persistence
- PWA manifest + Workbox service worker — installable on Android and iOS
- GitHub Actions workflow — tests → build → deploy to GitHub Pages on every push to `main`
