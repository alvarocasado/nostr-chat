# Feature Notes

## Unreleased

### Priority 3 — features users expect

- **Mentions (NIP-27).** Mentions are now detected from `p` tags and decoded
  `npub`/`nprofile` references instead of a fragile substring match, so unread
  "mention" counts and mention notifications are reliable. Outgoing channel
  messages emit mention `p` tags, and mentions render as clickable chips that
  open the mentioned profile.
- **NIP-05.** Add a contact by typing a `name@domain` identifier — it is
  resolved to a pubkey via the domain's `.well-known/nostr.json`. Verified
  NIP-05 identities show a badge on the profile card (amber warning when the
  identifier does not match).
- **Reactions.** Hover a message to pick an emoji; tap a reaction pill to
  toggle your own. Works in channels, DMs, and groups. Reactions in DMs and
  groups stay end-to-end encrypted (they ride the existing encrypted transport
  rather than public reaction events), so they are not visible to relays.
- **Edit & delete.** Edit or delete your own messages from the "⋯" menu.
  Edited messages show a "· edited" marker; deleted messages show a tombstone.
  Editing is limited to text messages. Note: deletion is advisory on Nostr —
  relays may retain the original event, so the tombstone reflects local
  honoring rather than guaranteed erasure. Like reactions, edits and deletes
  in DMs and groups remain end-to-end encrypted.
- **Read receipts (opt-in).** Turn on "Send read receipts" in Settings >
  Privacy to see a purple double-check when a contact has read your direct
  message. Off by default and reciprocal: you only see others' read status
  while you share yours. DMs only. Receipts travel as ephemeral encrypted
  events — relays never store them, so no persistent trail of who-read-what
  is created. If the sender is offline at that moment, the receipt arrives
  the next time you both have the conversation open.
- **Reliable sent ticks.** Message send status is now stored locally, so
  sent (and read) checkmarks survive a page reload instead of reverting to
  a spinner.
- **Group calls.** Start a voice or video call from a group's header; members
  see a "Call in progress" banner and join or leave freely (up to 6
  participants). Calls are serverless: media flows peer-to-peer between all
  participants, and coordination rides ephemeral encrypted Nostr events that
  relays never store. Late joining works; if someone's app crashes they
  disappear from the call within about 90 seconds. Group calls and 1:1 calls
  are mutually exclusive - you are "busy" to one while in the other.
- **Call history / missed-call records** (2026-07-03). Spec:
  `docs/superpowers/specs/2026-07-03-call-history-design.md`. Plan:
  `docs/superpowers/plans/2026-07-03-call-history.md`. 1:1 calls leave inline
  system rows in the DM thread: the caller publishes one kind-4 control DM
  (`{type:'call-log'}` with outcome completed/missed/declined/busy, plus
  duration for completed) at call end, riding the existing DM sync/backfill
  so missed calls surface even if the callee's app was closed. Missed/busy
  outcomes bump the unread badge and fire a notification; completed/declined
  are silent. Rows are perspective-aware, clickable to call back, and
  excluded from search, reply, edit, and reactions. Group threads store and
  render "X started a call" rows from the existing call-start control.
  Accepted limits: if the caller's app crashes before it can publish the
  control DM, no record is created; group calls only get start-only records
  (no per-member join/leave or outcome rows); there is no dedicated Calls tab
  in v1 (history lives inline in the thread); and there is no ring timeout —
  a call is logged missed only when the caller gives up and hangs up.
  Live verification (2026-07-05, two accounts over public relays): missed,
  completed, declined, call-back-from-row, offline missed call (app closed
  during the call, record appeared on next open via backfill), badge rules
  (only missed counts), search exclusion, and phone-width rendering all
  verified. The group "started a call" row could not be live-verified —
  blocked by the pre-existing group transport issue below (it is covered by
  unit tests). Verification surfaced and fixed a session-restore bug: inbox
  subscriptions never started on restored sessions because the signer is
  installed after the store rehydrates (see `useGlobalInbox` signerCaps dep).

### Known issues discovered during live verification (2026-07-05)

- **Private groups on strict public relays — FIXED and live-verified.**
  Group events now ride NIP-29-style `['h', groupId]` tags instead of
  non-hex `e` tags (which damus, nos.lol, and snort rejected). Group ids,
  storage, invites, and key backups are unchanged; no migration. Spec:
  `docs/superpowers/specs/2026-07-05-group-h-tag-design.md`. Live
  cross-account verification (2026-07-06, two accounts over public relays):
  group message delivered both ways; group call banner + join; two-party
  mesh connected ("2 in call" on both sides, presence heartbeats over
  `#h`); "started a call" rows rendered on both sides — closing the last
  deferred call-history checklist item. Note: the started-a-call
  notification is correctly suppressed when the recipient is already
  viewing that group with the tab visible (`notifications.ts` contextual
  suppression). New minor found: the invitee's group header shows
  "1 members" (invite handler stores only the joiner in `memberPubkeys`);
  cosmetic, count is wrong only on the invitee side.
- **Ghost ring on app open — FIXED.** Call signals (kind 24100) older than
  60 seconds are dropped before decryption in both the 1:1 and group signal
  subscriptions (`isStaleCallSignal` in `src/lib/webrtc.ts`), so relays
  that replay "ephemeral" call-offers can no longer ring the callee for an
  already-ended call, and replayed duplicate offers can no longer disturb a
  live group call. Trade-off: a caller whose clock runs more than 60 s slow
  cannot ring you (NTP keeps real devices within seconds). Spec:
  `docs/superpowers/specs/2026-07-06-stale-call-signal-gate-design.md`.
- **Mobile drawer renders empty after a live desktop-to-phone resize**
  (reload at phone width is fine). Cosmetic, dev-tools-emulation scenario.
