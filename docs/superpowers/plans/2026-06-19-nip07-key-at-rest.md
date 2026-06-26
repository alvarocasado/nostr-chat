# NIP-07 External Signer + Key-at-Rest Encryption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all Nostr signing/encryption through a `Signer` abstraction so the app can (a) use a NIP-07 browser extension and (b) stop persisting the private key in plaintext, encrypting it at rest with an opt-in passphrase.

**Architecture:** Introduce a module-singleton `Signer` (`getSigner()`/`setSigner()`/`clearSigner()`) mirroring the existing `getPool()`/`getUserDb()` singletons. Phase 0 swaps every `sk: Uint8Array` parameter for the signer with behavior preserved (key still persisted). Later phases replace plaintext persistence with encrypted-at-rest storage (device-key default, opt-in passphrase) and add a `Nip07Signer`.

**Tech Stack:** React 19, TypeScript, Zustand (persist → Dexie), nostr-tools 2.10 (nip04, finalizeEvent), WebCrypto (AES-GCM, PBKDF2), Dexie 4, Vitest + fake-indexeddb.

## Global Constraints

- Signer is a module singleton, same shape as `getPool()` in `src/lib/nostr.ts` and `getUserDb()` in `src/lib/userDb.ts`. Do NOT parameter-thread it.
- `build*`/`send*` crypto functions become `async` (NIP-07 `signEvent` is async). Update all call sites to `await`.
- No new runtime dependencies. Passphrase KDF is WebCrypto PBKDF2-SHA-256; iteration count is a named constant `PBKDF2_ITERATIONS = 600_000` and is stored inside each passphrase-mode record so old keys keep decrypting if the default changes.
- Key-at-rest device mode is obfuscation, not a vault — say so in a code comment where the device key is created. Passphrase mode is the real protection.
- NIP-07 "Login with Extension" UI is shown only when `window.nostr` exists. NIP-07 without `nip04` → allow login, degrade DM/call/group features, keep public channels working.
- No emojis in code, comments, or docs. Prefer many small files. Conventional commits.
- After each task, the full suite (`npm test`) must pass before moving on.

---

## File Structure

**New files**
- `src/lib/signer.ts` — `Signer` interface, `LocalSigner`, `Nip07Signer`, singleton + `requireSigner()`.
- `src/lib/keyStore.ts` — encrypt/decrypt the local secret at rest (device + passphrase modes), migration.
- `src/lib/nip07.ts` — minimal `window.nostr` typing + `hasNip07()` helper.
- `src/components/Auth/UnlockScreen.tsx` — passphrase prompt on cold start.
- `src/test/signer.ts` — test helper `installTestSigner(sk?)`.
- `src/__tests__/signer.test.ts`, `src/__tests__/keyStore.test.ts`, `src/__tests__/nip07Signer.test.ts`.

**Modified files**
- `src/lib/nostr.ts`, `src/lib/nostrSync.ts`, `src/lib/webrtc.ts`, `src/lib/fileTransfer.ts`, `src/lib/inbox.ts` — drop `sk`, use signer, become async.
- `src/lib/db.ts` — Dexie v3 `crypto` object store for the device `CryptoKey`.
- `src/store/nostrStore.ts` — set/clear signer; stop persisting key; `signerCaps`; restructure `completeLogin`/`logout`.
- `src/App.tsx` — bootstrap branch (device/passphrase/nip07/reconnect) + migration.
- `src/components/Auth/LoginScreen.tsx` — extension login button.
- `src/components/Settings/*` — Keys tab passphrase controls + auth-method display.
- `src/contexts/CallContext.tsx`, `src/hooks/useTypingIndicator.ts`, `src/hooks/useNostrSubscriptions.ts`, `src/components/Chat/MessageThread.tsx` — drop `getPrivateKey`, use signer + capability gating.
- Existing tests: `nostr.test.ts`, `nostrSync.test.ts`, `inbox.test.ts`, `store.test.ts`, `webrtc.test.ts`, `callState.test.ts` — install a test signer, drop `sk` args.

---

# Phase 0 — Signer abstraction (behavior-preserving)

End state of Phase 0: every crypto path goes through `getSigner()`; the key is still persisted as plaintext `privateKeyHex` (unchanged), and the signer is reconstructed on both login and rehydrate. The full suite passes.

## Task 1: Create the Signer module + LocalSigner

**Files:**
- Create: `src/lib/signer.ts`
- Create: `src/test/signer.ts`
- Test: `src/__tests__/signer.test.ts`

**Interfaces:**
- Produces:
  - `interface Signer { type: 'local' | 'nip07'; pubkey: string; signEvent(t: EventTemplate): Promise<Event>; nip04Encrypt(peer: string, plaintext: string): Promise<string>; nip04Decrypt(peer: string, ciphertext: string): Promise<string>; caps: { nip04: boolean } }`
  - `class LocalSigner implements Signer` with `constructor(sk: Uint8Array)` and `destroy(): void`
  - `getSigner(): Signer | null`, `setSigner(s: Signer): void`, `clearSigner(): void`, `requireSigner(): Signer`
  - test helper `installTestSigner(sk?: Uint8Array): { sk: Uint8Array; signer: LocalSigner }`

- [ ] **Step 1: Write the failing test**

`src/__tests__/signer.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { generateSecretKey, getPublicKey, nip04 } from 'nostr-tools'
import { LocalSigner, getSigner, setSigner, clearSigner, requireSigner } from '../lib/signer'

describe('LocalSigner', () => {
  beforeEach(() => clearSigner())

  it('derives pubkey and signs events', async () => {
    const sk = generateSecretKey()
    const signer = new LocalSigner(sk)
    expect(signer.pubkey).toBe(getPublicKey(sk))
    expect(signer.type).toBe('local')
    expect(signer.caps.nip04).toBe(true)
    const event = await signer.signEvent({ kind: 1, created_at: 0, tags: [], content: 'hi' })
    expect(event.pubkey).toBe(signer.pubkey)
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/)
  })

  it('round-trips nip04 with the recipient key', async () => {
    const a = new LocalSigner(generateSecretKey())
    const bSk = generateSecretKey()
    const ct = await a.nip04Encrypt(getPublicKey(bSk), 'secret')
    const pt = await nip04.decrypt(bSk, a.pubkey, ct)
    expect(pt).toBe('secret')
  })

  it('singleton set/get/require/clear', () => {
    expect(getSigner()).toBeNull()
    expect(() => requireSigner()).toThrow()
    const s = new LocalSigner(generateSecretKey())
    setSigner(s)
    expect(getSigner()).toBe(s)
    expect(requireSigner()).toBe(s)
    clearSigner()
    expect(getSigner()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- signer`
Expected: FAIL — cannot find module `../lib/signer`.

- [ ] **Step 3: Write `src/lib/signer.ts`**

```ts
import { finalizeEvent, getPublicKey, nip04, type Event, type EventTemplate } from 'nostr-tools'

export interface SignerCaps {
  nip04: boolean
}

export interface Signer {
  type: 'local' | 'nip07'
  pubkey: string
  signEvent(t: EventTemplate): Promise<Event>
  nip04Encrypt(peer: string, plaintext: string): Promise<string>
  nip04Decrypt(peer: string, ciphertext: string): Promise<string>
  caps: SignerCaps
}

export class LocalSigner implements Signer {
  readonly type = 'local' as const
  readonly pubkey: string
  readonly caps: SignerCaps = { nip04: true }
  private sk: Uint8Array

  constructor(sk: Uint8Array) {
    this.sk = sk
    this.pubkey = getPublicKey(sk)
  }

  async signEvent(t: EventTemplate): Promise<Event> {
    return finalizeEvent(t, this.sk)
  }

  async nip04Encrypt(peer: string, plaintext: string): Promise<string> {
    return nip04.encrypt(this.sk, peer, plaintext)
  }

  async nip04Decrypt(peer: string, ciphertext: string): Promise<string> {
    return nip04.decrypt(this.sk, peer, ciphertext)
  }

  /** Best-effort zeroing of the in-memory secret on logout. */
  destroy(): void {
    this.sk.fill(0)
  }
}

let _signer: Signer | null = null

export function getSigner(): Signer | null {
  return _signer
}

export function setSigner(s: Signer): void {
  _signer = s
}

export function clearSigner(): void {
  if (_signer instanceof LocalSigner) _signer.destroy()
  _signer = null
}

export function requireSigner(): Signer {
  if (!_signer) throw new Error('No signer available')
  return _signer
}
```

- [ ] **Step 4: Write `src/test/signer.ts` helper**

```ts
import { generateSecretKey } from 'nostr-tools'
import { LocalSigner, setSigner } from '../lib/signer'

/** Install a LocalSigner as the active singleton for tests. */
export function installTestSigner(sk: Uint8Array = generateSecretKey()) {
  const signer = new LocalSigner(sk)
  setSigner(signer)
  return { sk, signer }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- signer`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/signer.ts src/test/signer.ts src/__tests__/signer.test.ts
