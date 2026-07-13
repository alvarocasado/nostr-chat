# Group Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live audio/video group calls (room model, full mesh, up to 6 participants) inside existing encrypted groups, coordinated entirely over Nostr relays.

**Architecture:** A pure protocol/decision library (`lib/groupCall.ts`) + a new `GroupCallContext` provider managing a `Map<pubkey, RTCPeerConnection>` mesh. Roster via ephemeral kind-24103 heartbeats encrypted with the group AES key; pairwise signaling reuses kind 24100 with a new optional `groupId`; a `call-start` control message rides the existing encrypted group transport for notifications.

**Tech Stack:** React 19 + TypeScript, Zustand, nostr-tools, WebRTC, vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-02-group-calls-design.md`

## Global Constraints

- No emojis in code, comments, or documentation.
- `GROUP_CALL_PRESENCE_KIND = 24103` (ephemeral); heartbeat every `PRESENCE_INTERVAL_MS = 30_000`; roster expiry `PRESENCE_EXPIRY_MS = 90_000`; cap `MAX_GROUP_CALL_PARTICIPANTS = 6`; `callId` max 128 chars.
- Presence content encrypted with the group AES key (`encryptWithGroupKey`); payload `{ "type": "presence", "callId", "mediaType" }`; author identity comes from `event.pubkey` only.
- Concurrent starts converge on the lexicographically smallest live `callId`.
- Glare: the offer from the lexicographically smaller pubkey wins.
- The 1:1 path must be untouched behaviorally except: it ignores signals carrying `groupId`, and replies `busy` while a group call is active.
- Mutual exclusion via store field `activeCallType: 'none' | 'dm' | 'group'` (runtime-only, never persisted) — this realizes the spec's `callBusy` flag; a single boolean would let the two providers clobber each other.
- Per-peer failures never end the call. `getUserMedia` failure aborts a join before any heartbeat is published.
- Mobile: overlay grid `grid-cols-1` for <=2 tiles, `grid-cols-2` for 3+; controls 44 px+ with `env(safe-area-inset-bottom)` padding.
- Conventional commits. Tests: `npm test` (vitest); single file: `npx vitest run <path>`.
- Implementers may minimally fix typing/lint defects in this plan's test code while preserving every behavioral assertion (call it out in the report).

---

### Task 1: Protocol and decision library

**Files:**
- Create: `src/lib/groupCall.ts`
- Test: `src/__tests__/groupCall.test.ts`

**Interfaces:**
- Consumes: `encryptWithGroupKey`/`decryptWithGroupKey` (`src/lib/groupCrypto.ts`), `requireSigner` (`src/lib/signer.ts`), `generateGroupKey` (test only), `MediaType` from `src/lib/webrtc.ts`.
- Produces (used by Tasks 3-7):
  - Constants: `GROUP_CALL_PRESENCE_KIND`, `MAX_GROUP_CALL_PARTICIPANTS`, `PRESENCE_INTERVAL_MS`, `PRESENCE_EXPIRY_MS`
  - `buildPresenceEvent(groupId: string, groupKeyHex: string, callId: string, mediaType: MediaType): Promise<Event>`
  - `parsePresenceEvent(event: Event, groupKeyHex: string): Promise<GroupCallPresence | null>`
  - `interface GroupCallPresence { type: 'presence'; callId: string; mediaType: MediaType }`
  - `interface Heartbeat { callId: string; mediaType: MediaType; receivedAt: number }`
  - `interface LiveCall { callId: string; mediaType: MediaType; participants: string[] }`
  - `deriveRoster(heartbeats: ReadonlyMap<string, Heartbeat>, nowMs: number): LiveCall | null`
  - `myOfferWins(myPubkey: string, theirPubkey: string): boolean`
  - `type JoinState = 'can-join' | 'full' | 'busy' | 'other-device' | 'in-call'`
  - `deriveJoinState(args: { participants: string[]; myPubkey: string; inCallLocally: boolean; busyWithDmCall: boolean }): JoinState`
  - `serializeCallStart(callId: string): string`, `parseCallStartPayload(content: string): CallStartPayload | null`, `interface CallStartPayload { type: 'call-start'; callId: string }`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/groupCall.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installTestSigner } from '../test/signer'
import { clearSigner } from '../lib/signer'
import { generateGroupKey } from '../lib/groupCrypto'
import {
  GROUP_CALL_PRESENCE_KIND, MAX_GROUP_CALL_PARTICIPANTS,
  PRESENCE_INTERVAL_MS, PRESENCE_EXPIRY_MS,
  buildPresenceEvent, parsePresenceEvent,
  deriveRoster, myOfferWins, deriveJoinState,
  serializeCallStart, parseCallStartPayload,
  type Heartbeat,
} from '../lib/groupCall'

beforeEach(() => { installTestSigner() })
afterEach(() => clearSigner())

const GROUP_ID = 'g'.repeat(64)

describe('presence events', () => {
  it('builds an ephemeral 24103 event tagged to the group with encrypted content', async () => {
    const key = generateGroupKey()
    const event = await buildPresenceEvent(GROUP_ID, key, 'call1', 'audio')
    expect(event.kind).toBe(GROUP_CALL_PRESENCE_KIND)
    expect(event.kind).toBeGreaterThanOrEqual(20000)
    expect(event.kind).toBeLessThan(30000)
    expect(event.tags).toEqual([['e', GROUP_ID]])
    expect(event.content).not.toContain('presence')
  })

  it('round-trips through parse with the group key', async () => {
    const key = generateGroupKey()
    const event = await buildPresenceEvent(GROUP_ID, key, 'call1', 'video')
    expect(await parsePresenceEvent(event, key)).toEqual({ type: 'presence', callId: 'call1', mediaType: 'video' })
  })

  it('returns null for wrong key, wrong kind, or malformed payloads', async () => {
    const key = generateGroupKey()
    const event = await buildPresenceEvent(GROUP_ID, key, 'call1', 'audio')
    expect(await parsePresenceEvent(event, generateGroupKey())).toBeNull()
    expect(await parsePresenceEvent({ ...event, kind: 24100 }, key)).toBeNull()
    const { encryptWithGroupKey } = await import('../lib/groupCrypto')
    const bad = { ...event, content: await encryptWithGroupKey(JSON.stringify({ type: 'presence', callId: '', mediaType: 'audio' }), key) }
    expect(await parsePresenceEvent(bad, key)).toBeNull()
    const longId = { ...event, content: await encryptWithGroupKey(JSON.stringify({ type: 'presence', callId: 'x'.repeat(129), mediaType: 'audio' }), key) }
    expect(await parsePresenceEvent(longId, key)).toBeNull()
    const badMedia = { ...event, content: await encryptWithGroupKey(JSON.stringify({ type: 'presence', callId: 'c', mediaType: 'screen' }), key) }
    expect(await parsePresenceEvent(badMedia, key)).toBeNull()
  })
})

describe('deriveRoster', () => {
  const hb = (callId: string, receivedAt: number): Heartbeat => ({ callId, mediaType: 'audio', receivedAt })

  it('returns null when no live heartbeats exist', () => {
    expect(deriveRoster(new Map(), 1_000_000)).toBeNull()
    const stale = new Map([['pk1', hb('c1', 1_000_000 - PRESENCE_EXPIRY_MS - 1)]])
    expect(deriveRoster(stale, 1_000_000)).toBeNull()
  })

  it('returns live participants sorted, expiring stale ones', () => {
    const now = 1_000_000
    const map = new Map([
      ['pkB', hb('c1', now - 1_000)],
      ['pkA', hb('c1', now - PRESENCE_EXPIRY_MS + 1)],
      ['pkC', hb('c1', now - PRESENCE_EXPIRY_MS - 1)],
    ])
    expect(deriveRoster(map, now)).toEqual({ callId: 'c1', mediaType: 'audio', participants: ['pkA', 'pkB'] })
  })

  it('converges on the lexicographically smallest live callId', () => {
    const now = 1_000_000
    const map = new Map([
      ['pk1', hb('bbb', now - 1_000)],
      ['pk2', hb('aaa', now - 1_000)],
    ])
    expect(deriveRoster(map, now)?.callId).toBe('aaa')
    expect(deriveRoster(map, now)?.participants).toEqual(['pk2'])
  })
})

describe('myOfferWins', () => {
  it('smaller pubkey wins', () => {
    expect(myOfferWins('aaa', 'bbb')).toBe(true)
    expect(myOfferWins('bbb', 'aaa')).toBe(false)
  })
})

describe('deriveJoinState', () => {
  const base = { participants: ['p1', 'p2'], myPubkey: 'me', inCallLocally: false, busyWithDmCall: false }
  it.each([
    ['can-join', base],
    ['in-call', { ...base, inCallLocally: true }],
    ['busy', { ...base, busyWithDmCall: true }],
    ['other-device', { ...base, participants: ['p1', 'me'] }],
    ['full', { ...base, participants: ['1', '2', '3', '4', '5', '6'] }],
  ] as const)('returns %s', (expected, args) => {
    expect(deriveJoinState(args)).toBe(expected)
  })

  it('cap uses MAX_GROUP_CALL_PARTICIPANTS', () => {
    const five = { ...base, participants: ['1', '2', '3', '4', '5'] }
    expect(MAX_GROUP_CALL_PARTICIPANTS).toBe(6)
    expect(deriveJoinState(five)).toBe('can-join')
  })
})

describe('call-start payload', () => {
  it('round-trips', () => {
    expect(parseCallStartPayload(serializeCallStart('c1'))).toEqual({ type: 'call-start', callId: 'c1' })
  })
  it('rejects malformed payloads', () => {
    expect(parseCallStartPayload('not json')).toBeNull()
    expect(parseCallStartPayload(JSON.stringify({ type: 'call-start', callId: '' }))).toBeNull()
    expect(parseCallStartPayload(JSON.stringify({ type: 'call-start', callId: 'x'.repeat(129) }))).toBeNull()
    expect(parseCallStartPayload(JSON.stringify({ type: 'reaction', callId: 'c' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/groupCall.test.ts`
