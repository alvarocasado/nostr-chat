# Feature Notes

## Unreleased

### Chunked File Transfer (up to 10 MB)
- Large files are automatically split into ~40 KB binary chunks (53,000 base64 chars each) and sent as sequential Nostr events, bypassing the 64 KB relay message limit
- Raises the effective attachment ceiling from ~150 KB (inline) to **10 MB** per file
- Works for both encrypted DMs (NIP-04) and public channels (NIP-28)
- **Sender UX**: upload progress bar shows "Chunk N / total" count and animated fill; standard file picker (raised limit)
- **Receiver UX**: file reconstructed transparently and displayed as a normal attachment — no action required
- Out-of-order chunk delivery handled via orphan buffer — chunks that arrive before the manifest are stored and applied when the manifest comes in
- Transfer state is ephemeral (module-level `Map`s, not Zustand) — not persisted across page reloads
- Files under 150 KB continue to send inline as before; chunking kicks in only above that threshold

### Markdown & Link Previews
- Messages render full GitHub-Flavored Markdown: bold, italic, strikethrough, inline/block code, blockquotes, ordered/unordered lists, headings, horizontal rules
- Single newlines preserved as line breaks (natural chat behaviour via `remark-breaks`)
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
- **Per-chat mute** via bell icon in the sidebar (revealed on hover): 8 h, 24 h, 1 week, or always; amber bell icon when muted
- **Settings → Notifications tab**: permission request UI, per-type show/sound toggles, Do Not Disturb with presets (1 h / 8 h / 24 h / until I turn off) and live countdown
- Notification sounds generated via Web Audio API oscillator — no audio file required
- All settings persisted to `localStorage` via Zustand

See [ReleaseNotes.md](./ReleaseNotes.md) for the full history.