git commit -m "feat: add Signer abstraction with LocalSigner singleton"
```

---

## Task 2: Refactor `lib/nostr.ts` to the signer

**Files:**
- Modify: `src/lib/nostr.ts`
- Test (update): `src/__tests__/nostr.test.ts`

**Interfaces:**
- Consumes: `requireSigner()` from Task 1.
- Produces (new signatures, all `async` unless noted):
  - `buildProfileEvent(profile): Promise<Event>`
  - `buildDMEvent(recipientPubkey, content): Promise<Event>`
  - `decryptDM(senderPubkey, ciphertext): Promise<string>`
  - `buildChannelCreateEvent(name, about): Promise<Event>`
  - `buildTypingEvent(chatType, chatId): Promise<Event>`
  - `buildChannelMessageEvent(content, channelId, relayUrl, replyEventId?): Promise<Event>`
  - `buildGroupMessageEvent(encryptedContent, groupId, relayUrl, replyEventId?): Promise<Event>`
  - `buildGroupMetadataEvent(groupKeyHex, groupId, name, about, memberPubkeys): Promise<Event>`
  - `buildGroupKeyBackupEvent(groupId, groupKeyHex): Promise<Event>`
  - `buildGroupInviteEvent(recipientPubkey, groupId, groupKeyHex, groupName): Promise<Event>`
  - Unchanged: `getPool`, `fetchEvent`, `subscribeEvents`, `publishEvent`, `fetchEvents`, `parseProfile`, `shortPubkey`, kind constants, `DEFAULT_RELAYS`.

- [ ] **Step 1: Update the test first (drives the new signatures)**

In `src/__tests__/nostr.test.ts`, add at top:
```ts
import { installTestSigner } from '../test/signer'
import { clearSigner } from '../lib/signer'
```
Add `beforeEach(() => { installTestSigner() })` and `afterEach(() => clearSigner())`. Then change every `build*`/`decryptDM` call to drop the leading `sk` argument and `await` it. Example transformation:
```ts
// before
const ev = buildDMEvent(sk, recipient, 'hi')
// after
const ev = await buildDMEvent(recipient, 'hi')
```
If a test asserted `buildChannelMessageEvent` was synchronous, wrap in `await`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- nostr`
Expected: FAIL — signature mismatch / functions still require `sk`.

- [ ] **Step 3: Edit `src/lib/nostr.ts`**

Replace the import of `getPublicKey`/`nip04`/`finalizeEvent` usage in build functions with the signer. Keep `getPublicKey`/`nip19` imports that are still used by `encodeNsec`/`encodePubkey`/`generateKeys`. Add:
```ts
import { requireSigner } from './signer'
```
Replace each builder. Full replacements:
```ts
export async function buildProfileEvent(profile: {
  name?: string; display_name?: string; about?: string; picture?: string; nip05?: string
}): Promise<Event> {
  return requireSigner().signEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(profile),
  })
}

export async function buildDMEvent(recipientPubkey: string, content: string): Promise<Event> {
  const signer = requireSigner()
  const encryptedContent = await signer.nip04Encrypt(recipientPubkey, content)
  return signer.signEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkey]],
    content: encryptedContent,
  })
}

export async function decryptDM(senderPubkey: string, encryptedContent: string): Promise<string> {
  return requireSigner().nip04Decrypt(senderPubkey, encryptedContent)
}

export async function buildChannelCreateEvent(name: string, about: string): Promise<Event> {
  return requireSigner().signEvent({
    kind: 40,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({ name, about }),
  })
}

export async function buildTypingEvent(chatType: 'dm' | 'channel', chatId: string): Promise<Event> {
  const tags = chatType === 'dm' ? [['p', chatId]] : [['e', chatId]]
  return requireSigner().signEvent({
    kind: TYPING_INDICATOR_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: 'typing',
  })
}

export async function buildChannelMessageEvent(
  content: string, channelId: string, relayUrl: string, replyEventId?: string,
): Promise<Event> {
  const tags: string[][] = [['e', channelId, relayUrl, 'root']]
  if (replyEventId) tags.push(['e', replyEventId, '', 'reply'])
  return requireSigner().signEvent({ kind: 42, created_at: Math.floor(Date.now() / 1000), tags, content })
}

export async function buildGroupMessageEvent(
  encryptedContent: string, groupId: string, relayUrl: string, replyEventId?: string,
): Promise<Event> {
  const tags: string[][] = [['e', groupId, relayUrl, 'root']]
  if (replyEventId) tags.push(['e', replyEventId, '', 'reply'])
  return requireSigner().signEvent({ kind: GROUP_MESSAGE_KIND, created_at: Math.floor(Date.now() / 1000), tags, content: encryptedContent })
}

export async function buildGroupMetadataEvent(
  groupKeyHex: string, groupId: string, name: string, about: string, memberPubkeys: string[],
): Promise<Event> {
  const encrypted = await encryptWithGroupKey(JSON.stringify({ name, about, memberPubkeys }), groupKeyHex)
  return requireSigner().signEvent({ kind: 30040, created_at: Math.floor(Date.now() / 1000), tags: [['d', groupId]], content: encrypted })
}

export async function buildGroupKeyBackupEvent(groupId: string, groupKeyHex: string): Promise<Event> {
  const signer = requireSigner()
  const encrypted = await signer.nip04Encrypt(signer.pubkey, groupKeyHex)
  return signer.signEvent({ kind: 30041, created_at: Math.floor(Date.now() / 1000), tags: [['d', groupId]], content: encrypted })
}

export async function buildGroupInviteEvent(
  recipientPubkey: string, groupId: string, groupKeyHex: string, groupName: string,
): Promise<Event> {
  const signer = requireSigner()
  const payload = JSON.stringify({ type: 'group_invite', groupId, groupKeyHex, groupName })
  const encrypted = await signer.nip04Encrypt(recipientPubkey, payload)
  return signer.signEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', recipientPubkey]], content: encrypted })
}
```
Remove now-unused imports (`finalizeEvent`, `nip04` if no longer referenced; keep `getPublicKey` only if `generateKeys` still uses it — it does).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- nostr`
Expected: PASS. (Other suites may still fail — they are fixed in their own tasks.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/nostr.ts src/__tests__/nostr.test.ts
git commit -m "refactor: route nostr.ts builders through Signer"
```

---

## Task 3: Refactor `lib/nostrSync.ts` to the signer

**Files:**
- Modify: `src/lib/nostrSync.ts`
- Test (update): `src/__tests__/nostrSync.test.ts`

**Interfaces:**
- Consumes: `requireSigner()`.
- Produces:
  - `buildContactListEvent(contacts): Promise<Event>`
  - `publishContactList(contacts, relays): Promise<void>`
  - `buildChannelBookmarkEvent(channelIds): Promise<Event>`
  - `publishChannelBookmarks(channelIds, relays): Promise<void>`
  - `publishAppSettings(settings, relays): Promise<void>`
  - `fetchAppSettings(relays): Promise<{ settings; createdAt } | null>`
  - `fetchGroupKeys(relays): Promise<Record<string,string>>`
  - `syncFromRelays(relays): Promise<SyncResult>`
  - Unchanged: `fetchContactList(relays, pubkey)`, `fetchChannelBookmarks(relays, pubkey)`, `debounce`, `SyncResult`, `SyncedSettings`, `CallsSyncedSettings`.

- [ ] **Step 1: Update the test first**

In `src/__tests__/nostrSync.test.ts` add `installTestSigner`/`clearSigner` in `beforeEach`/`afterEach`. Drop the `sk` (and self-`pubkey`) args from `publishContactList`, `publishChannelBookmarks`, `publishAppSettings`, `fetchAppSettings`, `fetchGroupKeys`, `syncFromRelays`. Where a test needs the user's pubkey for assertions, read it from the installed signer: `const { signer } = installTestSigner(); const pubkey = signer.pubkey`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- nostrSync`
Expected: FAIL — signature mismatch.

- [ ] **Step 3: Edit `src/lib/nostrSync.ts`**

