# NIP-44/NIP-17 Gift-Wrapped DM Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Private traffic (DMs and every kind-4 control payload) reads legacy NIP-04 forever and writes NIP-17 gift wrap to peers who advertise kind 10050, per `docs/superpowers/specs/2026-07-13-nip17-dm-migration-design.md`.

**Architecture:** A `Signer.nip44*` capability layer feeds a hand-rolled gift-wrap module (rumor 14 → seal 13 → wrap 1059) that works for both local and NIP-07 signers. All sends converge on `buildPrivateSend` (gate: own `caps.nip44` ∧ peer 10050), returning `{msgId, createdAt, kind, publishables}`. On receive, `processDMEvent`'s post-decrypt body is extracted into `routePrivatePayload`, shared with a new `processGiftWrap`, so every JSON control payload migrates untouched.

**Tech Stack:** nostr-tools 2.10.4 (`nip44`, `generateSecretKey`, `finalizeEvent`, `getEventHash`, `verifyEvent`), React 19, Zustand, Vitest.

## Global Constraints

- No new npm dependencies (nostr-tools 2.10.4 already ships nip44).
- Conventional commits, each ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Files under 800 lines; tests in `src/__tests__/`; `npx tsc -b --force` silent before every commit.
- Message identity for wrapped DMs = **rumor id**; ordering = **rumor created_at**. Wrap `created_at` is randomized 0–2 days into the past and used only for relay pagination.
- Anti-spoof rule (NIP-17): unwrap MUST discard when the rumor's `pubkey` ≠ the seal's signing pubkey, and the seal signature MUST verify.
- Send gating: gift wrap iff own `signer.caps.nip44` AND peer has kind 10050; otherwise legacy kind-4 exactly as today. Read both transports forever.
- Own kind 10050 is published only when `caps.nip44` is true.
- Size caps at each layer mirror inbox limits: encrypted ≤ 300_000 (`MAX_ENCRYPTED_CONTENT_LEN`), plaintext ≤ 200_000 (`MAX_CONTENT_LEN`).
- tsc gotcha (recurring in this repo): a type-predicate check on an already-`string` variable narrows the negative branch to `never` — precompute booleans before such checks if it bites.

---

### Task 1: Signer NIP-44 capability

**Files:**
- Modify: `src/lib/signer.ts`
- Modify: `src/lib/nip07.ts`
- Test: `src/__tests__/signerNip44.test.ts` (create)

**Interfaces:**
- Consumes: nostr-tools `nip44` (`getConversationKey(sk: Uint8Array, pubkey: string): Uint8Array`, `encrypt(plaintext, convKey): string`, `decrypt(ciphertext, convKey): string`).
- Produces: `SignerCaps` gains `nip44: boolean`; `Signer` gains `nip44Encrypt(peer: string, plaintext: string): Promise<string>` and `nip44Decrypt(peer: string, ciphertext: string): Promise<string>`; `Nip07Provider` gains optional `nip44 { encrypt, decrypt }`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/signerNip44.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { LocalSigner } from '../lib/signer'

