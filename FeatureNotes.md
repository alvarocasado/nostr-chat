# Feature Notes

## Unreleased

### Cross-device sync via Nostr relays

Contacts, joined channels, and settings are now stored on the user's own relays and automatically synced across devices — no external service required.

**What syncs:**
- **Contacts** (NIP-02, kind 3) — DM contact list published as a replaceable event; merged (additive) on login
- **Joined channels** (NIP-51, kind 30001, `d=joined-channels`) — list of joined channel IDs; merged (additive) on login
- **Settings** (NIP-78, kind 30078, `d=nostr-chat-settings`) — notification preferences, muted chats, and relay list; NIP-04 encrypted to the user's own public key; applied on login if the relay event is newer than the last known sync

**How it works:**
- On login, the app fetches all three event kinds from the user's relays via `syncFromRelays()` and merges the results into local state in the background (login is never blocked)
- After any contact, channel, or settings mutation the relevant event is republished to relays with a 1.5 s debounce to avoid spamming
- Settings conflicts use a `syncedSettingsAt` timestamp: relay settings only overwrite local ones when the relay event is strictly newer than the last settings event received or published from this device

**New files:** `src/lib/nostrSync.ts` — all event builders, fetch functions, publish helpers, and debounce utility

**Limitations:**
- Contact *removals* do not propagate (union-only merge); removed contacts must be deleted on each device separately
- Message history is not synced separately — it is already relay-sourced via live subscriptions