Replace `finalizeEvent`/`nip04` direct use with the signer. Full replacements:
```ts
import { requireSigner } from './signer'
// remove: import { finalizeEvent, nip04 } from 'nostr-tools'

export async function buildContactListEvent(contacts: Contact[]): Promise<Event> {
  return requireSigner().signEvent({
    kind: 3,
    created_at: Math.floor(Date.now() / 1000),
    tags: contacts.filter(c => !c.pending).map(c => ['p', c.pubkey]),
    content: '',
  })
}

export async function publishContactList(contacts: Contact[], relays: string[]): Promise<void> {
  await publishEvent(relays, await buildContactListEvent(contacts))
}

export async function buildChannelBookmarkEvent(channelIds: string[]): Promise<Event> {
  return requireSigner().signEvent({
    kind: 30001,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', CHANNELS_D_TAG], ...channelIds.map(id => ['e', id])],
    content: '',
  })
}

export async function publishChannelBookmarks(channelIds: string[], relays: string[]): Promise<void> {
  await publishEvent(relays, await buildChannelBookmarkEvent(channelIds))
}

async function buildAppSettingsEvent(settings: SyncedSettings): Promise<Event> {
  const signer = requireSigner()
  const encrypted = await signer.nip04Encrypt(signer.pubkey, JSON.stringify(settings))
  return signer.signEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', SETTINGS_D_TAG]],
    content: encrypted,
  })
}

export async function fetchAppSettings(
  relays: string[],
): Promise<{ settings: SyncedSettings; createdAt: number } | null> {
  const signer = requireSigner()
  const event = await fetchEvent(relays, {
    kinds: [30078], authors: [signer.pubkey], '#d': [SETTINGS_D_TAG], limit: 1,
  })
  if (!event) return null
  try {
    const plaintext = await signer.nip04Decrypt(signer.pubkey, event.content)
    return { settings: JSON.parse(plaintext) as SyncedSettings, createdAt: event.created_at }
  } catch {
    return null
  }
}

export async function publishAppSettings(settings: SyncedSettings, relays: string[]): Promise<void> {
  await publishEvent(relays, await buildAppSettingsEvent(settings))
}

export async function fetchGroupKeys(relays: string[]): Promise<Record<string, string>> {
  const signer = requireSigner()
  const events = await fetchEvents(relays, { kinds: [30041], authors: [signer.pubkey] })
  const keys: Record<string, string> = {}
  for (const event of events) {
    const groupId = event.tags.find(t => t[0] === 'd')?.[1]
    if (!groupId) continue
    try {
      keys[groupId] = await signer.nip04Decrypt(signer.pubkey, event.content)
    } catch {
      // corrupt or unrecognised - skip
    }
  }
  return keys
}

export async function syncFromRelays(relays: string[]): Promise<SyncResult> {
  const pubkey = requireSigner().pubkey
  const [contacts, channels, settings, groupKeysResult] = await Promise.allSettled([
    fetchContactList(relays, pubkey),
    fetchChannelBookmarks(relays, pubkey),
    fetchAppSettings(relays),
    fetchGroupKeys(relays),
  ])
  return {
    contacts: contacts.status === 'fulfilled' ? contacts.value : null,
    channels: channels.status === 'fulfilled' ? channels.value : null,
    settings: settings.status === 'fulfilled' ? settings.value : null,
    groupKeys: groupKeysResult.status === 'fulfilled' ? groupKeysResult.value : {},
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- nostrSync`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nostrSync.ts src/__tests__/nostrSync.test.ts
git commit -m "refactor: route nostrSync.ts through Signer"
```

---

## Task 4: Refactor `lib/webrtc.ts` to the signer

**Files:**
- Modify: `src/lib/webrtc.ts`
- Test (update): `src/__tests__/webrtc.test.ts`

**Interfaces:**
- Produces: `buildCallSignalEvent(recipientPubkey, signal): Promise<Event>`; `decryptCallSignal(senderPubkey, content): Promise<CallSignal | null>`. Unchanged: `getIceServers`, `fetchCallIceServers`, `mergeIceServers`, `isValidCallSignal` (internal), constants.

- [ ] **Step 1: Update the test first**

In `src/__tests__/webrtc.test.ts`, install a signer in `beforeEach` and drop the `sk` arg from `buildCallSignalEvent`/`decryptCallSignal`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- webrtc`
Expected: FAIL.

- [ ] **Step 3: Edit `src/lib/webrtc.ts`**

```ts
import { requireSigner } from './signer'
// remove: import { finalizeEvent, nip04 } from 'nostr-tools'  (keep type Event import)

export async function buildCallSignalEvent(
  recipientPubkey: string, signal: CallSignal,
): Promise<Event> {
  const signer = requireSigner()
  const encrypted = await signer.nip04Encrypt(recipientPubkey, JSON.stringify(signal))
  return signer.signEvent({
    kind: CALL_SIGNAL_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkey]],
    content: encrypted,
  })
}

export async function decryptCallSignal(
  senderPubkey: string, content: string,
): Promise<CallSignal | null> {
  try {
    const plain = await requireSigner().nip04Decrypt(senderPubkey, content)
    const obj = JSON.parse(plain) as unknown
    return isValidCallSignal(obj) ? obj : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- webrtc`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webrtc.ts src/__tests__/webrtc.test.ts
git commit -m "refactor: route webrtc.ts call signals through Signer"
```

---

## Task 5: Refactor `lib/fileTransfer.ts` send path

**Files:**
- Modify: `src/lib/fileTransfer.ts` (only `sendChunkedFile`)
- Test (update if present): `src/__tests__/fileUtils.test.ts` does not cover `sendChunkedFile`; no test change expected.

**Interfaces:**
- Produces: `sendChunkedFile(dataUrl, name, mime, size, chatType, chatId, relays, onProgress): Promise<void>` (drops `sk` and `_myPubkey`).

- [ ] **Step 1: Edit `src/lib/fileTransfer.ts`**

Replace the signature and the two `buildDMEvent`/`buildChannelMessageEvent` calls (now async, no `sk`):
```ts
export async function sendChunkedFile(
  dataUrl: string,
  name: string,
  mime: string,
  size: number,
  chatType: 'dm' | 'channel',
  chatId: string,
  relays: string[],
  onProgress: (sent: number, total: number) => void,
): Promise<void> {
  const transferId = generateTransferId()
  const { chunks } = splitDataUrl(dataUrl)
  const total = chunks.length

  const startPayload = serializeFileStart({ transferId, name, mime, size, totalChunks: total })
  const startEvent = chatType === 'dm'
    ? await buildDMEvent(chatId, startPayload)
    : await buildChannelMessageEvent(startPayload, chatId, relays[0])
  await publishEvent(relays, startEvent)

  for (let i = 0; i < total; i++) {
    const chunkPayload = serializeFileChunk({ transferId, index: i, total, data: chunks[i] })
    const chunkEvent = chatType === 'dm'
      ? await buildDMEvent(chatId, chunkPayload)
      : await buildChannelMessageEvent(chunkPayload, chatId, relays[0])
    await publishEvent(relays, chunkEvent)
    onProgress(i + 1, total)
  }
}
```

- [ ] **Step 2: Run the suite**

Run: `npm test -- fileUtils`
Expected: PASS (no behavior change to covered code). Type-check via `npm run build` is exercised in Task 11.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fileTransfer.ts
git commit -m "refactor: drop sk from sendChunkedFile"
```

---

## Task 6: Refactor `lib/inbox.ts` `processDMEvent`

**Files:**
- Modify: `src/lib/inbox.ts`
- Test (update): `src/__tests__/inbox.test.ts`

**Interfaces:**
- Produces: `processDMEvent(event, myPubkey, relays, opts): Promise<void>` (drops `sk`).
- Consumes: `decryptDM(senderPubkey, ciphertext)` (Task 2).

- [ ] **Step 1: Update the test first**

In `src/__tests__/inbox.test.ts`, install a signer whose pubkey is the "me" pubkey used by the test: `const { signer } = installTestSigner(mySk); const myPubkey = signer.pubkey`. Drop the `sk` argument from every `processDMEvent(...)` call.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- inbox`
Expected: FAIL — `processDMEvent` arity mismatch.

- [ ] **Step 3: Edit `src/lib/inbox.ts`**

Change the signature and the decrypt call:
```ts
export async function processDMEvent(
  event: Event,
  myPubkey: string,
  relays: string[],
  opts: ProcessOpts,
): Promise<void> {
  if (event.content.length > MAX_ENCRYPTED_CONTENT_LEN) return

  const peer = event.pubkey === myPubkey
    ? event.tags.find(t => t[0] === 'p')?.[1]
    : event.pubkey
  if (!peer) return

  let decrypted: string
  try {
    decrypted = await decryptDM(peer, event.content)
  } catch {
    return
  }
  // ...rest unchanged...
}
```
Update the import: `import { decryptDM, fetchEvent, parseProfile } from './nostr'` (unchanged names). Remove the `sk: Uint8Array` parameter only.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- inbox`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbox.ts src/__tests__/inbox.test.ts
git commit -m "refactor: drop sk from processDMEvent"
```

---

## Task 7: Wire signer into the store (login + rehydrate)

**Files:**
- Modify: `src/store/nostrStore.ts`
- Test (update): `src/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `LocalSigner`, `setSigner`, `clearSigner` (Task 1); new `publish*`/`syncFromRelays` signatures (Task 3).
- Produces: store still exposes `getPrivateKey()` (kept in Phase 0); signer singleton is set on login AND on rehydrate. The send-side helpers (`sendDM` etc.) in `useNostrSubscriptions.ts` are updated in Task 9.

- [ ] **Step 1: Update the test first**

In `src/__tests__/store.test.ts`, after a login action, assert the signer is installed:
```ts
import { getSigner } from '../lib/signer'
// ...
it('installs a LocalSigner on login', async () => {
  await useNostrStore.getState().generateAndLogin()
  const signer = getSigner()
  expect(signer?.type).toBe('local')
  expect(signer?.pubkey).toBe(useNostrStore.getState().publicKey)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- store`
Expected: FAIL — signer is null after login.

- [ ] **Step 3: Edit `src/store/nostrStore.ts`**

