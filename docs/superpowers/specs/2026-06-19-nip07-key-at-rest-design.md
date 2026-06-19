# NIP-07 External Signer + Key-at-Rest Encryption — Design

Date: 2026-06-19
Status: Approved (design); pending implementation plan

## Goal

Eliminate the app's biggest security weakness: the user's Nostr private key
(`privateKeyHex`) is currently persisted **in plaintext** in IndexedDB via the
Zustand `persist` middleware. Anyone with device/browser access — or any XSS —
can read the nsec straight out of the database.

This spec addresses that two ways, both built on one shared foundation (a signer
abstraction):

1. **NIP-07 external signer support** — power users sign with a browser
   extension (Alby, nos2x, etc.) and never paste an nsec into the page.
2. **Key-at-rest encryption** — for users who do hold a local nsec, stop storing
   it in plaintext; encrypt it, with an opt-in passphrase for real protection.

Both ship in this single spec because they share the same refactor: routing all
signing/encryption through a `Signer` instead of pulling raw secret-key bytes.

## Decisions (from brainstorming)

- **Scope:** both features in one spec, sharing the signer abstraction.
- **Threading approach:** signer as a **module singleton** (`getSigner()`/
  `setSigner()`/`clearSigner()`), mirroring the existing `getPool()` and
  `getUserDb()` singletons. Not parameter-threaded.
- **Local-key unlock UX:** passphrase is **opt-in**. Default stays auto-login via
  device-bound obfuscation; opt-in passphrase is required on each cold start.
- **NIP-07 without nip04:** allow login, **degrade** affected features (DMs,
  calls, group-key backups) with a clear notice; public channels still work.
- **Migration:** transparent — existing plaintext keys are re-wrapped on next
  load with no user action.

## Background: current auth flow

- `store/nostrStore.ts` holds `privateKeyHex` and exposes `getPrivateKey(): Uint8Array`.
  `partialize` persists `privateKeyHex` and `nsec` into the per-user Dexie record
  `nostr-chat-storage`.
- The secret key bytes (`sk`) are threaded as a parameter into the `build*`/send
  functions in `lib/nostr.ts`, `lib/nostrSync.ts`, `lib/fileTransfer.ts`,
  `lib/webrtc.ts`, and into `processDMEvent` in `lib/inbox.ts`. These call
  `finalizeEvent` and `nostr-tools` `nip04` directly.
- `App.tsx` bootstrap: `getActivePubkey()` (localStorage) → `openUserDb()` →
  `useNostrStore.persist.rehydrate()`. A returning user is auto-logged-in because
  `privateKeyHex` rehydrates from Dexie.
- Login entry points: `generateAndLogin`, `loginFromNsec`, `loginFromHex` →
  `completeLogin(sk, pk, nsec, …)`.

NIP-07 fundamentally changes this: an extension never exposes secret bytes, and
its `signEvent`/`nip04` methods are async. So all signing/encryption must go
through an abstraction whose secret material may not be locally available.

## Section 1 — The `Signer` abstraction (`src/lib/signer.ts`)

```ts
import type { Event, EventTemplate } from 'nostr-tools'

export interface Signer {
  type: 'local' | 'nip07'
  pubkey: string                                       // hex, cached at construction
  signEvent(t: EventTemplate): Promise<Event>
  nip04Encrypt(peer: string, plaintext: string): Promise<string>
  nip04Decrypt(peer: string, ciphertext: string): Promise<string>
  caps: { nip04: boolean }
}
```

### Implementations

- **`LocalSigner`** — constructed from `Uint8Array` secret key, held in memory
  only (never persisted in plaintext after this change).
  - `signEvent` → `finalizeEvent(t, sk)` (wrapped in a resolved Promise).
  - `nip04Encrypt`/`nip04Decrypt` → `nip04.encrypt`/`nip04.decrypt`.
  - `caps.nip04 = true`.
- **`Nip07Signer`** — wraps `window.nostr`.
  - `pubkey` cached from `await window.nostr.getPublicKey()` at construction.
  - `signEvent` → `window.nostr.signEvent(t)`.
  - `nip04Encrypt`/`nip04Decrypt` → `window.nostr.nip04?.encrypt/decrypt`.
  - `caps.nip04 = !!window.nostr.nip04`.

### Singleton

```ts
let _signer: Signer | null = null
export function getSigner(): Signer | null
export function setSigner(s: Signer): void
export function clearSigner(): void
```

Same shape and lifetime semantics as `getPool()` / `getUserDb()`.

### Refactor of existing crypto/signing code

The `sk: Uint8Array` parameter is removed from the `build*`/send/process
functions; they call `getSigner()` internally and become `async`:

