# Private Groups Design

**Date:** 2026-05-15
**Status:** Approved for implementation

## Summary

Add encrypted private group chats to nostr-chat. Groups sit in the existing "Contacts" nav slot (repurposed — same Users icon, relabeled "Groups"). Messages use a shared AES-256-GCM symmetric key distributed via NIP-04 DMs. Group keys are backed up to relays via a self-encrypted kind-30041 event, enabling cross-device key recovery without depending on DM history retention.

---

## Architecture

Four new pieces; everything else reuses existing infrastructure unchanged.

| New piece | What it is |
|-----------|-----------|
| `Group` type + store slice | Parallel to `Channel` — groups list, group keys (persisted), actions |
| `lib/nostr.ts` additions | AES-GCM encrypt/decrypt, kind-10042 message builder, kind-30040 metadata builder, kind-30041 key backup builder, group invite builder |
| `useGroupMessages` hook | Subscribes to kind-10042 events tagged with groupId, decrypts with group key |
| Groups panel in Sidebar | Replaces Contacts section — scoped search, `GroupItem` list, `AddGroupModal` |

**Unchanged:** `messages` store (keyed by chatId), Dexie messages table, `markRead`, `seenAt`, `mutedChats`, drafts, `MuteButton`, global search. `MessageThread` gets a `'group'` case added but its structure is unchanged.

---

## Store

### New types

```ts
export type ChatType = 'channel' | 'dm' | 'group'

export interface Group {
  id: string             // random UUID, stable group identifier
  name: string
  about?: string
  creatorPubkey: string
  memberPubkeys: string[]
  relayUrl: string
  lastMessage?: string
  lastMessageAt?: number
  unread?: number
  mentions?: number
}
```

### New state fields

```ts
groups: Group[]                        // persisted in Dexie
groupKeys: Record<string, string>      // groupId → AES-key-hex, also persisted
```

Both fields are included in `partialize` (same security boundary as `privateKeyHex`). `groupKeys` in Dexie is a fast-path for same-device restarts; kind-30041 relay backup is the authoritative cross-device source.

### New actions

```ts
addGroup(group: Group): void
removeGroup(id: string): void
updateGroupLastMessage(groupId: string, content: string, at: number, isMention?: boolean): void
setGroupKey(groupId: string, keyHex: string): void
```

All structurally identical to their `Channel` / `Contact` equivalents.

---

## Nostr Protocol

### Event kinds

| Kind | Type | Purpose |
|------|------|---------|
| `10042` | Regular | Group message. Tags: `['e', groupId, relayUrl, 'root']`. Content: `base64(iv + ciphertext)` from AES-256-GCM. |
| `30040` | Parameterized replaceable | Group metadata. Tags: `['d', groupId]`. Content: group key–encrypted JSON `{ name, about, memberPubkeys }`. |
| `30041` | Parameterized replaceable | Self-encrypted key backup. Tags: `['d', groupId]`. Content: group key hex NIP-04 encrypted with own privkey to own pubkey (sender = recipient = self). |
| `4` (existing) | Encrypted DM | Group invite. Plaintext payload: `{ type: 'group_invite', groupId, groupKeyHex, groupName }`. |

**Group ID:** a random UUID generated locally at creation time. Used as the `d` tag in kind-30040/30041 and the `e` tag in kind-10042. Stable across relay hops — not a Nostr event ID.

### New lib/nostr.ts functions

```ts
// AES-256-GCM helpers
export async function encryptWithGroupKey(plaintext: string, keyHex: string): Promise<string>
export async function decryptWithGroupKey(ciphertext: string, keyHex: string): Promise<string>

// Event builders
export function buildGroupMessageEvent(sk, encryptedContent, groupId, relayUrl, replyEventId?): Event
export function buildGroupMetadataEvent(sk, groupKeyHex, groupId, name, about, members): Promise<Event>
export function buildGroupKeyBackupEvent(sk, groupId, groupKeyHex): Promise<Event>
export async function buildGroupInviteEvent(sk, recipientPubkey, groupId, groupKeyHex, groupName): Promise<Event>
```

### Key lifecycle

1. **Create group**
   - Generate 32-byte random AES key
   - Publish kind-30040 (encrypted metadata)
   - Send kind-4 invite DMs to each initial member
   - Publish kind-30041 self-encrypted key backup

2. **Receive invite**
   - DM subscription detects `{ type: 'group_invite', ... }` in decrypted kind-4 payload
   - Call `addGroup` + `setGroupKey` in store
   - Publish own kind-30041 self-encrypted backup for that groupId
   - Subscribe to kind-10042 for that groupId