(a) Import:
```ts
import { LocalSigner, setSigner, clearSigner } from '../lib/signer'
```
(b) In `completeLogin`, right after computing `sk`, install the signer before any relay work:
```ts
async function completeLogin(sk, pk, nsecStr, set, get) {
  setSigner(new LocalSigner(sk))
  openUserDb(pk)
  // ...existing body...
}
```
(c) Replace the relay-sync call (signatures changed in Task 3):
```ts
syncFromRelays(relays).then(result => { /* body unchanged */ }).catch(() => {})
```
(d) In the three debounced schedulers, drop `getPrivateKey`/`sk` and the new signatures:
```ts
const scheduleContactsSync = () => {
  debounce('contacts', () => {
    const { contacts, relays } = get()
    if (getSigner()) void publishContactList(contacts, relays).catch(() => {})
  })
}
const scheduleChannelsSync = () => {
  debounce('channels', () => {
    const { joinedChannelIds, relays } = get()
    if (getSigner()) void publishChannelBookmarks(joinedChannelIds, relays).catch(() => {})
  })
}
const scheduleSettingsSync = () => {
  debounce('settings', () => {
    void (async () => {
      const { notificationSettings, mutedChats, relays, blockedPubkeys, dismissedRequests } = get()
      if (!getSigner()) return
      const now = Math.floor(Date.now() / 1000)
      const [turnMode, turnMetered, turnCustom] = await Promise.all([
        getSetting<string>('turn_mode', 'none'),
        getSetting<{ subdomain: string; apiKey: string } | null>('turn_metered_config', null),
        getSetting<{ url: string; username: string; credential: string } | null>('turn_custom_config', null),
      ])
      const VALID_TURN_MODES = ['none', 'metered', 'custom'] as const
      const safeMode = (VALID_TURN_MODES as readonly string[]).includes(turnMode)
        ? turnMode as 'none' | 'metered' | 'custom' : 'none'
      const callsSettings: CallsSyncedSettings = {
        turnMode: safeMode,
        ...(turnMetered ? { turnMetered } : {}),
        ...(turnCustom ? { turnCustom } : {}),
      }
      void publishAppSettings({ notificationSettings, mutedChats, relays, callsSettings, blockedPubkeys, dismissedRequests }, relays)
        .then(() => set({ syncedSettingsAt: now }))
        .catch(() => {})
    })()
  })
}
```
Update the imports from `nostrSync` to match (drop nothing; the names are the same). Note `getSigner` import from `../lib/signer`.
(e) In `logout`, add `clearSigner()`:
```ts
logout: () => {
  set({ /* unchanged */ })
  clearSigner()
  closeUserDb()
  clearActivePubkey()
},
```
(f) In `onRehydrateStorage`, reconstruct the signer from the still-persisted `privateKeyHex` so reloads keep working:
```ts
onRehydrateStorage: () => (state) => {
  if (state?.privateKeyHex) {
    setSigner(new LocalSigner(hexToBytes(state.privateKeyHex)))
    if (!state.nsec) state.nsec = encodeNsec(hexToBytes(state.privateKeyHex))
  }
  if (state?.notificationSettings) {
    const ns = state.notificationSettings
    if (ns.callEnabled === undefined) ns.callEnabled = true
    if (ns.callSound === undefined) ns.callSound = true
  }
},
```
Keep `getPrivateKey` and `privateKeyHex` in `partialize` for now (removed in Phase 1).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/nostrStore.ts src/__tests__/store.test.ts
git commit -m "feat: install Signer on login and rehydrate; sync via signer"
```

---

## Task 8: Refactor `CallContext.tsx` to the signer

**Files:**
- Modify: `src/contexts/CallContext.tsx`

**Interfaces:**
- Consumes: `getSigner()` (Task 1); `buildCallSignalEvent(recipient, signal)`, `decryptCallSignal(sender, content)` (Task 4).

- [ ] **Step 1: Edit `src/contexts/CallContext.tsx`**

(a) Add `import { getSigner } from '../lib/signer'`. (b) Remove `getPrivateKey` from the `useNostrStore()` destructure. (c) `sendSignal`:
```ts
const sendSignal = useCallback(async (peerPubkey: string, signal: CallSignal) => {
  if (!getSigner()) return
  const event = await buildCallSignalEvent(peerPubkey, signal)
  await publishEvent(relays, event)
}, [relays])
```
(d) `handleSignal` — replace the `const sk = getPrivateKey(); if (!sk) return` guard with `if (!getSigner()) return`, and remove `getPrivateKey` from its dep array. (e) Subscription effect:
```ts
useEffect(() => {
  if (!publicKey || !getSigner()) return
  const sub = subscribeEvents(
    relays,
    { kinds: [CALL_SIGNAL_KIND], '#p': [publicKey] } as Parameters<typeof subscribeEvents>[1],
    async (event) => {
      const signal = await decryptCallSignal(event.pubkey, event.content)
      if (signal) await handleSignal(event.pubkey, signal)
    },
  )
  return () => sub.close()
}, [publicKey, relays, handleSignal])
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: no type errors in `CallContext.tsx` (other files validated in Task 11).

- [ ] **Step 3: Commit**

```bash
git add src/contexts/CallContext.tsx
git commit -m "refactor: route CallContext signaling through Signer"
```

---

## Task 9: Refactor hooks (`useTypingIndicator`, `useNostrSubscriptions`)

**Files:**
- Modify: `src/hooks/useTypingIndicator.ts`
- Modify: `src/hooks/useNostrSubscriptions.ts`

**Interfaces:**
- Consumes: `getSigner()`; async builders from Task 2; `processDMEvent(event, myPubkey, relays, opts)` from Task 6.
- Produces (send helpers, drop `sk`): `sendChannelMessage(content, channelId, relays, replyEventId?)`, `sendDM(content, recipientPubkey, relays)`, `createChannel(name, about, relays)`, `publishProfile(profile, relays)`, `sendChunkedFile(dataUrl, name, mime, size, chatType, chatId, relays, onProgress)`.

- [ ] **Step 1: Edit `useTypingIndicator.ts`**

Add `import { getSigner } from '../lib/signer'`; remove `getPrivateKey` from destructure; rewrite `notifyTyping`:
```ts
const notifyTyping = useCallback(() => {
  const now = Date.now()
  if (now - lastSent.current < THROTTLE_MS) return
  lastSent.current = now
  if (!getSigner() || !publicKey) return
  void (async () => {
    const event = await buildTypingEvent(chatType, chatId)
    void publishEvent(stableRelays, event)
  })()
}, [chatType, chatId, publicKey, stableRelays])
```

- [ ] **Step 2: Edit `useNostrSubscriptions.ts`**

(a) Add `import { getSigner } from '../lib/signer'`. (b) `useDMMessages`: replace `const sk = getPrivateKey(); if (!sk) return` with `if (!getSigner()) return`; call `processDMEvent(event, myPubkey, stableRelays, { live })`; remove `getPrivateKey` from destructure and deps. (c) `useGlobalInbox` DM effect: replace `const sk = useNostrStore.getState().getPrivateKey(); if (!sk) return` with `if (!getSigner()) return`; call `processDMEvent(event, publicKey, stableRelays, { live })`. (d) `useGroupInviteListener`: drop `getPrivateKey`; guard `if (!getSigner()) return`; `const decrypted = await decryptDM(event.pubkey, event.content)`; `const backup = await buildGroupKeyBackupEvent(groupId, groupKeyHex)` (drop `mySk`); remove the `getPrivateKey` lookups. (e) The exported send helpers:
```ts
export async function sendChannelMessage(content: string, channelId: string, relays: string[], replyEventId?: string) {
  const event = await buildChannelMessageEvent(content, channelId, relays[0], replyEventId)
  await publishEvent(relays, event)
  return event
}
export async function sendDM(content: string, recipientPubkey: string, relays: string[]) {
  const event = await buildDMEvent(recipientPubkey, content)
  await publishEvent(relays, event)
  return event
}
export async function createChannel(name: string, about: string, relays: string[]) {
  const event = await buildChannelCreateEvent(name, about)
  await publishEvent(relays, event)
  return event
}
export async function publishProfile(profile: Partial<NostrProfile>, relays: string[]) {
  const event = await buildProfileEvent(profile)
  await publishEvent(relays, event)
  return event
}
export async function sendChunkedFile(
  dataUrl: string, name: string, mime: string, size: number,
  chatType: 'dm' | 'channel', chatId: string, relays: string[],
  onProgress: (sent: number, total: number) => void,
): Promise<void> {
  return sendChunkedFileUtil(dataUrl, name, mime, size, chatType, chatId, relays, onProgress)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTypingIndicator.ts src/hooks/useNostrSubscriptions.ts
git commit -m "refactor: route hooks through Signer; drop sk from send helpers"
```

---

## Task 9b: Refactor remaining component call sites (added during execution)

Discovered during Task 8: four components call `getPrivateKey()` and the changed helpers but were missing from the original file map. They must be updated for the Phase 0 build gate (Task 10) to pass.

**Files:**
- Modify: `src/components/Chat/AddChannelModal.tsx`
- Modify: `src/components/Chat/AddGroupModal.tsx`
- Modify: `src/components/Settings/SettingsScreen.tsx`
- Modify: `src/components/Settings/SettingsPanel.tsx`

