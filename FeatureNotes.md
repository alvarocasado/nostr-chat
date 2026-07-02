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