Expected: FAIL — cannot resolve `../lib/groupCall`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/groupCall.ts`:

```ts
import type { Event } from 'nostr-tools'
import type { MediaType } from './webrtc'
import { encryptWithGroupKey, decryptWithGroupKey } from './groupCrypto'
import { requireSigner } from './signer'

// Group call presence: ephemeral range, app's 241xx block (24100 call
// signals, 24101 typing, 24102 read receipts). Relays never store these.
export const GROUP_CALL_PRESENCE_KIND = 24103

// Full mesh: each participant uploads N-1 streams; 6 is the practical
// browser ceiling for video on decent uplinks.
export const MAX_GROUP_CALL_PARTICIPANTS = 6
export const PRESENCE_INTERVAL_MS = 30_000
export const PRESENCE_EXPIRY_MS = 90_000

const MAX_CALL_ID_LEN = 128

export interface GroupCallPresence {
  type: 'presence'
  callId: string
  mediaType: MediaType
}

export async function buildPresenceEvent(
  groupId: string,
  groupKeyHex: string,
  callId: string,
  mediaType: MediaType,
): Promise<Event> {
  const payload: GroupCallPresence = { type: 'presence', callId, mediaType }
  const content = await encryptWithGroupKey(JSON.stringify(payload), groupKeyHex)
  return requireSigner().signEvent({
    kind: GROUP_CALL_PRESENCE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', groupId]],
    content,
  })
}

export async function parsePresenceEvent(event: Event, groupKeyHex: string): Promise<GroupCallPresence | null> {
  if (event.kind !== GROUP_CALL_PRESENCE_KIND) return null
  try {
    const obj = JSON.parse(await decryptWithGroupKey(event.content, groupKeyHex)) as Record<string, unknown>
    if (
      obj.type === 'presence' &&
      typeof obj.callId === 'string' && obj.callId.length > 0 && obj.callId.length <= MAX_CALL_ID_LEN &&
      (obj.mediaType === 'audio' || obj.mediaType === 'video')
    ) return obj as unknown as GroupCallPresence
  } catch { /* wrong key or malformed */ }
  return null
}

// One heartbeat per participant pubkey; receivedAt is local wall-clock ms.
export interface Heartbeat {
  callId: string
  mediaType: MediaType
  receivedAt: number
}

export interface LiveCall {
  callId: string
  mediaType: MediaType
  participants: string[]
}

/**
 * Derive the group's live call from heartbeats. Stale heartbeats (older than
 * PRESENCE_EXPIRY_MS) are ignored. If several callIds are live (concurrent
 * starts), all clients converge on the lexicographically smallest.
 */
export function deriveRoster(heartbeats: ReadonlyMap<string, Heartbeat>, nowMs: number): LiveCall | null {
  const byCall = new Map<string, { mediaType: MediaType; participants: string[] }>()
  for (const [pubkey, hb] of heartbeats) {
    if (nowMs - hb.receivedAt > PRESENCE_EXPIRY_MS) continue
    const entry = byCall.get(hb.callId) ?? { mediaType: hb.mediaType, participants: [] }
    entry.participants.push(pubkey)
    byCall.set(hb.callId, entry)
  }
  if (byCall.size === 0) return null
  const callId = [...byCall.keys()].sort()[0]
  const { mediaType, participants } = byCall.get(callId)!
  return { callId, mediaType, participants: [...participants].sort() }
}

/** Glare tie-break: when both sides of a pair sent offers, the offer from the lexicographically smaller pubkey wins. */
export function myOfferWins(myPubkey: string, theirPubkey: string): boolean {
  return myPubkey < theirPubkey
}

export type JoinState = 'can-join' | 'full' | 'busy' | 'other-device' | 'in-call'

export function deriveJoinState(args: {
  participants: string[]
  myPubkey: string
  inCallLocally: boolean
  busyWithDmCall: boolean
}): JoinState {
  const { participants, myPubkey, inCallLocally, busyWithDmCall } = args
  if (inCallLocally) return 'in-call'
  if (busyWithDmCall) return 'busy'
  if (participants.includes(myPubkey)) return 'other-device'
  if (participants.length >= MAX_GROUP_CALL_PARTICIPANTS) return 'full'
  return 'can-join'
}

// Call-start announcement: a group control message on the existing encrypted
// transport (like reactions/edits). UX only; presence is the source of truth.
export interface CallStartPayload {
  type: 'call-start'
  callId: string
}

export function serializeCallStart(callId: string): string {
  return JSON.stringify({ type: 'call-start', callId } satisfies CallStartPayload)
}

export function parseCallStartPayload(content: string): CallStartPayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (
      obj.type === 'call-start' &&
      typeof obj.callId === 'string' && obj.callId.length > 0 && obj.callId.length <= MAX_CALL_ID_LEN
    ) return obj as CallStartPayload
  } catch { /* not JSON */ }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/groupCall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/groupCall.ts src/__tests__/groupCall.test.ts
