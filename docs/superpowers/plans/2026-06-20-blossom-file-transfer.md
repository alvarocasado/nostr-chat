# Off-Relay File Transfer (Blossom + NIP-94) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace event-chunked file transfer with Blossom uploads — channels upload plaintext, DMs/groups encrypt-then-upload with the per-file key carried inside the encrypted message — and render off-relay attachments by downloading, verifying, and decrypting them.

**Architecture:** New libs `fileCrypto.ts` (AES-GCM) and `blossom.ts` (upload/download/hash/auth). The send path uploads large files via `uploadAttachment` and embeds a `{ url, hash, enc? }` reference in the normal message; the render path resolves remote attachments via a `useBlossomAttachment` hook (download → verify SHA-256 → decrypt if `enc` → object URL). The legacy chunk receiver stays for back-compat; the chunk sender is removed.

**Tech Stack:** TypeScript, React 19, WebCrypto (AES-GCM, SHA-256), XMLHttpRequest (upload progress), Dexie (settings), nostr-tools, Vitest.

## Global Constraints

- No emojis in code, comments, or documentation.
- Blossom only (not NIP-96): upload `PUT {server}/upload` with header `Authorization: Nostr <base64(kind-24242 event)>`; download `GET {url}`.
- DM and group files: per-file random AES-GCM-256 key + 12-byte IV; upload the CIPHERTEXT; embed `enc:{ algo:'AES-GCM', key, iv }` (base64) inside the message that is then encrypted by the existing send path. Channels upload plaintext (no `enc`).
- `hash` stored/verified is the SHA-256 of the UPLOADED blob (ciphertext for encrypted, plaintext for channel). A hash mismatch is an error; never render it.
- Default media server `https://blossom.band`, user-overridable in Settings → Files (Dexie setting key `media_server`, synced via `triggerSettingsSync()` like the TURN config). Only the sender's server matters.
- Keep the legacy chunk RECEIVER (`parseTransferPayload`/`handleFileStart`/`handleFileChunk`/`reconstructDataUrl`/`routeTransfer`) for historical messages; remove only the chunk SENDER.
- Inline small files (< `INLINE_BASE64_THRESHOLD` = 150 KB) stay inline, unchanged.
- `MAX_CHUNKED_FILE_BYTES` (50 MB) remains the attach cap; reuse the existing MIME allowlist.
- Mutate store state only through store actions.

---

## Phase 1 — Blossom client, file crypto, settings

### Task 1: File encryption helpers (`fileCrypto.ts`)

**Files:**
- Create: `src/lib/fileCrypto.ts`
- Test: `src/__tests__/fileCrypto.test.ts`

**Interfaces:**
- Produces: `generateFileKey(): Promise<{ key: CryptoKey; iv: Uint8Array }>`; `encryptBlob(bytes: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer>`; `decryptBlob(cipher: ArrayBuffer, keyB64: string, ivB64: string): Promise<ArrayBuffer>`; `exportKeyB64(key: CryptoKey): Promise<string>`; `ivToB64(iv: Uint8Array): string`; `bytesToB64(b: Uint8Array): string`; `b64ToBytes(s: string): Uint8Array`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/fileCrypto.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateFileKey, encryptBlob, decryptBlob, exportKeyB64, ivToB64 } from '../lib/fileCrypto'

const enc = new TextEncoder()
const dec = new TextDecoder()

describe('fileCrypto', () => {
  it('round-trips: encrypt then decrypt returns the original bytes', async () => {
    const plain = enc.encode('hello blossom').buffer
    const { key, iv } = await generateFileKey()
    const cipher = await encryptBlob(plain, key, iv)
    expect(new Uint8Array(cipher)).not.toEqual(new Uint8Array(plain)) // actually encrypted
    const out = await decryptBlob(cipher, await exportKeyB64(key), ivToB64(iv))
    expect(dec.decode(out)).toBe('hello blossom')
  })

  it('fails to decrypt with the wrong key', async () => {
    const plain = enc.encode('secret').buffer
    const a = await generateFileKey()
    const b = await generateFileKey()
    const cipher = await encryptBlob(plain, a.key, a.iv)
    await expect(decryptBlob(cipher, await exportKeyB64(b.key), ivToB64(a.iv))).rejects.toBeDefined()
  })

  it('fails to decrypt tampered ciphertext (GCM auth)', async () => {
    const plain = enc.encode('integrity').buffer
    const { key, iv } = await generateFileKey()
    const cipher = await encryptBlob(plain, key, iv)
    const tampered = new Uint8Array(cipher)
    tampered[0] ^= 0xff
    await expect(decryptBlob(tampered.buffer, await exportKeyB64(key), ivToB64(iv))).rejects.toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/fileCrypto.test.ts`
Expected: FAIL — `src/lib/fileCrypto.ts` does not exist.

- [ ] **Step 3: Implement `fileCrypto.ts`**

Create `src/lib/fileCrypto.ts`:

```ts
// AES-GCM-256 file encryption with a per-file random key and 12-byte IV.

export function bytesToB64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s)
}

export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function generateFileKey(): Promise<{ key: CryptoKey; iv: Uint8Array }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  return { key, iv }
}

export function encryptBlob(bytes: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)
}

export async function exportKeyB64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return bytesToB64(new Uint8Array(raw))
}

export function ivToB64(iv: Uint8Array): string {
  return bytesToB64(iv)
}

export async function decryptBlob(cipher: ArrayBuffer, keyB64: string, ivB64: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', b64ToBytes(keyB64), { name: 'AES-GCM' }, false, ['decrypt'])
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, cipher)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/fileCrypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fileCrypto.ts src/__tests__/fileCrypto.test.ts
git commit -m "feat: AES-GCM file encryption helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Blossom client (`blossom.ts`)

**Files:**
- Create: `src/lib/blossom.ts`
- Test: `src/__tests__/blossom.test.ts`

