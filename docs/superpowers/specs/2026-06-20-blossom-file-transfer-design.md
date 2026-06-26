# Off-Relay File Transfer (Blossom + NIP-94) — Design

Date: 2026-06-20
Status: Approved (design); pending implementation plan

## Goal

Replace the event-chunked file transfer (Priority 2, item #4 of the functional
analysis) with off-relay media storage. Today a large file is split into ~500
sequential kind-4/42 events; one dropped chunk silently fails the whole transfer,
the in-memory reassembly is GC'd after 15 minutes, and it abuses public relays
that rate-limit or cap event size. Instead, upload the file to a Blossom media
server and send a small reference (URL + SHA-256 hash) in the message. Small
inline images/files stay inline as they are today.

## Decisions (from brainstorming)

- **Protocol:** Blossom (content-addressed by SHA-256). Upload via
  `PUT {server}/upload` with a signed `kind:24242` auth event; download via
  `GET {url}`. Not NIP-96.
- **Chat types:** DM, channel, AND groups. Groups gain file attachments for the
  first time (previously unsupported), reusing the encrypted-upload path.
- **Server config:** a single default Blossom server, user-overridable in
  Settings (mirrors the existing TURN-server config). Default
  `https://blossom.band`. One upload target; no mirroring.
- **Privacy:** DMs and groups encrypt the file client-side before upload; the
  per-file key rides inside the already-encrypted message. Channels upload
  plaintext.
- **Back-compat:** keep the legacy chunk receiver so historical chunked messages
  still reconstruct; remove only the chunk sender. Inline small files unchanged.

## Background (current code)

- `src/lib/fileTransfer.ts` — chunk send (`sendChunkedFile`) and a receive-side
  state machine (`parseTransferPayload`, `handleFileStart`, `handleFileChunk`,
  `reconstructDataUrl`) plus constants (`INLINE_BASE64_THRESHOLD = 150 KB`,
  `MAX_CHUNKED_FILE_BYTES = 50 MB`, MIME allowlist).
- `src/lib/fileUtils.ts` — `AttachmentData { name, type, size, data }` (data URL),
  `serializeMessage` / `parseMessageContent` (attachment embedded in message JSON),
  `getPreviewText`, `compressImage`, `encodeFile`.
- `src/components/Chat/MessageThread.tsx` — `MessageInput.handleSend` chooses
  inline (`serializeMessage`) vs `onSendChunked` by `attachment.data.length >
  INLINE_BASE64_THRESHOLD`. `ChannelThread`/`DMThread` wire `onSendChunked` to
  `sendChunkedFile`; `GroupThread` throws "File attachments are not yet supported
  in groups."
- `src/components/Chat/MessageItem.tsx` — `AttachmentView` switches on
  `attachment.type` and renders from `attachment.data` (a data URL):
  `ImageAttachment`, `AudioMessage`, or a download button.
- `src/lib/inbox.ts` — `routeTransfer` dispatches `file_start`/`file_chunk`
  payloads via `parseTransferPayload`.
- `src/lib/signer.ts` — the `Signer` singleton signs events (used for the Blossom
  auth event). `signerCaps.nip04` already gates DM/group encrypted features.

## Protocol & crypto model

### Public channels (plaintext)

1. Compute `sha256Hex(blob)`.
2. Sign a `kind:24242` Blossom auth event: tags `["t","upload"]`,
   `["x",<sha256>]`, `["expiration",<now + window>]`, content e.g. "Upload".
3. `PUT {server}/upload`, header `Authorization: Nostr <base64(authEvent)>`,
   body = the raw blob. Response: a blob descriptor `{ url, sha256, size, type }`.
4. The channel message embeds `{ url, hash, name, mime, size }`.
5. Recipient: `GET {url}` → verify `sha256Hex(blob) === hash` → render.

### DMs and groups (encrypted, E2E preserved)

1. Generate a random AES-GCM-256 key and 12-byte IV (WebCrypto).
2. `encryptBlob(bytes, key, iv)` → ciphertext.
3. Upload the **ciphertext** to Blossom exactly as above; the server only ever
   holds opaque ciphertext. `hash` = SHA-256 of the **ciphertext** (the Blossom
   address).
4. The message embeds `{ url, hash, name, mime, size, enc: { algo:'AES-GCM',
   key:<base64 raw key>, iv:<base64> } }`. This object is placed inside the
   message content that is then encrypted with NIP-04 (DM) or the group symmetric
   key (group) — so the file key never reaches a relay or the Blossom server in
   the clear.
5. Recipient: decrypt the message (as today) → read `enc` → `GET {url}` → verify
   `sha256Hex(ciphertext) === hash` → `decryptBlob(ciphertext, key, iv)` →
   render.

The presence of `enc` is what tells the renderer to decrypt. Verifying the hash
before decrypting rejects a tampered or wrong blob from an untrusted server.

### Message attachment format

`AttachmentData` is extended (all new fields optional; `data` stays for inline):

```ts
interface AttachmentData {
  name: string
  type: string
  size: number
  data?: string            // inline data URL (small files) — unchanged
  url?: string             // Blossom GET url (remote files)
  hash?: string            // SHA-256 hex of the uploaded blob (ciphertext if enc)
  enc?: {                  // present only for encrypted (DM/group) files
    algo: 'AES-GCM'
    key: string            // base64 raw key
    iv: string             // base64 IV
  }
}
```

`parseMessageContent` and `getPreviewText` accept an attachment that has `url`
(remote) as well as one that has `data` (inline). A remote attachment is valid
when `url` and `hash` are present.

## Components, files & phasing

Four phases, each independently shippable.

### Phase 1 — Blossom client + file crypto + settings