- `lib/nostr.ts`: `buildProfileEvent`, `buildDMEvent`, `decryptDM`,
  `buildChannelCreateEvent`, `buildTypingEvent`, `buildChannelMessageEvent`,
  `buildGroupMessageEvent`, `buildGroupMetadataEvent`, `buildGroupKeyBackupEvent`,
  `buildGroupInviteEvent`, and the `sendDM`/`sendChannelMessage`/`createChannel`/
  `publishProfile` helpers in `useNostrSubscriptions.ts`.
- `lib/nostrSync.ts`: `buildContactListEvent`, `buildChannelBookmarkEvent`,
  `buildAppSettingsEvent`, `fetchAppSettings`, `fetchGroupKeys`,
  `publishContactList`, `publishChannelBookmarks`, `publishAppSettings`,
  `syncFromRelays` (drop the `sk` param; use `getSigner()` for nip04 self-encrypt
  and signing).
- `lib/fileTransfer.ts`: `sendChunkedFile` (drop `sk`).
- `lib/webrtc.ts`: `buildCallSignalEvent`, `decryptCallSignal` (drop `sk`).
- `lib/inbox.ts`: `processDMEvent` (drop `sk`; use `getSigner().nip04Decrypt`).

Note: functions that were synchronous (e.g. `buildChannelMessageEvent`,
`buildTypingEvent`) become `async` because `signEvent` is async for NIP-07.
Call sites are updated to `await`.

### Store changes

- Remove `privateKeyHex`, `nsec`, and `getPrivateKey()` from the store and from
  `partialize`. Components that read `getPrivateKey()` switch to `getSigner()`.
- Add `signerCaps: { nip04: boolean }` to the store, set when the signer is set
  (used for capability gating, Section 4).
- `publicKey`/`npub`/`profile` continue to persist.

## Section 2 — Key at rest (`src/lib/keyStore.ts`)

The encrypted local key is stored in its own per-user Dexie settings record
(key: `encrypted-key`), independent of the Zustand `nostr-chat-storage` blob.
A second record (`auth-method`) stores `'local' | 'nip07'`.

### Stored shape

```ts
type EncryptedKey =
  | { mode: 'device'; iv: string; ciphertext: string }                 // device-key wrapped
  | { mode: 'passphrase'; iv: string; salt: string; iterations: number; ciphertext: string }
```

(`iv`/`salt`/`ciphertext` base64; nsec secret bytes are the plaintext payload.)

### Default — device-bound obfuscation (no passphrase)

- Generate a **non-extractable** AES-GCM `CryptoKey`
  (`crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, …)`).
- Persist the `CryptoKey` object itself in Dexie (record `device-wrap-key`).
  CryptoKey is structured-cloneable; because it is non-extractable, its raw bytes
  are never readable from the DB.
- Wrap the secret key bytes under it (AES-GCM with random IV) → store as
  `EncryptedKey { mode: 'device' }`.
- On cold start: load the device CryptoKey + ciphertext, decrypt → `LocalSigner`.
  Auto-login behavior is preserved.

**Security framing (must be stated in-product and in code comments):** this is
*obfuscation, not a vault*. It removes plaintext-at-rest and forces an attacker
to actively invoke decryption rather than read the nsec directly, but on-device
code execution (e.g. persistent XSS) can still call decrypt with the
non-extractable key. The passphrase mode is the real protection.

### Opt-in — passphrase

- Derive a wrapping key from the passphrase via **PBKDF2-SHA-256**, ~600,000
  iterations (dependency-free WebCrypto), random 16-byte salt.
- Wrap the secret bytes under the derived key → `EncryptedKey { mode: 'passphrase' }`.
- **Do not** store a device wrap key; delete `device-wrap-key` if present.
- Cold start prompts for the passphrase; an incorrect passphrase makes AES-GCM
  decryption throw → surface "Incorrect passphrase."
- Set / change / remove passphrase lives in the **Keys** settings tab. Removing
  the passphrase converts back to device mode.

### API (sketch)

```ts
saveLocalKey(secret: Uint8Array, opts?: { passphrase?: string }): Promise<void>
loadLocalKey(opts?: { passphrase?: string }): Promise<Uint8Array | null>  // null if missing
hasPassphrase(): Promise<boolean>
setPassphrase(secret: Uint8Array, passphrase: string | null): Promise<void> // null => device mode
clearLocalKey(): Promise<void>
```

## Section 3 — Login, bootstrap & migration

### LoginScreen (`components/Auth/LoginScreen.tsx`)

Add a third option, "Login with Extension (NIP-07)", shown when `window.nostr`
is present (otherwise a subtle hint to install a signer):

- **Create / Import nsec** → build `LocalSigner`; `saveLocalKey(secret)`
  (device mode by default); write `auth-method: 'local'`; set active pubkey.
- **Extension** → `await window.nostr.getPublicKey()` → `Nip07Signer`;
  write `auth-method: 'nip07'`; set active pubkey. **No nsec stored.**