**Interfaces consumed:** `getSigner()`; `createChannel(name, about, relays)`; `publishProfile(profile, relays)`; `buildGroupMetadataEvent(groupKeyHex, groupId, name, about, memberPubkeys)`; `buildGroupKeyBackupEvent(groupId, groupKeyHex)`; `buildGroupInviteEvent(recipientPubkey, groupId, groupKeyHex, groupName)` — all async, no `sk`.

- [ ] **Step 1: AddChannelModal.tsx** — remove `getPrivateKey` from the `useNostrStore()` destructure; replace `const sk = getPrivateKey(); if (!sk) ...` with `if (!getSigner()) { /* surface existing error path */ return }`; call `await createChannel(name.trim(), about.trim(), relays)`.

- [ ] **Step 2: AddGroupModal.tsx** — remove `getPrivateKey`; guard `if (!getSigner()) return`; update the three builder calls: `await buildGroupMetadataEvent(groupKeyHex, groupId, name.trim(), about.trim(), allMembers)`, `await buildGroupKeyBackupEvent(groupId, groupKeyHex)`, `await buildGroupInviteEvent(memberPubkey, groupId, groupKeyHex, name.trim())`.

- [ ] **Step 3: SettingsScreen.tsx and SettingsPanel.tsx** — remove `getPrivateKey`; guard `if (!getSigner()) return`; call `await publishProfile({ display_name: displayName, name: displayName, about, picture, nip05 }, relays)`. (These two files duplicate the profile-publish block; update both identically — do not refactor the duplication, it is out of scope.)

- [ ] **Step 4: Verify** — `npm run build` should now show errors ONLY in `useTypingIndicator.ts`, `useNostrSubscriptions.ts`, and `MessageThread.tsx` (Tasks 9 and 10). Run `npm test` (focused suites already covered; no component tests for these). Commit:

```bash
git add src/components/Chat/AddChannelModal.tsx src/components/Chat/AddGroupModal.tsx src/components/Settings/SettingsScreen.tsx src/components/Settings/SettingsPanel.tsx
git commit -m "refactor: route remaining component call sites through Signer"
```

## Task 10: Refactor `MessageThread.tsx` send paths

**Files:**
- Modify: `src/components/Chat/MessageThread.tsx`

**Interfaces:**
- Consumes: `getSigner()`; async `buildChannelMessageEvent`/`buildDMEvent`/`buildGroupMessageEvent`; new `sendChunkedFile` signature.

- [ ] **Step 1: Edit the three thread components**

In each of `ChannelThread`, `DMThread`, `GroupThread`: add `import { getSigner } from '../../lib/signer'`; remove `getPrivateKey` from the `useNostrStore()` destructure. Replace `const sk = getPrivateKey(); if (!sk || !publicKey) return` with `if (!getSigner() || !publicKey) return`. Update builders to `await` and drop `sk`:
- Channel: `const event = await buildChannelMessageEvent(content, channelId, relays[0], replyTo?.id)`
- DM: `const event = await buildDMEvent(theirPubkey, content)`
- Group: keep `const encryptedContent = await encryptWithGroupKey(content, groupKey)` then `const event = await buildGroupMessageEvent(encryptedContent, groupId, relays[0], replyTo?.id)` (keep the `!groupKey` guard).

Update `handleSendChunked` in channel and DM:
- Channel: `await sendChunkedFile(attachment.data, attachment.name, attachment.type, attachment.size, 'channel', channelId, relays, onProgress)`
- DM: `await sendChunkedFile(attachment.data, attachment.name, attachment.type, attachment.size, 'dm', theirPubkey, relays, onProgress)`

`handleRetry` is unchanged (it republishes an already-built event from `pendingEventsRef`).

- [ ] **Step 2: Full type-check + suite (Phase 0 gate)**

Run: `npm run build && npm test`
Expected: build clean; all tests PASS. Behavior is identical to before Phase 0; the key is still persisted as plaintext.

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/MessageThread.tsx
git commit -m "refactor: route MessageThread send paths through Signer"
```

---

# Phase 1 — Key at rest (device mode + migration)

End state: `privateKeyHex`/`nsec` are no longer persisted in the Zustand blob. The secret is wrapped under a non-extractable device `CryptoKey` and stored separately; existing plaintext keys migrate transparently on next load. Auto-login behavior is preserved.

## Task 11: Dexie v3 crypto store + keyStore device mode

**Files:**
- Modify: `src/lib/db.ts`
- Create: `src/lib/keyStore.ts`
- Test: `src/__tests__/keyStore.test.ts`

**Interfaces:**
- Produces (keyStore, device mode only this task):
  - `saveLocalKey(secret: Uint8Array, opts?: { passphrase?: string }): Promise<void>`
  - `loadLocalKey(opts?: { passphrase?: string }): Promise<Uint8Array | null>`
  - `hasLocalKey(): Promise<boolean>`
  - `keyProtection(): Promise<'none' | 'device' | 'passphrase'>`
  - `clearLocalKey(): Promise<void>`
  - `PBKDF2_ITERATIONS = 600_000`
  - (passphrase branch is added in Task 14; device mode is the default path here)
- Consumes: `getUserDb()` from `userDb.ts`.

- [ ] **Step 1: Add Dexie v3 crypto store**

In `src/lib/db.ts`:
```ts
export interface CryptoRecord {
  id: string
  key: CryptoKey
}
// ...
export class UserDatabase extends Dexie {
  settings!: Table<SettingRecord, string>
  messages!: Table<MessageRecord, string>
  crypto!: Table<CryptoRecord, string>

  constructor(pubkey: string) {
    super(`nostr-chat-${pubkey}`)
    this.version(1).stores({ settings: 'key' })
    this.version(2).stores({ settings: 'key', messages: 'id, [chatId+createdAt], createdAt' })
    this.version(3).stores({ settings: 'key', messages: 'id, [chatId+createdAt], createdAt', crypto: 'id' })
  }
}
```

- [ ] **Step 2: Write the failing test**

`src/__tests__/keyStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { generateSecretKey } from 'nostr-tools'
import { openUserDb, closeUserDb } from '../lib/userDb'
import { saveLocalKey, loadLocalKey, hasLocalKey, keyProtection, clearLocalKey } from '../lib/keyStore'

const PK = 'a'.repeat(64)

