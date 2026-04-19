# Release Notes

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