`completeLogin` is restructured to construct/`setSigner()` and persist the
auth-method, rather than holding `privateKeyHex` in store state. The on-login
relay sync (`syncFromRelays`) now uses `getSigner()` for self-decryption.

### Bootstrap (`App.tsx`)

Branch on the persisted `auth-method`:

- `nip07` → re-acquire `window.nostr.getPublicKey()` → `Nip07Signer`. If
  `window.nostr` is missing, render a **"Reconnect your extension"** screen
  instead of the chat (do not log out / do not wipe data).
- `local` + device mode → `loadLocalKey()` auto-decrypt → `LocalSigner` →
  auto-login (unchanged UX).
- `local` + passphrase mode → render the new **UnlockScreen** component and only
  enter the app after a successful `loadLocalKey({ passphrase })`.

### Migration (transparent)

On bootstrap, if the old `nostr-chat-storage` blob still contains a plaintext
`privateKeyHex` and there is no `encrypted-key` record:

1. Build a fresh device wrap key and `saveLocalKey(secretFromHex)` (device mode).
2. Strip `privateKeyHex` and `nsec` from the persisted Zustand blob.
3. Write `auth-method: 'local'`.

Existing users keep working with no prompt, now without plaintext at rest.

## Section 4 — Capability degradation & logout

### Degradation when `signerCaps.nip04 === false`

(Only possible for NIP-07 extensions lacking nip04.)

- DM and group message inputs render a banner: "Your signer doesn't support
  encrypted DMs yet" and disable sending.
- `DMHeader` audio/video call buttons are disabled.
- `CallContext.initiateCall` is guarded (no-op + surfaced notice) and incoming
  call decryption is skipped gracefully.
- Public channels (kind 42) and channel discovery remain fully functional.

This is forward-compatible with the planned NIP-44 work (#2), which will add a
`caps.nip44` path and re-enable these features for nip44-capable signers.

### Logout

- `clearSigner()`, zero the in-memory secret (best-effort overwrite of the
  `Uint8Array`).
- Delete `encrypted-key`, `device-wrap-key`, and `auth-method` records; clear
  active pubkey.
- Existing message history handling in `logout` is unchanged otherwise.

## Section 5 — Testing

Vitest + `fake-indexeddb` (already configured in `src/test/setup.ts`).

- **signer.test.ts:** `LocalSigner` sign/nip04 round-trip; `Nip07Signer`
  delegates to a mocked `window.nostr`; capability detection with and without
  `window.nostr.nip04`.
- **keyStore.test.ts:** device-key wrap/unwrap round-trip; passphrase wrap/unwrap;
  wrong passphrase rejected; plaintext→encrypted migration produces a loadable
  key and removes `privateKeyHex`.
- **bootstrap/login:** local auto-unlock path; passphrase-locked path requires
  passphrase; nip07 re-acquire; missing-`window.nostr` renders reconnect state.

Existing crypto/inbox/sync tests are updated to the new signature shapes (signer
singleton instead of `sk` parameter).

## File map

**New**

- `src/lib/signer.ts`
- `src/lib/keyStore.ts`
- `src/components/Auth/UnlockScreen.tsx`
- `src/__tests__/signer.test.ts`
- `src/__tests__/keyStore.test.ts`

**Modified**

- `src/lib/nostr.ts`, `src/lib/nostrSync.ts`, `src/lib/fileTransfer.ts`,
  `src/lib/webrtc.ts`, `src/lib/inbox.ts`
- `src/store/nostrStore.ts` (remove `privateKeyHex`/`nsec`/`getPrivateKey`;
  add signer wiring + `signerCaps`; restructure `completeLogin`/`logout`)
- `src/components/Auth/LoginScreen.tsx`
- `src/App.tsx` (bootstrap branch + migration)
- Keys settings tab (passphrase set/change/remove; show auth method)
- `src/contexts/CallContext.tsx` (signer + capability guard)
- `src/components/Chat/MessageThread.tsx` (capability gating)
- `src/hooks/useNostrSubscriptions.ts` (signer instead of `getPrivateKey`)

## Out of scope

- NIP-44 / NIP-17 encrypted DMs (separate item #2; this spec only adds the
  `caps` seam they will extend).
- NIP-46 remote bunker signing.
- Passkey/WebAuthn unlock (considered, deferred in favor of opt-in passphrase).
- Changing group symmetric-key model or relay/outbox behavior.

## Risks

- **Refactor blast radius:** removing the `sk` parameter and making `build*`
  async touches many files and tests. Mitigation: mechanical, done as the first
  implementation step with the test suite green before layering keyStore/NIP-07.
- **NIP-07 reload friction:** some extensions re-prompt on `getPublicKey()`.
  Acceptable; the reconnect screen handles the missing-extension case.
- **Device-mode is obfuscation only:** explicitly communicated; passphrase is the
  real control.
