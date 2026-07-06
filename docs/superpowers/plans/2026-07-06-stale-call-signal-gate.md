# Stale Call-Signal Gate (Ghost-Ring Fix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop relays that replay "ephemeral" kind-24100 call signals from ringing the callee for already-ended calls (and from re-delivering duplicate offers into live group calls).

**Architecture:** A pure freshness predicate in `src/lib/webrtc.ts` (`isStaleCallSignal`, 60-second cutoff) applied at both kind-24100 subscription callbacks — 1:1 (`CallContext`) and group (`GroupCallContext`) — before decryption. No protocol, storage, or routing changes. Spec: `docs/superpowers/specs/2026-07-06-stale-call-signal-gate-design.md`.

**Tech Stack:** TypeScript, React, nostr-tools, Vitest.

## Global Constraints

- TDD: failing test first, then implementation.
- Conventional commits; no emojis in code or comments.
- `npm test` does not typecheck; verify with `npx tsc -b --noEmit` (NOT plain `tsc --noEmit`, which checks nothing in this repo).
- Boundary semantics copied from spec verbatim: an event exactly 60 s old is NOT stale (strict `<`); strictly older than 60 s is stale; future-dated events are never stale.
- `MAX_CALL_SIGNAL_AGE_SEC = 60`.

---

### Task 1: `isStaleCallSignal` helper

**Files:**
- Modify: `src/lib/webrtc.ts` (after the `CALL_SIGNAL_KIND` export, ~line 5)
- Test: `src/__tests__/webrtc.test.ts`