git commit -m "feat: group call protocol lib (kind 24103 presence, roster, glare, call-start)"
```

---

### Task 2: Signal extension and 1:1 coexistence

**Files:**
- Modify: `src/lib/webrtc.ts` (CallSignal interface ~line 31, isValidCallSignal ~line 60)
- Modify: `src/store/nostrStore.ts` (state interface, defaults, action)
- Modify: `src/contexts/CallContext.tsx` (handleSignal ~line 327, busy check ~line 331)
- Test: `src/__tests__/webrtc.test.ts` (append), `src/__tests__/store.test.ts` (append)

**Interfaces:**
- Produces (used by Tasks 4-7):
  - `CallSignal.groupId?: string` (validated <=128 chars when present)
  - `isGroupSignal(s: CallSignal): boolean` in `src/lib/webrtc.ts`
  - `type ActiveCallType = 'none' | 'dm' | 'group'` in `src/lib/webrtc.ts`
  - `shouldReplyBusy(isIdle: boolean, activeCallType: ActiveCallType): boolean` in `src/lib/webrtc.ts`
  - Store: `activeCallType: ActiveCallType` (default `'none'`, runtime-only, NOT in partialize), `setActiveCallType(t: ActiveCallType): void`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/webrtc.test.ts` (it already imports from `../lib/webrtc` and installs a test signer — follow the file's existing import style, adding `isGroupSignal`, `shouldReplyBusy`, `buildCallSignalEvent`, `decryptCallSignal` if not present):

```ts
describe('group signal extension', () => {
  it('accepts a signal with a valid groupId and preserves it through encrypt/decrypt', async () => {
    const me = getSigner()!.pubkey
    const event = await buildCallSignalEvent(me, { type: 'call-offer', callId: 'c1', groupId: 'g1', mediaType: 'audio', sdp: 'sdp' })
    const parsed = await decryptCallSignal(me, event.content)
    expect(parsed).not.toBeNull()
    expect(parsed!.groupId).toBe('g1')
  })

  it('rejects invalid groupId values', async () => {
    const me = getSigner()!.pubkey
    for (const groupId of ['', 'x'.repeat(129), 42 as unknown as string]) {
      const event = await buildCallSignalEvent(me, { type: 'call-offer', callId: 'c1', groupId, sdp: 'sdp' })
      expect(await decryptCallSignal(me, event.content)).toBeNull()
    }
  })

  it('isGroupSignal detects the groupId marker', () => {
    expect(isGroupSignal({ type: 'call-end', callId: 'c' })).toBe(false)
    expect(isGroupSignal({ type: 'call-end', callId: 'c', groupId: 'g' })).toBe(true)
  })
})

describe('shouldReplyBusy', () => {
  it.each([
    [false, true, 'none'],
    [true, false, 'none'],
    [true, true, 'group'],
    [false, false, 'dm'],
  ] as const)('returns %s for isIdle=%s activeCallType=%s', (expected, isIdle, act) => {
    expect(shouldReplyBusy(isIdle, act)).toBe(expected)
  })
})
```

Append to `src/__tests__/store.test.ts`:

```ts
describe('activeCallType', () => {
  it('defaults to none and is settable', () => {
    useNostrStore.setState({ activeCallType: 'none' })
    useNostrStore.getState().setActiveCallType('group')
    expect(useNostrStore.getState().activeCallType).toBe('group')
    useNostrStore.getState().setActiveCallType('none')
    expect(useNostrStore.getState().activeCallType).toBe('none')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/webrtc.test.ts src/__tests__/store.test.ts`
Expected: FAIL — `isGroupSignal` / `shouldReplyBusy` not exported; `setActiveCallType` not a function; groupId stripped/rejected paths absent.

- [ ] **Step 3: Implement**

3a. `src/lib/webrtc.ts` — extend `CallSignal` (~line 31):

```ts
export interface CallSignal {
  type: CallSignalType
  callId: string
  groupId?: string          // present on group-call signals; absent on 1:1
  mediaType?: MediaType
  sdp?: string
  candidate?: RTCIceCandidateInit
  reason?: 'rejected' | 'busy' | 'ended'
  iceServers?: RTCIceServer[]
}
```

In `isValidCallSignal`, after the `callId` check add:

```ts
  if (s.groupId !== undefined) {
    if (typeof s.groupId !== 'string' || s.groupId.length === 0 || s.groupId.length > MAX_CALL_ID_LEN) return false
  }
```

At the end of the file add:

```ts
export function isGroupSignal(s: CallSignal): boolean {
  return s.groupId !== undefined
}

export type ActiveCallType = 'none' | 'dm' | 'group'

/** A 1:1 offer gets a busy reply when a 1:1 call is active or a group call holds the media. */
export function shouldReplyBusy(isIdle: boolean, activeCallType: ActiveCallType): boolean {
  return !isIdle || activeCallType === 'group'
}
```

3b. `src/store/nostrStore.ts`:
- Import `type ActiveCallType` from `../lib/webrtc`.
- State interface, next to `signerCaps` (~line 179): `activeCallType: ActiveCallType` with comment `// Which call engine holds the media (runtime-only, never persisted)`.
- Actions interface: `setActiveCallType: (t: ActiveCallType) => void`.
- Defaults (next to `signerCaps: { nip04: true },`): `activeCallType: 'none',`.
- Implementation (next to `setSignerCaps`): `setActiveCallType: (t) => set({ activeCallType: t }),`.
- Do NOT add to `partialize`.

3c. `src/contexts/CallContext.tsx`:
- Add `isGroupSignal, shouldReplyBusy` to the existing `../lib/webrtc` import.
- Top of `handleSignal` (~line 328), right after `if (!getSigner()) return`:

```ts
    if (isGroupSignal(signal)) return  // group engine owns these
```

- Replace the busy check inside the `call-offer` branch (`if (callStateRef.current !== 'idle') {`) with:

```ts
      if (shouldReplyBusy(callStateRef.current === 'idle', useNostrStore.getState().activeCallType)) {
```

- Sync the flag: add this effect after the existing `useEffect(() => { callStateRef.current = callState }, [callState])`:

```ts
  // Publish 1:1 call activity so the group engine can mutually exclude
  useEffect(() => {
    const { activeCallType, setActiveCallType } = useNostrStore.getState()
    if (callState !== 'idle') setActiveCallType('dm')
    else if (activeCallType === 'dm') setActiveCallType('none')
  }, [callState])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/webrtc.test.ts src/__tests__/store.test.ts src/__tests__/callState.test.ts`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/webrtc.ts src/store/nostrStore.ts src/contexts/CallContext.tsx src/__tests__/webrtc.test.ts src/__tests__/store.test.ts
git commit -m "feat: groupId on call signals, activeCallType store flag, 1:1 busy coexistence"
```

---

### Task 3: call-start announcement routing

**Files:**
- Modify: `src/lib/inbox.ts` (add `routeCallStart`, wire into `processGroupEvent` ~line 359)
- Modify: `src/hooks/useNostrSubscriptions.ts` (add `sendGroupCallStart` next to `sendGroupReaction` ~line 271)
- Test: `src/__tests__/inbox.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 `serializeCallStart`/`parseCallStartPayload`; existing `sendGroupControl(content, groupId, groupKey, relays)`, `claimSideEffects`, `shouldCountUnread`, `fireNotification`, `updateGroupLastMessage`.
- Produces: `sendGroupCallStart(callId: string, groupId: string, groupKey: string, relays: string[]): Promise<Event>` (used by Task 4). Incoming call-start messages render no bubble, set the group preview to "Call started", and fire a group notification when live and not own.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/inbox.test.ts`. The file's `beforeEach` already resets the store (including `groups: []`, `groupKeys: {}`) and it already imports `finalizeEvent`, `generateSecretKey` from nostr-tools; add `processGroupEvent` to the existing `../lib/inbox` import, and add imports for `serializeCallStart` (`../lib/groupCall`), `generateGroupKey`/`encryptWithGroupKey` (`../lib/groupCrypto`):

```ts
describe('processGroupEvent call-start control messages', () => {
  const GROUP_ID = 'grp1'

  async function makeGroupEvent(plaintext: string, key: string): Promise<Event> {
    const senderSk = generateSecretKey()
    const content = await encryptWithGroupKey(plaintext, key)
    return finalizeEvent({
      kind: 1042,
      created_at: 1000,
      tags: [['e', GROUP_ID, RELAYS[0], 'root']],
      content,
    }, senderSk)
  }

  function seedGroup() {
    useNostrStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test group', creatorPubkey: 'p', memberPubkeys: [], relayUrl: RELAYS[0], unread: 0 }],
    })
  }

  it('routes call-start: no message stored, preview updated', async () => {
    const key = generateGroupKey()
    seedGroup()
    const event = await makeGroupEvent(serializeCallStart('c1'), key)
    await processGroupEvent(event, GROUP_ID, key, RELAYS, { live: false })

    const state = useNostrStore.getState()
    expect(state.messages[GROUP_ID] ?? []).toHaveLength(0)
    expect(state.groups.find(g => g.id === GROUP_ID)?.lastMessage).toBe('Call started')
  })

  it('treats malformed call-start payloads as normal messages', async () => {
    const key = generateGroupKey()
    seedGroup()
    const bad = JSON.stringify({ type: 'call-start', callId: '' })
    const event = await makeGroupEvent(bad, key)
    await processGroupEvent(event, GROUP_ID, key, RELAYS, { live: false })

    expect((useNostrStore.getState().messages[GROUP_ID] ?? []).length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/inbox.test.ts`
Expected: FAIL — call-start plaintext is stored as a normal message ("Call started" preview missing / message count 1 instead of 0).

- [ ] **Step 3: Implement**

3a. `src/lib/inbox.ts` — import `parseCallStartPayload` from `./groupCall`, then add next to `routeMessageOp`:

```ts
/** Route a group call-start announcement: preview + notification, no message bubble. */
function routeCallStart(content: string, groupId: string, event: Event, live: boolean): boolean {
  const payload = parseCallStartPayload(content)
  if (!payload) return false
  if (claimSideEffects(event.id)) {
    const { publicKey, groups, profiles, updateGroupLastMessage } = useNostrStore.getState()
    updateGroupLastMessage(groupId, 'Call started', event.created_at, false, {
      incrementUnread: shouldCountUnread(groupId, event.created_at, live),
    })
    if (live && event.pubkey !== publicKey) {
      const groupName = groups.find((g: Group) => g.id === groupId)?.name || 'Group'
      fireNotification(groupId, 'channel', groupName, `${getDisplayName(profiles[event.pubkey], event.pubkey)} started a call`)
    }
  }
  return true
}
```

3b. In `processGroupEvent` (~line 359), after `if (routeMessageOp(plaintext, event)) return` add:

```ts
  if (routeCallStart(plaintext, groupId, event, opts.live)) return
```

3c. `src/hooks/useNostrSubscriptions.ts` — import `serializeCallStart` from `../lib/groupCall`, add after `sendGroupReaction`:

```ts
export async function sendGroupCallStart(callId: string, groupId: string, groupKey: string, relays: string[]) {
  return sendGroupControl(serializeCallStart(callId), groupId, groupKey, relays)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/inbox.test.ts`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbox.ts src/hooks/useNostrSubscriptions.ts src/__tests__/inbox.test.ts
git commit -m "feat: route group call-start announcements (preview + notification, no bubble)"
```

---

### Task 4: GroupCallContext — presence core

**Files:**
- Create: `src/contexts/GroupCallContext.tsx`
- Modify: `src/lib/webrtc.ts` (add `getCallUserMedia` helper at end of file)
- Test: `src/__tests__/GroupCallContext.test.tsx`

**Interfaces:**
- Consumes: Task 1 lib, Task 2 store flag, Task 3 `sendGroupCallStart`; `subscribeEvents`/`publishEvent` from `src/lib/nostr.ts`; `useReadRelays`; `getSigner`.
- Produces (Tasks 5-7 rely on these exact names):

```ts
export type GroupCallState = 'idle' | 'in-call'
export interface GroupCallContextValue {
  groupCallState: GroupCallState
  activeGroupId: string | null
  callId: string | null
  mediaType: MediaType
  liveCall: LiveCall | null          // for the watched group (banner)
  joinState: JoinState               // for the watched group
  localStream: MediaStream | null
  remoteStreams: ReadonlyMap<string, MediaStream>
  peerStates: ReadonlyMap<string, 'connecting' | 'connected' | 'failed'>
  isMuted: boolean
  isCameraOff: boolean
  duration: number
  watchGroup: (groupId: string | null) => void
  startOrJoin: (groupId: string, requested: MediaType) => void
  leave: () => void
  toggleMute: () => void
  toggleCamera: () => void
}
export function useGroupCallContext(): GroupCallContextValue
export function GroupCallProvider({ children }: { children: ReactNode }): JSX element
```

In this task `remoteStreams`/`peerStates` stay empty and two mesh hook points are no-op functions Task 5 fills: `connectToPeers(pubkeys: string[])` and `teardownMesh()` (both defined with bodies containing only a comment `// mesh wired in the next task`).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/GroupCallContext.test.tsx`:

```tsx
import { it, expect, vi, beforeEach, afterEach, describe } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import type { Event } from 'nostr-tools'

const publishEvent = vi.fn(async () => {})
const subCallbacks: Array<(e: Event) => void> = []
const subscribeEvents = vi.fn((_r: unknown, _f: unknown, cb: (e: Event) => void) => {
  subCallbacks.push(cb)
  return { close: vi.fn() }
})
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    publishEvent: (...a: unknown[]) => publishEvent(...(a as [])),
    subscribeEvents: (...a: unknown[]) => (subscribeEvents as unknown as (...x: unknown[]) => unknown)(...a),
  }
})
const sendGroupCallStart = vi.fn(async () => ({}))
vi.mock('../hooks/useNostrSubscriptions', () => ({
  sendGroupCallStart: (...a: unknown[]) => sendGroupCallStart(...(a as [])),
}))

import { GroupCallProvider, useGroupCallContext } from '../contexts/GroupCallContext'
import { useNostrStore } from '../store/nostrStore'
import { installTestSigner } from '../test/signer'
import { clearSigner, getSigner } from '../lib/signer'
import { generateGroupKey, encryptWithGroupKey } from '../lib/groupCrypto'
import { GROUP_CALL_PRESENCE_KIND } from '../lib/groupCall'

const GROUP_ID = 'g'.repeat(64)
const KEY = generateGroupKey()

function fakeStream() {
  return {
    getTracks: () => [],
    getAudioTracks: () => [],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

function Probe() {
  const ctx = useGroupCallContext()
  return (
    <div>
      <span data-testid="state">{ctx.groupCallState}</span>
      <span data-testid="join">{ctx.joinState}</span>
      <span data-testid="live">{ctx.liveCall ? ctx.liveCall.participants.length : 'none'}</span>
      <button onClick={() => ctx.watchGroup(GROUP_ID)}>watch</button>
      <button onClick={() => ctx.startOrJoin(GROUP_ID, 'audio')}>join</button>
      <button onClick={() => ctx.leave()}>leave</button>
    </div>
  )
}

async function presenceEvent(pubkey: string, callId: string): Promise<Event> {
  const content = await encryptWithGroupKey(JSON.stringify({ type: 'presence', callId, mediaType: 'audio' }), KEY)
  return {
    id: Math.random().toString(36).slice(2), pubkey, created_at: Math.floor(Date.now() / 1000),
    kind: GROUP_CALL_PRESENCE_KIND, tags: [['e', GROUP_ID]], content, sig: 'sig',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  subCallbacks.length = 0
  installTestSigner()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream()) },
  })
  useNostrStore.setState({
    publicKey: getSigner()!.pubkey,
    groupKeys: { [GROUP_ID]: KEY },
    relays: ['wss://test.example'],
    relayModes: {},
    activeCallType: 'none',
  })
})
afterEach(() => clearSigner())

