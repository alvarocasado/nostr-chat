# Feature Notes

## Unreleased

### Per-user IndexedDB storage (Dexie.js)

All app data is now stored in a per-user IndexedDB database (`nostr-chat-<pubkey>`), fully scoped to the logged-in Nostr identity.

**What's persisted per user:**
- Contacts (DM list) with profiles, last message, and unread counts
- Channels and joined channel IDs
- Cached Nostr profiles
- Notification settings
- Relays, public key, and auth credentials
- Call settings (TURN/media device config)
- Chat messages (7-day rolling TTL, evicted on startup)

**Key behaviors:**
- Switching users loads that user's own contacts, channels, and settings — no data leakage between accounts
- Messages are cached for offline viewing and automatically purged after 7 days
- On startup the app reads `nostr-active-pubkey` from localStorage, opens the matching Dexie DB, evicts old messages, then rehydrates Zustand — all before rendering

### TURN subdomain fix

Fixed a URL construction bug where saving a Metered.ca subdomain would produce `<subdomain>.metered.live.metered.live` (double domain suffix). The subdomain input now strips any trailing `.metered.live` before saving.