**Interfaces:**
- Produces: `MAX_CALL_SIGNAL_AGE_SEC = 60` and `isStaleCallSignal(createdAtSec: number, nowMs?: number): boolean` (nowMs defaults to `Date.now()`), both exported from `src/lib/webrtc.ts`. Task 2 imports both names.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/webrtc.test.ts` (add `isStaleCallSignal, MAX_CALL_SIGNAL_AGE_SEC` to the existing `../lib/webrtc` import):

```ts
describe('isStaleCallSignal', () => {
  const NOW_MS = 1_000_000_000_000 // fixed clock so the boundary is exact
  const NOW_SEC = 1_000_000_000

  it('fresh events are not stale', () => {
    expect(isStaleCallSignal(NOW_SEC, NOW_MS)).toBe(false)
    expect(isStaleCallSignal(NOW_SEC - 30, NOW_MS)).toBe(false)
  })

  it('exactly 60 s old is not stale (strict boundary)', () => {
    expect(isStaleCallSignal(NOW_SEC - MAX_CALL_SIGNAL_AGE_SEC, NOW_MS)).toBe(false)
  })

  it('older than 60 s is stale', () => {
    expect(isStaleCallSignal(NOW_SEC - MAX_CALL_SIGNAL_AGE_SEC - 1, NOW_MS)).toBe(true)
    expect(isStaleCallSignal(NOW_SEC - 3600, NOW_MS)).toBe(true)
  })

  it('future-dated events are never stale', () => {
    expect(isStaleCallSignal(NOW_SEC + 300, NOW_MS)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/webrtc.test.ts`
Expected: FAIL — `isStaleCallSignal` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/webrtc.ts`, directly below `export const CALL_SIGNAL_KIND = 24100`:

```ts
// Kind 24100 is ephemeral, but some relays store and replay it on subscribe,
// ringing the callee for calls that ended minutes ago. Calls are real-time:
// any signal older than this is a replay, not a live call.
export const MAX_CALL_SIGNAL_AGE_SEC = 60

export function isStaleCallSignal(createdAtSec: number, nowMs = Date.now()): boolean {
  return createdAtSec < Math.floor(nowMs / 1000) - MAX_CALL_SIGNAL_AGE_SEC
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/webrtc.test.ts`
Expected: PASS (all tests, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/webrtc.ts src/__tests__/webrtc.test.ts
git commit -m "feat: isStaleCallSignal freshness predicate for call signals"
```

---

### Task 2: Gate both signal subscriptions

**Files:**
- Modify: `src/contexts/CallContext.tsx` (signal subscription effect, ~lines 499-513)
- Modify: `src/contexts/GroupCallContext.tsx` (group signal subscription effect, ~lines 307-319)
- Test: `src/__tests__/CallContext.test.tsx`

**Interfaces:**
- Consumes: `isStaleCallSignal` from `src/lib/webrtc.ts` (Task 1).
- Produces: stale kind-24100 events are dropped before decryption in both contexts.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/CallContext.test.tsx` (the file already has `peerSk`, `PEER`, `subCallbacks`, `CALL_SIGNAL_KIND`, `nip04`, `finalizeEvent`, `getSigner`, and the `Probe` with a `data-testid="state"` span):

```tsx
describe('stale signal gate', () => {
  it('a replayed call-offer older than 60 s does not ring', async () => {
    render(<CallProvider><Probe /></CallProvider>)
    const myPk = getSigner()!.pubkey
    const content = await nip04.encrypt(peerSk, myPk, JSON.stringify({
      type: 'call-offer', callId: 'ghost1', mediaType: 'audio', sdp: 'offer-sdp',
    }))
    const stale = finalizeEvent(
      { kind: CALL_SIGNAL_KIND, created_at: Math.floor(Date.now() / 1000) - 120, tags: [['p', myPk]], content },
      peerSk,
    )
    await act(async () => { subCallbacks.forEach(cb => cb(stale)) })
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })
})
```

The existing test `'rejecting an incoming offer sends only the call-end signal'` delivers a current-timestamp offer and asserts the state reaches `incoming` — it is the fresh-offer regression and must keep passing unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/CallContext.test.tsx`
Expected: the new test FAILS — state becomes `incoming` (the stale offer rings).

- [ ] **Step 3: Implement both gates**

In `src/contexts/CallContext.tsx`:

1. Add `isStaleCallSignal` to the existing `../lib/webrtc` import list.
2. In the signal-subscription effect, add the gate as the first line of the event callback:

```ts
      async (event) => {
        if (isStaleCallSignal(event.created_at)) return
        const signal = await decryptCallSignal(event.pubkey, event.content)
        if (signal) await handleSignal(event.pubkey, signal)
      },
```

In `src/contexts/GroupCallContext.tsx`:

1. Add `isStaleCallSignal` to the existing `../lib/webrtc` import list.
2. In the group signal-subscription effect (the one guarded by `groupCallState !== 'in-call'`), add the same first-line gate:

```ts
      (event) => {
        if (isStaleCallSignal(event.created_at)) return
        void decryptCallSignal(event.pubkey, event.content).then(signal => {
          if (signal) void handleGroupSignal(event.pubkey, signal).catch(() => {})
        })
      },
```

No dependency-array changes: `isStaleCallSignal` is a module import, not a hook value.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/CallContext.test.tsx src/__tests__/GroupCallContext.test.tsx src/__tests__/GroupCallMesh.test.tsx`
Expected: PASS — the new stale-gate test, the fresh-offer regression, and the group suites (their fixtures use current timestamps, so the gate is transparent to them).

Then typecheck: `npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/CallContext.tsx src/contexts/GroupCallContext.tsx src/__tests__/CallContext.test.tsx
git commit -m "fix: drop replayed call signals older than 60s (ghost ring)"
```

---

### Task 3: Verification, FeatureNotes, close-out

**Files:**
- Modify: `FeatureNotes.md`

**Interfaces:**
- Consumes: everything above.
- Produces: green build, updated known-issues entry, pushed `develop`.

- [ ] **Step 1: Full verification**

```bash
npm test
npm run build
npx eslint src/lib/webrtc.ts src/contexts/CallContext.tsx src/contexts/GroupCallContext.tsx src/__tests__/webrtc.test.ts src/__tests__/CallContext.test.tsx
```

Expected: all tests pass; `tsc -b` (inside `npm run build`) clean; lint clean.

- [ ] **Step 2: Update FeatureNotes.md**

In the "Known issues discovered during live verification (2026-07-05)" section, replace the "Ghost ring on app open." bullet with:

```markdown
- **Ghost ring on app open — FIXED.** Call signals (kind 24100) older than
  60 seconds are dropped before decryption in both the 1:1 and group signal
  subscriptions (`isStaleCallSignal` in `src/lib/webrtc.ts`), so relays
  that replay "ephemeral" call-offers can no longer ring the callee for an
  already-ended call, and replayed duplicate offers can no longer disturb a
  live group call. Trade-off: a caller whose clock runs more than 60 s slow
  cannot ring you (NTP keeps real devices within seconds). Spec:
  `docs/superpowers/specs/2026-07-06-stale-call-signal-gate-design.md`.
```

- [ ] **Step 3: Commit and push**

```bash
git add FeatureNotes.md
git commit -m "docs: mark ghost-ring issue fixed via stale call-signal gate"
git push origin develop
```

- [ ] **Step 4: Manual spot-check (controller/human)**

Reopen the app shortly after an ended 1:1 call on a replaying relay — the
incoming-call modal must not appear (the 2026-07-05 repro: reload the
Playwright client after a call from the second account and confirm no
"Incoming audio call" modal).