it('watchGroup subscribes to presence for the group', async () => {
  render(<GroupCallProvider><Probe /></GroupCallProvider>)
  act(() => screen.getByText('watch').click())
  await waitFor(() => {
    expect(subscribeEvents).toHaveBeenCalledWith(
      expect.anything(),
      { kinds: [GROUP_CALL_PRESENCE_KIND], '#e': [GROUP_ID] },
      expect.any(Function),
    )
  })
})

it('derives the live call and joinState from incoming heartbeats', async () => {
  render(<GroupCallProvider><Probe /></GroupCallProvider>)
  act(() => screen.getByText('watch').click())
  await waitFor(() => expect(subCallbacks.length).toBeGreaterThan(0))
  const e = await presenceEvent('a'.repeat(64), 'c1')
  await act(async () => { subCallbacks.forEach(cb => cb(e)) })
  await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('1'))
  expect(screen.getByTestId('join').textContent).toBe('can-join')
})

it('startOrJoin publishes a presence heartbeat and the call-start announcement when starting fresh', async () => {
  render(<GroupCallProvider><Probe /></GroupCallProvider>)
  act(() => screen.getByText('join').click())
  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('in-call'))
  await waitFor(() => {
    const kinds = publishEvent.mock.calls.map(c => (c[1] as Event).kind)
    expect(kinds).toContain(GROUP_CALL_PRESENCE_KIND)
  })
  expect(sendGroupCallStart).toHaveBeenCalledTimes(1)
  expect(useNostrStore.getState().activeCallType).toBe('group')
})

it('leave stops the call and clears the busy flag', async () => {
  render(<GroupCallProvider><Probe /></GroupCallProvider>)
  act(() => screen.getByText('join').click())
  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('in-call'))
  act(() => screen.getByText('leave').click())
  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('idle'))
  expect(useNostrStore.getState().activeCallType).toBe('none')
})

