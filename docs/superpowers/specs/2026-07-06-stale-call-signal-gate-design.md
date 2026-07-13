# Stale Call-Signal Gate (Ghost-Ring Fix) — Design Spec

Date: 2026-07-06
Status: Approved for planning

## Problem

Kind 24100 call signals are in the ephemeral range, but some relays store and
replay them on subscription. Observed live on 2026-07-05: reopening the app
after a 1:1 call re-delivered the old `call-offer`, popping the incoming-call
modal for a call that ended minutes earlier (the "ghost ring"). The same
replay class can deliver a duplicate offer to a group participant mid-call,
tearing down a healthy peer connection (known minor from the group-calls
review).

## Fix

Drop any kind-24100 event older than 60 seconds at both signal-subscription
callbacks, before decryption.

- `src/lib/webrtc.ts` gains:

```ts
export const MAX_CALL_SIGNAL_AGE_SEC = 60

export function isStaleCallSignal(createdAtSec: number, nowMs = Date.now()): boolean {
  return createdAtSec < Math.floor(nowMs / 1000) - MAX_CALL_SIGNAL_AGE_SEC
}
```

- `CallContext` (1:1 signal subscription) and `GroupCallContext` (group
  signal subscription, active only while in a call): the event callback
  returns immediately when `isStaleCallSignal(event.created_at)`, skipping
  decryption and routing.

## Why gating all signal types is safe

Calls are real-time; every signal that matters is seconds old:

- Offers: a stale offer is by definition a replay — the ghost ring.
- Answers: a callee who answers a long-ringing call emits a fresh event at
  answer time; its age is ~0 regardless of how long the call rang.
- ICE candidates: only meaningful within a live handshake; a 60-second-old
  candidate belongs to a dead session.
- call-end: stale ends are already ignored by the callId guard; dropping
  them earlier just saves a decrypt.

Presence (kind 24103) needs no gate: roster derivation already expires
heartbeats older than 90 s by timestamp.

## Accepted trade-off

A caller whose clock runs more than 60 s slow produces offers that look
stale and will not ring the callee. NTP keeps real devices within seconds;
accepted. Future-dated events (fast clocks) are never treated as stale.

## Scope

- Modify: `src/lib/webrtc.ts` (constant + helper), the subscription
  callback in `src/contexts/CallContext.tsx`, the group signal subscription
  callback in `src/contexts/GroupCallContext.tsx`.
- Unchanged: signal building/encryption, handleSignal/handleGroupSignal
  routing, presence, call history, everything else.

## Testing

- Unit (`webrtc.test.ts`): `isStaleCallSignal` — fresh event false; exactly
  60 s old false (boundary: strictly older than 60 s is stale); 61 s old
  true; future-dated false.
- Provider (`CallContext.test.tsx`): delivering a valid encrypted
  call-offer with `created_at` 120 s in the past leaves state `idle` (no
  incoming modal); the existing fresh-offer test keeps proving current
  offers still ring.
- Manual: reopen the app shortly after an ended 1:1 call on a replaying
  relay — no ghost modal (the 2026-07-05 repro).

## Known limits (accepted)

- A ghost ring within 60 s of a genuinely just-ended call is still
  possible; at that age it is indistinguishable from a live call attempt.
- Clock-skew trade-off above.
