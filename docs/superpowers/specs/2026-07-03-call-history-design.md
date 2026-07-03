# Call History / Missed-Call Records — Design Spec

Date: 2026-07-03
Status: Approved for planning

## Goal

Persistent, per-chat call history rendered inline in message threads: every
1:1 call leaves a system row ("Missed voice call", "Video call · 12:34"),
missed calls badge and notify, and group threads show a "Call started" row.
Missed calls surface even when the callee's app was closed during the call.

## Scope

- Inline system rows in the existing threads. No dedicated Calls tab (the
  data model supports one later).
- 1:1 calls: full outcome records (completed / missed / declined / busy).
- Group calls: a "Call started" row only — the room model has no
  authoritative end event, and "missed" has no meaning when nobody is rung.
- Out of scope: Calls tab, group call end/duration records, ring timeout,
  call records for calls where the caller crashed mid-call.

## Protocol — call-log as a kind-4 control payload

Kind-4 DMs in this app already carry JSON control payloads
(`{type:'edit'}`, `{type:'delete'}` in `src/lib/messageOps.ts`), and
`src/lib/history.ts` backfills kind 4 in both directions. The call log rides
the same rails and inherits relay durability, live subscription, backfill,
dedup, persistence, unread handling, and multi-device sync.

### Payload

One event, one writer: when a 1:1 call reaches a terminal state, the
**caller** (only) publishes a normal NIP-04 kind-4 DM to the peer:

```json
{ "type": "call-log", "callId": "...", "mediaType": "audio" | "video",
  "outcome": "completed" | "missed" | "declined" | "busy",
  "duration": 123 }
```

`duration` (seconds) is present only for `completed`.

### Outcome derivation

Pure function in new `src/lib/callLog.ts`, fed by `CallContext` at cleanup:

- Call reached `connected` at any point → `completed` + duration, including
  when the connection later dropped or failed (a call still happened).
- Still `calling` and received `call-end` reason `rejected` → `declined`.
- Still `calling` and received `call-end` reason `busy` → `busy`.
- Still `calling` and the caller hangs up (callee never answered or was
  offline) → `missed`. This is the durable marker: the callee ingests it on
  next sync even if their app was closed during the call.
- Setup failure before the offer was sent (`getUserMedia` denied, no signer)
  → no log.

The callee never publishes a log. Caller crash mid-call → no record
(accepted limit).

### Validation

Mirrors the other kind-4 controls: `type === 'call-log'`, `callId` non-empty
string ≤ 128 chars, `mediaType` and `outcome` in their allowed sets,
`duration` a finite non-negative number when present. Malformed payloads
fall back to rendering as a normal text message (existing posture, same as
group `call-start`).

## Ingest & persistence

- The inbox parses kind-4 content; a valid `call-log` is stored as a regular
  `MessageRecord` — content stays the raw JSON, rendering decides what it
  is. No Dexie schema change, no migration.
- The record sorts, paginates, dedups, and virtualizes like any message.
- The caller stores its own copy optimistically and publishes through the
  normal DM send path (existing `sending/sent/failed` status handling; no
  extra retry).
- Caller multi-device: only the in-call device publishes (it holds the
  `callId`), but all the caller's devices ingest the outgoing kind 4 via
  existing backfill, so histories converge.

## UI

### CallRow

A message whose content parses as `call-log` renders as a centered system
row instead of a bubble (new `src/components/Chat/CallRow.tsx`, branch in
the message list): phone/camera icon + label + time, duration appended for
`completed`. Perspective from `pubkey === myPubkey`:

| outcome   | caller sees        | callee sees            |
|-----------|--------------------|------------------------|
| completed | Video call · 12:34 | Video call · 12:34     |
| missed    | Call · no answer   | **Missed call** (red)  |
| declined  | Call declined      | Call declined          |
| busy      | Call · busy        | Missed call · busy     |

- Clicking the row calls the peer back (`initiateCall` with the row's
  `mediaType`), disabled while any call is active (`activeCallType`).
- Call rows are excluded from reply/edit/delete/reaction affordances and
  from message search results.

### Sidebar preview

The chat preview shows the derived label ("Missed call", "Video call")
instead of raw JSON, using the same parse as rendering.

### Group call-start row

`routeCallStart` (`src/lib/inbox.ts`) currently updates the preview and
fires a notification but stores no message. Change: also store the control
event as a `MessageRecord`, rendered as a system row — "Call started" with
the starter's name. Notification and preview behavior unchanged.

## Badge & notifications

- **Missed calls** (`missed`, and `busy` seen from the callee side) bump the
  chat's unread badge and fire a browser notification ("Missed call from
  X") through the existing DM notification path — fresh events only (not
  backfill), respecting per-chat mute.
- **Completed/declined** rows arrive silently and are excluded from the
  unread count: the recipient was in (or explicitly declined) the call, so
  nothing is unread. This is a small special case in the badge logic.
- **Group call-start** rows keep their existing notification and count as
  unread — in a room model the start announcement is the "you might be
  missing this" signal.

## Error handling

- call-log publish failure: existing message status handling (`failed`),
  no bespoke retry.
- Malformed inbound payloads: normal-message fallback, drop nothing.
- Replayed/duplicate events: existing kind-4 dedup.

## Testing

- `src/lib/callLog.ts` unit tests: payload build/parse/validate round-trip,
  malformed/oversized rejection, outcome-derivation table, perspective
  label table, sidebar preview text.
- Inbox tests: call-log stored as message + preview set; `missed` fires a
  notification only when fresh and unmuted; malformed falls back to a
  normal message; group call-start now stores a row (update the existing
  "no message stored" test).
- `CallContext` tests: publishes the right outcome on each terminal
  transition (connected → hangup = `completed` + duration; calling →
  hangup = `missed`; received `rejected` / `busy` → `declined` / `busy`);
  callee publishes nothing.
- Badge logic: missed counts toward unread; completed/declined do not.
- Manual (two browser profiles, live relay): missed call while the callee's
  app is closed (durable-marker path), completed call rows on both sides,
  call-back from a row, group call-start row, phone-width viewport.

## Known limits (accepted)

- Caller crash mid-call leaves no record.
- Group calls get start-only records (no end/duration).
- Other NIP-04 clients render the JSON payload as text — same posture as
  the existing edit/delete controls.
- No ring timeout: a missed call is only logged when the caller gives up
  and hangs up.
- No dedicated Calls tab in v1; call-log records in the messages table
  support building one later.