describe('join refusals', () => {
  it('refuses when a 1:1 call is active', async () => {
    useNostrStore.setState({ activeCallType: 'dm' })
    render(<GroupCallProvider><Probe /></GroupCallProvider>)
    act(() => screen.getByText('join').click())
    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByTestId('state').textContent).toBe('idle')
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('refuses when the roster is full', async () => {
    render(<GroupCallProvider><Probe /></GroupCallProvider>)
    act(() => screen.getByText('watch').click())
    await waitFor(() => expect(subCallbacks.length).toBeGreaterThan(0))
    for (let i = 0; i < 6; i++) {
      const e = await presenceEvent(String(i).repeat(64), 'c1')
      await act(async () => { subCallbacks.forEach(cb => cb(e)) })
    }
    await waitFor(() => expect(screen.getByTestId('join').textContent).toBe('full'))
    act(() => screen.getByText('join').click())
    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })

  it('aborts cleanly when getUserMedia fails (no heartbeat published)', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('denied'))
    render(<GroupCallProvider><Probe /></GroupCallProvider>)
    act(() => screen.getByText('join').click())
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('idle'))
    expect(publishEvent).not.toHaveBeenCalled()
    expect(useNostrStore.getState().activeCallType).toBe('none')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/GroupCallContext.test.tsx`
Expected: FAIL — cannot resolve `../contexts/GroupCallContext`.

- [ ] **Step 3: Implement**

3a. Add to the end of `src/lib/webrtc.ts` (shared with the 1:1 provider later if desired; used by GroupCallContext now):

```ts
/** getUserMedia honoring the user's saved device preferences (same logic as the 1:1 call path). */
export async function getCallUserMedia(type: MediaType): Promise<MediaStream> {
  const [audioSetting, videoSetting] = await Promise.all([
    getSetting<string>('media_audio_device', ''),
    getSetting<string>('media_video_device', ''),
  ])
  const audioId = audioSetting || undefined
  const videoId = videoSetting || undefined
  return navigator.mediaDevices.getUserMedia({
    audio: audioId ? { deviceId: { ideal: audioId } } : true,
    video: type === 'video'
      ? { width: 1280, height: 720, ...(videoId ? { deviceId: { ideal: videoId } } : { facingMode: 'user' as const }) }
      : false,
  })
}
```

3b. Create `src/contexts/GroupCallContext.tsx`:

```tsx
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react'
import { subscribeEvents, publishEvent } from '../lib/nostr'
import { useNostrStore } from '../store/nostrStore'
import { useReadRelays } from '../hooks/useRelays'
import { getSigner } from '../lib/signer'
import { sendGroupCallStart } from '../hooks/useNostrSubscriptions'
import { getCallUserMedia, type MediaType } from '../lib/webrtc'
import {
  GROUP_CALL_PRESENCE_KIND, PRESENCE_INTERVAL_MS,
  buildPresenceEvent, parsePresenceEvent, deriveRoster, deriveJoinState,
  type Heartbeat, type LiveCall, type JoinState,
} from '../lib/groupCall'

export type GroupCallState = 'idle' | 'in-call'

// Roster staleness is re-evaluated on this cadence even without new events.
const ROSTER_TICK_MS = 10_000

export interface GroupCallContextValue {
  groupCallState: GroupCallState
  activeGroupId: string | null
  callId: string | null
  mediaType: MediaType
  liveCall: LiveCall | null
  joinState: JoinState
  localStream: MediaStream | null
  remoteStreams: ReadonlyMap<string, MediaStream>
  peerStates: ReadonlyMap<string, 'connecting' | 'connected' | 'failed'>
  isMuted: boolean
  isCameraOff: boolean
  duration: number
  watchGroup: (groupId: string | null) => void
  startOrJoin: (groupId: string, requested: MediaType) => void
  leave: () => void
  toggleMute: () => void
  toggleCamera: () => void
}

const GroupCallContext = createContext<GroupCallContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components -- co-locating the consumer hook with its provider, matching CallContext
export function useGroupCallContext() {
  const ctx = useContext(GroupCallContext)
  if (!ctx) throw new Error('useGroupCallContext must be within GroupCallProvider')
  return ctx
}

export function GroupCallProvider({ children }: { children: ReactNode }) {
  const publicKey = useNostrStore(s => s.publicKey)
  const readR = useReadRelays()

  const [groupCallState, setGroupCallState] = useState<GroupCallState>('idle')
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [watchedGroupId, setWatchedGroupId] = useState<string | null>(null)
  const [liveCall, setLiveCall] = useState<LiveCall | null>(null)
  const [mediaType, setMediaType] = useState<MediaType>('audio')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [peerStates, setPeerStates] = useState<Map<string, 'connecting' | 'connected' | 'failed'>>(new Map())
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [duration, setDuration] = useState(0)

  // groupId -> pubkey -> latest heartbeat
  const heartbeatsRef   = useRef<Map<string, Map<string, Heartbeat>>>(new Map())
  const callIdRef       = useRef('')
  const activeGroupRef  = useRef<string | null>(null)
  const localStreamRef  = useRef<MediaStream | null>(null)
  const heartbeatTimer  = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationTimer   = useRef<ReturnType<typeof setInterval> | null>(null)
  const stateRef        = useRef<GroupCallState>('idle')
  useEffect(() => { stateRef.current = groupCallState }, [groupCallState])

  const recomputeWatched = useCallback(() => {
    const gid = watchedGroupId
    if (!gid) { setLiveCall(null); return }
    setLiveCall(deriveRoster(heartbeatsRef.current.get(gid) ?? new Map(), Date.now()))
  }, [watchedGroupId])

  // ── Mesh hook points (wired in the next task) ─────────────────────────────
  const connectToPeers = useCallback((_pubkeys: string[]) => {
    // mesh wired in the next task
  }, [])
  const teardownMesh = useCallback(() => {
    // mesh wired in the next task
  }, [])

  // ── Presence subscriptions: watched group + active call group ─────────────
  const subscribedIds = [...new Set([watchedGroupId, activeGroupId].filter((x): x is string => !!x))]
  const subKey = subscribedIds.join(',')
  useEffect(() => {
    if (!publicKey || subscribedIds.length === 0) return
    const subs = subscribedIds.map(gid => {
      const key = useNostrStore.getState().groupKeys[gid]
      if (!key) return null
      return subscribeEvents(
        readR,
        { kinds: [GROUP_CALL_PRESENCE_KIND], '#e': [gid] },
        (event) => {
          void parsePresenceEvent(event, key).then(p => {
            if (!p) return
            const perGroup = heartbeatsRef.current.get(gid) ?? new Map<string, Heartbeat>()
            perGroup.set(event.pubkey, { callId: p.callId, mediaType: p.mediaType, receivedAt: Date.now() })
            heartbeatsRef.current.set(gid, perGroup)
            recomputeWatched()
          })
        },
      )
    })
    const tick = setInterval(recomputeWatched, ROSTER_TICK_MS)
    return () => {
      subs.forEach(s => s?.close())
      clearInterval(tick)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- subKey stands in for subscribedIds
  }, [publicKey, readR, subKey, recomputeWatched])

  // ── Own heartbeat while in a call ─────────────────────────────────────────
  const mediaTypeRef = useRef<MediaType>('audio')
  useEffect(() => { mediaTypeRef.current = mediaType }, [mediaType])

  const publishHeartbeat = useCallback(() => {
    const gid = activeGroupRef.current
    const key = gid ? useNostrStore.getState().groupKeys[gid] : undefined
    if (!gid || !key || !callIdRef.current || !getSigner()) return
    void (async () => {
      const me = useNostrStore.getState().publicKey
      const type = mediaTypeRef.current
      const callId = callIdRef.current
      const event = await buildPresenceEvent(gid, key, callId, type)
      void publishEvent(useNostrStore.getState().writeRelays(), event).catch(() => {})
      // Record our own heartbeat locally so our roster includes us immediately
      if (me) {
        const perGroup = heartbeatsRef.current.get(gid) ?? new Map<string, Heartbeat>()
        perGroup.set(me, { callId, mediaType: type, receivedAt: Date.now() })
        heartbeatsRef.current.set(gid, perGroup)
        recomputeWatched()
      }
    })()
  }, [recomputeWatched])

  // ── Cleanup ────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    teardownMesh()
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    setLocalStream(null)
    setRemoteStreams(new Map())
    setPeerStates(new Map())
    setIsMuted(false)
    setIsCameraOff(false)
    setDuration(0)
    if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null }
    if (durationTimer.current) { clearInterval(durationTimer.current); durationTimer.current = null }
    // Drop our own heartbeat so the local roster reflects the leave at once
    const gid = activeGroupRef.current
    const me = useNostrStore.getState().publicKey
    if (gid && me) heartbeatsRef.current.get(gid)?.delete(me)
    callIdRef.current = ''
    activeGroupRef.current = null
    setActiveGroupId(null)
    setGroupCallState('idle')
    if (useNostrStore.getState().activeCallType === 'group') {
      useNostrStore.getState().setActiveCallType('none')
    }
    recomputeWatched()
  }, [teardownMesh, recomputeWatched])

  // ── Public actions ─────────────────────────────────────────────────────────
  const watchGroup = useCallback((groupId: string | null) => {
    setWatchedGroupId(groupId)
  }, [])

  const startOrJoin = useCallback(async (groupId: string, requested: MediaType) => {
    if (stateRef.current !== 'idle') return
    const store = useNostrStore.getState()
    if (store.activeCallType === 'dm') return
    if (!getSigner() || !store.publicKey || !store.groupKeys[groupId]) return

    const roster = deriveRoster(heartbeatsRef.current.get(groupId) ?? new Map(), Date.now())
    const state = deriveJoinState({
      participants: roster?.participants ?? [],
      myPubkey: store.publicKey,
      inCallLocally: false,
      busyWithDmCall: false,
    })
    if (state !== 'can-join') return

    const isStart = roster === null
    const callId = roster?.callId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const type = roster?.mediaType ?? requested

    try {
      const stream = await getCallUserMedia(type)
      localStreamRef.current = stream
      setLocalStream(stream)
    } catch {
      return // getUserMedia failed: abort before any heartbeat
    }

    callIdRef.current = callId
    activeGroupRef.current = groupId
    setActiveGroupId(groupId)
    setMediaType(type)
    mediaTypeRef.current = type
    setGroupCallState('in-call')
    store.setActiveCallType('group')

    publishHeartbeat()
    heartbeatTimer.current = setInterval(publishHeartbeat, PRESENCE_INTERVAL_MS)
    if (!durationTimer.current) durationTimer.current = setInterval(() => setDuration(d => d + 1), 1000)

    if (isStart) {
      void sendGroupCallStart(callId, groupId, store.groupKeys[groupId], store.writeRelays()).catch(() => {})
    }
    connectToPeers((roster?.participants ?? []).filter(p => p !== store.publicKey))
  }, [publishHeartbeat, connectToPeers])

  const leave = useCallback(() => {
    cleanup()
  }, [cleanup])

  const toggleMute = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled })
    setIsMuted(m => !m)
  }, [])

  const toggleCamera = useCallback(() => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled })
    setIsCameraOff(v => !v)
  }, [])

  // Cleanup on unmount
  useEffect(() => () => { cleanup() }, [cleanup])

  const activeCallType = useNostrStore(s => s.activeCallType)
  const myPubkey = publicKey ?? ''
  const joinState = deriveJoinState({
    participants: liveCall?.participants ?? [],
    myPubkey,
    inCallLocally: groupCallState === 'in-call' && activeGroupId === watchedGroupId,
    busyWithDmCall: activeCallType === 'dm',
  })

  return (
    <GroupCallContext.Provider value={{
      groupCallState, activeGroupId, callId: callIdRef.current || null, mediaType,
      liveCall, joinState,
      localStream, remoteStreams, peerStates,
      isMuted, isCameraOff, duration,
      watchGroup, startOrJoin, leave, toggleMute, toggleCamera,
    }}>
      {children}
    </GroupCallContext.Provider>
  )
}
```

Note: `const activeCallType = useNostrStore(s => s.activeCallType)` is an unconditional top-level hook call (it appears after the callbacks but before the return; order is stable across renders, which is all the rules of hooks require).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/GroupCallContext.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/contexts/GroupCallContext.tsx src/lib/webrtc.ts src/__tests__/GroupCallContext.test.tsx
git commit -m "feat: GroupCallContext presence core (watch, heartbeat, roster, join gating)"
```

