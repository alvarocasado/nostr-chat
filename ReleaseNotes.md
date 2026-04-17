# Release Notes

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