3. **Login / new device**
   - `syncFromRelays` fetches all kind-30041 events authored by self
   - NIP-04 decrypt each → `setGroupKey` for each groupId
   - Group subscriptions start once keys are available

4. **Remove member**
   - Creator-only action
   - Generate new 32-byte AES key
   - Republish kind-30040 with new key
   - Send new invite DMs to remaining members
   - Publish updated kind-30041 with new key
   - Old messages remain readable with the old key (no re-encryption)

---

## UI Components

### Sidebar (modified)

- `SidebarSection` type: `'contacts'` → `'groups'`
- `SECTION_LABELS`: `groups: 'Groups'`
- Nav rail button: Users icon, label "Groups" (icon unchanged from current Contacts button)
- `groupsSection` panel: scoped search input + `GroupItem` list + `+` button in header that opens `AddGroupModal`
- Unread dot on nav rail button mirrors the existing DMs unread indicator pattern

### New: `GroupItem` component

Located in `src/components/Chat/Sidebar.tsx` alongside `ChannelItem` and `ContactItem`.

- Same layout as `ChannelItem`: avatar area, name, last message preview, timestamp, unread badge
- Avatar: lock icon on a gradient background (active) or gray background (inactive)
- Subtitle when no last message: member count ("3 members")
- Includes `MuteButton` — no store changes needed

### New: `AddGroupModal` component

Located at `src/components/Chat/AddGroupModal.tsx`. Mirrors `AddChannelModal` structure.

Two-step flow:
1. Name + about fields
2. Add members by pubkey or npub (same pattern as `AddContactModal`)

On confirm:
- Generate group key
- `addGroup` + `setGroupKey` in store
- Publish kind-30040, kind-30041
- Send kind-4 invite DMs to each member
- `setActiveChat(groupId, 'group')`
- Close modal

Error state: surfaces relay publish failures inline; group not added to store if creation fails.

### MessageThread (small addition)

- Send path: adds `'group'` branch → encrypts content with group key → calls `buildGroupMessageEvent`
- Receive/render path: group messages pass through `decryptWithGroupKey(content, groupKey)` before display
- If group key not yet in memory (login race): per-message "Decrypting…" placeholder; re-renders once key arrives via kind-30041 fetch

---

## Subscription Hook

### New: `useGroupMessages(groupId: string | null)`

Located in `src/hooks/useNostrSubscriptions.ts`.

```ts
subscribeEvents(
  relays,
  { kinds: [10042], '#e': [groupId], limit: 200 },
  async (event) => {
    const key = groupKeys[groupId]
    if (!key) return  // key arrives later via kind-30041 fetch; re-subscription not needed
    const plaintext = await decryptWithGroupKey(event.content, key)
    // build Message, call addMessage, updateGroupLastMessage
  }
)
```

### Existing DM subscription (extended)

After decrypting a kind-4 DM, check if plaintext parses as `{ type: 'group_invite', groupId, groupKeyHex, groupName }`. If so:
- `addGroup` with the group metadata
- `setGroupKey`
- Publish own kind-30041 backup
- Fire notification if not muted

### syncFromRelays (extended)

On login, after existing contact/channel/settings sync, also fetch:
```
{ kinds: [30041], authors: [publicKey] }
```
For each result, NIP-04 decrypt content → `setGroupKey(groupId, keyHex)`.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Group key not in memory at render time | Per-message "Decrypting…" placeholder; resolves when kind-30041 fetch completes |
| Decryption failure (corrupted or wrong key) | Message shown as `[encrypted message]` — no crash |
| Invite DM send fails | Error surfaced in `AddGroupModal`; group not added to store |
| kind-30041 publish fails | Logged silently; group still works on current device via Dexie; retry on next key rotation |
| Member removal + key rotation failure | Old key remains active; creator sees error; existing members unaffected |

---

## Testing

- Unit: AES-GCM encrypt/decrypt roundtrip in `lib/nostr.ts`
- Unit: `buildGroupInviteEvent` / `buildGroupKeyBackupEvent` event shape
- Store: `addGroup`, `removeGroup`, `setGroupKey`, `updateGroupLastMessage`
- Component: `GroupItem` renders correctly with/without last message, with unread badge
- Component: `AddGroupModal` create flow (mocked relay publish)
- Integration: invite received → group appears in sidebar → messages decrypt correctly

---

## Out of Scope

- Group admin UI (member list management, remove member) — key rotation logic is designed for it but the UI ships separately
- Read receipts in groups
- NIP-29 migration path — architecture is compatible; `ChatType: 'group'` can route to NIP-29 later without touching the rest of the codebase