---

### Task 5: GroupCallContext — WebRTC mesh

**Files:**
- Modify: `src/contexts/GroupCallContext.tsx` (fill `connectToPeers`/`teardownMesh`, add signal handling)
- Test: `src/__tests__/GroupCallMesh.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`CallSignal.groupId`, `buildCallSignalEvent`, `decryptCallSignal`, `CALL_SIGNAL_KIND`, `fetchCallIceServers`, `mergeIceServers`), Task 1 `myOfferWins`, `PRESENCE_EXPIRY_MS`.
- Produces: working mesh — `remoteStreams` and `peerStates` populate; incoming group offers for the active call are auto-answered; `leave()` sends `call-end` to connected peers.

Implementation contract (all inside `GroupCallProvider`):

1. Refs: `peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())`, `pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())`, `pendingOffersRef = useRef<Set<string>>(new Set())`, `iceServersRef = useRef<RTCIceServer[]>([])`.
2. `sendSignal(peerPubkey, signal)`: `buildCallSignalEvent` + `publishEvent(writeRelays())`, exactly like CallContext's helper; every group signal carries `groupId: activeGroupRef.current` and `callId: callIdRef.current`.
3. `createPeer(peerPubkey)`: `new RTCPeerConnection({ iceServers: iceServersRef.current })`; `onicecandidate` sends `ice-candidate` signals; `ontrack` puts `streams[0]` into `remoteStreams` under `peerPubkey`; `onconnectionstatechange`: `connected` sets peerStates connected; `failed`/`disconnected` marks that peer `failed` and closes only that connection (per-peer isolation). Store in `peersRef`.
4. `connectToPeers(pubkeys)`: fetch `iceServersRef.current = await fetchCallIceServers()` once, then for each pubkey: `createPeer`, add local tracks, `createOffer`/`setLocalDescription`, add to `pendingOffersRef`, mark peerStates `connecting`, send `call-offer` with `mediaType`, `sdp`, `iceServers`.
5. `teardownMesh()`: send `call-end` (`reason: 'ended'`) to every pubkey in `peersRef`, close all connections, clear all three refs.
6. Group signal subscription effect (only while `groupCallState === 'in-call'`): subscribe `{ kinds: [CALL_SIGNAL_KIND], '#p': [publicKey] }`, decrypt with `decryptCallSignal`, ignore unless `signal.groupId === activeGroupRef.current && signal.callId === callIdRef.current`. Handle:
   - `call-offer` (late joiner or glare): if `pendingOffersRef.has(sender)` and `myOfferWins(me, sender)` → ignore (they will answer mine). Otherwise (no pending offer, or they win): close any existing pc for sender, `createPeer`, add local tracks, `mergeIceServers` local + `signal.iceServers ?? []` is NOT needed (we already have ours) — just answer: `setRemoteDescription(offer)`, flush that sender's pending candidates, `createAnswer`/`setLocalDescription`, send `call-answer`, remove sender from `pendingOffersRef`.
   - `call-answer`: pc = peersRef.get(sender); `setRemoteDescription(answer)`, flush pending candidates, delete from `pendingOffersRef`.
   - `ice-candidate`: add if pc has remoteDescription, else buffer per sender in `pendingCandidatesRef`.
   - `call-end`: close and fully remove that peer (streams, states, refs).
7. Roster sweep: in the existing `ROSTER_TICK_MS` tick, for the active group compute the roster and close+remove any peer connection whose pubkey is no longer in it (heartbeat expiry fallback).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/GroupCallMesh.test.tsx`. Stub WebRTC globals before importing the provider:

```tsx
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import type { Event } from 'nostr-tools'

class FakePC {
  static instances: FakePC[] = []
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null
  ontrack: ((e: { streams: MediaStream[] }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  connectionState = 'new'
  remoteDescription: unknown = null
  localDescription: unknown = null
  closed = false
  addedTracks: unknown[] = []
  constructor(public config: unknown) { FakePC.instances.push(this) }
  addTrack(t: unknown) { this.addedTracks.push(t) }
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' } }
  async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' } }
  async setLocalDescription(d: unknown) { this.localDescription = d }
  async setRemoteDescription(d: unknown) { this.remoteDescription = d }
  async addIceCandidate(_c: unknown) {}
  getSenders() { return [] }
  close() { this.closed = true }
}
vi.stubGlobal('RTCPeerConnection', FakePC as unknown as typeof RTCPeerConnection)
vi.stubGlobal('RTCIceCandidate', class { constructor(public c: unknown) {} } as unknown as typeof RTCIceCandidate)

const publishEvent = vi.fn(async () => {})
const subCallbacks = new Map<string, (e: Event) => void>()
const subscribeEvents = vi.fn((_r: unknown, filter: { kinds: number[] }, cb: (e: Event) => void) => {
  subCallbacks.set(filter.kinds.join(','), cb)
  return { close: vi.fn() }
})
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    publishEvent: (...a: unknown[]) => publishEvent(...(a as [])),
    subscribeEvents: (...a: unknown[]) => (subscribeEvents as unknown as (...x: unknown[]) => unknown)(...a),
  }
})
vi.mock('../hooks/useNostrSubscriptions', () => ({ sendGroupCallStart: vi.fn(async () => ({})) }))

import { GroupCallProvider, useGroupCallContext } from '../contexts/GroupCallContext'
import { useNostrStore } from '../store/nostrStore'
import { installTestSigner } from '../test/signer'
import { clearSigner, getSigner, LocalSigner } from '../lib/signer'
import { generateSecretKey } from 'nostr-tools'
import { generateGroupKey, encryptWithGroupKey } from '../lib/groupCrypto'
import { GROUP_CALL_PRESENCE_KIND } from '../lib/groupCall'
import { CALL_SIGNAL_KIND as SIGNAL_KIND, type CallSignal } from '../lib/webrtc'

const GROUP_ID = 'g'.repeat(64)
const KEY = generateGroupKey()
// A real second keypair so peer-authored signals can be NIP-04 encrypted to us.
const peerSigner = new LocalSigner(generateSecretKey())
const PEER = peerSigner.pubkey

/** Build a signal event authored by PEER, encrypted to the test signer. */
async function peerSignal(signal: CallSignal, from = peerSigner): Promise<Event> {
  const me = getSigner()!.pubkey
  const content = await from.nip04Encrypt(me, JSON.stringify(signal))
  return {
    id: Math.random().toString(36).slice(2), pubkey: from.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: SIGNAL_KIND, tags: [['p', me]], content, sig: 'sig',
  }
}

function fakeStream() {
  return { getTracks: () => [{ stop: vi.fn(), kind: 'audio', enabled: true }], getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream
}

function Probe() {
  const ctx = useGroupCallContext()
  return (
    <div>
      <span data-testid="state">{ctx.groupCallState}</span>
      <span data-testid="peers">{[...ctx.peerStates.keys()].join(',')}</span>
      <button onClick={() => ctx.watchGroup(GROUP_ID)}>watch</button>
      <button onClick={() => ctx.startOrJoin(GROUP_ID, 'audio')}>join</button>
      <button onClick={() => ctx.leave()}>leave</button>
    </div>
  )
}

async function presenceEvent(pubkey: string, callId: string): Promise<Event> {
  const content = await encryptWithGroupKey(JSON.stringify({ type: 'presence', callId, mediaType: 'audio' }), KEY)
  return { id: Math.random().toString(36).slice(2), pubkey, created_at: Math.floor(Date.now() / 1000), kind: GROUP_CALL_PRESENCE_KIND, tags: [['e', GROUP_ID]], content, sig: 'sig' }
}

beforeEach(() => {
  vi.clearAllMocks()
  FakePC.instances.length = 0
  subCallbacks.clear()
  installTestSigner()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => fakeStream()) } })
  useNostrStore.setState({
    publicKey: getSigner()!.pubkey,
    groupKeys: { [GROUP_ID]: KEY },
    relays: ['wss://test.example'], relayModes: {}, activeCallType: 'none',
  })
})
afterEach(() => clearSigner())

async function joinWithRoster() {
  render(<GroupCallProvider><Probe /></GroupCallProvider>)
  act(() => screen.getByText('watch').click())
  await waitFor(() => expect(subCallbacks.has(String(GROUP_CALL_PRESENCE_KIND))).toBe(true))
  const e = await presenceEvent(PEER, 'c1')
  await act(async () => { subCallbacks.get(String(GROUP_CALL_PRESENCE_KIND))!(e) })
  act(() => screen.getByText('join').click())
  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('in-call'))
}

function signalEvents(): Event[] {
  return publishEvent.mock.calls.map(c => c[1] as Event).filter(ev => ev.kind === SIGNAL_KIND)
}

async function deliverSignal(e: Event) {
  await waitFor(() => expect(subCallbacks.has(String(SIGNAL_KIND))).toBe(true))
  await act(async () => { subCallbacks.get(String(SIGNAL_KIND))!(e) })
}

it('joining sends one group call-offer per roster member', async () => {
  await joinWithRoster()
  await waitFor(() => {
    expect(signalEvents().length).toBe(1)
    expect(signalEvents()[0].tags).toEqual([['p', PEER]])
  })
  expect(FakePC.instances.length).toBe(1)
})

it('an incoming call-answer completes the pending connection without creating a new PC', async () => {
  await joinWithRoster()
  await waitFor(() => expect(FakePC.instances.length).toBe(1))
  const callId = 'c1'
  await deliverSignal(await peerSignal({ type: 'call-answer', callId, groupId: GROUP_ID, sdp: 'answer-sdp' }))
  await waitFor(() => expect(FakePC.instances[0].remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' }))
  expect(FakePC.instances.length).toBe(1)
})

it('auto-answers a late-join offer for the active call', async () => {
  await joinWithRoster()
  const third = new LocalSigner(generateSecretKey())
  await deliverSignal(await peerSignal({ type: 'call-offer', callId: 'c1', groupId: GROUP_ID, mediaType: 'audio', sdp: 'late-sdp' }, third))
  await waitFor(() => {
    expect(FakePC.instances.length).toBe(2)
    const toThird = signalEvents().filter(ev => ev.tags[0][1] === third.pubkey)
    expect(toThird.length).toBe(1)
  })
})

it('resolves glare deterministically (smaller pubkey offer wins)', async () => {
  await joinWithRoster() // we have a pending offer to PEER
  await waitFor(() => expect(FakePC.instances.length).toBe(1))
  const iWin = getSigner()!.pubkey < PEER
  await deliverSignal(await peerSignal({ type: 'call-offer', callId: 'c1', groupId: GROUP_ID, mediaType: 'audio', sdp: 'glare-sdp' }))
  await new Promise(r => setTimeout(r, 50))
  if (iWin) {
    expect(FakePC.instances.length).toBe(1) // their offer ignored; they answer mine
  } else {
    await waitFor(() => expect(FakePC.instances.length).toBe(2)) // mine discarded, theirs answered
    expect(FakePC.instances[0].closed).toBe(true)
  }
})

it('call-end from a peer removes only that peer', async () => {
  await joinWithRoster()
  await waitFor(() => expect(FakePC.instances.length).toBe(1))
  await deliverSignal(await peerSignal({ type: 'call-end', callId: 'c1', groupId: GROUP_ID, reason: 'ended' }))
  await waitFor(() => expect(FakePC.instances[0].closed).toBe(true))
  expect(screen.getByTestId('state').textContent).toBe('in-call')
  expect(screen.getByTestId('peers').textContent).not.toContain(PEER)
})

it('leave sends call-end to connected peers and closes every connection', async () => {
  await joinWithRoster()
  await waitFor(() => expect(FakePC.instances.length).toBe(1))
  act(() => screen.getByText('leave').click())
  await waitFor(() => {
    expect(FakePC.instances.every(pc => pc.closed)).toBe(true)
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })
})
```

