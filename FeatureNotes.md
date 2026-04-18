# Feature Notes

## Unreleased

### Bug Fixes
- **QR code unreadable** — QR was rendered white-on-dark (`dark: #ffffff / light: #1f2937`), which most phone cameras cannot decode. Fixed to standard black-on-white with a white background container.
- **Voice message shows Infinity:NaN duration** — `MediaRecorder` blobs lack a duration header so `audio.duration` is `Infinity`. Fixed by seeking to `1e10` on `loadedmetadata` to force the browser to scan the file and resolve the real duration, then resetting `currentTime` to 0. `formatDuration` also guarded against non-finite inputs.
- **Chunked image appears twice for sender** — sender's own subscription processed their own emitted chunks, causing `finishTransfer` to call `addMessage` a second time after the optimistic local add. Fixed by skipping `finishTransfer` when `senderPubkey === publicKey`.

### Image Lightbox
- Tap any image in chat to open a full-screen preview overlay
- `Escape` or click outside to close; zoom-in cursor and icon hint on hover over thumbnail
- Download button and close button in the overlay corner
- Filename label shown below the full-size image

See [ReleaseNotes.md](./ReleaseNotes.md) for the full history.