**Interfaces:**
- Consumes: `requireSigner` from `./signer` (signs the auth event); `getSetting` from `./userDb`.
- Produces: `DEFAULT_MEDIA_SERVER`; `MEDIA_SERVER_KEY`; `sha256Hex(bytes: ArrayBuffer): Promise<string>`; `buildBlossomAuth(sha256: string, verb?: string): Promise<string>`; `uploadBlob(server: string, bytes: ArrayBuffer, mime: string, onProgress?: (loaded: number, total: number) => void): Promise<{ url: string; sha256: string; size: number; type: string }>`; `downloadBlob(url: string): Promise<ArrayBuffer>`; `getCachedObjectUrl(url: string): string | undefined`; `setCachedObjectUrl(url: string, objectUrl: string): void`; `getMediaServer(): Promise<string>`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/blossom.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sha256Hex, buildBlossomAuth, uploadBlob, downloadBlob } from '../lib/blossom'
import { installTestSigner } from '../test/signer'
import { clearSigner } from '../lib/signer'
import { generateSecretKey } from 'nostr-tools'

afterEach(() => { clearSigner(); vi.restoreAllMocks() })

describe('sha256Hex', () => {
  it('hashes the empty input to the known SHA-256 vector', async () => {
    expect(await sha256Hex(new ArrayBuffer(0)))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('buildBlossomAuth', () => {
  it('produces a base64 kind-24242 event with t/x/expiration tags', async () => {
    installTestSigner(generateSecretKey())
    const b64 = await buildBlossomAuth('abc123', 'upload')
    const ev = JSON.parse(atob(b64))
    expect(ev.kind).toBe(24242)
    expect(ev.tags).toEqual(expect.arrayContaining([
      ['t', 'upload'],
      ['x', 'abc123'],
    ]))
    expect(ev.tags.find((t: string[]) => t[0] === 'expiration')).toBeDefined()
    expect(typeof ev.sig).toBe('string')
  })
})

describe('uploadBlob', () => {
  it('PUTs to {server}/upload with the Nostr auth header and parses the descriptor', async () => {
    installTestSigner(generateSecretKey())
    const calls: { url?: string; method?: string; headers: Record<string, string>; body?: unknown } = { headers: {} }
    class FakeXHR {
      upload = { onprogress: null as null | ((e: ProgressEvent) => void) }
      onload: null | (() => void) = null
      onerror: null | (() => void) = null
      status = 200
      responseText = JSON.stringify({ url: 'https://srv/deadbeef', sha256: 'deadbeef', size: 3, type: 'text/plain' })
      open(method: string, url: string) { calls.method = method; calls.url = url }
      setRequestHeader(k: string, v: string) { calls.headers[k] = v }
      send(body: unknown) { calls.body = body; this.onload?.() }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)

    const desc = await uploadBlob('https://srv/', new TextEncoder().encode('abc').buffer, 'text/plain')
    expect(calls.method).toBe('PUT')
    expect(calls.url).toBe('https://srv/upload')
    expect(calls.headers['Authorization']).toMatch(/^Nostr /)
    expect(desc.url).toBe('https://srv/deadbeef')
    expect(desc.sha256).toBe('deadbeef')
  })
})

describe('downloadBlob', () => {
  it('fetches the url and returns an ArrayBuffer', async () => {
    const buf = new TextEncoder().encode('xyz').buffer
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(buf) }))
    const out = await downloadBlob('https://srv/xyz')
    expect(new TextDecoder().decode(out)).toBe('xyz')
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(downloadBlob('https://srv/missing')).rejects.toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/blossom.test.ts`
Expected: FAIL — `src/lib/blossom.ts` does not exist.

- [ ] **Step 3: Implement `blossom.ts`**

Create `src/lib/blossom.ts`:

```ts
import { requireSigner } from './signer'
import { getSetting } from './userDb'

export const DEFAULT_MEDIA_SERVER = 'https://blossom.band'
export const MEDIA_SERVER_KEY = 'media_server'
const AUTH_WINDOW_S = 300

export async function getMediaServer(): Promise<string> {
  return getSetting<string>(MEDIA_SERVER_KEY, DEFAULT_MEDIA_SERVER)
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/** Sign a kind-24242 Blossom auth event and return it base64-encoded for the header. */
export async function buildBlossomAuth(sha256: string, verb = 'upload'): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const event = await requireSigner().signEvent({
    kind: 24242,
    created_at: now,
    tags: [
      ['t', verb],
      ['x', sha256],
      ['expiration', String(now + AUTH_WINDOW_S)],
    ],
    content: `${verb} ${sha256}`,
  })
  return btoa(JSON.stringify(event))
}

export interface BlobDescriptor { url: string; sha256: string; size: number; type: string }

export async function uploadBlob(
  server: string,
  bytes: ArrayBuffer,
  mime: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<BlobDescriptor> {
  const sha256 = await sha256Hex(bytes)
  const auth = await buildBlossomAuth(sha256, 'upload')
  const base = server.replace(/\/$/, '')
  return new Promise<BlobDescriptor>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${base}/upload`)
    xhr.setRequestHeader('Authorization', `Nostr ${auth}`)
    if (mime) xhr.setRequestHeader('Content-Type', mime)
    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as BlobDescriptor) }
        catch { reject(new Error('Invalid server response')) }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('Upload network error'))
    xhr.send(new Blob([bytes], { type: mime }))
  })
}

export async function downloadBlob(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  return res.arrayBuffer()
}

// Module-level object-URL cache: the sender seeds it from local bytes so its own
// message renders instantly, and repeat views skip a re-download. Session-lived
// (intentionally not revoked — shared across remounts, mirrors the old inline
// data-URL behavior).
const objectUrlCache = new Map<string, string>()
export function getCachedObjectUrl(url: string): string | undefined { return objectUrlCache.get(url) }
export function setCachedObjectUrl(url: string, objectUrl: string): void { objectUrlCache.set(url, objectUrl) }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/blossom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/blossom.ts src/__tests__/blossom.test.ts
git commit -m "feat: Blossom client (auth, upload, download, sha256, cache)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Settings → Files tab (media server config)

**Files:**
- Create: `src/components/Settings/FilesTab.tsx`
- Modify: `src/store/nostrStore.ts` (add `'files'` to the `SettingsTab` union, line 30)
- Modify: `src/components/Settings/SettingsScreen.tsx` (import + `TAB_LABELS` + render branch)
- Modify: `src/components/Chat/Sidebar.tsx` (settings tab button list, ~line 737)
- Modify: `src/components/Settings/SettingsPanel.tsx` (its local `SettingsTab` union line 12, the tab list ~line 95, render branch ~line 308)

**Interfaces:**
- Consumes: `DEFAULT_MEDIA_SERVER`, `MEDIA_SERVER_KEY` from `../../lib/blossom`; `getSetting`/`setSetting` from `../../lib/userDb`; `triggerSettingsSync` from the store.
- Produces: a `'files'` settings tab rendering `<FilesTab />`.

- [ ] **Step 1: Create the FilesTab component**

Create `src/components/Settings/FilesTab.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { Loader2, Check, Save } from 'lucide-react'
import { getSetting, setSetting } from '../../lib/userDb'
import { DEFAULT_MEDIA_SERVER, MEDIA_SERVER_KEY } from '../../lib/blossom'
import { useNostrStore } from '../../store/nostrStore'

export function FilesTab() {
  const triggerSettingsSync = useNostrStore(s => s.triggerSettingsSync)
  const [server, setServer] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void getSetting<string>(MEDIA_SERVER_KEY, DEFAULT_MEDIA_SERVER).then(setServer)
  }, [])

  const handleSave = async () => {
    setError('')
    const value = server.trim()
    if (!/^https:\/\/.+/.test(value)) { setError('Enter a valid https:// URL.'); return }
    setSaving(true)
    try {
      await setSetting(MEDIA_SERVER_KEY, value)
      setSaved(true)
      triggerSettingsSync()
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pb-1">Media Server</p>
        <p className="text-xs text-gray-500 pb-1">
          Files larger than 150 KB are uploaded here instead of being sent over relays. Direct-message and
          group files are encrypted before upload. Recipients download from the link in the message, so they
          do not need the same server.
        </p>
        <label className="text-xs text-gray-400 mb-1 block">Blossom server URL</label>
        <input
          type="text"
          value={server}
          onChange={e => setServer(e.target.value)}
          placeholder={DEFAULT_MEDIA_SERVER}
          className="w-full bg-gray-900 border border-gray-700 focus:border-purple-500 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition-colors"
        />
        {error && <p className="text-red-400 text-xs pt-1">{error}</p>}
        <div className="pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : <Save size={15} />}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the `'files'` tab in the store union**

In `src/store/nostrStore.ts` line 30, change:

```ts
export type SettingsTab = 'profile' | 'relays' | 'keys' | 'calls' | 'notifications' | 'privacy'
```

to add `'files'`:

```ts
export type SettingsTab = 'profile' | 'relays' | 'keys' | 'calls' | 'files' | 'notifications' | 'privacy'
```

- [ ] **Step 3: Register in `SettingsScreen.tsx`**

In `src/components/Settings/SettingsScreen.tsx`:
- Add the import near the `CallsTab` import (line 9): `import { FilesTab } from './FilesTab'`.
- In the `TAB_LABELS` map, add a `files: 'Files'` entry (place it next to `calls`).
- After the `{activeSettingsTab === 'calls' && <CallsTab />}` line (line 512), add:

```tsx
          {activeSettingsTab === 'files' && <FilesTab />}
```

- [ ] **Step 4: Register the tab button in `Sidebar.tsx`**

In `src/components/Chat/Sidebar.tsx`, the settings tab list (~line 737) has entries like `{ tab: 'calls', label: 'Calls', icon: <Phone size={16} />, badge: null }`. Add an entry for files immediately after the calls entry:

```tsx
            { tab: 'files',         label: 'Files',         icon: <Paperclip size={16} />, badge: null },
```

Ensure `Paperclip` is imported from `lucide-react` at the top of `Sidebar.tsx` (add it to the existing lucide import if not already present).

- [ ] **Step 5: Register in `SettingsPanel.tsx`**

In `src/components/Settings/SettingsPanel.tsx`:
- Add `import { FilesTab } from './FilesTab'` near the `CallsTab` import (line 9).
- Line 12: add `'files'` to the local `SettingsTab` union (after `'calls'`).
- Line ~95: add `'files'` to the `(['profile', 'relays', 'keys', 'calls', 'notifications'] as const)` tab array (after `'calls'`).
- Line ~308: after `{tab === 'calls' && <CallsTab />}` add `{tab === 'files' && <FilesTab />}`.

- [ ] **Step 6: Type-check and run the existing settings/sidebar tests**

Run: `npx tsc --noEmit`
Expected: PASS — the `SettingsTab` union change compiles everywhere it is used.

Run: `npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/FilesTab.tsx src/store/nostrStore.ts src/components/Settings/SettingsScreen.tsx src/components/Chat/Sidebar.tsx src/components/Settings/SettingsPanel.tsx
git commit -m "feat: Settings -> Files tab for media server config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — Message format + send path

### Task 4: Remote attachment format (`fileUtils.ts`)

**Files:**
- Modify: `src/lib/fileUtils.ts` (extend `AttachmentData`; update `parseMessageContent`)
- Test: `src/__tests__/fileUtils.test.ts` (add a `describe` block)

**Interfaces:**
- Produces: `AttachmentData` gains optional `url?: string`, `hash?: string`, `enc?: { algo: 'AES-GCM'; key: string; iv: string }`, and `data?` becomes optional. A remote attachment (has `url`) parses through `parseMessageContent`/`getPreviewText` the same as an inline one.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/fileUtils.test.ts`:

```ts
import { parseMessageContent, serializeMessage, getPreviewText, type AttachmentData } from '../lib/fileUtils'

describe('remote (Blossom) attachments', () => {
  const remote: AttachmentData = {
    name: 'pic.jpg', type: 'image/jpeg', size: 1234,
    url: 'https://srv/abc', hash: 'abc',
    enc: { algo: 'AES-GCM', key: 'k', iv: 'iv' },
  }

  it('serializes and parses a remote attachment (no inline data)', () => {
    const content = serializeMessage('caption', remote, null)
    const parsed = parseMessageContent(content)
    expect(parsed.text).toBe('caption')
    expect(parsed.attachment?.url).toBe('https://srv/abc')
    expect(parsed.attachment?.hash).toBe('abc')
    expect(parsed.attachment?.enc?.key).toBe('k')
    expect(parsed.attachment?.data).toBeUndefined()
  })

  it('getPreviewText describes a remote image attachment', () => {
    const content = serializeMessage('', remote, null)
    expect(getPreviewText(content)).toBe('Image: pic.jpg')
  })

  it('still parses a legacy inline attachment (data url)', () => {
    const inline: AttachmentData = { name: 'a.txt', type: 'text/plain', size: 3, data: 'data:text/plain;base64,YWJj' }
    const parsed = parseMessageContent(serializeMessage('hi', inline, null))
    expect(parsed.attachment?.data).toBe('data:text/plain;base64,YWJj')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/fileUtils.test.ts -t "remote"`
Expected: FAIL — `parseMessageContent` only treats `attachment.data` as a valid attachment, so the remote one parses as `null`.

- [ ] **Step 3: Extend `AttachmentData` and `parseMessageContent`**

In `src/lib/fileUtils.ts`, change the `AttachmentData` interface to:

```ts
export interface AttachmentData {
  name: string
  type: string
  size: number  // original file size in bytes
  data?: string // inline data URL (small files)
  url?: string  // Blossom GET url (off-relay files)
  hash?: string // SHA-256 hex of the uploaded blob (ciphertext when encrypted)
  enc?: {       // present only for encrypted (DM/group) files
    algo: 'AES-GCM'
    key: string // base64 raw key
    iv: string  // base64 IV
  }
}
```

In `parseMessageContent`, change the guard so an attachment with `data` OR `url` counts:

```ts
export function parseMessageContent(content: string): ParsedMessage {
  try {
    const parsed = JSON.parse(content)
    const hasAttachment = !!(parsed?.attachment?.data || parsed?.attachment?.url)
    if (parsed && typeof parsed === 'object' && (hasAttachment || parsed.replyTo)) {
      return {
        text: parsed.text ?? '',
        attachment: hasAttachment ? parsed.attachment as AttachmentData : null,
        replyTo: parsed.replyTo ?? undefined,
      }
    }
  } catch {
    // not a JSON attachment message
  }
  return { text: content, attachment: null }
}
```

`serializeMessage` and `getPreviewText` need no change (they spread the attachment and read `type`/`name`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/fileUtils.test.ts`
Expected: PASS — new remote tests and all existing fileUtils tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fileUtils.ts src/__tests__/fileUtils.test.ts
git commit -m "feat: support remote (Blossom) attachment refs in message format

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Upload orchestration (`fileSend.ts`)

**Files:**
- Create: `src/lib/fileSend.ts`
- Test: `src/__tests__/fileSend.test.ts`

**Interfaces:**
- Consumes: `uploadBlob`, `setCachedObjectUrl` from `./blossom`; `generateFileKey`, `encryptBlob`, `exportKeyB64`, `ivToB64` from `./fileCrypto`; `AttachmentData` from `./fileUtils`.
- Produces: `uploadAttachment(attachment: AttachmentData, chatType: 'dm' | 'channel' | 'group', server: string, onProgress?: (loaded: number, total: number) => void): Promise<AttachmentData>` — returns a remote `AttachmentData` (`url`/`hash`, plus `enc` for dm/group). Reads the raw bytes from the inline `attachment.data` data URL.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/fileSend.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AttachmentData } from '../lib/fileUtils'

const uploadBlob = vi.fn()
vi.mock('../lib/blossom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/blossom')>()
  return { ...actual, uploadBlob: (...a: unknown[]) => uploadBlob(...a), setCachedObjectUrl: vi.fn() }
})

import { uploadAttachment } from '../lib/fileSend'

// data URL for the 3 bytes "abc"
const DATA_URL = 'data:text/plain;base64,YWJj'

function attachment(): AttachmentData {
  return { name: 'a.txt', type: 'text/plain', size: 3, data: DATA_URL }
}

beforeEach(() => {
  uploadBlob.mockReset()
  uploadBlob.mockResolvedValue({ url: 'https://srv/HASH', sha256: 'HASH', size: 3, type: 'text/plain' })
  // jsdom lacks createObjectURL
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:local') })
})
afterEach(() => { vi.restoreAllMocks() })

describe('uploadAttachment', () => {
  it('channel: uploads plaintext and returns a remote ref with no enc', async () => {
    const out = await uploadAttachment(attachment(), 'channel', 'https://srv')
    expect(out.url).toBe('https://srv/HASH')
    expect(out.hash).toBe('HASH')
    expect(out.enc).toBeUndefined()
    expect(out.data).toBeUndefined()
    // the bytes uploaded are the plaintext "abc"
    const uploadedBytes = new Uint8Array(uploadBlob.mock.calls[0][1] as ArrayBuffer)
    expect(new TextDecoder().decode(uploadedBytes)).toBe('abc')
  })

  it('dm: encrypts before upload and returns an enc block; uploaded bytes are not the plaintext', async () => {
    const out = await uploadAttachment(attachment(), 'dm', 'https://srv')
    expect(out.url).toBe('https://srv/HASH')
    expect(out.enc?.algo).toBe('AES-GCM')
    expect(typeof out.enc?.key).toBe('string')
    expect(typeof out.enc?.iv).toBe('string')
    const uploadedBytes = new Uint8Array(uploadBlob.mock.calls[0][1] as ArrayBuffer)
    expect(new TextDecoder().decode(uploadedBytes)).not.toBe('abc') // ciphertext
  })

  it('group: also produces an enc block (encrypted upload)', async () => {
    const out = await uploadAttachment(attachment(), 'group', 'https://srv')
    expect(out.enc?.algo).toBe('AES-GCM')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/fileSend.test.ts`
Expected: FAIL — `src/lib/fileSend.ts` does not exist.

- [ ] **Step 3: Implement `fileSend.ts`**

Create `src/lib/fileSend.ts`:

```ts
import { uploadBlob, setCachedObjectUrl } from './blossom'
import { generateFileKey, encryptBlob, exportKeyB64, ivToB64 } from './fileCrypto'
import type { AttachmentData } from './fileUtils'

async function dataUrlToBytes(dataUrl: string): Promise<ArrayBuffer> {
  return (await fetch(dataUrl)).arrayBuffer()
}

/**
 * Upload an inline attachment to Blossom and return a remote reference.
 * Channels upload plaintext; DMs and groups encrypt with a per-file key whose
 * material is returned in `enc` for the caller to embed in the encrypted message.
 */
export async function uploadAttachment(
  attachment: AttachmentData,
  chatType: 'dm' | 'channel' | 'group',
  server: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<AttachmentData> {
  if (!attachment.data) throw new Error('Attachment has no data to upload')
  const bytes = await dataUrlToBytes(attachment.data)
  const base: AttachmentData = { name: attachment.name, type: attachment.type, size: attachment.size }

  if (chatType === 'channel') {
    const desc = await uploadBlob(server, bytes, attachment.type, onProgress)
    setCachedObjectUrl(desc.url, URL.createObjectURL(new Blob([bytes], { type: attachment.type })))
    return { ...base, url: desc.url, hash: desc.sha256 }
  }

  const { key, iv } = await generateFileKey()
  const cipher = await encryptBlob(bytes, key, iv)
  const desc = await uploadBlob(server, cipher, 'application/octet-stream', onProgress)
  setCachedObjectUrl(desc.url, URL.createObjectURL(new Blob([bytes], { type: attachment.type })))
  return {
    ...base,
    url: desc.url,
    hash: desc.sha256,
    enc: { algo: 'AES-GCM', key: await exportKeyB64(key), iv: ivToB64(iv) },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/fileSend.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fileSend.ts src/__tests__/fileSend.test.ts
git commit -m "feat: uploadAttachment orchestration (plaintext channels, encrypted DM/group)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire the send path; enable groups; drop the chunk sender

**Files:**
- Modify: `src/components/Chat/MessageThread.tsx` (`MessageInput`: add `chatType` prop, replace the chunked branch with a Blossom upload; remove `onSendChunked`; pass `chatType` from the three threads; remove `GroupThread`'s file-unsupported throw and its `sendChunkedFile` usage)
- Modify: `src/hooks/useNostrSubscriptions.ts` (remove the `sendChunkedFile` re-export)
- Modify: `src/lib/fileTransfer.ts` (remove the `sendChunkedFile` sender; keep all receive-side code)
- Test: `src/__tests__/messageInputSend.test.tsx`

**Interfaces:**
- Consumes: `uploadAttachment` from `../../lib/fileSend`; `getMediaServer` from `../../lib/blossom`; `serializeMessage`, `INLINE_BASE64_THRESHOLD`.
- Produces: `MessageInput` now takes `chatType: 'dm' | 'channel' | 'group'` and no longer takes `onSendChunked`; large files are uploaded then sent through the normal `onSend`. Groups support file attachments.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/messageInputSend.test.tsx`. It mocks `uploadAttachment` and asserts that a large attachment is uploaded and the resulting remote ref is what gets sent via `onSend`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AttachmentData } from '../lib/fileUtils'
import { parseMessageContent } from '../lib/fileUtils'

const uploadAttachment = vi.fn()
vi.mock('../lib/fileSend', () => ({ uploadAttachment: (...a: unknown[]) => uploadAttachment(...a) }))
vi.mock('../lib/blossom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/blossom')>()
  return { ...actual, getMediaServer: vi.fn().mockResolvedValue('https://srv') }
})

import { MessageInput } from '../components/Chat/MessageThread'

beforeEach(() => {
  uploadAttachment.mockReset()
  uploadAttachment.mockResolvedValue({ name: 'big.bin', type: 'application/pdf', size: 999, url: 'https://srv/H', hash: 'H' } as AttachmentData)
})

// A large inline attachment (> 150 KB) forces the upload path.
const bigData = 'data:application/pdf;base64,' + 'A'.repeat(200_000)

it('uploads a large attachment and sends a remote reference', async () => {
  const onSend = vi.fn().mockResolvedValue(undefined)
  render(
    <MessageInput
      chatId="chan1" chatType="channel"
      onSend={onSend} onTyping={() => {}}
      placeholder="msg" replyTo={null} onCancelReply={() => {}}
      preloadedAttachment={{ name: 'big.bin', type: 'application/pdf', size: 999, data: bigData }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: /send/i }))
  await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
  const sent = parseMessageContent(onSend.mock.calls[0][0] as string)
  expect(sent.attachment?.url).toBe('https://srv/H')
})
```

NOTE: `MessageInput` is not currently exported and has no `preloadedAttachment` prop. This test drives two small, intentional refactors in Step 3: export `MessageInput`, and accept an optional `preloadedAttachment` to make the send path testable without simulating the file picker. If you prefer not to add a test-only prop, instead expose the attachment state via the existing file-input change handler in the test — but the `preloadedAttachment` seam is simplest and harmless in production (defaults to none).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/messageInputSend.test.tsx`
Expected: FAIL — `MessageInput` is not exported / does not accept `chatType` or `preloadedAttachment`, and still uses the chunk path.

- [ ] **Step 3: Refactor `MessageInput` send path in `MessageThread.tsx`**

In `src/components/Chat/MessageThread.tsx`:

1. Add imports:

```ts
import { uploadAttachment } from '../../lib/fileSend'
import { getMediaServer } from '../../lib/blossom'
```

2. Change the `MessageInput` signature: `export function MessageInput(...)`, replace the `onSendChunked` prop with `chatType: 'dm' | 'channel' | 'group'`, and add an optional `preloadedAttachment?: AttachmentData` used to seed the initial attachment state. Update the props type accordingly and remove `onSendChunked` from it.

3. Seed attachment state from the prop: `const [attachment, setAttachment] = useState<AttachmentData | null>(preloadedAttachment ?? null)`.

4. Replace the body of `handleSend` large-file branch. Replace the entire current "Large-file path: chunk and send" block AND the "Inline path" block with this unified flow:

```ts
  const handleSend = async () => {
    if (!canSend) return
    if (!tryRecord()) return

    const replyToData = buildReplyTo()
    const a = attachment
    const t = text.trim()

    setSending(true)
    setText('')
    setAttachment(null)
    onCancelReply()
    clearDraft(chatId)

    try {
      let finalAttachment = a
      if (a && a.data && a.data.length > INLINE_BASE64_THRESHOLD) {
        setUploadProgress({ name: a.name, sent: 0, total: 1 })
        const server = await getMediaServer()
        finalAttachment = await uploadAttachment(a, chatType, server, (loaded, total) =>
          setUploadProgress({ name: a.name, sent: loaded, total }))
      }
      const content = serializeMessage(t, finalAttachment, replyToData)
      await onSend(content)
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Send failed.')
      setText(t)
      if (a) setAttachment(a)
    } finally {
      setSending(false)
      setUploadProgress(null)
      textareaRef.current?.focus()
    }
  }
```

(The upload-progress UI already exists; with a single PUT it shows `loaded/total` bytes. The `total > 1` label branch in the progress UI continues to work.)

5. Remove the now-unused `onSendChunked` references and the `INLINE_BASE64_THRESHOLD` chunk path. Keep `INLINE_BASE64_THRESHOLD` imported (still used by the branch above).

- [ ] **Step 4: Update the three thread wrappers**

In `src/components/Chat/MessageThread.tsx`, for each thread's `<MessageInput .../>`:
- `ChannelThread`: remove `onSendChunked={...}`, add `chatType="channel"`.
- `DMThread`: remove `onSendChunked={...}`, add `chatType="dm"`.
- `GroupThread`: remove the `onSendChunked={async () => { throw new Error('File attachments are not yet supported in groups.') }}` prop and add `chatType="group"`.

Remove each thread's `handleSendChunked` function and the `sendChunkedFile` import from `../../hooks/useNostrSubscriptions`. (Each thread's `onSend` already builds and encrypts the message; the unified `MessageInput` now handles upload before calling `onSend`.)

- [ ] **Step 5: Remove the chunk sender**

In `src/hooks/useNostrSubscriptions.ts`, delete the `sendChunkedFile` wrapper export and its `sendChunkedFileUtil` import.

In `src/lib/fileTransfer.ts`, delete the `sendChunkedFile` function (the "Send-side" section) and the now-unused `buildDMEvent`/`buildChannelMessageEvent`/`publishEvent` imports IF they are no longer referenced in the file. Keep ALL receive-side code (`parseTransferPayload`, `handleFileStart`, `handleFileChunk`, `reconstructDataUrl`, constants, types).

- [ ] **Step 6: Run the test and type-check**

Run: `npx vitest run src/__tests__/messageInputSend.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS — no dangling `onSendChunked`/`sendChunkedFile` references.

- [ ] **Step 7: Run the broader affected suites**

Run: `npx vitest run src/__tests__/fileUtils.test.ts src/__tests__/inbox.test.ts`
Expected: PASS — message/attachment parsing and the legacy chunk receiver (still present) are unaffected.

- [ ] **Step 8: Manual verification note**

Cannot be automated here — record as outstanding: in the running app, attach a >150 KB file in a channel, a DM, and a group; confirm it uploads (progress shows) and sends, and that the group case (previously unsupported) now works.

- [ ] **Step 9: Commit**

```bash
git add src/components/Chat/MessageThread.tsx src/hooks/useNostrSubscriptions.ts src/lib/fileTransfer.ts src/__tests__/messageInputSend.test.tsx
git commit -m "feat: send large files via Blossom; enable group files; drop chunk sender

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3 — Receive / render path

### Task 7: `useBlossomAttachment` hook

**Files:**
- Create: `src/hooks/useBlossomAttachment.ts`
- Test: `src/__tests__/useBlossomAttachment.test.tsx`

**Interfaces:**
- Consumes: `downloadBlob`, `sha256Hex`, `getCachedObjectUrl`, `setCachedObjectUrl` from `../lib/blossom`; `decryptBlob` from `../lib/fileCrypto`; `AttachmentData` from `../lib/fileUtils`.
- Produces: `useBlossomAttachment(attachment: AttachmentData): { status: 'loading' | 'ready' | 'error'; objectUrl: string | null; retry: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/useBlossomAttachment.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { AttachmentData } from '../lib/fileUtils'

const downloadBlob = vi.fn()
const sha256Hex = vi.fn()
const decryptBlob = vi.fn()
vi.mock('../lib/blossom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/blossom')>()
  return {
    ...actual,
    downloadBlob: (...a: unknown[]) => downloadBlob(...a),
    sha256Hex: (...a: unknown[]) => sha256Hex(...a),
    getCachedObjectUrl: () => undefined,
    setCachedObjectUrl: vi.fn(),
  }
})
vi.mock('../lib/fileCrypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/fileCrypto')>()
  return { ...actual, decryptBlob: (...a: unknown[]) => decryptBlob(...a) }
})

import { useBlossomAttachment } from '../hooks/useBlossomAttachment'

const bytes = new TextEncoder().encode('img').buffer

beforeEach(() => {
  downloadBlob.mockReset(); sha256Hex.mockReset(); decryptBlob.mockReset()
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:obj'), revokeObjectURL: vi.fn() })
})
afterEach(() => { vi.restoreAllMocks() })

const plain: AttachmentData = { name: 'a.png', type: 'image/png', size: 3, url: 'https://srv/H', hash: 'H' }
const encrypted: AttachmentData = { ...plain, enc: { algo: 'AES-GCM', key: 'k', iv: 'iv' } }

describe('useBlossomAttachment', () => {
  it('plaintext: downloads, verifies hash, becomes ready', async () => {
    downloadBlob.mockResolvedValue(bytes)
    sha256Hex.mockResolvedValue('H')
    const { result } = renderHook(() => useBlossomAttachment(plain))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.objectUrl).toBe('blob:obj')
    expect(decryptBlob).not.toHaveBeenCalled()
  })

  it('encrypted: decrypts after verifying, becomes ready', async () => {
    downloadBlob.mockResolvedValue(bytes)
    sha256Hex.mockResolvedValue('H')
    decryptBlob.mockResolvedValue(bytes)
    const { result } = renderHook(() => useBlossomAttachment(encrypted))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(decryptBlob).toHaveBeenCalledTimes(1)
  })

  it('hash mismatch -> error, never decrypts', async () => {
    downloadBlob.mockResolvedValue(bytes)
    sha256Hex.mockResolvedValue('DIFFERENT')
    const { result } = renderHook(() => useBlossomAttachment(encrypted))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(decryptBlob).not.toHaveBeenCalled()
  })

  it('download failure -> error; retry re-attempts', async () => {
    downloadBlob.mockRejectedValueOnce(new Error('net'))
    const { result } = renderHook(() => useBlossomAttachment(plain))
    await waitFor(() => expect(result.current.status).toBe('error'))
    downloadBlob.mockResolvedValue(bytes)
    sha256Hex.mockResolvedValue('H')
    act(() => { result.current.retry() })
    await waitFor(() => expect(result.current.status).toBe('ready'))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/useBlossomAttachment.test.tsx`
Expected: FAIL — `src/hooks/useBlossomAttachment.ts` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useBlossomAttachment.ts`:

```ts
import { useEffect, useState } from 'react'
import { downloadBlob, sha256Hex, getCachedObjectUrl, setCachedObjectUrl } from '../lib/blossom'
import { decryptBlob } from '../lib/fileCrypto'
import type { AttachmentData } from '../lib/fileUtils'

type Status = 'loading' | 'ready' | 'error'

export function useBlossomAttachment(attachment: AttachmentData): {
  status: Status
  objectUrl: string | null
  retry: () => void
} {
  const [status, setStatus] = useState<Status>('loading')
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const url = attachment.url
  const hash = attachment.hash
  const encKey = attachment.enc?.key
  const encIv = attachment.enc?.iv
  const mime = attachment.type

  useEffect(() => {
    if (!url) { setStatus('error'); return }

    const cached = getCachedObjectUrl(url)
    if (cached) { setObjectUrl(cached); setStatus('ready'); return }

    let cancelled = false
    setStatus('loading')
    setObjectUrl(null)

    ;(async () => {
      try {
        const blob = await downloadBlob(url)
        if (hash) {
          const got = await sha256Hex(blob)
          if (got !== hash) throw new Error('hash mismatch')
        }
        const plain = encKey && encIv ? await decryptBlob(blob, encKey, encIv) : blob
        if (cancelled) return
        const obj = URL.createObjectURL(new Blob([plain], { type: mime }))
        setCachedObjectUrl(url, obj)
        setObjectUrl(obj)
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => { cancelled = true }
  }, [url, hash, encKey, encIv, mime, attempt])

  return { status, objectUrl, retry: () => setAttempt(a => a + 1) }
}
```

(Object URLs are cached module-level in `blossom.ts` and intentionally session-lived — not revoked per-unmount — because the virtualized list remounts message rows on scroll and multiple rows may share a blob; this mirrors the old inline data-URL lifetime.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/useBlossomAttachment.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBlossomAttachment.ts src/__tests__/useBlossomAttachment.test.tsx
git commit -m "feat: useBlossomAttachment resolves remote attachments (verify + decrypt)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Render remote attachments in `MessageItem`

**Files:**
- Modify: `src/components/Chat/MessageItem.tsx` (branch `AttachmentView` to a `RemoteAttachmentView` for remote attachments)
- Test: `src/__tests__/MessageItem.remote.test.tsx`

**Interfaces:**
- Consumes: `useBlossomAttachment` from `../../hooks/useBlossomAttachment`.
- Produces: an attachment with `url` and no `data` renders via the hook (loading/error/ready); a ready attachment reuses the existing inline renderers with the resolved object URL.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/MessageItem.remote.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Message } from '../store/nostrStore'

const useBlossomAttachment = vi.fn()
vi.mock('../hooks/useBlossomAttachment', () => ({
  useBlossomAttachment: (...a: unknown[]) => useBlossomAttachment(...a),
}))

import { MessageItem } from '../components/Chat/MessageItem'

const remoteImg = {
  text: '', attachment: { name: 'p.png', type: 'image/png', size: 3, url: 'https://srv/H', hash: 'H' },
}
function msg(): Message {
  return { id: 'm1', pubkey: 'them'.padEnd(64, '1'), content: JSON.stringify(remoteImg), createdAt: 1000, tags: [], kind: 42 }
}
const noop = () => {}

it('shows a loading state while a remote attachment resolves', () => {
  useBlossomAttachment.mockReturnValue({ status: 'loading', objectUrl: null, retry: noop })
  render(<MessageItem message={msg()} isOwn={false} showAvatar={false} onReply={noop} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})

it('shows an error state with a retry button on failure', () => {
  const retry = vi.fn()
  useBlossomAttachment.mockReturnValue({ status: 'error', objectUrl: null, retry })
  render(<MessageItem message={msg()} isOwn={false} showAvatar={false} onReply={noop} />)
  expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument()
})

it('renders the image once resolved to an object URL', () => {
  useBlossomAttachment.mockReturnValue({ status: 'ready', objectUrl: 'blob:obj', retry: noop })
  render(<MessageItem message={msg()} isOwn={false} showAvatar={false} onReply={noop} />)
  expect(screen.getByRole('img', { name: 'p.png' })).toHaveAttribute('src', 'blob:obj')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/MessageItem.remote.test.tsx`
Expected: FAIL — remote attachments currently render nothing usable (no `data`), and there is no loading/error UI.

- [ ] **Step 3: Add `RemoteAttachmentView` and branch in `MessageItem.tsx`**

In `src/components/Chat/MessageItem.tsx`:

1. Add the import:

```ts
import { useBlossomAttachment } from '../../hooks/useBlossomAttachment'
import { Loader2 } from 'lucide-react'
```

(`Loader2` may already be imported — if so, do not duplicate.)

2. Add the component (place it just above `AttachmentView`):

```tsx
function RemoteAttachmentView({ attachment, isOwn }: { attachment: AttachmentData; isOwn: boolean }) {
  const { status, objectUrl, retry } = useBlossomAttachment(attachment)

  if (status === 'ready' && objectUrl) {
    return <AttachmentView attachment={{ ...attachment, data: objectUrl }} isOwn={isOwn} />
  }
  if (status === 'error') {
    return (
      <button
        onClick={retry}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-red-700/50 bg-red-900/20 w-full text-left"
      >
        <AlertCircle size={20} className="text-red-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">Couldn't load attachment</p>
          <p className="text-xs text-gray-400 truncate">{attachment.name} — tap to retry</p>
        </div>
      </button>
    )
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-600/40 bg-gray-700/40 w-full">
      <Loader2 size={18} className="text-gray-400 animate-spin flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">Loading…</p>
        <p className="text-xs text-gray-400 truncate">{attachment.name}</p>
      </div>
    </div>
  )
}
```

(`AlertCircle` is already imported in this file.)

3. At the top of `AttachmentView`, branch to the remote view when there is no inline data but a url is present:

```tsx
function AttachmentView({ attachment, isOwn }: { attachment: AttachmentData; isOwn: boolean }) {
  if (!attachment.data && attachment.url) {
    return <RemoteAttachmentView attachment={attachment} isOwn={isOwn} />
  }
  if (attachment.type.startsWith('image/')) {
    // ...existing body unchanged...
```

(`RemoteAttachmentView` calls `AttachmentView` with `data` set, so the second pass takes the inline branch — no infinite recursion.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/MessageItem.remote.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS — entire suite green.

- [ ] **Step 6: Manual verification note**

Record as outstanding: in the running app, send and receive image/audio/PDF files in a channel, a DM, and a group across two accounts; confirm they download, decrypt (DM/group), verify, and render, and that download works; confirm a corrupted/unreachable URL shows the error+retry state.

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/MessageItem.tsx src/__tests__/MessageItem.remote.test.tsx
git commit -m "feat: render remote (Blossom) attachments with loading/error states

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Blossom upload/download/auth (`kind:24242`) → Task 2.
- File AES-GCM encrypt/decrypt → Task 1.
- Channel plaintext vs DM/group encrypt-then-upload → Task 5; `enc` only for dm/group.
- `hash` = uploaded-blob SHA-256, verified before decrypt; mismatch never rendered → Tasks 2 (`sha256Hex`), 7 (verify+error).
- Message format `{ url, hash, enc? }` + parse/preview + back-compat (legacy inline + legacy chunk receiver) → Task 4 (format) + Task 6 Step 5/7 (receiver kept).
- Default server + user override in Settings → Files, synced via `triggerSettingsSync` → Task 3.
- Groups gain file support → Task 6 Step 4.
- Render path (download → verify → decrypt → object URL) with loading/error/retry → Tasks 7 + 8.
- Remove chunk sender, keep receiver → Task 6 Step 5.
- Upload progress via XHR → Task 2 (`uploadBlob`) + Task 6 (progress UI).
- Inline small files unchanged → Task 6 Step 3 (threshold branch).
- Mobile/PWA (plain HTTPS, XHR progress, no fixed layouts) → no special task; inherent.
- Testing per spec → each task's tests; manual-verification notes in Tasks 6 & 8.

All spec sections map to a task. No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step has complete code; every run step states the command and expected result.

**Type consistency:** `AttachmentData` (extended in Task 4) is the shared type used by `uploadAttachment` (Task 5), `useBlossomAttachment` (Task 7), and `RemoteAttachmentView` (Task 8). `uploadBlob(server, bytes, mime, onProgress)` and its `{ url, sha256, size, type }` descriptor are consistent between Task 2 (def) and Task 5 (use). `uploadAttachment(attachment, chatType, server, onProgress)` is consistent between Task 5 (def) and Task 6 (use). `getMediaServer()`/`getCachedObjectUrl`/`setCachedObjectUrl`/`sha256Hex`/`downloadBlob` names match across Tasks 2, 5, 7. `enc: { algo:'AES-GCM', key, iv }` shape is identical in Tasks 4, 5, 7. `useBlossomAttachment` return shape `{ status, objectUrl, retry }` matches between Task 7 (def) and Task 8 (use).
