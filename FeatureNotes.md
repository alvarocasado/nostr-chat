# Feature Notes

## Unreleased

### Features

#### Signer Abstraction
All signing and encryption now flow through a single `Signer` interface (a module singleton, like the existing relay pool and per-user database) instead of passing the raw secret key around the app. Two implementations back it: a `LocalSigner` that holds a key in memory, and a `Nip07Signer` that delegates to a browser extension. This is the seam the rest of this work — and the planned NIP-44/NIP-17 encrypted-DM work — builds on; it carries a `caps` capability flag (currently `nip04`) that the UI reads to enable or degrade features per signer.

#### Private Key Encrypted at Rest
The Nostr private key is no longer stored in plaintext. Previously the key sat unencrypted in the browser's IndexedDB, readable by anyone with device access or any script-injection. Now, by default, the key is wrapped with a non-extractable device key (AES-GCM) so its raw bytes can't be read out of the database. This is honest obfuscation, not a vault — on-device code can still ask the browser to decrypt — but it removes plaintext-at-rest and is the baseline for the opt-in passphrase below. Existing users are migrated transparently on next load: the old plaintext key is re-wrapped and stripped from storage with no action required. The in-memory `nsec` for export is recomputed from the unlocked key and is never persisted.

#### Opt-in Passphrase
You can protect your key with a passphrase (Settings → Keys). When set, the key is encrypted with a passphrase-derived key (PBKDF2-SHA-256, 600k iterations, salt and iteration count stored per record) and the device key is removed — the passphrase becomes the only way in. On a cold start, a new Unlock screen asks for it before the app loads; a wrong passphrase is rejected cleanly. You can set, change, or remove the passphrase at any time (removing reverts to device protection). Re-logging in with the same key no longer silently downgrades passphrase protection back to device mode.

#### Login with a Browser Extension (NIP-07)
On desktop browsers with a Nostr signer extension installed (Alby, nos2x, etc.), a "Login with Extension" option lets you sign in without ever pasting your nsec into the app — the extension holds the key and performs signing. No secret is stored locally for extension logins. On reload the app re-acquires the signer from the extension; if the extension is missing, a Reconnect screen lets you retry or switch to a different account. The option only appears when an extension is present, so mobile and extension-less browsers are unaffected and continue to use the local-key path (which works on every platform).

#### Graceful Degradation for Limited Signers
Some extensions implement newer encryption (NIP-44) but not the NIP-04 this app currently uses for DMs, calls, and group-key backups. When you sign in with such a signer, those features are disabled with a clear in-app notice and public channels keep working — rather than failing silently. This is forward-compatible with the planned NIP-44 migration.

#### Scalable Message History (Virtualization + Backfill)
Long conversations are now fast and their full history is reachable. Previously the app loaded a chat's entire local history into memory and rendered every message into the page at once, so big channels janked and bloated memory; and history older than the most recent batch the relays returned was simply unreachable. Now the message list is virtualized — only the messages on screen are rendered — so scrolling stays smooth no matter how long the chat is. Opening a chat loads just the most recent page; scrolling up loads older messages a page at a time, first from the local database and then, once local history runs out, by backfilling from the relays. The list stays anchored to the message you're reading while older ones load in above. Jumping to a message (for example from search) now pages history back until it finds the target, then scrolls to and highlights it; if it truly can't be found, a brief "Message not available" notice appears. Virtualization especially helps lower-powered phones, and the scroll, anchoring, and keyboard behavior are tuned for mobile browsers and the installed PWA.

#### Off-Relay File Transfer (Blossom)
Files no longer travel over relays. Previously a large attachment was split into hundreds of sequential events and reassembled on the other side — fragile (one dropped piece silently failed the whole transfer), abusive to relays, and discarded after 15 minutes. Now files above 150 KB are uploaded to a Blossom media server and the message carries just a link plus a content hash. Privacy is preserved: files in direct messages and groups are encrypted on your device before upload (a fresh per-file key that travels only inside the already-encrypted message), so the server stores nothing but opaque ciphertext; public-channel files are uploaded as-is. On the receiving side the app downloads the file, verifies its SHA-256 hash before showing it (a tampered or substituted file is rejected, never rendered), and decrypts it for private chats. The media server is configurable in Settings → Files (default included) and only the sender needs one — recipients fetch from the link. Group chats can now send files for the first time. Small images stay inline as before, and files sent with the old chunked method still display.

#### Relay Read/Write Lists (NIP-65)
The app now follows the NIP-65 "outbox" convention for relays. Each relay can be marked Read, Write, or both in Settings → Relays, and the app publishes a standard relay-list event (kind 10002) so other Nostr clients can discover where to reach you. Your own messages and events are sent to your write relays, and your inbox is read from your read relays, instead of fanning every request out to every relay. On sign-in the app adopts your published relay list as the source of truth. This is a behavior-preserving change by default: until you deliberately split a relay into read-only or write-only, every relay stays both, so routing is identical to before.

The app now also routes through *other people's* relay lists — the full outbox model. The first time you message someone, open their profile, or load their messages, the app looks up their published relay list (cached for a day) and uses it: a direct message is sent to the recipient's read relays so it reaches them, their replies are read from their write relays, and a contact's profile is fetched from where they publish it. If someone hasn't published a relay list, the app falls back to your own relays exactly as before, so nothing breaks. This makes direct messages far more likely to be delivered and seen across the wider Nostr network, with less wasted traffic. (Channels and groups continue to use your own relays.)

### Changes

#### Full Sign-out Cleanup
Logging out now deletes the encrypted key, the device wrap key, and the stored sign-in method (in addition to clearing the in-memory key and active account), so no key material is left at rest for the next person to use the device. The deletion completes before the database is closed.

#### Deduplicated Direct-Message Subscriptions
Incoming direct messages were being fetched and decrypted twice. Two separate listeners — the global inbox and a dedicated group-invite watcher — each opened the same relay subscription for kind-4 DMs addressed to you and independently ran the NIP-04 decryption on every one. Group-invite handling now lives in the shared message processor, so a single subscription decrypts each DM once and routes it to either the chat flow or the invite-join flow. This halves the relay load and per-message decryption work for DMs, and removes a redundant subscription. Joining a group from an invite remains idempotent — replays from overlapping subscriptions or relay backfill can't add a group twice or re-publish its key backup.