Note for the implementer: the glare test's branching on `iWin` is inherent — `installTestSigner` generates a random key each run, so the test covers whichever side of the tie-break the draw produces while asserting the deterministic rule both ways. `LocalSigner` and `generateSecretKey` imports are already in the test header.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/GroupCallMesh.test.tsx`
Expected: FAIL — no 24100 events published on join (connectToPeers is a stub), signal subscription absent.

- [ ] **Step 3: Implement the mesh per the contract above**

Fill `connectToPeers`/`teardownMesh` and add the signal-handling effect in `src/contexts/GroupCallContext.tsx` following the numbered implementation contract in this task's header. Follow CallContext's existing patterns for ICE candidate buffering and sendSignal. Keep per-peer failure isolation: a `failed`/`disconnected` connection closes only that peer.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/GroupCallMesh.test.tsx src/__tests__/GroupCallContext.test.tsx`
Expected: PASS (mesh tests + no presence-core regressions).

- [ ] **Step 5: Commit**

```bash
git add src/contexts/GroupCallContext.tsx src/__tests__/GroupCallMesh.test.tsx
git commit -m "feat: group call WebRTC mesh (pairwise offers, auto-answer, glare, per-peer failure)"
```

---

### Task 6: GroupCallOverlay

**Files:**
- Create: `src/components/Call/GroupCallOverlay.tsx`
- Test: `src/__tests__/GroupCallOverlay.test.tsx`

**Interfaces:**
- Consumes: `useGroupCallContext` (Task 4/5 value), `Avatar` (`../Chat/Avatar`), `getDisplayName` (`../../lib/fileUtils`), `formatDuration` (`../../lib/format`), profiles from the store.
- Produces: `<GroupCallOverlay />` rendered in App (Task 7). Returns `null` unless `groupCallState === 'in-call'`.

Layout requirements (from spec):
- `fixed inset-0 z-[70] bg-gray-950 flex flex-col` base like `CallOverlay`.
- Tile grid: participants = me + every key of `remoteStreams`/`peerStates` union. Grid classes: `grid gap-2 p-2 flex-1 overflow-hidden grid-cols-1` when total tiles <= 2, `grid-cols-2` when >= 3 (compute `total <= 2 ? 'grid-cols-1' : 'grid-cols-2'`). Each tile `relative rounded-2xl overflow-hidden bg-gray-900 min-h-0` — video via the same `VideoEl` pattern as CallOverlay (copy the small `VideoEl` + `RemoteAudio` components into this file), avatar + name centered otherwise; a small label bottom-left with the display name; a "Connecting…" / "Connection failed" overlay per `peerStates` value; local tile mirrored (`scale-x-[-1]`) and always muted.
- One `RemoteAudio` element per remote stream (audio must play even for video-off peers).
- Bottom controls bar exactly like CallOverlay's (gradient, `paddingBottom: 'max(2rem, env(safe-area-inset-bottom))'`): mute toggle, camera toggle (only when `mediaType === 'video'`), red hang-up button calling `leave`, all `w-14 h-14`/`w-16 h-16` (44 px+ targets). Top-center: participant count "N in call" + `formatDuration(duration)`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/GroupCallOverlay.test.tsx`:

```tsx
import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const ctx = {
  groupCallState: 'in-call', activeGroupId: 'g1', callId: 'c1', mediaType: 'audio' as const,
  liveCall: null, joinState: 'in-call' as const,
  localStream: null, remoteStreams: new Map<string, MediaStream>(),
  peerStates: new Map<string, 'connecting' | 'connected' | 'failed'>(),
  isMuted: false, isCameraOff: false, duration: 65,
  watchGroup: vi.fn(), startOrJoin: vi.fn(), leave: vi.fn(), toggleMute: vi.fn(), toggleCamera: vi.fn(),
}
vi.mock('../contexts/GroupCallContext', () => ({ useGroupCallContext: () => ctx }))

import { GroupCallOverlay } from '../components/Call/GroupCallOverlay'
import { useNostrStore } from '../store/nostrStore'

const P1 = 'a'.repeat(64)
const P2 = 'b'.repeat(64)

beforeEach(() => {
  ctx.groupCallState = 'in-call'
  ctx.peerStates = new Map()
  ctx.remoteStreams = new Map()
  useNostrStore.setState({ publicKey: 'm'.repeat(64), profiles: {}, contacts: [] })
})

it('renders nothing when idle', () => {
  ctx.groupCallState = 'idle' as typeof ctx.groupCallState
  const { container } = render(<GroupCallOverlay />)
  expect(container.firstChild).toBeNull()
})

it('renders one tile per participant including self, and the count', () => {
  ctx.peerStates = new Map([[P1, 'connected'], [P2, 'connecting']])
  render(<GroupCallOverlay />)
  expect(screen.getAllByTestId('call-tile')).toHaveLength(3)
  expect(screen.getByText('3 in call')).toBeInTheDocument()
  expect(screen.getByText(/connecting/i)).toBeInTheDocument()
})

it('uses a single column for 2 tiles and two columns for 3 or more', () => {
  ctx.peerStates = new Map([[P1, 'connected']])
  const { rerender } = render(<GroupCallOverlay />)
  expect(screen.getByTestId('tile-grid').className).toContain('grid-cols-1')
  ctx.peerStates = new Map([[P1, 'connected'], [P2, 'connected']])
  rerender(<GroupCallOverlay />)
  expect(screen.getByTestId('tile-grid').className).toContain('grid-cols-2')
})

it('wires the controls', () => {
  render(<GroupCallOverlay />)
  fireEvent.click(screen.getByTitle('Mute'))
  expect(ctx.toggleMute).toHaveBeenCalled()
  fireEvent.click(screen.getByTitle('Hang up'))
  expect(ctx.leave).toHaveBeenCalled()
})

it('marks a failed peer tile', () => {
  ctx.peerStates = new Map([[P1, 'failed']])
  render(<GroupCallOverlay />)
  expect(screen.getByText(/connection failed/i)).toBeInTheDocument()
})
```