- New `src/lib/fileCrypto.ts`: `generateFileKey()` → `{ key: CryptoKey, iv }`;
  `encryptBlob(bytes, key, iv): Promise<ArrayBuffer>`;
  `decryptBlob(cipher, keyB64, ivB64): Promise<ArrayBuffer>`; base64 key/iv
  import/export helpers. AES-GCM-256.
- New `src/lib/blossom.ts`: `sha256Hex(bytes): Promise<string>`;
  `buildBlossomAuth(verb, sha256, expiresInS)` (signs `kind:24242` via the
  signer); `uploadBlob(server, blob, onProgress): Promise<{ url, sha256, size,
  type }>` (XHR for upload progress); `downloadBlob(url): Promise<ArrayBuffer>`.
- Store: add `mediaServer: string` (default `https://blossom.band`), persisted
  and synced via the existing NIP-78 settings path, with a setter.
- New Settings → Files tab (`src/components/Settings/FilesTab.tsx`) mirroring the
  TURN config in `CallsTab`: an input for the media server URL with basic URL
  validation; registered in the settings panel/screen.

### Phase 2 — Send path

- Extend `AttachmentData` (above) in `fileUtils.ts`; update `serializeMessage`,
  `parseMessageContent`, `getPreviewText` to handle remote attachments.
- New `src/lib/fileSend.ts` (or extend `fileTransfer.ts`): `sendFileViaBlossom(
  bytes, name, mime, size, chatType, chatId, opts, onProgress)` that, for
  `channel`, uploads plaintext; for `dm`/`group`, encrypts then uploads, and
  returns the `AttachmentData` remote ref. The caller then builds and sends a
  normal message via the existing send functions.
- `MessageThread.tsx`: `MessageInput.handleSend` large-file branch calls the new
  Blossom path instead of `onSendChunked`/`sendChunkedFile`. `GroupThread`'s
  file-send branch is implemented (replacing the "not supported" throw) using the
  group key. The optimistic local message renders from the local bytes
  immediately.
- Remove the chunk **sender** (`sendChunkedFile`) and its `useNostrSubscriptions`
  re-export once unused.

### Phase 3 — Receive / render path

- New `src/hooks/useBlossomAttachment.ts`: given a remote `AttachmentData`,
  returns `{ status: 'idle'|'loading'|'ready'|'error', objectUrl?, retry() }`.
  Resolves: `downloadBlob(url)` → verify SHA-256 → if `enc`, `decryptBlob` →
  `URL.createObjectURL`. Caches by `url`; revokes the object URL on unmount.
- `MessageItem.tsx` `AttachmentView`: if `attachment.data` → inline (unchanged);
  else if `attachment.url` → use `useBlossomAttachment`, show loading/error, and
  feed the resolved object URL into the existing `ImageAttachment` /
  `AudioMessage` / download views.

### Phase 4 — Back-compat cleanup

- Keep the chunk receiver (`parseTransferPayload`, `handleFileStart`,
  `handleFileChunk`, `reconstructDataUrl`, `routeTransfer`) so historical chunked
  messages still reconstruct.
- Inline small files (< `INLINE_BASE64_THRESHOLD`) remain inline.

## Settings & limits

- `mediaServer` default `https://blossom.band`, user-editable (Settings → Files),
  basic URL validation, synced via NIP-78. Only the sender's server matters;
  recipients fetch from the `url` embedded in the message.
- `MAX_CHUNKED_FILE_BYTES` (50 MB) retained as the attach cap (tunable constant).
- The existing MIME allowlist (`image/`, `audio/`, `video/`, `text/`,
  `application/pdf`) is reused for both send and render.

## Error handling

- Upload failure (network, server, signer can't sign) → surfaced in the existing
  `attachError` / upload-progress UI; the message is not sent; the user can retry.
- Download/verify/decrypt failure → per-attachment error state with a retry
  action. A SHA-256 mismatch is treated as failure and never rendered.
- A signer that cannot sign the auth event blocks upload with a clear message.
  (DM/group encrypted files are already gated by `signerCaps.nip04`; channel
  uploads still require signing the message itself, so behavior is consistent.)

## Testing

- `fileCrypto`: encrypt→decrypt round-trip; wrong key/IV fails; tamper of the
  ciphertext fails decryption.
- `blossom`: `sha256Hex` known-vector; `buildBlossomAuth` produces a `kind:24242`
  event with the right tags; `uploadBlob` posts to `{server}/upload` with the
  `Authorization: Nostr` header and parses the descriptor (mocked XHR/fetch);
  `downloadBlob` returns bytes (mocked fetch).
- `fileUtils`: `serializeMessage`/`parseMessageContent`/`getPreviewText` for
  remote attachments (with and without `enc`); legacy inline attachments still
  parse; legacy chunk payloads still parse and reconstruct (back-compat).
- `useBlossomAttachment`: loading→ready for plaintext; loading→ready with decrypt
  for encrypted; verify-mismatch→error; download-failure→error; retry path
  (mocked `downloadBlob`/`decryptBlob`).
- The real network and `URL.createObjectURL` rendering are IO/layout-dependent
  and are covered by mocks plus a manual-verification note rather than faked
  assertions.

## Mobile / PWA

Upload and download are plain HTTPS, so they work identically on mobile browsers
and the installed PWA — and large media is more reliable than the old chunking
because there are no relay event-size limits. XHR upload progress drives the
existing progress bar. No fixed layouts are introduced.

## Out of scope

- The other Priority 2 item still open (NIP-65 outbox).
- Multi-server upload/mirroring and download fallback (single configured server).
- Migrating the NIP-04 message envelope to NIP-44/NIP-17 (separate sequencing
  item); the file key rides inside whatever envelope the chat currently uses.
- A separate plaintext-content hash beyond the uploaded-blob hash.
- Raising the 50 MB attach cap (kept as a tunable constant).
