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

### Changes

#### Full Sign-out Cleanup
Logging out now deletes the encrypted key, the device wrap key, and the stored sign-in method (in addition to clearing the in-memory key and active account), so no key material is left at rest for the next person to use the device. The deletion completes before the database is closed.