Give the grid container `data-testid="tile-grid"` and each tile `data-testid="call-tile"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/GroupCallOverlay.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Implement per the layout requirements above**

Write `src/components/Call/GroupCallOverlay.tsx` following the layout requirements block and CallOverlay's idioms (copy `VideoEl`/`RemoteAudio` locally; camera toggle only for video calls; audio calls get a `w-14 h-14` spacer like CallOverlay line 165).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/GroupCallOverlay.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Call/GroupCallOverlay.tsx src/__tests__/GroupCallOverlay.test.tsx
git commit -m "feat: group call overlay with responsive participant grid"
```

---

### Task 7: Banner, thread wiring, app mount, FeatureNotes

**Files:**
- Create: `src/components/Call/GroupCallBanner.tsx`
- Modify: `src/components/Chat/MessageThread.tsx` (GroupHeader ~line 174, GroupThread ~line 759)
- Modify: `src/App.tsx` (~lines 13-15 imports, ~170 provider, ~191 overlay)
- Modify: `FeatureNotes.md`
- Test: `src/__tests__/GroupCallBanner.test.tsx`

**Interfaces:**
- Consumes: `useGroupCallContext` (`watchGroup`, `startOrJoin`, `liveCall`, `joinState`, `groupCallState`), lucide `Phone`/`Video` icons.
- Produces: user-facing feature complete.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/GroupCallBanner.test.tsx`:

```tsx
import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const ctx = {
  groupCallState: 'idle' as 'idle' | 'in-call',
  liveCall: null as null | { callId: string; mediaType: 'audio' | 'video'; participants: string[] },
  joinState: 'can-join' as 'can-join' | 'full' | 'busy' | 'other-device' | 'in-call',
  startOrJoin: vi.fn(),
}
vi.mock('../contexts/GroupCallContext', () => ({ useGroupCallContext: () => ctx }))

import { GroupCallBanner } from '../components/Call/GroupCallBanner'

const GROUP_ID = 'g'.repeat(64)

beforeEach(() => {
  vi.clearAllMocks()
  ctx.groupCallState = 'idle'
  ctx.liveCall = { callId: 'c1', mediaType: 'audio', participants: ['a', 'b'] }
  ctx.joinState = 'can-join'
})

it('renders nothing when no live call or already joined', () => {
  ctx.liveCall = null
  expect(render(<GroupCallBanner groupId={GROUP_ID} />).container.firstChild).toBeNull()
  ctx.liveCall = { callId: 'c1', mediaType: 'audio', participants: ['a'] }
  ctx.joinState = 'in-call'
  expect(render(<GroupCallBanner groupId={GROUP_ID} />).container.firstChild).toBeNull()
})

it('shows the count and joins with the call mediaType', () => {
  render(<GroupCallBanner groupId={GROUP_ID} />)
  expect(screen.getByText('Call in progress · 2/6')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /join/i }))
  expect(ctx.startOrJoin).toHaveBeenCalledWith(GROUP_ID, 'audio')
})

it.each([
  ['full', 'Call full'],
  ['busy', 'In another call'],
  ['other-device', 'In call on another device'],
] as const)('disables join when %s', (state, label) => {
  ctx.joinState = state
  render(<GroupCallBanner groupId={GROUP_ID} />)
  const btn = screen.getByRole('button', { name: new RegExp(label, 'i') })
  expect(btn).toBeDisabled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/GroupCallBanner.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Implement**

3a. Create `src/components/Call/GroupCallBanner.tsx`:

```tsx
import { Phone } from 'lucide-react'
import { useGroupCallContext } from '../../contexts/GroupCallContext'
import { MAX_GROUP_CALL_PARTICIPANTS } from '../../lib/groupCall'

const DISABLED_LABELS = {
  full: 'Call full',
  busy: 'In another call',
  'other-device': 'In call on another device',
} as const

export function GroupCallBanner({ groupId }: { groupId: string }) {
  const { liveCall, joinState, startOrJoin } = useGroupCallContext()
  if (!liveCall || joinState === 'in-call') return null

  const disabled = joinState !== 'can-join'
  const label = disabled ? DISABLED_LABELS[joinState as keyof typeof DISABLED_LABELS] : 'Join'

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-green-500/10 border-b border-green-500/30">
      <Phone size={16} className="text-green-400 flex-shrink-0" />
      <p className="flex-1 text-sm text-white min-w-0 truncate">
        Call in progress · {liveCall.participants.length}/{MAX_GROUP_CALL_PARTICIPANTS}
      </p>
      <button
        onClick={() => startOrJoin(groupId, liveCall.mediaType)}
        disabled={disabled}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {label}
      </button>
    </div>
  )
}
```

3b. `src/components/Chat/MessageThread.tsx`:
- Imports: add `Phone, Video` to the existing lucide import; `import { GroupCallBanner } from '../Call/GroupCallBanner'`; `import { useGroupCallContext } from '../../contexts/GroupCallContext'`.
- `GroupHeader` (~line 174): add `const { startOrJoin, liveCall, joinState } = useGroupCallContext()` and, before the gallery button, two buttons matching the gallery button's classes:

```tsx
      <button
        onClick={() => startOrJoin(groupId, liveCall?.mediaType ?? 'audio')}
        disabled={joinState !== 'can-join'}
        className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        title={liveCall ? 'Join call' : 'Start voice call'}
      >
        <Phone size={18} />
      </button>
      <button
        onClick={() => startOrJoin(groupId, liveCall?.mediaType ?? 'video')}
        disabled={joinState !== 'can-join'}
        className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        title={liveCall ? 'Join call' : 'Start video call'}
      >
        <Video size={18} />
      </button>
```

- `GroupThread` (~line 759): add after `useGroupMessages(groupId)`:

```tsx
  const { watchGroup } = useGroupCallContext()
  useEffect(() => {
    watchGroup(groupId)
    return () => watchGroup(null)
  }, [groupId, watchGroup])
```

and render `<GroupCallBanner groupId={groupId} />` directly under `<GroupHeader ... />` in BOTH return branches' fragment (the no-key branch may skip it; add it only in the main branch, right after the `GroupHeader` line at ~853).

3c. `src/App.tsx`:
- `import { GroupCallProvider } from './contexts/GroupCallContext'` and `import { GroupCallOverlay } from './components/Call/GroupCallOverlay'`.
- Wrap: `<CallProvider><GroupCallProvider> ... </GroupCallProvider></CallProvider>` (GroupCallProvider directly inside CallProvider, wrapping everything CallProvider wrapped).
- Mount `<GroupCallOverlay />` right after `<CallOverlay />`.

3d. `FeatureNotes.md` — append under the existing "Priority 3" section:

```markdown
- **Group calls.** Start a voice or video call from a group's header; members
  see a "Call in progress" banner and join or leave freely (up to 6
  participants). Calls are serverless: media flows peer-to-peer between all
  participants, and coordination rides ephemeral encrypted Nostr events that
  relays never store. Late joining works; if someone's app crashes they
  disappear from the call within about 90 seconds. Group calls and 1:1 calls
  are mutually exclusive - you are "busy" to one while in the other.
```

- [ ] **Step 4: Run tests, lint, build**

Run: `npx vitest run src/__tests__/GroupCallBanner.test.tsx` — Expected: PASS.
Run: `npm test` — Expected: full suite PASS.
Run: `npm run lint` — Expected: no errors.
Run: `npm run build` — Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/components/Call/GroupCallBanner.tsx src/components/Chat/MessageThread.tsx src/App.tsx FeatureNotes.md src/__tests__/GroupCallBanner.test.tsx
git commit -m "feat: group call banner, thread wiring, app mount, FeatureNotes"
```

---

## Manual verification (after all tasks)

Live relay, three browser profiles (A, B, C) in one group, plus one phone-sized viewport:

1. A starts a voice call — B and C see the banner and a notification; B joins; A and B hear each other.
2. C joins late — mesh completes (3-way audio).
3. B kills the tab — B disappears from A/C's roster within ~90 s; call survives.
4. A starts a video call in another group while C is calling A 1:1 — busy interactions both ways.
5. Full-cap behavior with 6 participants if feasible; otherwise verify the banner's disabled "Call full" state by inspection.
6. Repeat step 1 on a phone-sized viewport: banner, grid (1-col for 2, 2-col for 3), controls above the safe area.
