# Feature Notes

## Released in 1.0.0-alpha.4

### Bug Fixes
- **QR code unreadable** — QR was rendered white-on-dark (`dark: #ffffff / light: #1f2937`), which most phone cameras cannot decode. Fixed to standard black-on-white with a white background container.
- **Voice message shows Infinity:NaN duration** — `MediaRecorder` blobs lack a duration header so `audio.duration` is `Infinity`. Fixed by seeking to `1e10` on `loadedmetadata` to force the browser to scan the file and resolve the real duration, then resetting `currentTime` to 0. `formatDuration` also guarded against non-finite inputs.
- **Chunked image appears twice for sender** — sender's own subscription processed their own emitted chunks, causing `finishTransfer` to call `addMessage` a second time after the optimistic local add. Fixed by skipping `finishTransfer` when `senderPubkey === publicKey`.

### Screen Sharing
- Share your screen during any active video call via the screen-share button in the call controls
- Button is disabled until the WebRTC connection is established (prevents premature track replacement)
- Clicking the button opens the browser's native screen/window/tab picker via `getDisplayMedia`
- Screen track replaces the outgoing video track over the existing P2P connection using `RTCRtpSender.replaceTrack()` — no renegotiation needed
- "Sharing your screen" badge overlaid on the remote-video panel so both parties see the mode clearly
- Stop sharing: click the button again, or use the OS "Stop sharing" button — both revert the sender to the original camera track
- Cancelling the picker (or permission denied) is silently ignored — call continues unaffected
- Screen audio deliberately excluded (`audio: false` in `getDisplayMedia`) to avoid double-audio feedback

### Audio & Video Calls
- Phone and video call buttons in DM headers (disabled while another call is active)
- **Signaling**: NIP-04-encrypted ephemeral Nostr events (kind 24100) carry offer / answer / ICE candidates / hangup — relay-based but ephemeral (not stored)
- **Media**: WebRTC P2P — audio and video streams travel directly between peers, never through relays
- **Incoming call**: full-screen overlay with caller avatar, Accept and Decline buttons
- **Active call UI**: full-screen overlay — remote video (or animated audio-pulse avatar for audio-only calls), local video picture-in-picture (mirrored, bottom-right), mute / camera toggle / hang-up controls, live duration timer
- Busy-rejection: if a call arrives while already in a call, caller receives an automatic busy signal
- ICE candidates buffered until remote SDP is set to handle out-of-order arrival
- STUN via Google's free servers (`stun.l.google.com`); works on same-network and open-NAT connections

### Refactor / Technical Debt
- **`getDisplayName()` utility** — extracted from 8 inline copies of `profile?.display_name || profile?.name || pubkey.slice(0, N) + '...'` scattered across Sidebar, MessageItem, MessageThread, and useNostrSubscriptions; ellipsis standardised to `…`
- **ReactMarkdown component maps pre-built** — `COMPONENTS_OWN` / `COMPONENTS_OTHER` built once at module load instead of inside the render function; prevents new object references on every paint that defeated ReactMarkdown's internal memoization
- **In-flight profile fetch deduplication** — a module-level `Set<string>` gates concurrent `fetchEvent` calls so a burst of messages from the same unknown sender triggers only one network request instead of N
- **Abandoned transfer GC** — `gcStaleTransfers()` called on each `handleFileStart`; prunes `IncomingTransfer` entries older than 5 minutes to prevent unbounded `Map` growth from failed transfers
- **QR scanner canvas null check** — replaced `getContext('2d')!` non-null assertion with a guarded check that skips the frame and retries via `requestAnimationFrame`
- **Signal SDP validation** — replaced `signal.sdp!` non-null assertions in `CallContext` with explicit `typeof signal.sdp !== 'string'` guards; malformed signaling events now silently drop instead of throwing
- **LinkPreview: AbortController + LRU cap** — fetch cancellation switched from a `cancelled` flag to `AbortController` (actually stops the in-flight request); session cache capped at 100 entries to bound memory growth
- **Sidebar tab switcher** — three identical 8-line button blocks collapsed into a single mapped array over `SIDEBAR_TABS`; `MAX_SEARCH_RESULTS = 50` constant replaces the magic number in `slice` and the results count label
- **Named constants** — `MAX_TEXTAREA_HEIGHT = 120` in `MessageInput` (auto-resize effect); `Partial<NostrProfile>` type on `JSON.parse` in `parseProfile` removes implicit `any`
- **Audio unmount cleanup** — `AudioMessage` now pauses the `<audio>` element on unmount to prevent `setState` after unmount if a message row is removed while audio is playing

### Image Lightbox
- Tap any image in chat to open a full-screen preview overlay
- `Escape` or click outside to close; zoom-in cursor and icon hint on hover over thumbnail
- Download button and close button in the overlay corner
- Filename label shown below the full-size image

See [ReleaseNotes.md](./ReleaseNotes.md) for the full history.
