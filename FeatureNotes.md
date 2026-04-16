# Feature Notes

## Unreleased

### Cache Busting / Update Prompt
- Service worker changed from `autoUpdate` to `prompt` mode — new versions install silently in the background and wait for user confirmation before activating
- "New version available" toast banner appears at the bottom of the screen (on login and chat screens) with an **Update** button and a dismiss option
- Clicking **Update** activates the new service worker immediately and reloads the page
- `clientsClaim: true` — new SW claims all open tabs immediately on activation so no tab is left on the old version
- `cleanupOutdatedCaches: true` — old Workbox caches are removed automatically on each update
- `Cache-Control: no-cache` meta tags added to `index.html` to prevent browsers from serving a stale HTML shell from their own cache, independent of the service worker
- `vite-plugin-pwa/client` types added to `tsconfig.app.json` for the `virtual:pwa-register/react` virtual module

### Share Contact via Link
- New "Share Contact Link" card in Settings > Keys, alongside the QR code
- **Web link** — `https://[app-url]/?contact=npub1…` — works in any browser; opening it launches the app and auto-fills the Add Contact modal with your profile pre-loaded
- **Nostr URI** — `nostr:npub1…` — for Nostr-native apps that handle the `nostr:` scheme
- Both links have individual copy buttons; Web Share API button ("Share via…") appears on supporting devices
- **URL handler** in App.tsx: `?contact=npub1…` is consumed on load, the param is removed from the URL history via `history.replaceState`, and the Add Contact modal opens with the profile auto-looked up

### Voice Messages
- Microphone button in the message input (visible when the text field is empty and no attachment is pending)
- Tap to start recording — browser prompts for microphone permission on first use
- Live recording indicator with elapsed / max time (0:00 / 1:00) and a pulsing red dot
- Stop button ends the recording; Cancel discards it entirely
- Recording is capped at 60 seconds; the resulting audio blob is encoded as a base64 data URL and checked against a 200 KB relay-safe limit before attaching
- Preview shows an inline audio player before sending so the user can review the message
- Voice messages render as a compact audio player in the chat (play/pause, scrub bar, elapsed/total time) for both sender and receiver
- Supports `audio/webm;codecs=opus` (Chrome/Firefox/Edge) and `audio/mp4` (Safari) via auto-detected MIME type
- Microphone permission errors shown as inline error banners

### File Attachments
- Paperclip button in the message input to attach files, photos, documents, audio, and video
- Images are compressed client-side (canvas → JPEG, max 1280px, progressive quality reduction) to stay within the 150 KB relay-safe limit; an error is shown if the image cannot be compressed enough
- Non-image files (PDF, audio, video, text, etc.) accepted up to 100 KB; oversized files are rejected with a clear error message
- Attachment preview before sending: image thumbnail or filename + size with a remove button
- Images render inline in the chat (max 300px tall); other files render as a downloadable card with a type icon, name, and size
- Backwards-compatible: plain text messages are unaffected; the JSON envelope is only used when an attachment is present
- 16 new unit tests covering parse/serialize round-trips, size constants, and byte formatting (`src/__tests__/fileUtils.test.ts`)

### Search Messages
- Search bar in the sidebar filters across all in-memory messages (channels + DMs)
- Starts searching after 2 characters are typed
- Results show chat name, sender, highlighted match snippet, and timestamp
- Sorted by most recent first (up to 50 results)
- Tab switcher hides while a search is active; cleared query restores normal view
- Clicking a result navigates to that chat (closes mobile drawer)

### Sidebar Width Fix
- Fixed desktop sidebar shrinking when switching to Messages or Contacts tabs
- Root cause: `sidebarContent` div lacked `w-full`, so flex child sized to content

_See [ReleaseNotes.md](./ReleaseNotes.md) for the full history._