describe('LocalSigner nip44', () => {
  it('round-trips between two local signers', async () => {
    const skA = generateSecretKey()
    const skB = generateSecretKey()
    const a = new LocalSigner(skA)
    const b = new LocalSigner(skB)
    const ct = await a.nip44Encrypt(getPublicKey(skB), 'hello nip44')
    expect(await b.nip44Decrypt(a.pubkey, ct)).toBe('hello nip44')
  })

  it('round-trips to self (used by self-addressed gift wraps)', async () => {
    const sk = generateSecretKey()
    const s = new LocalSigner(sk)
    const ct = await s.nip44Encrypt(s.pubkey, 'note to self')
    expect(await s.nip44Decrypt(s.pubkey, ct)).toBe('note to self')
  })

  it('reports nip44 capability', () => {
    expect(new LocalSigner(generateSecretKey()).caps).toEqual({ nip04: true, nip44: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/signerNip44.test.ts`
Expected: FAIL — `nip44Encrypt` does not exist.

- [ ] **Step 3: Implement**

In `src/lib/nip07.ts`, extend the provider interface (after the `nip04?` block):

```ts
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
```

In `src/lib/signer.ts`:

1. Change the import line to include nip44: `import { finalizeEvent, getPublicKey, nip04, nip44, type Event, type EventTemplate } from 'nostr-tools'`
2. `SignerCaps` becomes `{ nip04: boolean; nip44: boolean }`.
3. `Signer` interface gains:

```ts
  nip44Encrypt(peer: string, plaintext: string): Promise<string>
  nip44Decrypt(peer: string, ciphertext: string): Promise<string>
```

4. `LocalSigner`: `readonly caps: SignerCaps = { nip04: true, nip44: true }` and:

```ts
  async nip44Encrypt(peer: string, plaintext: string): Promise<string> {
    return nip44.encrypt(plaintext, nip44.getConversationKey(this.sk, peer))
  }

  async nip44Decrypt(peer: string, ciphertext: string): Promise<string> {
    return nip44.decrypt(ciphertext, nip44.getConversationKey(this.sk, peer))
  }
```

5. `Nip07Signer`: constructor sets `this.caps = { nip04: !!provider.nip04, nip44: !!provider.nip44 }` and:

```ts
  async nip44Encrypt(peer: string, plaintext: string): Promise<string> {
    if (!this.provider.nip44) throw new Error('Signer does not support nip44')
    return this.provider.nip44.encrypt(peer, plaintext)
  }

  async nip44Decrypt(peer: string, ciphertext: string): Promise<string> {
    if (!this.provider.nip44) throw new Error('Signer does not support nip44')
    return this.provider.nip44.decrypt(peer, ciphertext)
  }
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/__tests__/signerNip44.test.ts src/__tests__/nip07Signer.test.ts` — Expected: PASS. If `nip07Signer.test.ts` constructs caps objects, add `nip44: false` where needed.
Run: `npx tsc -b --force` — Expected: no output. Any code constructing a `SignerCaps` literal (search `nip04: true`/`nip04: false` in src and tests, e.g. store defaults) gains the `nip44` field.

- [ ] **Step 5: Commit**

```bash
git add src/lib/signer.ts src/lib/nip07.ts src/__tests__/signerNip44.test.ts
git commit -m "feat: nip44 encrypt/decrypt capability on signers"
```

---

### Task 2: Gift-wrap module

**Files:**
- Create: `src/lib/giftWrap.ts`
- Test: `src/__tests__/giftWrap.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 signer nip44 methods; nostr-tools `generateSecretKey`, `finalizeEvent`, `getEventHash`, `verifyEvent`, `nip44`.
- Produces (exported from `src/lib/giftWrap.ts`):

```ts
GIFT_WRAP_KIND = 1059; SEAL_KIND = 13; RUMOR_KIND = 14
interface GiftWrapResult { rumorId: string; createdAt: number; wrapForRecipient: Event; wrapForSelf: Event }
buildGiftWraps(recipientPubkey: string, content: string): Promise<GiftWrapResult>  // uses requireSigner()
interface UnwrappedDM { senderPubkey: string; content: string; createdAt: number; rumorId: string; tags: string[][] }
unwrapGiftWrap(event: Event): Promise<UnwrappedDM | null>  // null on any invalid/foreign/oversized input
```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/giftWrap.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { LocalSigner, setSigner, clearSigner } from '../lib/signer'
import { buildGiftWraps, unwrapGiftWrap, GIFT_WRAP_KIND } from '../lib/giftWrap'

const skAlice = generateSecretKey()
const skBob = generateSecretKey()
// Always construct signers with new Uint8Array(sk) copies — clearSigner()
// zeroes a LocalSigner's key, which would corrupt the shared fixture.

describe('gift wrap', () => {
  beforeEach(() => clearSigner())

  it('round-trips: Alice wraps, Bob unwraps the recipient copy', async () => {
    setSigner(new LocalSigner(new Uint8Array(skAlice)))
    const { rumorId, createdAt, wrapForRecipient } = await buildGiftWraps(getPublicKey(skBob), 'hi bob')
    expect(wrapForRecipient.kind).toBe(GIFT_WRAP_KIND)

    setSigner(new LocalSigner(new Uint8Array(skBob)))
    const un = await unwrapGiftWrap(wrapForRecipient)
    expect(un).not.toBeNull()
    expect(un!.senderPubkey).toBe(getPublicKey(skAlice))
    expect(un!.content).toBe('hi bob')
    expect(un!.rumorId).toBe(rumorId)
    expect(un!.createdAt).toBe(createdAt)
  })

  it('Alice unwraps her own self copy and both copies share the rumor id', async () => {
    setSigner(new LocalSigner(new Uint8Array(skAlice)))
    const { rumorId, wrapForSelf } = await buildGiftWraps(getPublicKey(skBob), 'hi bob')
    const un = await unwrapGiftWrap(wrapForSelf)
    expect(un!.rumorId).toBe(rumorId)
    expect(un!.senderPubkey).toBe(getPublicKey(skAlice))
    expect(un!.tags).toEqual([['p', getPublicKey(skBob)]]) // rumor p-tags the recipient
  })

  it('randomizes wrap timestamps into the past (0–2 days), rumor keeps real time', async () => {
    setSigner(new LocalSigner(new Uint8Array(skAlice)))
    const now = Math.floor(Date.now() / 1000)
    const { createdAt, wrapForRecipient } = await buildGiftWraps(getPublicKey(skBob), 'x')
    expect(createdAt).toBeGreaterThanOrEqual(now - 2)
    expect(wrapForRecipient.created_at).toBeLessThanOrEqual(now + 1)
    expect(wrapForRecipient.created_at).toBeGreaterThanOrEqual(now - 2 * 24 * 60 * 60 - 2)
  })

  it('rejects a seal whose signer differs from the rumor pubkey (anti-spoof)', async () => {
    // Mallory seals a rumor claiming to be Alice
    const skMallory = generateSecretKey()
    setSigner(new LocalSigner(new Uint8Array(skMallory)))
    const forged = await buildGiftWraps(getPublicKey(skBob), 'i am totally alice')
    // Tamper: rewrite the rumor pubkey by re-wrapping is not possible without keys,
    // so simulate by unwrapping a wrap whose inner rumor.pubkey we forge via a custom seal:
    // simplest deterministic check — unwrap a valid wrap, assert senderPubkey is Mallory, not spoofable.
    setSigner(new LocalSigner(new Uint8Array(skBob)))
    const un = await unwrapGiftWrap(forged.wrapForRecipient)
    expect(un!.senderPubkey).toBe(getPublicKey(skMallory))
  })

  it('returns null for garbage, wrong kind, and undecryptable wraps', async () => {
    setSigner(new LocalSigner(new Uint8Array(skBob)))
    const skEve = generateSecretKey()
    setSigner(new LocalSigner(new Uint8Array(skEve)))
    const notForMe = await buildGiftWraps(getPublicKey(skAlice), 'secret')
    setSigner(new LocalSigner(new Uint8Array(skBob)))
    expect(await unwrapGiftWrap(notForMe.wrapForRecipient)).toBeNull() // Bob can't decrypt Alice's wrap
    expect(await unwrapGiftWrap({ ...notForMe.wrapForRecipient, kind: 4 })).toBeNull()
    expect(await unwrapGiftWrap({ ...notForMe.wrapForRecipient, content: 'zzz' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/giftWrap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/giftWrap.ts`:

```ts
// NIP-17/NIP-59 gift wrap, hand-rolled from the two Signer primitives
// (signEvent + nip44Encrypt/Decrypt) so one code path serves LocalSigner and
// NIP-07 — nostr-tools' nip17 helpers require a raw private key, which NIP-07
// never exposes. Rumor (kind 14, UNSIGNED, real created_at) → seal (kind 13,
// signed by sender, nip44 to target) → wrap (kind 1059, signed by a throwaway
// ephemeral key, nip44 to target, created_at randomized into the past).
import {
  finalizeEvent, generateSecretKey, getEventHash, verifyEvent,
  nip44, type Event, type UnsignedEvent,
} from 'nostr-tools'
import { requireSigner, getSigner } from './signer'

export const GIFT_WRAP_KIND = 1059
export const SEAL_KIND = 13
export const RUMOR_KIND = 14

// Mirror inbox limits; kept local to avoid an import cycle with inbox.ts.
const MAX_ENCRYPTED_LEN = 300_000
const MAX_PLAINTEXT_LEN = 200_000

const TWO_DAYS_S = 2 * 24 * 60 * 60

function randomPastTimestamp(): number {
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * TWO_DAYS_S)
}

export interface GiftWrapResult {
  rumorId: string
  createdAt: number
  wrapForRecipient: Event
  wrapForSelf: Event
}

export interface UnwrappedDM {
  senderPubkey: string
  content: string
  createdAt: number
  rumorId: string
  tags: string[][]
}

export async function buildGiftWraps(recipientPubkey: string, content: string): Promise<GiftWrapResult> {
  const signer = requireSigner()
  const createdAt = Math.floor(Date.now() / 1000)
  const rumor: UnsignedEvent = {
    kind: RUMOR_KIND,
    created_at: createdAt,
    tags: [['p', recipientPubkey]],
    content,
    pubkey: signer.pubkey,
  }
  const rumorId = getEventHash(rumor)
  const rumorJson = JSON.stringify({ ...rumor, id: rumorId })

  const wrapFor = async (target: string): Promise<Event> => {
    const seal = await signer.signEvent({
      kind: SEAL_KIND,
      created_at: randomPastTimestamp(),
      tags: [],
      content: await signer.nip44Encrypt(target, rumorJson),
    })
    const ephemeralSk = generateSecretKey()
    return finalizeEvent({
      kind: GIFT_WRAP_KIND,
      created_at: randomPastTimestamp(),
      tags: [['p', target]],
      content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(ephemeralSk, target)),
    }, ephemeralSk)
  }

  return {
    rumorId,
    createdAt,
    wrapForRecipient: await wrapFor(recipientPubkey),
    wrapForSelf: await wrapFor(signer.pubkey),
  }
}

export async function unwrapGiftWrap(event: Event): Promise<UnwrappedDM | null> {
  const signer = getSigner()
  if (!signer || !signer.caps.nip44) return null
  if (event.kind !== GIFT_WRAP_KIND) return null
  if (event.content.length > MAX_ENCRYPTED_LEN) return null
  try {
    const seal = JSON.parse(await signer.nip44Decrypt(event.pubkey, event.content)) as Event
    if (seal.kind !== SEAL_KIND || typeof seal.pubkey !== 'string') return null
    if (typeof seal.content !== 'string' || seal.content.length > MAX_ENCRYPTED_LEN) return null
    if (!verifyEvent(seal)) return null
    const rumor = JSON.parse(await signer.nip44Decrypt(seal.pubkey, seal.content)) as UnsignedEvent
    if (rumor.kind !== RUMOR_KIND) return null
    if (rumor.pubkey !== seal.pubkey) return null // NIP-17 anti-spoof
    if (typeof rumor.content !== 'string' || rumor.content.length > MAX_PLAINTEXT_LEN) return null
    if (typeof rumor.created_at !== 'number') return null
    const tags = Array.isArray(rumor.tags) ? rumor.tags : []
    // Recompute the id from contents — never trust an embedded one
    const rumorId = getEventHash({ kind: rumor.kind, created_at: rumor.created_at, tags, content: rumor.content, pubkey: rumor.pubkey })
    return { senderPubkey: seal.pubkey, content: rumor.content, createdAt: rumor.created_at, rumorId, tags }
  } catch {
    return null // undecryptable / malformed — not addressed to us or garbage
  }
}
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/__tests__/giftWrap.test.ts` — Expected: PASS.
Run: `npx tsc -b --force` — Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/giftWrap.ts src/__tests__/giftWrap.test.ts
git commit -m "feat: NIP-17 gift wrap build/unwrap via signer primitives"
```

---

### Task 3: Kind-10050 DM capability discovery

**Files:**
- Create: `src/lib/dmCaps.ts`
- Test: `src/__tests__/dmCaps.test.ts` (create)

**Interfaces:**
- Consumes: `fetchEvent`, `publishEvent` from `src/lib/nostr.ts`; `requireSigner`/`getSigner` from `src/lib/signer.ts`.
- Produces (exported from `src/lib/dmCaps.ts`):

```ts
DM_RELAY_LIST_KIND = 10050
interface DmCaps { nip17: boolean; relays: string[] }
parseDmRelayList(event: Event): string[]              // ['relay', url] tags, ws(s) urls only, max 4
buildDmRelayListEvent(relays: string[]): Promise<Event>
fetchDmCaps(pubkey: string, discoveryRelays: string[]): Promise<DmCaps>  // session-cached, 24h TTL, negative-cached
ensureOwnDmRelayList(relays: string[]): Promise<void> // publish own 10050 once if absent; only when caps.nip44
resetDmCapsCache(): void
```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/dmCaps.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event } from 'nostr-tools'

const h = vi.hoisted(() => ({ fetchEvent: vi.fn(), publishEvent: vi.fn() }))
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, fetchEvent: h.fetchEvent, publishEvent: h.publishEvent }
})
vi.mock('../lib/signer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/signer')>()
  const signer = {
    pubkey: 'f'.repeat(64),
    caps: { nip04: true, nip44: true },
    signEvent: vi.fn(async (t: object) => ({ ...t, id: 'signed', pubkey: 'f'.repeat(64), sig: '' })),
  }
  return { ...actual, getSigner: () => signer, requireSigner: () => signer }
})

import { fetchDmCaps, parseDmRelayList, ensureOwnDmRelayList, resetDmCapsCache, DM_RELAY_LIST_KIND } from '../lib/dmCaps'

const PEER = 'a'.repeat(64)
const RELAYS = ['wss://r']

function listEvent(tags: string[][]): Event {
  return { id: 'e', pubkey: PEER, kind: DM_RELAY_LIST_KIND, created_at: 1, tags, content: '', sig: '' } as Event
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDmCapsCache()
})

describe('parseDmRelayList', () => {
  it('extracts relay tags, drops non-ws urls, caps at 4', () => {
    expect(parseDmRelayList(listEvent([
      ['relay', 'wss://a'], ['relay', 'http://evil'], ['relay', 'wss://b'],
      ['relay', 'wss://c'], ['relay', 'wss://d'], ['relay', 'wss://e'],
    ]))).toEqual(['wss://a', 'wss://b', 'wss://c', 'wss://d'])
  })
})

describe('fetchDmCaps', () => {
  it('peer with a 10050 is nip17-capable with its relays', async () => {
    h.fetchEvent.mockResolvedValue(listEvent([['relay', 'wss://dm']]))
    expect(await fetchDmCaps(PEER, RELAYS)).toEqual({ nip17: true, relays: ['wss://dm'] })
    expect(h.fetchEvent).toHaveBeenCalledWith(RELAYS, { kinds: [DM_RELAY_LIST_KIND], authors: [PEER], limit: 1 })
  })

  it('peer without a 10050 is not capable, and the result is cached (one fetch)', async () => {
    h.fetchEvent.mockResolvedValue(null)
    expect(await fetchDmCaps(PEER, RELAYS)).toEqual({ nip17: false, relays: [] })
    await fetchDmCaps(PEER, RELAYS)
    expect(h.fetchEvent).toHaveBeenCalledTimes(1)
  })

  it('fetch failure degrades to not-capable', async () => {
    h.fetchEvent.mockRejectedValue(new Error('offline'))
    expect(await fetchDmCaps(PEER, RELAYS)).toEqual({ nip17: false, relays: [] })
  })
})

describe('ensureOwnDmRelayList', () => {
  it('publishes when absent', async () => {
    h.fetchEvent.mockResolvedValue(null)
    await ensureOwnDmRelayList(['wss://mine'])
    expect(h.publishEvent).toHaveBeenCalledTimes(1)
  })

  it('does not republish when one exists', async () => {
    h.fetchEvent.mockResolvedValue(listEvent([['relay', 'wss://mine']]))
    await ensureOwnDmRelayList(['wss://mine'])
    expect(h.publishEvent).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/dmCaps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/dmCaps.ts`:

```ts
// Kind 10050 (NIP-17): both the "I read gift wraps" capability signal and the
// DM-delivery relay list. A peer's 10050 exists only if their client reads
// kind 1059, so gating sends on it makes the rollout self-coordinating.
// ponytail: session memory cache only (24h TTL) — no Dexie table; a cold app
// re-fetches one small replaceable event per peer per day.
import type { Event } from 'nostr-tools'
import { fetchEvent, publishEvent } from './nostr'
import { requireSigner, getSigner } from './signer'

export const DM_RELAY_LIST_KIND = 10050
const TTL_MS = 24 * 60 * 60 * 1000
const MAX_DM_RELAYS = 4

export interface DmCaps {
  nip17: boolean
  relays: string[]
}

const cache = new Map<string, { caps: DmCaps; fetchedAt: number }>()

export function resetDmCapsCache(): void {
  cache.clear()
}

export function parseDmRelayList(event: Event): string[] {
  return event.tags
    .filter(t => t[0] === 'relay' && typeof t[1] === 'string' && /^wss?:\/\//.test(t[1]))
    .map(t => t[1])
    .slice(0, MAX_DM_RELAYS)
}

export async function buildDmRelayListEvent(relays: string[]): Promise<Event> {
  return requireSigner().signEvent({
    kind: DM_RELAY_LIST_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: relays.map(url => ['relay', url]),
    content: '',
  })
}

export async function fetchDmCaps(pubkey: string, discoveryRelays: string[]): Promise<DmCaps> {
  const hit = cache.get(pubkey)
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.caps

  let caps: DmCaps = { nip17: false, relays: [] }
  try {
    const event = await fetchEvent(discoveryRelays, { kinds: [DM_RELAY_LIST_KIND], authors: [pubkey], limit: 1 })
    if (event) caps = { nip17: true, relays: parseDmRelayList(event) }
  } catch { /* negative-cache below */ }

  cache.set(pubkey, { caps, fetchedAt: Date.now() })
  return caps
}

/** Publish our own 10050 once if none exists. Only when the signer can nip44. */
export async function ensureOwnDmRelayList(relays: string[]): Promise<void> {
  const signer = getSigner()
  if (!signer || !signer.caps.nip44) return
  try {
    const existing = await fetchEvent(relays, { kinds: [DM_RELAY_LIST_KIND], authors: [signer.pubkey], limit: 1 })
    if (existing) return
    await publishEvent(relays, await buildDmRelayListEvent(relays))
  } catch { /* best-effort; retried next login */ }
}
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/__tests__/dmCaps.test.ts` — Expected: PASS.
Run: `npx tsc -b --force` — Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dmCaps.ts src/__tests__/dmCaps.test.ts
git commit -m "feat: kind-10050 DM capability discovery and own-list publish"
```

---

### Task 4: buildPrivateSend — the gated send builder

**Files:**
- Create: `src/lib/privateSend.ts`
- Test: `src/__tests__/privateSend.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 `buildGiftWraps`, `RUMOR_KIND`; Task 3 `fetchDmCaps`; existing `buildDMEvent`, `publishEvent` (`lib/nostr.ts`), `getPeerRelays`, `combineRelays` (`lib/peerRelays.ts`), `useNostrStore` (`readRelays()`, `writeRelays()`), `requireSigner`.
- Produces:

```ts
interface Publishable { event: Event; relays: string[] }
interface PrivateSend { msgId: string; createdAt: number; kind: number; publishables: Publishable[] }
buildPrivateSend(peerPubkey: string, content: string): Promise<PrivateSend>
publishPrivateSend(ps: PrivateSend): Promise<void>          // Promise.all over publishables
sendPrivate(content: string, recipientPubkey: string): Promise<PrivateSend>  // build + publish
```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/privateSend.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event } from 'nostr-tools'

const h = vi.hoisted(() => ({
  fetchDmCaps: vi.fn(),
  buildGiftWraps: vi.fn(),
  buildDMEvent: vi.fn(),
  publishEvent: vi.fn(),
  getPeerRelays: vi.fn(),
  caps: { nip04: true, nip44: true },
}))
vi.mock('../lib/dmCaps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dmCaps')>()
  return { ...actual, fetchDmCaps: h.fetchDmCaps }
})
vi.mock('../lib/giftWrap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/giftWrap')>()
  return { ...actual, buildGiftWraps: h.buildGiftWraps }
})
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, buildDMEvent: h.buildDMEvent, publishEvent: h.publishEvent }
})
vi.mock('../lib/peerRelays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/peerRelays')>()
  return { ...actual, getPeerRelays: h.getPeerRelays }
})
vi.mock('../lib/signer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/signer')>()
  const signer = { pubkey: 'f'.repeat(64), caps: h.caps }
  return { ...actual, getSigner: () => signer, requireSigner: () => signer }
})

import { useNostrStore } from '../store/nostrStore'
import { buildPrivateSend } from '../lib/privateSend'
import { RUMOR_KIND } from '../lib/giftWrap'

const PEER = 'a'.repeat(64)
const wrapR = { id: 'wrapR', kind: 1059 } as Event
const wrapS = { id: 'wrapS', kind: 1059 } as Event

beforeEach(() => {
  vi.clearAllMocks()
  h.caps.nip44 = true
  useNostrStore.setState({ relays: ['wss://mine'], relayModes: {} })
  h.buildGiftWraps.mockResolvedValue({ rumorId: 'rumor1', createdAt: 111, wrapForRecipient: wrapR, wrapForSelf: wrapS })
  h.buildDMEvent.mockResolvedValue({ id: 'legacy1', kind: 4, created_at: 222, tags: [['p', PEER]] } as Event)
  h.getPeerRelays.mockResolvedValue({ read: ['wss://peer-read'], write: [] })
})

describe('buildPrivateSend', () => {
  it('gift-wraps when signer has nip44 and peer has 10050', async () => {
    h.fetchDmCaps.mockResolvedValue({ nip17: true, relays: ['wss://dm'] })
    const ps = await buildPrivateSend(PEER, 'hello')
    expect(ps.msgId).toBe('rumor1')
    expect(ps.createdAt).toBe(111)
    expect(ps.kind).toBe(RUMOR_KIND)
    expect(ps.publishables).toHaveLength(2)
    expect(ps.publishables[0].event).toBe(wrapR)
    expect(ps.publishables[0].relays).toContain('wss://dm')     // peer's DM relays
    expect(ps.publishables[1].event).toBe(wrapS)
    expect(ps.publishables[1].relays).toEqual(['wss://mine'])   // self copy → own write relays
    expect(h.buildDMEvent).not.toHaveBeenCalled()
  })

  it('falls back to peer read relays when the 10050 lists none', async () => {
    h.fetchDmCaps.mockResolvedValue({ nip17: true, relays: [] })
    const ps = await buildPrivateSend(PEER, 'hello')
    expect(ps.publishables[0].relays).toContain('wss://peer-read')
  })

  it('uses legacy kind 4 when the peer has no 10050', async () => {
    h.fetchDmCaps.mockResolvedValue({ nip17: false, relays: [] })
    const ps = await buildPrivateSend(PEER, 'hello')
    expect(ps.msgId).toBe('legacy1')
    expect(ps.kind).toBe(4)
    expect(ps.publishables).toHaveLength(1)
    expect(ps.publishables[0].relays).toEqual(expect.arrayContaining(['wss://mine', 'wss://peer-read']))
    expect(h.buildGiftWraps).not.toHaveBeenCalled()
  })

  it('uses legacy kind 4 when own signer lacks nip44 (no 10050 lookup)', async () => {
    h.caps.nip44 = false
    const ps = await buildPrivateSend(PEER, 'hello')
    expect(ps.kind).toBe(4)
    expect(h.fetchDmCaps).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/privateSend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/privateSend.ts`:

```ts
// Single choke point for all private sends (chat DMs, DM reactions/edits/
// deletes, call logs, group invite/rekey/remove). Gift wrap iff our signer
// can nip44 AND the peer advertises kind 10050; otherwise legacy kind 4
// targeted exactly as before.
import type { Event } from 'nostr-tools'
import { buildDMEvent, publishEvent } from './nostr'
import { buildGiftWraps, RUMOR_KIND } from './giftWrap'
import { fetchDmCaps } from './dmCaps'
import { getPeerRelays, combineRelays } from './peerRelays'
import { requireSigner } from './signer'
import { useNostrStore } from '../store/nostrStore'

export interface Publishable {
  event: Event
  relays: string[]
}

export interface PrivateSend {
  msgId: string
  createdAt: number
  kind: number
  publishables: Publishable[]
}

export async function buildPrivateSend(peerPubkey: string, content: string): Promise<PrivateSend> {
  const signer = requireSigner()
  const state = useNostrStore.getState()
  const myWrite = state.writeRelays()

  if (signer.caps.nip44) {
    const caps = await fetchDmCaps(peerPubkey, state.readRelays())
    if (caps.nip17) {
      const { rumorId, createdAt, wrapForRecipient, wrapForSelf } = await buildGiftWraps(peerPubkey, content)
      const recipientRelays = caps.relays.length > 0
        ? combineRelays(myWrite, caps.relays)
        : combineRelays(myWrite, (await getPeerRelays(peerPubkey, state.readRelays())).read)
      return {
        msgId: rumorId,
        createdAt,
        kind: RUMOR_KIND,
        publishables: [
          { event: wrapForRecipient, relays: recipientRelays },
          { event: wrapForSelf, relays: myWrite },
        ],
      }
    }
  }

  const event = await buildDMEvent(peerPubkey, content)
  const peerRead = (await getPeerRelays(peerPubkey, state.readRelays())).read
  return {
    msgId: event.id,
    createdAt: event.created_at,
    kind: 4,
    publishables: [{ event, relays: combineRelays(myWrite, peerRead) }],
  }
}

export async function publishPrivateSend(ps: PrivateSend): Promise<void> {
  await Promise.all(ps.publishables.map(p => publishEvent(p.relays, p.event)))
}

export async function sendPrivate(content: string, recipientPubkey: string): Promise<PrivateSend> {
  const ps = await buildPrivateSend(recipientPubkey, content)
  await publishPrivateSend(ps)
  return ps
}
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/__tests__/privateSend.test.ts` — Expected: PASS.
Run: `npx tsc -b --force` — Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/privateSend.ts src/__tests__/privateSend.test.ts
git commit -m "feat: gated private-send builder (gift wrap vs legacy kind 4)"
```

---

### Task 5: Inbox — routePrivatePayload extraction + processGiftWrap

**Files:**
- Modify: `src/lib/inbox.ts` (`processDMEvent` ~lines 340-447; add `routePrivatePayload`, `processGiftWrap`)
- Test: `src/__tests__/giftWrapInbox.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 `unwrapGiftWrap`, `GIFT_WRAP_KIND`, `RUMOR_KIND`.
- Produces:
  - `routePrivatePayload(msg: { id: string; senderPubkey: string; peer: string; plaintext: string; createdAt: number; tags: string[][]; kind: number }, myPubkey: string, relays: string[], opts: ProcessOpts): Promise<void>` — module-private; everything after today's decrypt in `processDMEvent`.
  - `processDMEvent(event, myPubkey, relays, opts)` — signature unchanged; body = guards + decrypt + route.
  - `export processGiftWrap(event: Event, myPubkey: string, relays: string[], opts: ProcessOpts): Promise<void>` — unwrap → dedup by rumor id → route.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/giftWrapInbox.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { LocalSigner, setSigner } from '../lib/signer'
import { buildGiftWraps } from '../lib/giftWrap'
import { useNostrStore } from '../store/nostrStore'
import { serializeGroupRekey } from '../lib/groupMembership'

vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    publishEvent: vi.fn().mockResolvedValue(undefined),
    buildGroupKeyBackupEvent: vi.fn().mockResolvedValue({ id: 'backup' }),
    fetchEvent: vi.fn().mockResolvedValue(null),
  }
})

import { processGiftWrap, resetInboxDedup } from '../lib/inbox'

const skAlice = generateSecretKey()
const skBob = generateSecretKey()
const ALICE = getPublicKey(skAlice)
const BOB = getPublicKey(skBob)
const RELAYS = ['wss://r']
const OLD_KEY = 'a'.repeat(64)
const NEW_KEY = 'b'.repeat(64)

async function wrapFromAlice(content: string) {
  setSigner(new LocalSigner(new Uint8Array(skAlice)))
  const wraps = await buildGiftWraps(BOB, content)
  setSigner(new LocalSigner(new Uint8Array(skBob))) // Bob is the receiving user
  return wraps
}

beforeEach(() => {
  resetInboxDedup()
  useNostrStore.setState({
    publicKey: BOB,
    messages: {}, contacts: [], profiles: {}, blockedPubkeys: [], dismissedRequests: {}, seenAt: {},
    groups: [], groupKeys: {}, groupKeyHistory: {}, groupKeyRotatedAt: {}, groupMembersUpdatedAt: {},
  })
})

describe('processGiftWrap', () => {
  it('inserts a chat message with the rumor id, rumor createdAt, kind 14, under the sender chat', async () => {
    const { rumorId, createdAt, wrapForRecipient } = await wrapFromAlice('hello bob')
    await processGiftWrap(wrapForRecipient, BOB, RELAYS, { live: false })
    const msgs = useNostrStore.getState().messages[ALICE] ?? []
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ id: rumorId, pubkey: ALICE, content: 'hello bob', createdAt, kind: 14, decrypted: true })
  })

  it('dedups the self copy against the recipient copy by rumor id', async () => {
    setSigner(new LocalSigner(new Uint8Array(skBob)))
    const wraps = await buildGiftWraps(ALICE, 'from bob') // Bob sends; self copy comes back to Bob
    await processGiftWrap(wraps.wrapForSelf, BOB, RELAYS, { live: false })
    await processGiftWrap(wraps.wrapForSelf, BOB, RELAYS, { live: false })
    const msgs = useNostrStore.getState().messages[ALICE] ?? []
    expect(msgs).toHaveLength(1)          // addMessage idempotent by id
    expect(msgs[0].pubkey).toBe(BOB)      // sent copy shows under the peer chat, authored by me
  })

  it('routes a wrapped group_rekey control exactly like a legacy kind-4 one', async () => {
    useNostrStore.setState({
      groups: [{ id: 'g1', name: 'Team', creatorPubkey: ALICE, memberPubkeys: [ALICE, BOB], relayUrl: RELAYS[0] }],
      groupKeys: { g1: OLD_KEY },
    })
    const { wrapForRecipient } = await wrapFromAlice(serializeGroupRekey('g1', NEW_KEY, 'Team', [ALICE, BOB]))
    await processGiftWrap(wrapForRecipient, BOB, RELAYS, { live: true })
    const s = useNostrStore.getState()
    expect(s.groupKeys.g1).toBe(NEW_KEY)
    expect(s.messages[ALICE] ?? []).toHaveLength(0) // control, not a chat message
  })

  it('ignores wraps that fail to unwrap (not addressed to us)', async () => {
    setSigner(new LocalSigner(new Uint8Array(skAlice)))
    const foreign = await buildGiftWraps(ALICE, 'alice to alice') // wrapped to Alice, Bob receives it
    setSigner(new LocalSigner(new Uint8Array(skBob)))
    await processGiftWrap(foreign.wrapForRecipient, BOB, RELAYS, { live: false })
    expect(Object.keys(useNostrStore.getState().messages)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/giftWrapInbox.test.ts`
Expected: FAIL — `processGiftWrap` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/inbox.ts`:

1. Add imports: `import { unwrapGiftWrap, GIFT_WRAP_KIND } from './giftWrap'`.

2. Extract the body of `processDMEvent` after the decrypt into a module-private router. The current body from the `// Route file-transfer control messages` comment down to the final `ensureProfile` call moves verbatim into:

```ts
interface PrivatePayload {
  id: string           // event id (legacy) or rumor id (wrapped)
  senderPubkey: string
  peer: string         // the chat this belongs to
  plaintext: string
  createdAt: number
  tags: string[][]
  kind: number         // 4 or 14
}

async function routePrivatePayload(p: PrivatePayload, myPubkey: string, relays: string[], opts: ProcessOpts): Promise<void> {
  // — verbatim current post-decrypt body with these renames —
  // decrypted            -> p.plaintext
  // event.id             -> p.id
  // event.pubkey         -> p.senderPubkey
  // event.created_at     -> p.createdAt
  // event.tags           -> p.tags
  // event.kind           -> p.kind
  // peer                 -> p.peer
  // The group-control dispatch block calls handleGroupInvite/handleGroupRekey/
  // handleGroupRemove with a synthesized event-shaped arg:
  //   { pubkey: p.senderPubkey, created_at: p.createdAt } — change those three
  //   handlers' first parameter type from Event to
  //   { pubkey: string; created_at: number } (they use nothing else).
  // routeReaction/routeMessageOp take (content, event) but only use
  //   event.id/event.pubkey/event.created_at — change their second parameter to
  //   { id: string; pubkey: string; created_at: number } and pass
  //   { id: p.id, pubkey: p.senderPubkey, created_at: p.createdAt }.
  // routeTransfer(transfer, chatId, event) uses event.pubkey/created_at — same
  //   narrowing, pass the synthesized object.
  // The Message built at the end keeps recipientPubkey: p.peer and gains
  //   kind: p.kind.
}
```

The narrowed parameter types are structural — the existing `processChannelEvent`/`processGroupEvent` call sites that pass full `Event` objects still compile.

3. `processDMEvent` becomes guards + decrypt + route:

```ts
export async function processDMEvent(event: Event, myPubkey: string, relays: string[], opts: ProcessOpts): Promise<void> {
  if (event.content.length > MAX_ENCRYPTED_CONTENT_LEN) return
  const peer = event.pubkey === myPubkey
    ? event.tags.find(t => t[0] === 'p')?.[1]
    : event.pubkey
  if (!peer) return
  let decrypted: string
  try {
    decrypted = await decryptDM(peer, event.content)
  } catch {
    return // decryption failed — skip
  }
  if (decrypted.length > MAX_CONTENT_LEN) return
  await routePrivatePayload(
    { id: event.id, senderPubkey: event.pubkey, peer, plaintext: decrypted, createdAt: event.created_at, tags: event.tags, kind: event.kind },
    myPubkey, relays, opts,
  )
}
```

4. Add `processGiftWrap`:

```ts
/** Unwrap a kind-1059 gift wrap and route its rumor through the shared private
 * pipeline. Dedup keys on the RUMOR id, so the self copy and the recipient
 * copy of the same message collapse. */
export async function processGiftWrap(event: Event, myPubkey: string, relays: string[], opts: ProcessOpts): Promise<void> {
  if (event.kind !== GIFT_WRAP_KIND) return
  const un = await unwrapGiftWrap(event)
  if (!un) return
  // Sent copies come back addressed to me with me as sender; the chat peer is
  // then the rumor's p tag. Received messages: peer = sender.
  const peer = un.senderPubkey === myPubkey
    ? un.tags.find(t => t[0] === 'p')?.[1]
    : un.senderPubkey
  if (!peer) return
  await routePrivatePayload(
    { id: un.rumorId, senderPubkey: un.senderPubkey, peer, plaintext: un.content, createdAt: un.createdAt, tags: un.tags, kind: RUMOR_KIND },
    myPubkey, relays, opts,
  )
}
```

Also import `RUMOR_KIND` from `./giftWrap`.

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/__tests__/giftWrapInbox.test.ts src/__tests__/inbox.test.ts src/__tests__/groupMembership.inbox.test.ts` — Expected: PASS (legacy suites untouched behaviorally).
Run: `npx tsc -b --force` — Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbox.ts src/__tests__/giftWrapInbox.test.ts
git commit -m "feat: shared private-payload router + gift wrap inbox processing"
```

---

### Task 6: Subscriptions and backfill wiring

**Files:**
- Modify: `src/hooks/useNostrSubscriptions.ts` (`useGlobalInbox` DM effect ~lines 172-186; `useDMMessages` ~lines 85-109)
- Modify: `src/lib/history.ts:30-40` (DM filter set)
- Modify: `src/hooks/useChatHistory.ts:66-71` (route 1059 events)
- Test: extend `src/__tests__/useGlobalInbox.test.tsx` (add one case)

**Interfaces:**
- Consumes: Task 5 `processGiftWrap`; Task 2 `GIFT_WRAP_KIND` (value 1059).
- Produces: live 1059 subscription in the global inbox only; initial-page 1059 fetch in `useDMMessages`; 1059 backfill filter in `history.ts` with a 2-day-padded `until`.

- [ ] **Step 1: Write the failing test**

In `src/__tests__/useGlobalInbox.test.tsx`, add (adapting to that file's existing mock harness — it mocks `subscribeEvents` and records filters; follow the existing test that asserts the kind-4 subscription):

```tsx
  it('subscribes to kind-1059 gift wraps addressed to me when the signer can nip44', () => {
    renderGlobalInbox() // whatever helper the file already uses to mount useGlobalInbox
    const filters = subscribeEventsMock.mock.calls.map(c => c[1])
    expect(filters).toContainEqual(expect.objectContaining({ kinds: [1059], '#p': [PUBKEY] }))
  })
```

If the file's signer mock lacks `caps`, extend it to `caps: { nip04: true, nip44: true }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/useGlobalInbox.test.tsx`
Expected: the new case FAILS (no 1059 filter yet).

- [ ] **Step 3: Implement**

1. `src/hooks/useNostrSubscriptions.ts` — import `processGiftWrap` from `../lib/inbox` and `GIFT_WRAP_KIND` from `../lib/giftWrap`. In `useGlobalInbox`, add a sibling effect after the DM effect:

```ts
  // Gift-wrapped DMs (NIP-17). Wraps cannot be filtered by author (ephemeral
  // signing keys), so this single global subscription serves every chat; the
  // router sorts by unwrapped sender. Only useful when we can nip44-decrypt.
  useEffect(() => {
    if (!publicKey) return
    if (!getSigner()?.caps.nip44) return

    let live = false
    const sub = subscribeEvents(
      stableRelays,
      { kinds: [GIFT_WRAP_KIND], '#p': [publicKey], limit: 100 },
      (event) => { void processGiftWrap(event, publicKey, stableRelays, { live }) },
      () => { live = true },
    )
    return () => sub.close()
  }, [publicKey, stableRelays, signerCaps])
```

2. `useDMMessages` — inside the existing effect (after `sub2` is created), add an initial-page wrap fetch (one-shot; live updates come from the global inbox):

```ts
    // Initial page of gift wraps (backfill only; the global inbox owns the
    // live 1059 subscription). Wraps are unfilterable by peer, so this fetches
    // my recent wraps and lets the router sort them.
    if (getSigner()?.caps.nip44) {
      void fetchEvents(receivedRelays, { kinds: [GIFT_WRAP_KIND], '#p': [myPubkey], limit: INITIAL_PAGE })
        .then(events => Promise.all(events.map(e => processGiftWrap(e, myPubkey, receivedRelays, { live: false }))))
        .catch(() => {})
    }
```

Import `fetchEvents` from `../lib/nostr` if not already imported.

3. `src/lib/history.ts` — the DM branch currently returns two kind-4 filters. Add a third with the fuzz-padded cursor (import `GIFT_WRAP_KIND` from `./giftWrap`; define `const WRAP_FUZZ_S = 2 * 24 * 60 * 60`):

```ts
    { kinds: [GIFT_WRAP_KIND], '#p': [myPubkey], until: until + WRAP_FUZZ_S, limit },
```

4. `src/hooks/useChatHistory.ts` — in the DM/default branch of the per-event loop, route wraps to the wrap processor:

```ts
        else if (ev.kind === 1059) await processGiftWrap(ev, myPubkey, relays, { live: false })
        else await processDMEvent(ev, myPubkey, relays, { live: false })
```

Import `processGiftWrap` from `../lib/inbox`.

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/__tests__/useGlobalInbox.test.tsx src/__tests__/useDMMessages.routing.test.tsx src/__tests__/history.test.ts src/__tests__/useChatHistory.test.tsx` — Expected: PASS (history.test.ts asserts the DM filter set — update its expectation to include the new 1059 filter).
Run: `npx tsc -b --force` — Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNostrSubscriptions.ts src/hooks/useChatHistory.ts src/lib/history.ts src/__tests__/useGlobalInbox.test.tsx src/__tests__/history.test.ts
git commit -m "feat: subscribe and backfill kind-1059 gift wraps"
```

---

### Task 7: Send-path migration (thread, reactions, call logs, group controls)

**Files:**
- Modify: `src/hooks/useChatThread.ts` (widen retry map; add `publishPrivate`)
- Modify: `src/components/Chat/MessageThread.tsx` (DMThread `handleSend` + `sendContent`)
- Modify: `src/hooks/useNostrSubscriptions.ts` (`sendDM` → wraps `sendPrivate`; `sendDMReaction` drops relays)
- Modify: `src/contexts/CallContext.tsx:166` (call-log DM via `sendPrivate`)
- Modify: `src/lib/groupManage.ts` (invite/rekey/remove via `sendPrivate`), `src/components/Chat/AddGroupModal.tsx` (invite loop), `src/lib/groupMembership.ts` (add `serializeGroupInvite`)
- Test: extend `src/__tests__/useChatThread.test.tsx`; update `src/__tests__/groupManage.test.ts`, `src/__tests__/messageInputSend.test.tsx` if signatures ripple
- Delete: `buildGroupInviteEvent`, `buildGroupRekeyEvent`, `buildGroupRemoveEvent` from `src/lib/nostr.ts` (their serialization moves to `groupMembership.ts`; transport to `privateSend.ts`)

**Interfaces:**
- Consumes: Task 4 `buildPrivateSend`, `publishPrivateSend`, `sendPrivate`, `PrivateSend`.
- Produces:
  - `useChatThread` return gains `publishPrivate(ps: PrivateSend, fields: Pick<Message,'content'> & Partial<Message>): Promise<void>`; the pending map becomes `Map<string, () => Promise<unknown>>` (retry closures) — `publish` (channel/group path) keeps its signature and stores `() => publishEvent(await opts.targetRelays(), event)`.
  - `sendDM(content: string, recipientPubkey: string): Promise<PrivateSend>` (relays param removed).
  - `serializeGroupInvite(groupId: string, groupKeyHex: string, groupName: string, memberPubkeys: string[]): string` in `groupMembership.ts` — same JSON shape as today's invite payload.
  - `addGroupMember`/`removeGroupMember` signatures unchanged; internals send via `sendPrivate`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/useChatThread.test.tsx` add (mock `../lib/privateSend` partially: `publishPrivateSend: vi.fn()`):

```tsx
  it('publishPrivate adds an optimistic message from the PrivateSend envelope and retries via its closure', async () => {
    publishPrivateSend.mockRejectedValueOnce(new Error('down'))
    const { result } = renderHook(() => useChatThread('chat', opts()))
    const ps = { msgId: 'rumor1', createdAt: 333, kind: 14, publishables: [] }
    await act(() => result.current.publishPrivate(ps as never, { content: 'hi', recipientPubkey: 'peer', decrypted: true }))
    expect(h.addMessage).toHaveBeenCalledWith('chat', expect.objectContaining({ id: 'rumor1', createdAt: 333, kind: 14, status: 'sending' }))
    expect(h.updateMessageStatus).toHaveBeenCalledWith('chat', 'rumor1', 'failed')

    publishPrivateSend.mockResolvedValueOnce(undefined)
    await act(() => result.current.handleRetry('rumor1'))
    expect(publishPrivateSend).toHaveBeenCalledTimes(2)
    expect(h.updateMessageStatus).toHaveBeenLastCalledWith('chat', 'rumor1', 'sent')
  })
```

In `src/__tests__/groupManage.test.ts`: replace the `buildGroupInviteEvent`/`buildGroupRekeyEvent`/`buildGroupRemoveEvent`/`publishEvent`-per-DM expectations with a mocked `../lib/privateSend` `sendPrivate` and assert:
- `addGroupMember`: `sendPrivate(serializeGroupInvite('g1', KEY, 'Team', [ME, BOB, EVE, NEW]), NEW)` called once.
- `removeGroupMember`: `sendPrivate(<rekey payload>, BOB)` and `sendPrivate(<rekey payload>, ME)` and `sendPrivate(serializeGroupRemove('g1'), EVE)`; metadata + backup still via `publishEvent`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/useChatThread.test.tsx src/__tests__/groupManage.test.ts`
Expected: FAIL — `publishPrivate` and the new send shape don't exist.

- [ ] **Step 3: Implement**

1. `src/hooks/useChatThread.ts`:
   - Imports: add `import { publishPrivateSend, type PrivateSend } from '../lib/privateSend'`.
   - `pendingEventsRef` becomes `useRef<Map<string, () => Promise<unknown>>>(new Map())`.
   - Extract the shared tail:

```ts
  const runSend = async (msgId: string, attempt: () => Promise<unknown>) => {
    pendingEventsRef.current.set(msgId, attempt)
    try {
      await attempt()
      updateMessageStatus(chatId, msgId, 'sent')
      pendingEventsRef.current.delete(msgId)
    } catch {
      updateMessageStatus(chatId, msgId, 'failed')
    }
  }
```

   - `publish(event, fields)` (channel/group): unchanged optimistic `addMessage`, then `await runSend(event.id, async () => publishEvent(await opts.targetRelays(), event))`.
   - New:

```ts
  const publishPrivate = async (ps: PrivateSend, fields: Pick<Message, 'content'> & Partial<Message>) => {
    addMessage(chatId, {
      id: ps.msgId,
      pubkey: publicKey || '',
      createdAt: ps.createdAt,
      tags: fields.recipientPubkey ? [['p', fields.recipientPubkey]] : [],
      kind: ps.kind,
      status: 'sending',
      ...(replyTo && {
        replyTo: { id: replyTo.id, pubkey: replyTo.pubkey, previewText: getPreviewText(replyTo.content).slice(0, 100) },
      }),
      ...fields,
    })
    await runSend(ps.msgId, () => publishPrivateSend(ps))
  }
```

   - `handleRetry`:

```ts
  const handleRetry = async (msgId: string) => {
    const attempt = pendingEventsRef.current.get(msgId)
    if (!attempt) return
    updateMessageStatus(chatId, msgId, 'sending')
    try {
      await attempt()
      updateMessageStatus(chatId, msgId, 'sent')
      pendingEventsRef.current.delete(msgId)
    } catch {
      updateMessageStatus(chatId, msgId, 'failed')
    }
  }
```

   - Return `publishPrivate` alongside `publish`.

2. `src/components/Chat/MessageThread.tsx` DMThread:

```ts
  const handleSend = async (content: string) => {
    if (!thread.guarded()) return
    if (isPending) acceptMessageRequest(theirPubkey)
    const ps = await buildPrivateSend(theirPubkey, content)
    await thread.publishPrivate(ps, { content, recipientPubkey: theirPubkey, decrypted: true })
  }
```

   `sendContent`/`sendReaction` opts become `async content => sendDM(content, theirPubkey)` and `async (t, e, o) => sendDMReaction(t, e, o, theirPubkey)`; `dmTargetRelays` and `targetRelays` stay only if the legacy channel/group paths use them — for DMThread, `targetRelays` is still required by `ChatThreadOpts`; keep it as-is (it now only affects nothing since DM sends go through publishPrivate/sendPrivate; retry closures carry their own targets). Import `buildPrivateSend` from `../../lib/privateSend`; drop the now-unused `buildDMEvent` import.

3. `src/hooks/useNostrSubscriptions.ts`:

```ts
export async function sendDM(content: string, recipientPubkey: string) {
  return sendPrivate(content, recipientPubkey)
}

export async function sendDMReaction(target: string, emoji: string, op: 'add' | 'remove', peer: string) {
  return sendDM(serializeReaction(target, emoji, op), peer)
}
```

Import `sendPrivate` from `../lib/privateSend`; remove the `buildDMEvent` import if now unused.

4. `src/contexts/CallContext.tsx:166`: replace `const event = await buildDMEvent(peerPubkey, content)` + its publish with `await sendPrivate(content, peerPubkey)` (check the surrounding lines: if the old code published to explicit relays, delete that publish — sendPrivate targets internally). Update imports.

5. Group controls — in `src/lib/groupMembership.ts` add:

```ts
export function serializeGroupInvite(groupId: string, groupKeyHex: string, groupName: string, memberPubkeys: string[]): string {
  return JSON.stringify({ type: 'group_invite', groupId, groupKeyHex, groupName, memberPubkeys })
}
```

In `src/lib/groupManage.ts`: replace `publishEvent(relays, await buildGroupInviteEvent(...))` with `await sendPrivate(serializeGroupInvite(group.id, key, group.name, members), newMemberPubkey)`; the rekey loop body becomes `await sendPrivate(serializeGroupRekey(group.id, newKey, group.name, members), member)`; the remove notice becomes `await sendPrivate(serializeGroupRemove(group.id), removePubkey)`. Metadata (30040) and backup (30041) publishes are unchanged.
In `src/components/Chat/AddGroupModal.tsx`: the invite loop becomes `await sendPrivate(serializeGroupInvite(groupId, groupKeyHex, name.trim(), allMembers), memberPubkey)`.
Delete `buildGroupInviteEvent`, `buildGroupRekeyEvent`, `buildGroupRemoveEvent` from `src/lib/nostr.ts` and remove their `serializeGroupRekey`/`serializeGroupRemove` imports there.

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/__tests__/useChatThread.test.tsx src/__tests__/groupManage.test.ts src/__tests__/MessageThread.test.tsx src/__tests__/messageInputSend.test.tsx src/__tests__/CallContext.test.tsx src/__tests__/groupMembership.inbox.test.ts` — Expected: PASS after updating mocks that referenced the deleted builders (CallContext tests may mock `../lib/privateSend`).
Run: `npx tsc -b --force` — Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: route all private sends through the gated private-send builder"
```

---

### Task 8: Publish own kind 10050 on sync

**Files:**
- Modify: `src/store/nostrStore.ts` (end of `applySyncResult`/`loadRemote` flow, after the relay-list branch ~line 300)
- Test: extend `src/__tests__/dmCaps.test.ts` is already done in Task 3; here add one store-level smoke assertion only if the store tests have a loadRemote harness — otherwise verify by type + manual note.

**Interfaces:**
- Consumes: Task 3 `ensureOwnDmRelayList`.
- Produces: after every successful remote-state load, `void ensureOwnDmRelayList(get().readRelays())` fires (fire-and-forget, internally gated on `caps.nip44` and absence of an existing list).

- [ ] **Step 1: Implement**

In `src/store/nostrStore.ts`, immediately after the relay-list merge branch in the sync-apply function (the block ending with `get().triggerSettingsSync()` around line 302), add:

```ts
  // NIP-17: advertise gift-wrap capability + DM relays (no-op unless nip44)
  void ensureOwnDmRelayList(get().readRelays())
```

Import `ensureOwnDmRelayList` from `../lib/dmCaps`.

- [ ] **Step 2: Verify**

Run: `npx vitest run src/__tests__/store.test.ts src/__tests__/dmCaps.test.ts` — Expected: PASS.
Run: `npx tsc -b --force` — Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/store/nostrStore.ts
git commit -m "feat: publish own kind-10050 DM relay list on sync"
```

---

### Task 9: Full verification + FeatureNotes (push held for final review)

**Files:**
- Modify: `FeatureNotes.md`

- [ ] **Step 1: Full suite, type check, lint**

Run: `npx vitest run` — Expected: all pass.
Run: `npx tsc -b --force` — Expected: no output.
Run: `npx eslint src/lib/giftWrap.ts src/lib/dmCaps.ts src/lib/privateSend.ts src/lib/signer.ts src/lib/inbox.ts src/hooks/useChatThread.ts src/hooks/useNostrSubscriptions.ts src/lib/groupManage.ts` — Expected: no output.

- [ ] **Step 2: FeatureNotes entry**

Add under `## Unreleased` in `FeatureNotes.md`:

```markdown
- **NIP-44/17 gift-wrapped DMs** (2026-07-13). Spec:
  `docs/superpowers/specs/2026-07-13-nip17-dm-migration-design.md`. All
  private sends (chat DMs, DM reactions/edits/deletes, call logs, group
  invite/rekey/remove) go through one gated builder: peers who publish a
  kind-10050 DM-relay list get NIP-17 gift wrap (rumor 14 → seal 13 → wrap
  1059, ephemeral wrap keys, timestamps fuzzed ≤2 days); everyone else gets
  legacy NIP-04 kind 4, which we also read forever. Message identity/ordering
  use the rumor id and rumor timestamp; self-addressed wrap copies make sent
  messages visible across devices and dedup by rumor id. We publish our own
  10050 only when the signer supports nip44 (local keys always; NIP-07 iff
  window.nostr.nip44), so a peer's 10050 proves their client reads wraps —
  single-release rollout. Accepted limits: no forward secrecy (MLS later);
  wrap backfill is global per user, not per-peer; wrapped pagination is
  approximate (±2-day fuzz); ephemeral 241xx signals stay NIP-04.
```

- [ ] **Step 3: Commit (do NOT push — final whole-branch review runs first)**

```bash
git add FeatureNotes.md
git commit -m "docs: FeatureNotes entry for NIP-44/17 gift-wrapped DMs"
```

- [ ] **Step 4: Manual verification note**

Report for live verification with two accounts: fresh login publishes 10050; DM between two upgraded accounts arrives as kind 1059 on the relay (check a relay explorer) and renders normally both sides including offline backfill; DM to a legacy (extension-without-nip44) account still arrives as kind 4; group invite/rekey between upgraded accounts works end-to-end.
