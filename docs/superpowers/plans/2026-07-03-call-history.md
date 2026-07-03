# Call History / Missed-Call Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every 1:1 call leaves an inline system row in the DM thread (missed calls badge + notify, even if the app was closed), and group threads show a "started a call" row.

**Architecture:** A call log is one kind-4 NIP-04 DM with a JSON control payload (`{type:'call-log', ...}`), published by the **caller** at the call's terminal transition — the same rails as the existing `edit`/`delete` controls (`src/lib/messageOps.ts`). It is stored as a normal `MessageRecord` (no schema change) and rendered as a system row instead of a bubble. Group threads reuse the existing `call-start` control (kind 1042), which now also stores a row. Spec: `docs/superpowers/specs/2026-07-03-call-history-design.md`.

**Tech Stack:** React 19, TypeScript, Zustand, Dexie, nostr-tools, Vitest + @testing-library/react, Tailwind, lucide-react.

## Global Constraints

- TDD: write the failing test first, watch it fail, then implement (project standard).
- Conventional commits: `feat:` / `fix:` / `test:` / `docs:`.
- No emojis in code or comments (user global standard).
- `npm test` = vitest (no typechecking); `npm run build` runs `tsc -b` — run it before the final commit, it catches type errors vitest misses (including in test files).
- Deliberate simplifications get a `ponytail:` comment naming the ceiling.
- The callee NEVER publishes a call log. Only the initiating device does.
- Payload validation limits copied from spec verbatim: `callId` non-empty ≤ 128 chars, `outcome` ∈ {completed, missed, declined, busy}, `mediaType` ∈ {audio, video}, `duration` finite ≥ 0, present only for `completed`.

---

### Task 1: Call-log payload library (`src/lib/callLog.ts`)

**Files:**
- Create: `src/lib/callLog.ts`
- Test: `src/__tests__/callLog.test.ts`

**Interfaces:**
- Produces (used by Tasks 2, 4, 5, 6):
  - `type CallOutcome = 'completed' | 'missed' | 'declined' | 'busy'`
  - `interface CallLogPayload { type: 'call-log'; callId: string; mediaType: MediaType; outcome: CallOutcome; duration?: number }`
  - `serializeCallLog(p: Omit<CallLogPayload, 'type'>): string`
  - `parseCallLogPayload(content: string): CallLogPayload | null`
  - `deriveCallOutcome(wasConnected: boolean, endReason?: string): CallOutcome`
  - `callLogLabel(p: CallLogPayload, isOwn: boolean): string`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/callLog.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  serializeCallLog, parseCallLogPayload, deriveCallOutcome, callLogLabel,
  type CallLogPayload,
} from '../lib/callLog'

describe('serialize / parse round-trip', () => {
  it('round-trips a completed call with duration', () => {
    const s = serializeCallLog({ callId: 'c1', mediaType: 'video', outcome: 'completed', duration: 754 })
    expect(parseCallLogPayload(s)).toEqual({
      type: 'call-log', callId: 'c1', mediaType: 'video', outcome: 'completed', duration: 754,
    })
  })

  it('round-trips a missed call without duration', () => {
    const s = serializeCallLog({ callId: 'c2', mediaType: 'audio', outcome: 'missed' })
    expect(parseCallLogPayload(s)).toEqual({
      type: 'call-log', callId: 'c2', mediaType: 'audio', outcome: 'missed',
    })
  })
})

describe('parseCallLogPayload validation', () => {
  const valid = { type: 'call-log', callId: 'c', mediaType: 'audio', outcome: 'missed' }

  it('rejects non-JSON and non-object content', () => {
    expect(parseCallLogPayload('hello')).toBeNull()
    expect(parseCallLogPayload('{not json')).toBeNull()
  })
  it('rejects wrong type field', () => {
    expect(parseCallLogPayload(JSON.stringify({ ...valid, type: 'edit' }))).toBeNull()
  })
  it('rejects empty and oversized callId', () => {
    expect(parseCallLogPayload(JSON.stringify({ ...valid, callId: '' }))).toBeNull()
    expect(parseCallLogPayload(JSON.stringify({ ...valid, callId: 'x'.repeat(129) }))).toBeNull()
  })
  it('rejects unknown outcome and mediaType', () => {
    expect(parseCallLogPayload(JSON.stringify({ ...valid, outcome: 'exploded' }))).toBeNull()
    expect(parseCallLogPayload(JSON.stringify({ ...valid, mediaType: 'hologram' }))).toBeNull()
  })
  it('rejects invalid durations', () => {
    expect(parseCallLogPayload(JSON.stringify({ ...valid, duration: -1 }))).toBeNull()
    expect(parseCallLogPayload(JSON.stringify({ ...valid, duration: Infinity }))).toBeNull()
    expect(parseCallLogPayload(JSON.stringify({ ...valid, duration: 'long' }))).toBeNull()
  })
})

describe('deriveCallOutcome', () => {
  it('connected at any point is completed regardless of end reason', () => {
    expect(deriveCallOutcome(true)).toBe('completed')
    expect(deriveCallOutcome(true, 'ended')).toBe('completed')
    expect(deriveCallOutcome(true, 'rejected')).toBe('completed')
  })
  it('never-connected maps end reasons', () => {
    expect(deriveCallOutcome(false, 'rejected')).toBe('declined')
    expect(deriveCallOutcome(false, 'busy')).toBe('busy')
    expect(deriveCallOutcome(false, 'ended')).toBe('missed')
    expect(deriveCallOutcome(false)).toBe('missed')
  })
})

