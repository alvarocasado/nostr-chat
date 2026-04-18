# Feature Notes

## Unreleased

### Bug Fixes
- **QR code unreadable** — QR was rendered white-on-dark (`dark: #ffffff / light: #1f2937`), which most phone cameras cannot decode. Fixed to standard black-on-white with a white background container.
- **Voice message shows Infinity:NaN duration** — `MediaRecorder` blobs lack a duration header so `audio.duration` is `Infinity`. Fixed by seeking to `1e10` on `loadedmetadata` to force the browser to scan the file and resolve the real duration, then resetting `currentTime` to 0. `formatDuration` also guarded against non-finite inputs.
- **Chunked image appears twice for sender** — sender's own subscription processed their own emitted chunks, causing `finishTransfer` to call `addMessage` a second time after the optimistic local add. Fixed by skipping `finishTransfer` when `senderPubkey === publicKey`.

### Refactor / Technical Debt
- **`getDisplayName()` utility** — extracted from 8 inline copies of `profile?.display_name || profile?.name || pubkey.slice(0, N) + '...'` scattered across Sidebar, MessageItem, MessageThread, and useNostrSubscriptions; ellipsis standardised to `…`
- **ReactMarkdown component maps pre-built** — `COMPONENTS_OWN` / `COMPONENTS_OTHER` built once at module load instead of inside the render function; prevents new object references on every paint that defeated ReactMarkdown's internal memoization
- **In-flight profile fetch deduplication** — a module-level `Set<string>` gates concurrent `fetchEvent` calls so a burst of messages from the same unknown sender triggers only one network request instead of N
- **Abandoned transfer GC** — `gcStaleTransfers()` called on each `handleFileStart`; prunes `IncomingTransfer` entries older than 5 minutes to prevent unbounded `Map` growth from failed transfers
- **QR scanner canvas null check** — replaced `getContext('2d')!` non-null assertion with a guarded check that skips the frame and retries via `requestAnimationFrame`

### Image Lightbox
- Tap any image in chat to open a full-screen preview overlay
- `Escape` or click outside to close; zoom-in cursor and icon hint on hover over thumbnail
- Download button and close button in the overlay corner
- Filename label shown below the full-size image

See [ReleaseNotes.md](./ReleaseNotes.md) for the full history.
