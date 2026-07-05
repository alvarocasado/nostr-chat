# Group Transport: h-Tag Addressing — Design Spec

Date: 2026-07-05
Status: Approved for planning

## Problem

Private-group events carry the group id (a UUID) in an `e` tag. Strict public
relays validate `e` tags as 64-hex event ids and reject such events with
"invalid: unexpected size for fixed-size tag: e" — verified live against
relay.damus.io, nos.lol, and relay.snort.social on 2026-07-05. Every group
message (kind 1042), group typing indicator (kind 24101), and group-call
presence heartbeat (kind 24103) is affected. The bug went unnoticed because
senders render their own messages optimistically and groups were never tested
cross-account over a live network.

## Fix

Move group addressing from `['e', groupId]` to `['h', groupId]` — the
NIP-29 group-tag convention. Relays index all single-letter tags without
hex validation; verified live on 2026-07-05: relay.damus.io, nos.lol,
relay.snort.social, and relay.primal.net all accept kind-1042 events with
`['h', <uuid>]` AND return them for `{"#h": [<uuid>]}` filters.

Group ids stay UUIDs. Nothing about id generation, storage, or exchange
changes.

## Scope

### Publish surfaces (3)

- `buildGroupMessageEvent` (src/lib/nostr.ts): root tag becomes
  `['h', groupId, relayUrl]`. A reply tag remains `['e', replyEventId, '',
  'reply']` — reply targets are real 64-hex event ids, valid and semantically
  correct as `e`.
- `buildTypingEvent` (src/lib/nostr.ts) + `useTypingIndicator`
  (src/hooks/useTypingIndicator.ts): gain an explicit `'group'` chat type
  that tags `['h', chatId]` and filters `'#h'`. The group thread passes
  `'group'` instead of reusing `'channel'`. DMs (p tags) and channels
  (hex-id e tags) are unchanged.
- `buildPresenceEvent` (src/lib/groupCall.ts): tags `['h', groupId]`.

### Read surfaces (5 filters + routing)

- Per-group message subscription (`useGroupMessages`) and the global groups
  subscription (`useGlobalInbox`) filter `'#h': [...]`.
- Group history backfill (src/lib/history.ts, group branch) filters `'#h'`.
- Group typing subscription filters `'#h'`.
- Group-call presence subscription (GroupCallContext) filters `'#h'`.
- Routing: new pure helper `extractGroupId(tags: string[][]): string | null`
  in src/lib/inbox.ts returns the first `h` tag value (null when absent).
  Group event handlers route by it. `extractRootChatId` stays as-is for
  channels and reply resolution.

### Explicitly unchanged

- Group id generation (UUID via `crypto.randomUUID` in AddGroupModal).
- Dexie `chatId` keys, store `groups[].id`, `groupKeys` map.
- Group invites (kind-4 payload, no group tag).
- Group metadata (kind 30040) and key backups (kind 30041) — `d` tags accept
  arbitrary strings.
- Channels (kind 40/42) — their ids are 64-hex event ids; `e` tags valid.
- 1:1 calls, DMs, call history.

## Compatibility decisions

- **No dual-read of old `#e` group events.** Relay probes on 2026-07-05
  found zero e-tagged group events stored on any configured relay (strict
  relays rejected them at publish time), and local history is served from
  Dexie regardless of tag scheme. A clean cut loses nothing.
- **Legacy kind 10042** stays in the group read filters, now under `#h`,
  same reasoning.
- **Version skew**: an old client publishing after this ships would emit
  e-tagged events invisible to new clients (and rejected by strict relays
  anyway). Accepted — the app is pre-release alpha with no functioning
  cross-account groups to break.

## Error handling

- Group events without an `h` tag (or with a non-matching one) are dropped
  by routing exactly as unmatched `e`-tag events are today.
- No new failure modes: publish/subscribe paths are otherwise unchanged.

## Testing

- Unit: tag assertions for `buildGroupMessageEvent` (h root + e reply),
  `buildTypingEvent('group', …)`, `buildPresenceEvent`; `extractGroupId`
  (present / absent / malformed tags); filter-shape assertions updated in
  history, groupCall, typing, and subscription tests; a regression test
  pins that channel messages and channel typing still use `e`/`#e`, and DM
  typing still uses `p`.
- Live cross-account verification (two accounts over public relays, same
  setup as the 2026-07-05 session): group message send/receive both ways
  (previously impossible), group typing indicator, group call start →
  banner + notification on the other account, and the call-history
  "started a call" row — closing the item deferred from the call-history
  checklist.

## Known limits (accepted)

- `h` is the NIP-29 group tag; this app's kinds (1042, 24101, 24103) are
  app-custom, so no cross-client interop is implied or attempted.
- Relays that index only a fixed allowlist of tag letters (rare) would not
  serve `#h` filters; the four default relays are verified working.