function eq(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

describe('keyStore device mode', () => {
  beforeEach(() => { openUserDb(PK) })

  it('round-trips a secret under the device key', async () => {
    const sk = generateSecretKey()
    await saveLocalKey(sk)
    expect(await hasLocalKey()).toBe(true)
    expect(await keyProtection()).toBe('device')
    const loaded = await loadLocalKey()
    expect(loaded && eq(loaded, sk)).toBe(true)
  })

  it('reports none when empty and clears', async () => {
    await clearLocalKey()
    expect(await hasLocalKey()).toBe(false)
    expect(await keyProtection()).toBe('none')
    expect(await loadLocalKey()).toBeNull()
    closeUserDb()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- keyStore`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/lib/keyStore.ts` (device mode)**

```ts
import { getUserDb } from './userDb'

export const PBKDF2_ITERATIONS = 600_000

const ENC_KEY_SETTING = 'encrypted-key'
const DEVICE_KEY_ID = 'device-wrap-key'

type DeviceRecord = { mode: 'device'; iv: string; ciphertext: string }
type PassphraseRecord = {
  mode: 'passphrase'; iv: string; salt: string; iterations: number; ciphertext: string
}
type EncryptedKey = DeviceRecord | PassphraseRecord

function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

async function readRecord(): Promise<EncryptedKey | null> {
  const db = getUserDb()
  if (!db) return null
  const rec = await db.settings.get(ENC_KEY_SETTING)
  return rec ? (JSON.parse(rec.value) as EncryptedKey) : null
}
async function writeRecord(value: EncryptedKey): Promise<void> {
  const db = getUserDb()
  if (!db) return
  await db.settings.put({ key: ENC_KEY_SETTING, value: JSON.stringify(value) })
}

async function getOrCreateDeviceKey(): Promise<CryptoKey | null> {
  const db = getUserDb()
  if (!db) return null
  const existing = await db.crypto.get(DEVICE_KEY_ID)
  if (existing) return existing.key
  // Device mode is obfuscation, not a vault: the key is non-extractable so its
  // raw bytes cannot be read from IndexedDB, but on-device code execution can
  // still invoke decryption. Passphrase mode is the real protection.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await db.crypto.put({ id: DEVICE_KEY_ID, key })
  return key
}

async function wrap(key: CryptoKey, secret: Uint8Array): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, secret)
  return { iv: b64encode(iv), ciphertext: b64encode(new Uint8Array(ct)) }
}
async function unwrap(key: CryptoKey, iv: string, ciphertext: string): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(iv) }, key, b64decode(ciphertext))
  return new Uint8Array(plain)
}

export async function saveLocalKey(secret: Uint8Array, opts?: { passphrase?: string }): Promise<void> {
  if (opts?.passphrase) return savePassphrase(secret, opts.passphrase) // defined in Task 14
  const deviceKey = await getOrCreateDeviceKey()
  if (!deviceKey) return
  const { iv, ciphertext } = await wrap(deviceKey, secret)
  await writeRecord({ mode: 'device', iv, ciphertext })
}

export async function loadLocalKey(opts?: { passphrase?: string }): Promise<Uint8Array | null> {
  const rec = await readRecord()
  if (!rec) return null
  if (rec.mode === 'device') {
    const deviceKey = await getOrCreateDeviceKey()
    if (!deviceKey) return null
    try { return await unwrap(deviceKey, rec.iv, rec.ciphertext) } catch { return null }
  }
  return loadPassphrase(rec, opts?.passphrase) // defined in Task 14
}

export async function hasLocalKey(): Promise<boolean> {
  return (await readRecord()) !== null
}

export async function keyProtection(): Promise<'none' | 'device' | 'passphrase'> {
  const rec = await readRecord()
  return rec ? rec.mode : 'none'
}

export async function clearLocalKey(): Promise<void> {
  const db = getUserDb()
  if (!db) return
  await db.settings.delete(ENC_KEY_SETTING)
  await db.crypto.delete(DEVICE_KEY_ID)
}

// --- Passphrase mode: implemented in Task 14 ---
async function savePassphrase(_secret: Uint8Array, _passphrase: string): Promise<void> {
  throw new Error('passphrase mode not implemented yet')
}
async function loadPassphrase(_rec: PassphraseRecord, _passphrase?: string): Promise<Uint8Array | null> {
  throw new Error('passphrase mode not implemented yet')
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- keyStore`
Expected: PASS (device-mode tests). Passphrase tests come in Task 14.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts src/lib/keyStore.ts src/__tests__/keyStore.test.ts
git commit -m "feat: add at-rest key store with device-key encryption"
```

---

## Task 12: Persist auth method; stop persisting the plaintext key; migrate

**Files:**
- Modify: `src/store/nostrStore.ts`
- Modify: `src/lib/userDb.ts` (add `auth-method` helpers)
- Modify: `src/App.tsx` (bootstrap: load key + migrate)
- Test (update): `src/__tests__/store.test.ts`, `src/__tests__/db.test.ts` if it asserts on persisted shape.

**Interfaces:**
- Produces: `getAuthMethod()/setAuthMethod()/clearAuthMethod()` in `userDb.ts` (values `'local' | 'nip07'`, backed by localStorage like `getActivePubkey`); store no longer persists `privateKeyHex`/`nsec`; `completeLogin` calls `saveLocalKey(sk)` + `setAuthMethod('local')`.
- Consumes: `saveLocalKey`, `loadLocalKey`, `keyProtection` (Task 11); `LocalSigner`/`setSigner` (Task 1).

- [ ] **Step 1: Add auth-method helpers to `userDb.ts`**

```ts
export const AUTH_METHOD_KEY = 'nostr-auth-method'
export type AuthMethod = 'local' | 'nip07'

export function getAuthMethod(): AuthMethod | null {
  try { return localStorage.getItem(AUTH_METHOD_KEY) as AuthMethod | null } catch { return null }
}
export function setAuthMethod(m: AuthMethod): void {
  try { localStorage.setItem(AUTH_METHOD_KEY, m) } catch {}
}
export function clearAuthMethod(): void {
  try { localStorage.removeItem(AUTH_METHOD_KEY) } catch {}
}
```

- [ ] **Step 2: Update the store**

(a) In `completeLogin`, after `setSigner(new LocalSigner(sk))` and `openUserDb(pk)`, persist the encrypted key and auth method:
```ts
setSigner(new LocalSigner(sk))
openUserDb(pk)
await saveLocalKey(sk)
setAuthMethod('local')
```
(b) Remove `privateKeyHex` and `nsec` from `partialize` (delete those two lines). Keep `npub`, `publicKey`, `profile`, etc.
(c) Remove the in-memory `privateKeyHex`/`nsec` fields? Keep the fields in state typing but they are session-only now and unused for crypto. Simplest: keep `nsec` (used by Keys tab export for local users; recompute on login) and **drop** `privateKeyHex` from state and remove `getPrivateKey`. Concretely:
- Delete `privateKeyHex` from `NostrState`, from initial state, from `logout`'s reset, and delete the `getPrivateKey` action and its interface line.
- Replace any remaining `get().getPrivateKey()` references (there should be none after Phase 0) — grep to confirm.
- Keep `nsec` field; set it in `completeLogin` as today.
(d) `onRehydrateStorage`: remove the `setSigner(... privateKeyHex ...)` line added in Task 7 (the signer is now established during bootstrap from `loadLocalKey`, see Step 3). Keep the `notificationSettings` defaults block.

- [ ] **Step 3: Update `App.tsx` bootstrap + migration**

Replace the bootstrap effect body:
```ts
useEffect(() => {
  async function bootstrap() {
    const pubkey = getActivePubkey()
    const method = getAuthMethod()
    if (pubkey) {
      openUserDb(pubkey)
      await evictOldMessages()
      await useNostrStore.persist.rehydrate()
      await migratePlaintextKeyIfNeeded(pubkey)
      if (method === 'local' || method === null) {
        const protection = await keyProtection()
        if (protection === 'device') {
          const sk = await loadLocalKey()
          if (sk) setSigner(new LocalSigner(sk))
        }
        // passphrase protection -> handled by UnlockScreen in Task 15
      }
      // nip07 -> handled in Task 17
    }
    setIsHydrating(false)
  }
  bootstrap()
}, [])
```
Add a migration helper in `App.tsx` (or a small `src/lib/migrate.ts` — prefer the latter for testability):

`src/lib/migrate.ts`:
```ts
import { getUserDb } from './userDb'
import { saveLocalKey, hasLocalKey } from './keyStore'

const STORAGE_KEY = 'nostr-chat-storage'

/** One-time: move a plaintext privateKeyHex out of the Zustand blob into the encrypted key store. */
export async function migratePlaintextKeyIfNeeded(_pubkey: string): Promise<void> {
  const db = getUserDb()
  if (!db) return
  if (await hasLocalKey()) return
  const rec = await db.settings.get(STORAGE_KEY)
  if (!rec) return
  let parsed: { state?: { privateKeyHex?: string } }
  try { parsed = JSON.parse(rec.value) } catch { return }
  const hex = parsed.state?.privateKeyHex
  if (!hex) return
  const bytes = Uint8Array.from(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  await saveLocalKey(bytes)
  delete parsed.state!.privateKeyHex
  if (parsed.state && 'nsec' in parsed.state) delete (parsed.state as Record<string, unknown>).nsec
  await db.settings.put({ key: STORAGE_KEY, value: JSON.stringify(parsed) })
}
```
Import `migratePlaintextKeyIfNeeded`, `keyProtection`, `loadLocalKey`, `LocalSigner`, `setSigner`, `getAuthMethod` into `App.tsx`.

- [ ] **Step 4: Write/adjust tests**

Add to `keyStore.test.ts` (or a new `migrate.test.ts`) a migration test:
```ts
import { migratePlaintextKeyIfNeeded } from '../lib/migrate'
it('migrates a plaintext privateKeyHex into the key store', async () => {
  const db = getUserDb()!
  const hex = 'b'.repeat(64)
  await db.settings.put({ key: 'nostr-chat-storage', value: JSON.stringify({ state: { privateKeyHex: hex, publicKey: PK } }) })
  await migratePlaintextKeyIfNeeded(PK)
  expect(await hasLocalKey()).toBe(true)
  const blob = JSON.parse((await db.settings.get('nostr-chat-storage'))!.value)
  expect(blob.state.privateKeyHex).toBeUndefined()
})
```
Update `store.test.ts`: the `getSigner()?.pubkey === publicKey` assertion from Task 7 still holds; remove any assertion that reads `privateKeyHex` from persisted state.

- [ ] **Step 5: Run the suite + build**

Run: `npm run build && npm test`
Expected: build clean; all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/nostrStore.ts src/lib/userDb.ts src/lib/migrate.ts src/App.tsx src/__tests__/keyStore.test.ts src/__tests__/store.test.ts
git commit -m "feat: encrypt key at rest; migrate plaintext keys; auth-method persistence"
```

---

# Phase 2 — Opt-in passphrase + UnlockScreen

## Task 13: keyStore passphrase mode (PBKDF2)

**Files:**
- Modify: `src/lib/keyStore.ts`
- Test: `src/__tests__/keyStore.test.ts`

**Interfaces:**
- Produces: working `savePassphrase`/`loadPassphrase`; `setPassphrase(secret, passphrase | null): Promise<void>` (null => revert to device mode); `keyProtection()` returns `'passphrase'` after set.

- [ ] **Step 1: Add failing tests**

```ts
it('round-trips under a passphrase and rejects the wrong one', async () => {
  const sk = generateSecretKey()
  await saveLocalKey(sk, { passphrase: 'hunter2' })
  expect(await keyProtection()).toBe('passphrase')
  const ok = await loadLocalKey({ passphrase: 'hunter2' })
  expect(ok && eq(ok, sk)).toBe(true)
  expect(await loadLocalKey({ passphrase: 'wrong' })).toBeNull()
})

it('setPassphrase(null) reverts to device mode', async () => {
  const sk = generateSecretKey()
  await saveLocalKey(sk, { passphrase: 'hunter2' })
  await setPassphrase(sk, null)
  expect(await keyProtection()).toBe('device')
  const ok = await loadLocalKey()
  expect(ok && eq(ok, sk)).toBe(true)
})
```
Add `setPassphrase` to the import in the test file.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- keyStore`
Expected: FAIL — `passphrase mode not implemented yet`.

- [ ] **Step 3: Implement passphrase mode in `keyStore.ts`**

Replace the two stub functions and add `setPassphrase` + `deriveKey`:
```ts
async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function savePassphrase(secret: Uint8Array, passphrase: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const { iv, ciphertext } = await wrap(key, secret)
  await writeRecord({ mode: 'passphrase', iv, salt: b64encode(salt), iterations: PBKDF2_ITERATIONS, ciphertext })
  // Passphrase mode supersedes device mode: drop any device wrap key.
  const db = getUserDb()
  if (db) await db.crypto.delete(DEVICE_KEY_ID)
}

async function loadPassphrase(rec: PassphraseRecord, passphrase?: string): Promise<Uint8Array | null> {
  if (!passphrase) return null
  try {
    const key = await deriveKey(passphrase, b64decode(rec.salt), rec.iterations)
    return await unwrap(key, rec.iv, rec.ciphertext)
  } catch {
    return null
  }
}

/** Switch protection: passphrase string sets/changes it, null reverts to device mode. */
export async function setPassphrase(secret: Uint8Array, passphrase: string | null): Promise<void> {
  if (passphrase) await savePassphrase(secret, passphrase)
  else await saveLocalKey(secret) // device mode
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- keyStore`
Expected: PASS (all keyStore tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/keyStore.ts src/__tests__/keyStore.test.ts
git commit -m "feat: add passphrase mode (PBKDF2) to key store"
```

---

## Task 14: UnlockScreen + bootstrap passphrase branch

**Files:**
- Create: `src/components/Auth/UnlockScreen.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `loadLocalKey({ passphrase })`, `keyProtection()`; `LocalSigner`/`setSigner`; store `logout`.
- Produces: `UnlockScreen` shows when `auth=local` and protection is `passphrase`; on success it installs the signer and lets the app render.

- [ ] **Step 1: Write `UnlockScreen.tsx`**

```tsx
import { useState } from 'react'
import { Lock } from 'lucide-react'
import { LocalSigner, setSigner } from '../../lib/signer'
import { loadLocalKey } from '../../lib/keyStore'

export function UnlockScreen({ onUnlocked, onLogout }: { onUnlocked: () => void; onLogout: () => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!passphrase || busy) return
    setBusy(true); setError('')
    const sk = await loadLocalKey({ passphrase })
    setBusy(false)
    if (!sk) { setError('Incorrect passphrase'); return }
    setSigner(new LocalSigner(sk))
    onUnlocked()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-purple-950 to-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm glass rounded-2xl p-8 space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-3">
            <Lock size={24} className="text-white" />
          </div>
          <h2 className="text-xl font-bold text-white">Unlock</h2>
          <p className="text-gray-400 text-sm mt-1">Enter your passphrase to decrypt your key.</p>
        </div>
        <input
          type="password"
          autoFocus
          value={passphrase}
          onChange={e => { setPassphrase(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Passphrase"
          className="w-full bg-gray-900 border border-gray-700 focus:border-purple-500 rounded-xl px-4 py-3 text-white outline-none"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button onClick={submit} disabled={busy} className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors">
          {busy ? 'Unlocking...' : 'Unlock'}
        </button>
        <button onClick={onLogout} className="w-full text-gray-400 hover:text-white text-sm transition-colors">
          Use a different account
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into `App.tsx`**

Add `const [locked, setLocked] = useState(false)`. In bootstrap, when `method === 'local'` and `keyProtection() === 'passphrase'` and no signer was installed, `setLocked(true)`. After `if (isHydrating)`, render:
```tsx
if (locked) {
  return <UnlockScreen onUnlocked={() => setLocked(false)} onLogout={() => { useNostrStore.getState().logout(); setLocked(false) }} />
}
```
(The existing `if (!publicKey)` LoginScreen branch stays below this.)

- [ ] **Step 3: Manual verification note + build**

Run: `npm run build && npm test`
Expected: build clean; all PASS. (Passphrase cold-start flow is verified manually: set a passphrase in Keys tab — Task 16 — then reload.)

- [ ] **Step 4: Commit**

```bash
git add src/components/Auth/UnlockScreen.tsx src/App.tsx
git commit -m "feat: add passphrase UnlockScreen and bootstrap branch"
```

---

## Task 15: Keys settings tab — passphrase controls

**Files:**
- Modify: the Keys settings tab (locate via `grep -rl "nsec" src/components/Settings`; likely `SettingsScreen.tsx`/`SettingsPanel.tsx`).

**Interfaces:**
- Consumes: `keyProtection()`, `setPassphrase(secret, passphrase|null)`, `loadLocalKey()`; store `nsec`/auth-method.

- [ ] **Step 1: Add a "Key protection" section to the Keys tab**

For `auth-method === 'local'` only, render the current protection (`keyProtection()` -> "Device" or "Passphrase") and controls:
- "Set passphrase" / "Change passphrase": collect a passphrase (and confirm), load the current secret via `loadLocalKey()` (device mode) or require current passphrase, then `await setPassphrase(secret, newPassphrase)`.
- "Remove passphrase": require current passphrase, `loadLocalKey({ passphrase })` -> `await setPassphrase(secret, null)`.
Show inline success/error. Reuse the existing show/hide and copy patterns from `LoginScreen`. Keep nsec export gated behind the unlocked in-memory secret.

For `auth-method === 'nip07'`, render "Signed in with extension" and hide passphrase + nsec-export controls.

- [ ] **Step 2: Build + manual check**

Run: `npm run build`
Expected: clean. Manually: set a passphrase, reload -> UnlockScreen appears; correct passphrase enters the app; wrong passphrase shows "Incorrect passphrase".

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings
git commit -m "feat: passphrase set/change/remove in Keys settings"
```

---

# Phase 3 — NIP-07 external signer

## Task 16: Nip07Signer + window.nostr typing

**Files:**
- Create: `src/lib/nip07.ts`
- Modify: `src/lib/signer.ts` (add `Nip07Signer`)
- Test: `src/__tests__/nip07Signer.test.ts`

**Interfaces:**
- Produces: `hasNip07(): boolean`; `class Nip07Signer implements Signer` with `static create(): Promise<Nip07Signer>` (caches pubkey and nip04 capability).

- [ ] **Step 1: Write `src/lib/nip07.ts`**

```ts
import type { Event, EventTemplate } from 'nostr-tools'

export interface Nip07Provider {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<Event>
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
}

declare global {
  interface Window { nostr?: Nip07Provider }
}

export function hasNip07(): boolean {
  return typeof window !== 'undefined' && !!window.nostr
}

export function getNip07(): Nip07Provider | null {
  return hasNip07() ? window.nostr! : null
}
```

- [ ] **Step 2: Write the failing test**

`src/__tests__/nip07Signer.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Nip07Signer } from '../lib/signer'

afterEach(() => { delete (window as { nostr?: unknown }).nostr })

describe('Nip07Signer', () => {
  it('delegates to window.nostr and reports nip04 capability', async () => {
    const signEvent = vi.fn(async (t) => ({ ...t, id: 'x', pubkey: 'pk', sig: 's' }))
    ;(window as { nostr?: unknown }).nostr = {
      getPublicKey: async () => 'pk',
      signEvent,
      nip04: { encrypt: async () => 'ct', decrypt: async () => 'pt' },
    }
    const s = await Nip07Signer.create()
    expect(s.pubkey).toBe('pk')
    expect(s.caps.nip04).toBe(true)
    expect(await s.nip04Encrypt('peer', 'hi')).toBe('ct')
    await s.signEvent({ kind: 1, created_at: 0, tags: [], content: 'hi' })
    expect(signEvent).toHaveBeenCalled()
  })

  it('reports nip04 false when the extension lacks it', async () => {
    ;(window as { nostr?: unknown }).nostr = { getPublicKey: async () => 'pk', signEvent: async (t) => t }
    const s = await Nip07Signer.create()
    expect(s.caps.nip04).toBe(false)
    await expect(s.nip04Encrypt('peer', 'hi')).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- nip07Signer`
Expected: FAIL — `Nip07Signer` not exported.

- [ ] **Step 4: Add `Nip07Signer` to `signer.ts`**

```ts
import { getNip07, type Nip07Provider } from './nip07'

export class Nip07Signer implements Signer {
  readonly type = 'nip07' as const
  readonly pubkey: string
  readonly caps: SignerCaps
  private provider: Nip07Provider

  private constructor(provider: Nip07Provider, pubkey: string) {
    this.provider = provider
    this.pubkey = pubkey
    this.caps = { nip04: !!provider.nip04 }
  }

  static async create(): Promise<Nip07Signer> {
    const provider = getNip07()
    if (!provider) throw new Error('No NIP-07 provider')
    const pubkey = await provider.getPublicKey()
    return new Nip07Signer(provider, pubkey)
  }

  async signEvent(t: EventTemplate): Promise<Event> {
    return this.provider.signEvent(t)
  }

  async nip04Encrypt(peer: string, plaintext: string): Promise<string> {
    if (!this.provider.nip04) throw new Error('Signer does not support nip04')
    return this.provider.nip04.encrypt(peer, plaintext)
  }

  async nip04Decrypt(peer: string, ciphertext: string): Promise<string> {
    if (!this.provider.nip04) throw new Error('Signer does not support nip04')
    return this.provider.nip04.decrypt(peer, ciphertext)
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- nip07Signer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/nip07.ts src/lib/signer.ts src/__tests__/nip07Signer.test.ts
git commit -m "feat: add Nip07Signer for window.nostr extensions"
```

---

## Task 17: Extension login + bootstrap nip07 branch + reconnect screen

**Files:**
- Modify: `src/store/nostrStore.ts` (add `loginWithExtension`)
- Modify: `src/components/Auth/LoginScreen.tsx`
- Modify: `src/App.tsx`
- Create: `src/components/Auth/ReconnectScreen.tsx`

**Interfaces:**
- Produces: store action `loginWithExtension(): Promise<boolean>` — `Nip07Signer.create()`, `setSigner`, set `publicKey`/`npub`, `openUserDb`, `setActivePubkey`, `setAuthMethod('nip07')`, run `syncFromRelays(relays)` (same merge block as `completeLogin`). No key is stored.

- [ ] **Step 1: Add `loginWithExtension` to the store**

```ts
loginWithExtension: async () => {
  try {
    const signer = await Nip07Signer.create()
    setSigner(signer)
    const pk = signer.pubkey
    openUserDb(pk)
    const existing = await loadExistingUserState(pk)
    if (existing.publicKey === pk) set(existing)
    set({ publicKey: pk, npub: encodePubkey(pk), nsec: null, profile: existing.profile ?? { pubkey: pk } })
    setActivePubkey(pk)
    setAuthMethod('nip07')
    syncFromRelays(get().relays).then(/* same merge block as completeLogin */).catch(() => {})
    return true
  } catch {
    return false
  }
},
```
Add `loginWithExtension: () => Promise<boolean>` to the `NostrState` interface and import `Nip07Signer`, `setAuthMethod`. Factor the post-sync merge block from `completeLogin` into a shared `applySyncResult(result, set, get)` to avoid duplication (DRY).

- [ ] **Step 2: Add the extension button to `LoginScreen.tsx`**

On the welcome screen, below "Login with Private Key", render only when `hasNip07()`:
```tsx
{hasNip07() && (
  <button
    onClick={async () => { setError(''); const ok = await loginWithExtension(); if (!ok) setError('Extension login failed or was rejected') }}
    className="w-full bg-gray-800 hover:bg-gray-700 text-white font-semibold py-4 rounded-xl transition-all flex items-center justify-center gap-3 border border-gray-700"
  >
    <Shield size={20} /> Login with Extension
  </button>
)}
```
Import `hasNip07` from `../../lib/nip07` and `loginWithExtension` from the store.

- [ ] **Step 3: Bootstrap nip07 branch + ReconnectScreen**

`src/components/Auth/ReconnectScreen.tsx`: a minimal screen ("Reconnect your signer extension", a Retry button calling a passed `onRetry`, and "Use a different account" calling `logout`).

In `App.tsx` bootstrap, when `method === 'nip07'`:
```ts
if (method === 'nip07') {
  if (hasNip07()) {
    try { setSigner(await Nip07Signer.create()) } catch { setNeedsReconnect(true) }
  } else {
    setNeedsReconnect(true)
  }
}
```
Add `const [needsReconnect, setNeedsReconnect] = useState(false)` and render the ReconnectScreen before the `!publicKey` branch when `needsReconnect` is true. Retry re-runs the nip07 acquisition.

- [ ] **Step 4: Build + suite**

Run: `npm run build && npm test`
Expected: clean + PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/nostrStore.ts src/components/Auth/LoginScreen.tsx src/components/Auth/ReconnectScreen.tsx src/App.tsx
git commit -m "feat: NIP-07 extension login, bootstrap reacquire, reconnect screen"
```

---

## Task 18: Capability degradation + full logout cleanup

**Files:**
- Modify: `src/store/nostrStore.ts` (`signerCaps` + logout cleanup)
- Modify: `src/components/Chat/MessageThread.tsx` (DM/group gating, call buttons)
- Modify: `src/contexts/CallContext.tsx` (guard `initiateCall`)

**Interfaces:**
- Produces: store field `signerCaps: { nip04: boolean }`, set whenever a signer is installed (`completeLogin`, `loginWithExtension`, bootstrap, UnlockScreen success). Default `{ nip04: true }`.

- [ ] **Step 1: Add `signerCaps` to the store**

Add to state: `signerCaps: { nip04: boolean }` default `{ nip04: true }`, and a `setSignerCaps(caps)` action. Call `set({ signerCaps: getSigner()!.caps })` after each `setSigner(...)` (in `completeLogin`, `loginWithExtension`; and from `App.tsx`/`UnlockScreen` via `useNostrStore.getState().setSignerCaps(getSigner()!.caps)` after installing the signer). Do not persist `signerCaps` (derive at runtime) — leave it out of `partialize`.

- [ ] **Step 2: Gate DM/group send + calls in `MessageThread.tsx`**

Read `const { signerCaps } = useNostrStore()`. In `DMThread` and `GroupThread`, when `!signerCaps.nip04`, render a banner above the input ("Your signer does not support encrypted messages yet") and pass a disabled state so `MessageInput` cannot send (e.g. short-circuit `handleSend` with a thrown/ignored no-op and visually disable). In `DMHeader`, set `canCall = callState === 'idle' && signerCaps.nip04`.

- [ ] **Step 3: Guard `initiateCall` in `CallContext.tsx`**

At the top of `initiateCall`, `if (!getSigner()?.caps.nip04) return`. (Public channels remain fully functional regardless.)

- [ ] **Step 4: Full logout cleanup**

In `logout`, after `clearSigner()`:
```ts
clearSigner()
void clearLocalKey()
clearAuthMethod()
closeUserDb()
clearActivePubkey()
```
Import `clearLocalKey` (keyStore) and `clearAuthMethod` (userDb). Order: call `clearLocalKey()` before `closeUserDb()` so the DB is still open. Make `logout` tolerant of the async `clearLocalKey` (fire-and-forget is acceptable here since the DB closes after; if test flakiness appears, make `logout` async and await it).

- [ ] **Step 5: Build + suite (final gate)**

Run: `npm run build && npm test`
Expected: clean + all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/nostrStore.ts src/components/Chat/MessageThread.tsx src/contexts/CallContext.tsx
git commit -m "feat: signer capability gating and full logout cleanup"
```

---

## Self-Review

**Spec coverage**

- Signer abstraction + singleton (spec S1) -> Task 1; refactor of all `build*`/process functions -> Tasks 2-10.
- Store changes: remove `privateKeyHex`/`getPrivateKey`, add `signerCaps` (S1) -> Tasks 7, 12, 18.
- Key at rest: device mode + non-extractable key, obfuscation framing (S2) -> Task 11; passphrase PBKDF2 + iterations stored, opt-in (S2, Global Constraints) -> Task 13.
- Login/bootstrap/migration (S3) -> Tasks 12, 14, 17.
- Capability degradation + logout (S4) -> Task 18.
- NIP-07 desktop-only / gated button / mobile universal key-at-rest (Platform section) -> Tasks 16-17 (button gated on `hasNip07()`), key-at-rest path covers mobile (Tasks 11-15).
- Testing (S5) -> tests in Tasks 1, 11, 13, 16 + existing-suite updates in Tasks 2-7.
- PBKDF2 iteration count tunable + stored in record (Platform section) -> Task 13 (`iterations` field; `PBKDF2_ITERATIONS` constant).

**Placeholder scan:** the only intentional stubs are `savePassphrase`/`loadPassphrase` in Task 11, which throw with a clear message and are implemented in Task 13 — explicitly sequenced, not a placeholder gap.

**Type consistency:** `Signer`/`SignerCaps`, `getSigner`/`setSigner`/`clearSigner`/`requireSigner`, `LocalSigner`/`Nip07Signer.create()`, `saveLocalKey`/`loadLocalKey`/`hasLocalKey`/`keyProtection`/`clearLocalKey`/`setPassphrase`, `getAuthMethod`/`setAuthMethod`/`clearAuthMethod`, `migratePlaintextKeyIfNeeded` are used consistently across tasks. Async signatures (`build*` now return `Promise<Event>`) are matched by `await` at every updated call site (Tasks 5, 8, 9, 10).

**Out of scope (unchanged):** NIP-44/NIP-17, NIP-46, passkey unlock, group symmetric-key model, relay/outbox behavior.

---

## Execution note

Phase 0 (Tasks 1-10) is a behavior-preserving refactor and must end with `npm run build && npm test` green before Phase 1 touches persistence. Phases 1-3 each end with the same gate.