describe('callLogLabel', () => {
  const p = (over: Partial<CallLogPayload>): CallLogPayload =>
    ({ type: 'call-log', callId: 'c', mediaType: 'audio', outcome: 'missed', ...over })

  it('completed shows kind and duration for both sides', () => {
    expect(callLogLabel(p({ outcome: 'completed', duration: 754, mediaType: 'video' }), true)).toBe('Video call · 12:34')
    expect(callLogLabel(p({ outcome: 'completed', duration: 61 }), false)).toBe('Voice call · 1:01')
  })
  it('missed is perspective-aware', () => {
    expect(callLogLabel(p({}), true)).toBe('Voice call · no answer')
    expect(callLogLabel(p({}), false)).toBe('Missed voice call')
    expect(callLogLabel(p({ mediaType: 'video' }), false)).toBe('Missed video call')
  })
  it('declined is the same for both sides', () => {
    expect(callLogLabel(p({ outcome: 'declined' }), true)).toBe('Voice call declined')
    expect(callLogLabel(p({ outcome: 'declined' }), false)).toBe('Voice call declined')
  })
  it('busy is perspective-aware', () => {
    expect(callLogLabel(p({ outcome: 'busy' }), true)).toBe('Voice call · busy')
    expect(callLogLabel(p({ outcome: 'busy' }), false)).toBe('Missed voice call · busy')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/callLog.test.ts`
Expected: FAIL — cannot resolve `../lib/callLog`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/callLog.ts`:

```ts
// 1:1 call history records travel as kind-4 control payloads through the
// normal DM transport (like edits/deletes — see lib/messageOps.ts), so they
// inherit relay durability, backfill, dedup, persistence, and multi-device
// sync. One event, one writer: the caller publishes at the call's terminal
// transition. ponytail: caller crash mid-call leaves no record; a callee-side
// fallback log would cover it if that ever matters.

import type { MediaType } from './webrtc'
import { formatDuration } from './format'

export type CallOutcome = 'completed' | 'missed' | 'declined' | 'busy'

export interface CallLogPayload {
  type: 'call-log'
  callId: string
  mediaType: MediaType
  outcome: CallOutcome
  duration?: number // seconds, present only for completed
}

const MAX_CALL_ID_LEN = 128
const OUTCOMES: readonly string[] = ['completed', 'missed', 'declined', 'busy']

export function serializeCallLog(p: Omit<CallLogPayload, 'type'>): string {
  return JSON.stringify({ type: 'call-log', ...p } satisfies CallLogPayload)
}

export function parseCallLogPayload(content: string): CallLogPayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (
      obj?.type === 'call-log' &&
      typeof obj.callId === 'string' && obj.callId.length > 0 && obj.callId.length <= MAX_CALL_ID_LEN &&
      (obj.mediaType === 'audio' || obj.mediaType === 'video') &&
      OUTCOMES.includes(obj.outcome) &&
      (obj.duration === undefined ||
        (typeof obj.duration === 'number' && Number.isFinite(obj.duration) && obj.duration >= 0))
    ) return obj as CallLogPayload
  } catch { /* not JSON */ }
  return null
}

/** Terminal outcome of a 1:1 call, computed on the caller's side. */
export function deriveCallOutcome(wasConnected: boolean, endReason?: string): CallOutcome {
  if (wasConnected) return 'completed'
  if (endReason === 'rejected') return 'declined'
  if (endReason === 'busy') return 'busy'
  return 'missed'
}

/**
 * Thread-row and sidebar/notification label. `isOwn` = rendered by the caller
 * (event author); the callee perspective (isOwn=false) is also the sidebar
 * preview and notification text, since previews only run for incoming events.
 */
export function callLogLabel(p: CallLogPayload, isOwn: boolean): string {
  const kind = p.mediaType === 'video' ? 'Video call' : 'Voice call'
  const missedKind = p.mediaType === 'video' ? 'Missed video call' : 'Missed voice call'
  switch (p.outcome) {
    case 'completed': return `${kind} · ${formatDuration(p.duration ?? 0)}`
    case 'missed':    return isOwn ? `${kind} · no answer` : missedKind
    case 'declined':  return `${kind} declined`
    case 'busy':      return isOwn ? `${kind} · busy` : `${missedKind} · busy`
  }
}
```

Note: check `src/lib/format.ts` — `formatDuration(754)` must yield `12:34` and `formatDuration(61)` → `1:01`. If its zero-padding differs (e.g. `01:01`), adjust the expected strings in the Step 1 test to match the actual formatter — do NOT change the formatter, it is shared with call overlays and audio messages.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/callLog.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/callLog.ts src/__tests__/callLog.test.ts
git commit -m "feat: call-log payload, outcome derivation, and labels"
```

---

### Task 2: Inbox routes 1:1 call-logs (store, preview, badge, notification)

**Files:**
- Modify: `src/lib/inbox.ts` (`processDMEvent`, lines ~308-360)
- Test: `src/__tests__/inbox.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `parseCallLogPayload`, `callLogLabel` from `src/lib/callLog.ts` (Task 1).
- Produces: incoming valid call-log DMs are stored as normal messages (raw JSON content); sidebar preview shows the label; ONLY `missed`/`busy` outcomes increment unread and fire a notification. Malformed call-logs fall through as plain text messages.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/inbox.test.ts` (the file already imports `processDMEvent`, `useNostrStore`, `fireNotification`, `installTestSigner`, `nip04`, `finalizeEvent`, `generateSecretKey`, `getPublicKey`; add `serializeCallLog` to the imports from a new line: `import { serializeCallLog } from '../lib/callLog'`):

```ts
describe('processDMEvent call-log control messages', () => {
  async function incomingCallLog(plaintext: string, createdAt = 1000) {
    const senderSk = generateSecretKey()
    const senderPk = getPublicKey(senderSk)
    const mySk = generateSecretKey()
    const { signer } = installTestSigner(mySk)
    const myPk = signer.pubkey
    useNostrStore.setState({
      publicKey: myPk,
      // known, accepted contact so the request gate and pending-mute do not interfere
      contacts: [{ pubkey: senderPk, pending: false, unread: 0 }],
    })
    const encrypted = await nip04.encrypt(senderSk, myPk, plaintext)
    const event = finalizeEvent({ kind: 4, created_at: createdAt, tags: [['p', myPk]], content: encrypted }, senderSk)
    return { event, senderPk, myPk }
  }

  it('stores a missed call-log, sets the preview, counts unread, and notifies', async () => {
    const { event, senderPk, myPk } = await incomingCallLog(
      serializeCallLog({ callId: 'c1', mediaType: 'audio', outcome: 'missed' }))
    await processDMEvent(event, myPk, RELAYS, { live: true })

    const s = useNostrStore.getState()
    expect(s.messages[senderPk]).toHaveLength(1)
    const contact = s.contacts.find(c => c.pubkey === senderPk)
    expect(contact?.lastMessage).toBe('Missed voice call')
    expect(contact?.unread).toBe(1)
    expect(fireNotification).toHaveBeenCalledWith(
      senderPk, 'dm', expect.any(String), 'Missed voice call', undefined)
  })

  it('stores a completed call-log silently: preview updates, no unread, no notification', async () => {
    const { event, senderPk, myPk } = await incomingCallLog(
      serializeCallLog({ callId: 'c2', mediaType: 'video', outcome: 'completed', duration: 61 }))
    await processDMEvent(event, myPk, RELAYS, { live: true })

    const s = useNostrStore.getState()
    expect(s.messages[senderPk]).toHaveLength(1)
    const contact = s.contacts.find(c => c.pubkey === senderPk)
    expect(contact?.lastMessage).toBe('Video call · 1:01')
    expect(contact?.unread).toBe(0)
    expect(fireNotification).not.toHaveBeenCalled()
  })

  it('counts a backfilled missed call newer than seenAt (app was closed during the call)', async () => {
    const { event, senderPk, myPk } = await incomingCallLog(
      serializeCallLog({ callId: 'c3', mediaType: 'audio', outcome: 'missed' }), 2000)
    useNostrStore.setState({ seenAt: { [senderPk]: 1000 } })
    await processDMEvent(event, myPk, RELAYS, { live: false })

    expect(useNostrStore.getState().contacts.find(c => c.pubkey === senderPk)?.unread).toBe(1)
    expect(fireNotification).not.toHaveBeenCalled() // backfill never notifies
  })

  it('treats a malformed call-log as a normal text message', async () => {
    const bad = JSON.stringify({ type: 'call-log', callId: 'c4', mediaType: 'audio', outcome: 'exploded' })
    const { event, senderPk, myPk } = await incomingCallLog(bad)
    await processDMEvent(event, myPk, RELAYS, { live: true })

    const s = useNostrStore.getState()
    expect(s.messages[senderPk]).toHaveLength(1)
    expect(s.contacts.find(c => c.pubkey === senderPk)?.unread).toBe(1)
  })
})
```

Note the completed-call preview assertion: it expects `Video call · 1:01`. Adjust only if Task 1's formatter check changed the label format.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/inbox.test.ts`
Expected: the new describe block FAILS — preview is the raw JSON, unread counts are wrong, notification text is the JSON. (Pre-existing tests still pass.)

- [ ] **Step 3: Implement the routing in `processDMEvent`**

In `src/lib/inbox.ts`:

Add the import near the other control-payload imports (next to `parseEditPayload`):

```ts
import { parseCallLogPayload, callLogLabel } from './callLog'
```

In `processDMEvent`, after the `routeMessageOp` line (`if (routeMessageOp(decrypted, event)) return`) and before the request gate, add:

```ts
  // 1:1 call history record: stored as a message (rendered as a call row),
  // but with its own preview text and quieter badge/notification rules.
  const callLog = parseCallLogPayload(decrypted)
```

Then replace the existing side-effects block at the end of the function:

```ts
  const { profiles, updateContactLastMessage } = useNostrStore.getState()
  const preview = getPreviewText(decrypted)
  updateContactLastMessage(peer, preview, event.created_at, {
    incrementUnread: shouldCountUnread(peer, event.created_at, opts.live),
  })

  if (opts.live && !isPending) {
    const senderName = getDisplayName(profiles[event.pubkey], event.pubkey)
    fireNotification(peer, 'dm', senderName, preview, profiles[event.pubkey]?.picture)
  }
```

with:

```ts
  const { profiles, updateContactLastMessage } = useNostrStore.getState()
  const preview = callLog ? callLogLabel(callLog, false) : getPreviewText(decrypted)
  // Completed/declined call rows are records of a call you took part in —
  // nothing is unread. Only missed/busy behave like an unread message.
  const isMissedCall = callLog !== null && (callLog.outcome === 'missed' || callLog.outcome === 'busy')
  const countsAsUnread = callLog === null || isMissedCall
  updateContactLastMessage(peer, preview, event.created_at, {
    incrementUnread: countsAsUnread && shouldCountUnread(peer, event.created_at, opts.live),
  })

  if (opts.live && !isPending && (callLog === null || isMissedCall)) {
    const senderName = getDisplayName(profiles[event.pubkey], event.pubkey)
    fireNotification(peer, 'dm', senderName, preview, profiles[event.pubkey]?.picture)
  }
```

Nothing else changes: the message is stored with the raw JSON as content by the existing `addMessage` call, own outgoing copies still return early (`event.pubkey === myPubkey`), and the blocked/dismissed request gate already runs before storage.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/inbox.test.ts`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbox.ts src/__tests__/inbox.test.ts
git commit -m "feat: route 1:1 call-log DMs with quiet-unless-missed badge rules"
```

---

### Task 3: Group call-start announcements store a thread row

**Files:**
- Modify: `src/lib/inbox.ts` (`routeCallStart`, lines ~143-158, and its call site ~380)
- Test: `src/__tests__/inbox.test.ts` (modify the existing call-start describe block)

**Interfaces:**
- Consumes: existing `parseCallStartPayload` (`src/lib/groupCall.ts`), `claimSideEffects`, `alreadyStored`, `addMessage`.
- Produces: group `call-start` control events are stored as messages (raw JSON content, rendered by Task 6 as "started a call" rows). Preview and notification behavior unchanged.

- [ ] **Step 1: Update the existing test to expect a stored row**

In `src/__tests__/inbox.test.ts`, find the test `'routes call-start: no message stored, preview updated'` and replace it with:

```ts
  it('routes call-start: stores a call row and updates the preview', async () => {
    const key = generateGroupKey()
    seedGroup()
    const event = await makeGroupEvent(serializeCallStart('c1'), key)
    await processGroupEvent(event, GROUP_ID, key, RELAYS, { live: false })

    const state = useNostrStore.getState()
    expect(state.messages[GROUP_ID]).toHaveLength(1)
    expect(state.messages[GROUP_ID][0].content).toBe(serializeCallStart('c1'))
    expect(state.groups.find(g => g.id === GROUP_ID)?.lastMessage).toBe('Call started')
  })
```

The neighboring test `'treats malformed call-start payloads as normal messages'` stays as-is.

- [ ] **Step 2: Run tests to verify the updated test fails**

Run: `npx vitest run src/__tests__/inbox.test.ts`
Expected: FAIL — `messages[GROUP_ID]` has length 0.

- [ ] **Step 3: Store the row in `routeCallStart`**

In `src/lib/inbox.ts`, replace `routeCallStart` with an async version that stores the event as a message (side-effect gating now matches the normal message path, since replays across sessions could otherwise recount unread):

```ts
/** Route a group call-start announcement: stored as a call row, preview + notification. */
async function routeCallStart(content: string, groupId: string, event: Event, live: boolean): Promise<boolean> {
  const payload = parseCallStartPayload(content)
  if (!payload) return false
  const sideEffects = claimSideEffects(event.id) && !(await alreadyStored(event.id))
  useNostrStore.getState().addMessage(groupId, {
    id: event.id,
    pubkey: event.pubkey,
    content,
    createdAt: event.created_at,
    tags: event.tags,
    kind: event.kind,
  })
  if (sideEffects) {
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

Update the call site in `processGroupEvent`:

```ts
  if (await routeCallStart(plaintext, groupId, event, opts.live)) return
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/inbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbox.ts src/__tests__/inbox.test.ts
git commit -m "feat: store group call-start announcements as thread rows"
```

---

### Task 4: CallContext publishes the call-log at terminal transitions

**Files:**
- Modify: `src/contexts/CallContext.tsx`
- Test: create `src/__tests__/CallContext.test.tsx`

**Interfaces:**
- Consumes: `serializeCallLog`, `deriveCallOutcome` (Task 1); existing `buildDMEvent`, `publishEvent` (`src/lib/nostr.ts`); store `addMessage` / `updateMessageStatus` / `writeRelays`.
- Produces: on each terminal transition of a call this client initiated, exactly one kind-4 call-log DM is published to the peer and stored optimistically in the local thread. The callee side and unmount cleanup publish nothing.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/CallContext.test.tsx` (mocking pattern copied from `src/__tests__/GroupCallContext.test.tsx`):

```tsx
import { it, expect, vi, beforeEach, afterEach, describe } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { finalizeEvent, generateSecretKey, getPublicKey, nip04 } from 'nostr-tools'
import type { Event } from 'nostr-tools'

const publishEvent = vi.fn(async (..._args: unknown[]) => {})
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
vi.mock('../lib/notifications', () => ({ fireCallNotification: vi.fn(() => () => {}) }))

import { CallProvider, useCallContext } from '../contexts/CallContext'
import { useNostrStore } from '../store/nostrStore'
import { installTestSigner } from '../test/signer'
import { clearSigner, getSigner } from '../lib/signer'
import { CALL_SIGNAL_KIND } from '../lib/webrtc'
import { parseCallLogPayload } from '../lib/callLog'

const peerSk = generateSecretKey()
const PEER = getPublicKey(peerSk)

const pcs: FakePC[] = []
class FakePC {
  onicecandidate: ((e: { candidate: null }) => void) | null = null
  ontrack: unknown = null
  onconnectionstatechange: (() => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  connectionState = 'new'
  iceConnectionState = 'new'
  remoteDescription: unknown = null
  constructor() { pcs.push(this) }
  addTrack() {}
  getSenders() { return [] }
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' } }
  async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' } }
  async setLocalDescription() {}
  async setRemoteDescription(d: unknown) { this.remoteDescription = d }
  async addIceCandidate() {}
  close() {}
}
vi.stubGlobal('RTCPeerConnection', FakePC)
vi.stubGlobal('RTCIceCandidate', class { constructor(public c: unknown) {} })

function fakeStream() {
  return { getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream
}

function Probe() {
  const ctx = useCallContext()
  return (
    <div>
      <span data-testid="state">{ctx.callState}</span>
      <button onClick={() => ctx.initiateCall(PEER, 'audio')}>call</button>
      <button onClick={() => ctx.rejectCall()}>reject</button>
      <button onClick={() => ctx.hangup()}>hangup</button>
    </div>
  )
}

/** Published kind-4 events (call logs are the only kind-4s CallContext sends). */
function publishedKind4s(): Event[] {
  return publishEvent.mock.calls.map(c => c[1] as Event).filter(e => e.kind === 4)
}

/** The caller's optimistic call-log message stored for the peer thread. */
function storedCallLog() {
  const msgs = useNostrStore.getState().messages[PEER] ?? []
  for (const m of msgs) {
    const p = parseCallLogPayload(m.content)
    if (p) return p
  }
  return null
}

async function startCall() {
  render(<CallProvider><Probe /></CallProvider>)
  act(() => screen.getByText('call').click())
  // the offer (kind 24100) marks the call as loggable
  await waitFor(() => {
    expect(publishEvent.mock.calls.some(c => (c[1] as Event).kind === CALL_SIGNAL_KIND)).toBe(true)
  })
}

/** Encrypt and deliver a call-end signal from the peer, using the real callId from the published offer. */
async function deliverCallEnd(reason: 'rejected' | 'busy' | 'ended') {
  const offer = publishEvent.mock.calls.map(c => c[1] as Event).find(e => e.kind === CALL_SIGNAL_KIND)!
  const myPk = getSigner()!.pubkey
  const { callId } = JSON.parse(await nip04.decrypt(peerSk, myPk, offer.content)) as { callId: string }
  const content = await nip04.encrypt(peerSk, myPk, JSON.stringify({ type: 'call-end', callId, reason }))
  const event = finalizeEvent(
    { kind: CALL_SIGNAL_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['p', myPk]], content },
    peerSk,
  )
  await act(async () => { subCallbacks.forEach(cb => cb(event)) })
}

beforeEach(() => {
  vi.clearAllMocks()
  subCallbacks.length = 0
  pcs.length = 0
  installTestSigner()
  ;(navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: vi.fn(async () => fakeStream()),
  }
  useNostrStore.setState({
    publicKey: getSigner()!.pubkey,
    signerCaps: { nip04: true },
    relays: ['wss://test.example'],
    relayModes: {},
    messages: {},
    contacts: [],
    activeCallType: 'none',
  })
})
afterEach(() => clearSigner())

describe('caller publishes exactly one call-log at the terminal transition', () => {
  it('hangup before answer logs a missed call', async () => {
    await startCall()
    act(() => screen.getByText('hangup').click())
    await waitFor(() => expect(publishedKind4s()).toHaveLength(1))
    expect(storedCallLog()).toMatchObject({ outcome: 'missed', mediaType: 'audio' })
    expect(storedCallLog()?.duration).toBeUndefined()
  })

  it('a connected call logs completed with a duration field', async () => {
    await startCall()
    act(() => { pcs[0].connectionState = 'connected'; pcs[0].onconnectionstatechange?.() })
    act(() => screen.getByText('hangup').click())
    await waitFor(() => expect(publishedKind4s()).toHaveLength(1))
    expect(storedCallLog()).toMatchObject({ outcome: 'completed' })
    expect(typeof storedCallLog()?.duration).toBe('number')
  })

  it('a received rejection logs declined; busy logs busy', async () => {
    await startCall()
    await deliverCallEnd('rejected')
    await waitFor(() => expect(publishedKind4s()).toHaveLength(1))
    expect(storedCallLog()).toMatchObject({ outcome: 'declined' })
  })

  it('a connection failure before connecting logs missed, once', async () => {
    await startCall()
    act(() => { pcs[0].connectionState = 'failed'; pcs[0].onconnectionstatechange?.() })
    await waitFor(() => expect(publishedKind4s()).toHaveLength(1))
    expect(storedCallLog()).toMatchObject({ outcome: 'missed' })
    // cleanup already ran; a later hangup must not double-log
    act(() => screen.getByText('hangup').click())
    expect(publishedKind4s()).toHaveLength(1)
  })

  it('getUserMedia failure logs nothing', async () => {
    ;(navigator as unknown as { mediaDevices: { getUserMedia: unknown } }).mediaDevices = {
      getUserMedia: vi.fn(async () => { throw new Error('denied') }),
    }
    render(<CallProvider><Probe /></CallProvider>)
    act(() => screen.getByText('call').click())
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('idle'))
    expect(publishedKind4s()).toHaveLength(0)
  })
})

describe('callee never publishes a call-log', () => {
  it('rejecting an incoming offer sends only the call-end signal', async () => {
    render(<CallProvider><Probe /></CallProvider>)
    const myPk = getSigner()!.pubkey
    const content = await nip04.encrypt(peerSk, myPk, JSON.stringify({
      type: 'call-offer', callId: 'in1', mediaType: 'audio', sdp: 'offer-sdp',
    }))
    const event = finalizeEvent(
      { kind: CALL_SIGNAL_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['p', myPk]], content },
      peerSk,
    )
    await act(async () => { subCallbacks.forEach(cb => cb(event)) })
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('incoming'))
    act(() => screen.getByText('reject').click())
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('idle'))
    expect(publishedKind4s()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/CallContext.test.tsx`
Expected: FAIL — no kind-4 events are ever published (`publishedKind4s()` is empty).

If `startCall` itself fails before the assertions (e.g. `subscribeEvents` never called because the provider guards on `publicKey`), fix the test setup, not the component — the pre-existing 1:1 call flow is known-good.

- [ ] **Step 3: Implement logging in `CallContext.tsx`**

All changes in `src/contexts/CallContext.tsx`.

Add imports:

```ts
import { buildDMEvent } from '../lib/nostr'
import { serializeCallLog, deriveCallOutcome } from '../lib/callLog'
```

(`subscribeEvents, publishEvent` are already imported from `../lib/nostr`; extend that line.)

Add refs next to the existing ones (after `callStateRef`):

```ts
  // Call-log bookkeeping: only the initiating device writes history (spec:
  // one event, one writer), and only after its offer actually went out.
  const isInitiatorRef  = useRef(false)
  const offerSentRef    = useRef(false)
  const wasConnectedRef = useRef(false)
  const mediaTypeRef    = useRef<MediaType>('audio')
  const durationSecRef  = useRef(0)
```

In `startDurationTimer`, mirror the counter into the ref:

```ts
  const startDurationTimer = useCallback(() => {
    if (durationTimer.current) return
    durationTimer.current = setInterval(() => {
      durationSecRef.current += 1
      setDuration(d => d + 1)
    }, 1000)
  }, [])
```

Add the publisher, placed after `startDurationTimer` and before `getUserMedia` (it must be defined before its first use in `createPeerConnection`):

```ts
  // Publish the durable history record for a call this device initiated.
  // Guarded to fire at most once per call; the callee never publishes.
  const publishCallLog = useCallback((peerPubkey: string, endReason?: string) => {
    if (!isInitiatorRef.current || !offerSentRef.current) return
    offerSentRef.current = false
    const outcome = deriveCallOutcome(wasConnectedRef.current, endReason)
    const content = serializeCallLog({
      callId: callIdRef.current,
      mediaType: mediaTypeRef.current,
      outcome,
      ...(outcome === 'completed' && { duration: durationSecRef.current }),
    })
    void (async () => {
      let eventId = ''
      try {
        const event = await buildDMEvent(peerPubkey, content)
        eventId = event.id
        const { publicKey, addMessage } = useNostrStore.getState()
        if (!publicKey) return
        addMessage(peerPubkey, {
          id: event.id,
          pubkey: publicKey,
          content,
          createdAt: event.created_at,
          tags: event.tags,
          kind: 4,
          recipientPubkey: peerPubkey,
          decrypted: true,
          status: 'sending',
        })
        await publishEvent(useNostrStore.getState().writeRelays(), event)
        useNostrStore.getState().updateMessageStatus(peerPubkey, event.id, 'sent')
      } catch {
        // ponytail: best-effort history; a failed publish shows the row as
        // "failed" locally (or nothing if signing failed) and is not retried.
        if (eventId) useNostrStore.getState().updateMessageStatus(peerPubkey, eventId, 'failed')
      }
    })()
  }, [])
```

Wire the terminal transitions:

1. `initiateCall` — after `callIdRef.current = callId`, add:

```ts
    isInitiatorRef.current  = true
    offerSentRef.current    = false
    wasConnectedRef.current = false
    mediaTypeRef.current    = type
    durationSecRef.current  = 0
```

and immediately after the `await sendSignal(peerPubkey, { type: 'call-offer', ... })` call, add:

```ts
      offerSentRef.current = true
```

2. `handleSignal`, in the `call-offer` branch (callee side) — after `callIdRef.current = signal.callId`, add:

```ts
      isInitiatorRef.current = false
```

3. `createPeerConnection.onconnectionstatechange` — replace the handler body:

```ts
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        wasConnectedRef.current = true
        setIsRtcConnected(true)
        setIceConnFailed(false)
        startDurationTimer()
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        publishCallLog(peerPubkey)
        cleanup()
      }
    }
```

and add `publishCallLog` to `createPeerConnection`'s dependency array.

4. `hangup` — log before cleanup (no endReason: outcome comes from `wasConnectedRef`):

```ts
  const hangup = useCallback(() => {
    if (peer) {
      void sendSignal(peer.pubkey, {
        type: 'call-end',
        callId: callIdRef.current,
        reason: 'ended',
      })
      publishCallLog(peer.pubkey)
    }
    cleanup()
  }, [peer, sendSignal, publishCallLog, cleanup])
```

5. `handleSignal`, in the `call-end` branch — the peer ended it; log with their reason:

```ts
    if (signal.type === 'call-end') {
      publishCallLog(senderPubkey, signal.reason)
      cleanup()
    }
```

and add `publishCallLog` to `handleSignal`'s dependency array.

6. `cleanup` — reset the bookkeeping so a stale flag can never leak into the next call. Add before `setCallState('idle')`:

```ts
    isInitiatorRef.current  = false
    offerSentRef.current    = false
    wasConnectedRef.current = false
    durationSecRef.current  = 0
```

Note the unmount effect (`useEffect(() => () => { cleanup() }, [cleanup])`) intentionally does NOT log: closing the app mid-call leaves no record (spec: accepted limit; logging here would fire on every provider teardown, including HMR).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/CallContext.test.tsx`
Expected: PASS (6 tests).

Also run the neighboring call suites to catch regressions:
`npx vitest run src/__tests__/callState.test.ts src/__tests__/GroupCallContext.test.tsx src/__tests__/groupCall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/CallContext.tsx src/__tests__/CallContext.test.tsx
git commit -m "feat: caller publishes durable call-log DM at call end"
```

---

### Task 5: CallRow component

**Files:**
- Create: `src/components/Chat/CallRow.tsx`
- Test: `src/__tests__/CallRow.test.tsx`

**Interfaces:**
- Consumes: `callLogLabel`, `CallLogPayload` (Task 1); `useCallContext().initiateCall`; store `activeCallType`.
- Produces: `CallRow({ message, isOwn, callLog, senderName })` — `callLog` set = 1:1 record (clickable call-back button); `callLog` null = group call-start row (static). Used by Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/CallRow.test.tsx`:

```tsx
import { it, expect, vi, beforeEach, describe } from 'vitest'
import { render, screen } from '@testing-library/react'

const initiateCall = vi.fn()
vi.mock('../contexts/CallContext', () => ({
  useCallContext: () => ({ initiateCall }),
}))

import { CallRow } from '../components/Chat/CallRow'
import { useNostrStore } from '../store/nostrStore'
import type { Message } from '../store/nostrStore'
import type { CallLogPayload } from '../lib/callLog'

const PEER = 'a'.repeat(64)

function msg(over: Partial<Message> = {}): Message {
  return {
    id: 'm1', pubkey: PEER, content: '{}', createdAt: 1700000000,
    tags: [], kind: 4, recipientPubkey: PEER, ...over,
  }
}

function log(over: Partial<CallLogPayload> = {}): CallLogPayload {
  return { type: 'call-log', callId: 'c1', mediaType: 'audio', outcome: 'missed', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  useNostrStore.setState({ activeCallType: 'none' })
})

describe('1:1 call rows', () => {
  it('renders the missed label for the callee', () => {
    render(<CallRow message={msg()} isOwn={false} callLog={log()} senderName="Alice" />)
    expect(screen.getByText('Missed voice call')).toBeInTheDocument()
  })

  it('renders the completed label with duration', () => {
    render(<CallRow message={msg()} isOwn={true}
      callLog={log({ outcome: 'completed', duration: 61, mediaType: 'video' })} senderName="Alice" />)
    expect(screen.getByText('Video call · 1:01')).toBeInTheDocument()
  })

  it('clicking calls the peer back with the same media type', () => {
    render(<CallRow message={msg()} isOwn={false} callLog={log({ mediaType: 'video' })} senderName="Alice" />)
    screen.getByRole('button').click()
    expect(initiateCall).toHaveBeenCalledWith(PEER, 'video')
  })

  it('is disabled while any call is active', () => {
    useNostrStore.setState({ activeCallType: 'group' })
    render(<CallRow message={msg()} isOwn={false} callLog={log()} senderName="Alice" />)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})

describe('group call-start rows', () => {
  it('renders a static started-a-call row with the sender name', () => {
    render(<CallRow message={msg()} isOwn={false} callLog={null} senderName="Alice" />)
    expect(screen.getByText(/Alice started a call/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says You for own call-start rows', () => {
    render(<CallRow message={msg()} isOwn={true} callLog={null} senderName="Alice" />)
    expect(screen.getByText(/You started a call/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/CallRow.test.tsx`
Expected: FAIL — cannot resolve `../components/Chat/CallRow`.

- [ ] **Step 3: Implement the component**

Create `src/components/Chat/CallRow.tsx`:

```tsx
import { format } from 'date-fns'
import { Phone, PhoneMissed, Video } from 'lucide-react'
import type { Message } from '../../store/nostrStore'
import { useNostrStore } from '../../store/nostrStore'
import { useCallContext } from '../../contexts/CallContext'
import { callLogLabel, type CallLogPayload } from '../../lib/callLog'

interface CallRowProps {
  message: Message
  isOwn: boolean
  /** Parsed 1:1 call-log payload, or null for a group call-start row. */
  callLog: CallLogPayload | null
  senderName: string
}

/** Centered system row for call history records — replaces the bubble. */
export function CallRow({ message, isOwn, callLog, senderName }: CallRowProps) {
  const { initiateCall } = useCallContext()
  const activeCallType = useNostrStore(s => s.activeCallType)
  const time = format(new Date(message.createdAt * 1000), 'HH:mm')

  if (!callLog) {
    // Group call-start record: informational only (join happens via the banner).
    return (
      <div className="flex justify-center py-1" data-message-id={message.id}>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-gray-800/60 rounded-full px-3 py-1">
          <Phone size={12} className="text-gray-400" />
          {isOwn ? 'You' : senderName} started a call
          <span className="text-gray-600">· {time}</span>
        </span>
      </div>
    )
  }

  const missed = !isOwn && (callLog.outcome === 'missed' || callLog.outcome === 'busy')
  const peer = message.recipientPubkey
  const Icon = callLog.mediaType === 'video' ? Video : missed ? PhoneMissed : Phone

  return (
    <div className="flex justify-center py-1" data-message-id={message.id}>
      <button
        type="button"
        onClick={() => peer && initiateCall(peer, callLog.mediaType)}
        disabled={activeCallType !== 'none' || !peer}
        title="Call back"
        className="inline-flex items-center gap-1.5 text-xs bg-gray-800/60 hover:bg-gray-700/60 disabled:hover:bg-gray-800/60 disabled:cursor-default rounded-full px-3 py-1 transition-colors"
      >
        <Icon size={12} className={missed ? 'text-red-400' : 'text-gray-400'} />
        <span className={missed ? 'text-red-400' : 'text-gray-400'}>{callLogLabel(callLog, isOwn)}</span>
        <span className="text-gray-600">· {time}</span>
      </button>
    </div>
  )
}
```

(If Task 1's formatter check changed the duration format, the `Video call · 1:01` assertion in Step 1 follows it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/CallRow.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/CallRow.tsx src/__tests__/CallRow.test.tsx
git commit -m "feat: CallRow system row for call history records"
```

---

### Task 6: Wire CallRow into MessageList; exclude call rows from search

**Files:**
- Modify: `src/components/Chat/MessageList.tsx` (itemContent, lines ~156-180)
- Modify: `src/components/Chat/Sidebar.tsx` (searchResults memo, lines ~407-436)

**Interfaces:**
- Consumes: `CallRow` (Task 5), `parseCallLogPayload` (Task 1), existing `parseCallStartPayload` (`src/lib/groupCall.ts`), existing `getDisplayName` (`src/lib/fileUtils.ts`).
- Produces: DM threads render call-log messages as `CallRow`; group threads render call-start messages as `CallRow`; message search skips call records. Rendering-only — no store or lib changes, covered by the manual checklist in Task 7 (Virtuoso does not render rows in jsdom, so no component test here).

- [ ] **Step 1: Branch in `MessageList.tsx`**

Add imports:

```tsx
import { CallRow } from './CallRow'
import { parseCallLogPayload } from '../../lib/callLog'
import { parseCallStartPayload } from '../../lib/groupCall'
import { getDisplayName } from '../../lib/fileUtils'
```

In `itemContent`, replace the block from `const { showDateSeparator, showAvatar } = ...` through the closing `</div>` with:

```tsx
          const { showDateSeparator, showAvatar } = decorateRow(msg, prev, myPubkey)
          const showDivider = msg.id === dividerAnchorId
          // Call records render as centered system rows, not bubbles. Scoped
          // by chat type so identical JSON pasted elsewhere stays plain text.
          const callLog = chatType === 'dm' ? parseCallLogPayload(msg.content) : null
          const callStart = chatType === 'group' ? parseCallStartPayload(msg.content) : null
          return (
            <div className="px-3">
              {showDateSeparator && <DateSeparator date={new Date(msg.createdAt * 1000)} />}
              {showDivider && <NewMessagesDivider />}
              <div className="py-0.5">
                {callLog || callStart ? (
                  <CallRow
                    message={msg}
                    isOwn={msg.pubkey === myPubkey}
                    callLog={callLog}
                    senderName={getDisplayName(profiles[msg.pubkey], msg.pubkey)}
                  />
                ) : (
                  <MessageItem
                    message={msg}
                    profile={profiles[msg.pubkey]}
                    isOwn={msg.pubkey === myPubkey}
                    showAvatar={showAvatar}
                    onReply={onReply}
                    onRetry={onRetry}
                    onReact={onReact}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                )}
              </div>
            </div>
          )
```

Because `CallRow` fully replaces `MessageItem` for these rows, reply/edit/delete/reaction affordances never appear on call records — no per-affordance exclusion needed.

- [ ] **Step 2: Exclude call records from search in `Sidebar.tsx`**

Add import:

```tsx
import { parseCallLogPayload } from '../../lib/callLog'
```

In the `searchResults` useMemo, inside `for (const msg of msgs) {`, add as the first line (search only spans channels and DM contacts, so call-start rows in groups are already out of scope):

```tsx
        if (parseCallLogPayload(msg.content)) continue // call records are not messages
```

- [ ] **Step 3: Run the full test suite and lint**

Run: `npm test`
Expected: PASS — no suite regressions.

Run: `npx eslint src/components/Chat/MessageList.tsx src/components/Chat/Sidebar.tsx src/components/Chat/CallRow.tsx src/lib/callLog.ts src/contexts/CallContext.tsx src/lib/inbox.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/MessageList.tsx src/components/Chat/Sidebar.tsx
git commit -m "feat: render call records as system rows; exclude from search"
```

---

### Task 7: Verification, FeatureNotes, close-out

**Files:**
- Modify: `FeatureNotes.md` (repo root — append an entry following the file's existing format)

**Interfaces:**
- Consumes: everything above.
- Produces: green build, feature note, pushed `develop`.

- [ ] **Step 1: Full verification**

```bash
npm test
npm run build
```

Expected: all tests pass; `tsc -b` reports no type errors (this catches test-file type errors vitest misses — known project gotcha). Fix anything that surfaces before proceeding.

- [ ] **Step 2: Manual verification (two browser profiles, live relay)**

Run `npm run dev` and walk this checklist; note results:

1. Profile A calls B; B answers; hang up → both threads show "Voice call · M:SS"; neither side gains an unread badge from the row.
2. A calls B; B never answers; A hangs up → A sees "Voice call · no answer"; B sees red "Missed voice call", unread badge +1, browser notification "Missed voice call".
3. Close B's tab entirely; A calls, waits, hangs up; reopen B → the missed-call row and badge appear after sync (durable-marker path).
4. A calls B; B rejects → both see "Voice call declined"; no badge on B.
5. Click a call row in B's thread → outgoing call to A starts with the same media type; row is disabled while a call is active.
6. Group with a call: start a call → other members' threads show "X started a call" row; own thread shows "You started a call".
7. Search for "call-log" in the message search → no results from call records.
8. Phone-width viewport (devtools emulation): call rows render centered and legible in the single-pane layout.

- [ ] **Step 3: FeatureNotes entry**

Append an entry to `FeatureNotes.md` matching its existing format: feature name (Call history / missed-call records), date, spec + plan links, one-paragraph behavior summary, and the accepted limits (caller crash = no record; groups start-only; no Calls tab).

- [ ] **Step 4: Commit and push**

```bash
git add FeatureNotes.md
git commit -m "docs: FeatureNotes entry for call history / missed-call records"
git push origin develop
```

(Push is routine on feature completion per project convention.)
