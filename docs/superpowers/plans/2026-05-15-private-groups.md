# Private Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add encrypted private group chats using a shared AES-256-GCM key distributed via NIP-04 DMs, backed up to relays via self-encrypted kind-30041 events.

**Architecture:** Groups are a new `ChatType` ('group') with their own Zustand slice, Nostr event kinds (10042 messages, 30040 metadata, 30041 key backup), and sidebar panel replacing the unused Contacts section. Crypto helpers live in a dedicated `groupCrypto.ts` module. Group keys are persisted in Dexie and recovered cross-device via kind-30041 relay events fetched at login.

**Tech Stack:** TypeScript, React, Zustand, Dexie, nostr-tools (NIP-04, finalizeEvent), Web Crypto API (AES-GCM), Vitest, Tailwind CSS, Lucide React

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/groupCrypto.ts` | AES-256-GCM encrypt/decrypt, key generation |
| Create | `src/__tests__/groupCrypto.test.ts` | Crypto roundtrip tests |
| Modify | `src/lib/nostr.ts` | Add `fetchEvents` helper + group event builders |
| Modify | `src/lib/nostrSync.ts` | Add `fetchGroupKeys`, extend `SyncResult` + `syncFromRelays` |
| Modify | `src/store/nostrStore.ts` | `Group` type, `ChatType` update, groups/groupKeys state + actions |
| Modify | `src/hooks/useNostrSubscriptions.ts` | `useGroupMessages` + `useGroupInviteListener` hooks |
| Modify | `src/components/Chat/Sidebar.tsx` | `GroupItem`, groups section, replace contacts section |
| Create | `src/components/Chat/AddGroupModal.tsx` | Group creation modal |
| Modify | `src/App.tsx` | Mount `AddGroupModal` + `useGroupInviteListener` |
| Modify | `src/components/Chat/MessageThread.tsx` | `GroupHeader`, `GroupThread`, dispatch 'group' case |
| Modify | `src/__tests__/store.test.ts` | Add group store action tests |

---

## Task 1: AES-256-GCM crypto helpers

**Files:**
- Create: `src/lib/groupCrypto.ts`
- Create: `src/__tests__/groupCrypto.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/groupCrypto.test.ts
import { describe, it, expect } from 'vitest'
import { generateGroupKey, encryptWithGroupKey, decryptWithGroupKey } from '../lib/groupCrypto'

describe('generateGroupKey', () => {
  it('returns a 64-char lowercase hex string', () => {
    expect(generateGroupKey()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique keys each call', () => {
    expect(generateGroupKey()).not.toBe(generateGroupKey())
  })
})

describe('encryptWithGroupKey / decryptWithGroupKey', () => {
  it('roundtrips plaintext', async () => {
    const key = generateGroupKey()
    const cipher = await encryptWithGroupKey('Hello, group!', key)
    expect(cipher).not.toBe('Hello, group!')
    expect(await decryptWithGroupKey(cipher, key)).toBe('Hello, group!')
  })

  it('produces different ciphertext for same input due to random IV', async () => {
    const key = generateGroupKey()
    const c1 = await encryptWithGroupKey('same', key)
    const c2 = await encryptWithGroupKey('same', key)
    expect(c1).not.toBe(c2)
  })

  it('throws when decrypting with the wrong key', async () => {
    const k1 = generateGroupKey()
    const k2 = generateGroupKey()
    const cipher = await encryptWithGroupKey('secret', k1)
    await expect(decryptWithGroupKey(cipher, k2)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npx vitest run src/__tests__/groupCrypto.test.ts
```

Expected: FAIL — "Cannot find module '../lib/groupCrypto'"

- [ ] **Step 3: Implement `src/lib/groupCrypto.ts`**

```ts
export function generateGroupKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export async function encryptWithGroupKey(plaintext: string, keyHex: string): Promise<string> {
  const key = await importGroupKey(keyHex)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  const combined = new Uint8Array(12 + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), 12)
  return btoa(String.fromCharCode(...combined))
}

export async function decryptWithGroupKey(ciphertext: string, keyHex: string): Promise<string> {
  const key = await importGroupKey(keyHex)
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12))
  return new TextDecoder().decode(plain)
}

async function importGroupKey(keyHex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(keyHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npx vitest run src/__tests__/groupCrypto.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/groupCrypto.ts src/__tests__/groupCrypto.test.ts
git commit -m "feat: add AES-256-GCM group crypto helpers"
```

---

## Task 2: Group event builders in nostr.ts

**Files:**
- Modify: `src/lib/nostr.ts`

- [ ] **Step 1: Add `fetchEvents` helper and group event builders**

Append to `src/lib/nostr.ts` (after the existing `publishEvent` function):

```ts
import { encryptWithGroupKey } from './groupCrypto'

// Fetch multiple events matching a filter (collects until EOSE)
export async function fetchEvents(relays: string[], filter: Filter): Promise<Event[]> {
  const p = getPool()
  const events: Event[] = []
  await new Promise<void>(resolve => {
    const sub = p.subscribeMany(relays, [filter], {
      onevent: (e) => events.push(e),
      oneose: () => { sub.close(); resolve() },
    })
  })
  return events
}

// Build kind-10042 group message event (content is pre-encrypted by caller)
export function buildGroupMessageEvent(
  sk: Uint8Array,
  encryptedContent: string,
  groupId: string,
  relayUrl: string,
  replyEventId?: string,
): Event {
  const tags: string[][] = [['e', groupId, relayUrl, 'root']]
  if (replyEventId) tags.push(['e', replyEventId, '', 'reply'])
  return finalizeEvent({ kind: 10042, created_at: Math.floor(Date.now() / 1000), tags, content: encryptedContent }, sk)
}

// Build kind-30040 group metadata event (content encrypted with group key)
export async function buildGroupMetadataEvent(
  sk: Uint8Array,
  groupKeyHex: string,
  groupId: string,
  name: string,
  about: string,
  memberPubkeys: string[],
): Promise<Event> {
  const encrypted = await encryptWithGroupKey(JSON.stringify({ name, about, memberPubkeys }), groupKeyHex)
  return finalizeEvent({ kind: 30040, created_at: Math.floor(Date.now() / 1000), tags: [['d', groupId]], content: encrypted }, sk)
}

// Build kind-30041 self-encrypted key backup (NIP-04 with own pubkey as recipient)
export async function buildGroupKeyBackupEvent(
  sk: Uint8Array,
  groupId: string,
  groupKeyHex: string,
): Promise<Event> {
  const ownPubkey = getPublicKey(sk)
  const encrypted = await nip04.encrypt(sk, ownPubkey, groupKeyHex)
  return finalizeEvent({ kind: 30041, created_at: Math.floor(Date.now() / 1000), tags: [['d', groupId]], content: encrypted }, sk)
}

// Build group invite as NIP-04 DM carrying { type: 'group_invite', groupId, groupKeyHex, groupName }
export async function buildGroupInviteEvent(
  sk: Uint8Array,
  recipientPubkey: string,
  groupId: string,
  groupKeyHex: string,
  groupName: string,
): Promise<Event> {
  const payload = JSON.stringify({ type: 'group_invite', groupId, groupKeyHex, groupName })
  const encrypted = await nip04.encrypt(sk, recipientPubkey, payload)
  return finalizeEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', recipientPubkey]], content: encrypted }, sk)
}
```

Note: `getPublicKey` is already imported from `nostr-tools` at the top of the file. Add the `encryptWithGroupKey` import right after the existing imports block.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/nostr.ts
git commit -m "feat: add group event builders and fetchEvents to nostr lib"
```

---

## Task 3: Extend nostrSync.ts for group key recovery

**Files:**
- Modify: `src/lib/nostrSync.ts`

- [ ] **Step 1: Add `fetchGroupKeys` and update `SyncResult` + `syncFromRelays`**

Add this import at the top of `src/lib/nostrSync.ts` (after the existing imports):

```ts
import { fetchEvents } from './nostr'
```

Add `fetchGroupKeys` function after the existing `publishAppSettings` block:

```ts
// ── Kind 30041 – self-encrypted group key backups ─────────────────────────────

export async function fetchGroupKeys(
  relays: string[],
  sk: Uint8Array,
  pubkey: string,
): Promise<Record<string, string>> {
  const events = await fetchEvents(relays, { kinds: [30041], authors: [pubkey] })
  const keys: Record<string, string> = {}
  for (const event of events) {
    const groupId = event.tags.find(t => t[0] === 'd')?.[1]
    if (!groupId) continue
    try {
      keys[groupId] = await nip04.decrypt(sk, pubkey, event.content)
    } catch {
      // corrupt or unrecognised — skip
    }
  }
  return keys
}
```

Update `SyncResult` to include `groupKeys`:

```ts
export interface SyncResult {
  contacts: { pubkeys: string[]; createdAt: number } | null
  channels: { channelIds: string[]; createdAt: number } | null
  settings: { settings: SyncedSettings; createdAt: number } | null
  groupKeys: Record<string, string>
}
```

Update `syncFromRelays` to run `fetchGroupKeys` in parallel:

```ts
export async function syncFromRelays(
  sk: Uint8Array,
  pubkey: string,
  relays: string[],
): Promise<SyncResult> {
  const [contacts, channels, settings, groupKeysResult] = await Promise.allSettled([
    fetchContactList(relays, pubkey),
    fetchChannelBookmarks(relays, pubkey),
    fetchAppSettings(relays, sk, pubkey),
    fetchGroupKeys(relays, sk, pubkey),
  ])
  return {
    contacts: contacts.status === 'fulfilled' ? contacts.value : null,
    channels: channels.status === 'fulfilled' ? channels.value : null,
    settings: settings.status === 'fulfilled' ? settings.value : null,
    groupKeys: groupKeysResult.status === 'fulfilled' ? groupKeysResult.value : {},
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors (the `SyncResult` change will surface a compile error in `nostrStore.ts` — that is expected; it gets fixed in Task 4)

- [ ] **Step 3: Commit**

```bash
git add src/lib/nostrSync.ts
git commit -m "feat: add group key recovery via kind-30041 relay fetch"
```

---

## Task 4: Store — Group type, state, and actions

**Files:**
- Modify: `src/store/nostrStore.ts`
- Modify: `src/__tests__/store.test.ts`

- [ ] **Step 1: Write failing store tests**

Append to `src/__tests__/store.test.ts`:

```ts
describe('group store actions', () => {
  const group = {
    id: 'group-1',
    name: 'Team Alpha',
    creatorPubkey: 'creator-pk',
    memberPubkeys: ['creator-pk', 'member-pk'],
    relayUrl: 'wss://relay.example.com',
  }

  it('addGroup adds a group', () => {
    useNostrStore.getState().addGroup(group)
    expect(useNostrStore.getState().groups).toHaveLength(1)
    expect(useNostrStore.getState().groups[0].name).toBe('Team Alpha')
  })

  it('addGroup is idempotent', () => {
    useNostrStore.getState().addGroup(group)
    useNostrStore.getState().addGroup(group)
    expect(useNostrStore.getState().groups).toHaveLength(1)
  })

  it('removeGroup removes by id', () => {
    useNostrStore.getState().addGroup(group)
    useNostrStore.getState().removeGroup('group-1')
    expect(useNostrStore.getState().groups).toHaveLength(0)
  })

  it('setGroupKey stores key by groupId', () => {
    useNostrStore.getState().setGroupKey('group-1', 'aabbcc')
    expect(useNostrStore.getState().groupKeys['group-1']).toBe('aabbcc')
  })

  it('updateGroupLastMessage updates the group', () => {
    useNostrStore.getState().addGroup(group)
    useNostrStore.getState().updateGroupLastMessage('group-1', 'hello', 100)
    const g = useNostrStore.getState().groups[0]
    expect(g.lastMessage).toBe('hello')
    expect(g.lastMessageAt).toBe(100)
    expect(g.unread).toBe(1)
  })

  it('markRead clears unread on groups', () => {
    useNostrStore.getState().addGroup(group)
    useNostrStore.getState().updateGroupLastMessage('group-1', 'hello', 100)
    useNostrStore.getState().markRead('group-1')
    expect(useNostrStore.getState().groups[0].unread).toBe(0)
  })
})
```

Also update the `beforeEach` reset in `store.test.ts` to include the new fields:

```ts
beforeEach(() => {
  useNostrStore.setState({
    privateKeyHex: null,
    publicKey: null,
    nsec: null,
    npub: null,
    profile: null,
    relays: [],
    channels: [],
    joinedChannelIds: [],
    contacts: [],
    groups: [],          // add
    groupKeys: {},       // add
    activeChatId: null,
    activeChatType: null,
    messages: {},
    profiles: {},
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npx vitest run src/__tests__/store.test.ts
```

Expected: FAIL — "groups is not iterable" or similar

- [ ] **Step 3: Add `Group` interface and update `ChatType`**

In `src/store/nostrStore.ts`, after the existing `export interface Contact { ... }` block, add:

```ts
export interface Group {
  id: string
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

Change line 24:

```ts
export type ChatType = 'channel' | 'dm' | 'group'
```

- [ ] **Step 4: Add state fields to `NostrState` interface**

Inside the `interface NostrState { ... }` block, add after the `contacts` line:

```ts
  // Groups
  groups: Group[]
  groupKeys: Record<string, string>

  // UI (add alongside showAddChannel / showAddContact)
  showAddGroup: boolean
```

Add action signatures after `setShowAddContact`:

```ts
  addGroup: (group: Group) => void
  removeGroup: (id: string) => void
  updateGroupLastMessage: (groupId: string, content: string, at: number, isMention?: boolean) => void
  setGroupKey: (groupId: string, keyHex: string) => void
  setShowAddGroup: (show: boolean) => void
```

- [ ] **Step 5: Add initial state values inside `create()`**

In the `return { ... }` block (after `showAddContact: false`), add:

```ts
        groups: [],
        groupKeys: {},
        showAddGroup: false,
```

- [ ] **Step 6: Add action implementations**

Add the following inside the `return { ... }` block, after the `leaveChannel` action:

```ts
        addGroup: (group) => {
          if (!get().groups.find(g => g.id === group.id)) {
            set({ groups: [group, ...get().groups] })
          }
        },

        removeGroup: (id) => {
          set({
            groups: get().groups.filter(g => g.id !== id),
            activeChatId: get().activeChatId === id ? null : get().activeChatId,
          })
        },

        updateGroupLastMessage: (groupId, content, at, isMention = false) => {
          const isActive = get().activeChatId === groupId
          set({
            groups: get().groups.map(g =>
              g.id === groupId
                ? {
                    ...g,
                    lastMessage: content,
                    lastMessageAt: at,
                    unread: isActive ? 0 : (g.unread || 0) + 1,
                    mentions: isActive ? 0 : isMention ? (g.mentions || 0) + 1 : (g.mentions || 0),
                  }
                : g
            ),
          })
        },

        setGroupKey: (groupId, keyHex) => {
          set({ groupKeys: { ...get().groupKeys, [groupId]: keyHex } })
        },

        setShowAddGroup: (show) => set({ showAddGroup: show }),
```

- [ ] **Step 7: Update `markRead` to clear group unread**

Find the existing `markRead` action and update it to also clear group unread:

```ts
        markRead: (chatId) => {
          const contacts = get().contacts.map(c =>
            c.pubkey === chatId ? { ...c, unread: 0 } : c
          )
          const channels = get().channels.map(ch =>
            ch.id === chatId ? { ...ch, unread: 0, mentions: 0 } : ch
          )
          const groups = get().groups.map(g =>
            g.id === chatId ? { ...g, unread: 0, mentions: 0 } : g
          )
          set({ contacts, channels, groups })
        },
```

- [ ] **Step 8: Update `partialize` to persist groups and groupKeys**

In the `partialize: (state) => ({...})` block at the bottom of the file, add:

```ts
        groups: state.groups,
        groupKeys: state.groupKeys,
```

- [ ] **Step 9: Wire up group keys from relay sync in `completeLogin`**

In the `completeLogin` function (around line 245 where `syncFromRelays` result is handled), add after the existing settings handling:

```ts
    // Group keys: relay backup takes priority for keys we don't have locally
    if (result.groupKeys && Object.keys(result.groupKeys).length > 0) {
      const current = get().groupKeys
      const merged = { ...result.groupKeys, ...current } // local keys take precedence
      set({ groupKeys: merged })
    }
```

- [ ] **Step 10: Run tests — confirm they pass**

```bash
npx vitest run src/__tests__/store.test.ts
```

Expected: PASS (all existing + 6 new group tests)

- [ ] **Step 11: Commit**

```bash
git add src/store/nostrStore.ts src/__tests__/store.test.ts
git commit -m "feat: add Group type, state, and actions to store"
```

---

## Task 5: useGroupMessages and useGroupInviteListener hooks

**Files:**
- Modify: `src/hooks/useNostrSubscriptions.ts`

- [ ] **Step 1: Add imports**

In `src/hooks/useNostrSubscriptions.ts`:

Replace the existing `nostr` import block with this expanded version:
```ts
import {
  subscribeEvents,
  publishEvent,
  parseProfile,
  decryptDM,
  buildChannelCreateEvent,
  buildChannelMessageEvent,
  buildDMEvent,
  buildProfileEvent,
  fetchEvent,
  buildGroupKeyBackupEvent,
  type NostrProfile,
} from '../lib/nostr'
```

Add after the existing store import:
```ts
import { decryptWithGroupKey } from '../lib/groupCrypto'
```

Update the store import to include `Group`:
```ts
import { useNostrStore, type Channel, type Message, type Group } from '../store/nostrStore'
```

- [ ] **Step 2: Add `useGroupMessages` hook**

Append to `src/hooks/useNostrSubscriptions.ts`, after `useChannelDiscovery`:

```ts
// Hook to subscribe to encrypted group messages
export function useGroupMessages(groupId: string | null) {
  const { relays, groupKeys, addMessage, updateGroupLastMessage, setProfile, profiles, publicKey } = useNostrStore()
  const groupKey = groupId ? groupKeys[groupId] : null

  useEffect(() => {
    if (!groupId || !groupKey) return

    const sub = subscribeEvents(
      relays,
      { kinds: [10042], '#e': [groupId], limit: 200 },
      async (event) => {
        try {
          const plaintext = await decryptWithGroupKey(event.content, groupKey)
          if (plaintext.length > MAX_CONTENT_LEN) return

          const msg: Message = {
            id: event.id,
            pubkey: event.pubkey,
            content: plaintext,
            createdAt: event.created_at,
            tags: event.tags,
            kind: event.kind,
          }
          addMessage(groupId, msg)

          const { publicKey: pk, groups } = useNostrStore.getState()
          const isMention = !!(pk && plaintext.includes(pk))
          updateGroupLastMessage(groupId, getPreviewText(plaintext), event.created_at, isMention)

          if (event.pubkey !== pk) {
            const groupName = groups.find((g: Group) => g.id === groupId)?.name || 'Group'
            const { profiles: p } = useNostrStore.getState()
            fireNotification(groupId, 'channel', groupName, `${getDisplayName(p[event.pubkey], event.pubkey)}: ${getPreviewText(plaintext)}`)
          }

          if (!profiles[event.pubkey] && !fetchingProfiles.has(event.pubkey)) {
            fetchingProfiles.add(event.pubkey)
            fetchEvent(relays, { kinds: [0], authors: [event.pubkey] })
              .then(e => { if (e) setProfile(e.pubkey, parseProfile(e)) })
              .finally(() => fetchingProfiles.delete(event.pubkey))
          }
        } catch {
          // decryption failed — skip
        }
      },
    )
    return () => sub.close()
  }, [groupId, groupKey, relays.join(',')])
}
```

- [ ] **Step 3: Add `useGroupInviteListener` hook**

Append to `src/hooks/useNostrSubscriptions.ts`:

```ts
// Hook to detect incoming group invites from kind-4 DMs addressed to the local user.
// Mount once at app level (inside App component when logged in).
export function useGroupInviteListener() {
  const { relays, publicKey, getPrivateKey, addGroup, setGroupKey } = useNostrStore()

  useEffect(() => {
    if (!publicKey) return
    const sk = getPrivateKey()
    if (!sk) return

    const sub = subscribeEvents(
      relays,
      { kinds: [4], '#p': [publicKey], limit: 100 },
      async (event) => {
        try {
          const decrypted = await decryptDM(sk, event.pubkey, event.content)
          const payload = JSON.parse(decrypted) as { type?: string; groupId?: string; groupKeyHex?: string; groupName?: string }
          if (payload?.type !== 'group_invite') return
          const { groupId, groupKeyHex, groupName } = payload
          if (!groupId || !groupKeyHex || !groupName) return
          if (useNostrStore.getState().groups.find((g: Group) => g.id === groupId)) return

          addGroup({
            id: groupId,
            name: groupName,
            creatorPubkey: event.pubkey,
            memberPubkeys: [publicKey],
            relayUrl: relays[0],
            lastMessage: 'Joined via invite',
            lastMessageAt: event.created_at,
          })
          setGroupKey(groupId, groupKeyHex)

          // Publish own key backup so cross-device recovery works
          const mySk = useNostrStore.getState().getPrivateKey()
          if (mySk) {
            const backup = await buildGroupKeyBackupEvent(mySk, groupId, groupKeyHex)
            publishEvent(relays, backup).catch(() => {})
          }
        } catch {
          // not a group invite or decryption failed
        }
      },
    )
    return () => sub.close()
  }, [publicKey, relays.join(',')])
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNostrSubscriptions.ts
git commit -m "feat: add useGroupMessages and useGroupInviteListener hooks"
```

---

## Task 6: Sidebar — GroupItem and groups section

**Files:**
- Modify: `src/components/Chat/Sidebar.tsx`

- [ ] **Step 1: Update imports and types**

In `src/components/Chat/Sidebar.tsx`:

Add `Group` to the store import:
```ts
import { useNostrStore, type Channel, type Contact, type Message, type ChatType, type Group } from '../../store/nostrStore'
```

Change the `SidebarSection` type (around line 250):
```ts
type SidebarSection = 'search' | 'messages' | 'channels' | 'groups' | 'settings'
```

Change `SECTION_LABELS`:
```ts
const SECTION_LABELS: Record<SidebarSection, string> = {
  search: 'Search',
  messages: 'Messages',
  channels: 'Channels',
  groups: 'Groups',
  settings: 'Settings',
}
```

- [ ] **Step 2: Add `groupSearchQuery` state and destructure groups from store**

In the `Sidebar` function, add alongside the existing search query states:
```ts
const [groupSearchQuery, setGroupSearchQuery] = useState('')
```

In the store destructuring, replace `contacts` with `groups`:
```ts
const {
  publicKey, profile, channels, joinedChannelIds, groups,
  activeChatId, activeChatType, messages, profiles,
  activeSettingsTab, setActiveSettingsTab,
  setShowAddChannel, setShowAddContact, setShowAddGroup,
  logout, relays,
} = useNostrStore()
```

In `toggleSection` and `closePanelOnly`, add reset for `groupSearchQuery`:
```ts
setGroupSearchQuery('')
```

- [ ] **Step 3: Add `GroupItem` component**

Add after the existing `ContactItem` component:

```tsx
function GroupItem({ group, isActive, onSelect }: { group: Group; isActive: boolean; onSelect: () => void }) {
  const { setActiveChat } = useNostrStore()

  const hasMention = (group.mentions || 0) > 0
  const hasUnread = (group.unread || 0) > 0

  return (
    <div className="group relative">
      <button
        onClick={() => { setActiveChat(group.id, 'group'); onSelect() }}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left ${
          isActive
            ? 'bg-gradient-to-br from-violet-500/15 to-purple-700/15 border border-violet-500/40 text-white shadow-[0_0_8px_rgba(124,58,237,0.10)]'
            : 'hover:bg-white/5 text-gray-300 hover:text-white'
        }`}
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isActive ? 'bg-gradient-to-br from-violet-500 to-purple-700' : 'bg-gray-800'
        }`}>
          <Users size={16} className={isActive ? 'text-white' : 'text-gray-400'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={`font-medium truncate text-sm ${hasMention ? 'text-white' : ''}`}>{group.name}</span>
            <span className="text-gray-500 text-xs flex-shrink-0">{formatTime(group.lastMessageAt)}</span>
          </div>
          {group.lastMessage ? (
            <p className="text-xs text-gray-500 truncate mt-0.5">{group.lastMessage}</p>
          ) : (
            <p className="text-xs text-gray-600 truncate mt-0.5">{group.memberPubkeys.length} members</p>
          )}
        </div>
        {hasUnread && (
          <span className={`flex-shrink-0 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center ${
            hasMention ? 'bg-amber-500' : 'bg-gray-600'
          }`}>
            {hasMention ? (group.mentions! > 9 ? '9+' : group.mentions) : (group.unread! > 9 ? '9+' : group.unread)}
          </span>
        )}
      </button>
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <MuteButton chatId={group.id} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add groups section body**

Inside the `Sidebar` function, replace the existing `contactsSection` variable with `groupsSection`:

```tsx
const filteredGroups = groupSearchQuery.trim()
  ? groups.filter(g => g.name.toLowerCase().includes(groupSearchQuery.trim().toLowerCase()))
  : groups

const groupsSection = (
  <div className="flex flex-col h-full">
    <div className="px-3 pt-3 pb-2 flex-shrink-0">
      <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2 border border-gray-700 focus-within:border-purple-500/50 transition-colors">
        <Search size={14} className="text-gray-500 flex-shrink-0" />
        <input
          type="text"
          value={groupSearchQuery}
          onChange={e => setGroupSearchQuery(e.target.value)}
          placeholder="Search groups…"
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none min-w-0"
        />
        {groupSearchQuery && (
          <button aria-label="clear" onClick={() => setGroupSearchQuery('')} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
            <X size={14} />
          </button>
        )}
      </div>
    </div>
    <div className="flex-1 overflow-y-auto scrollbar-thin py-1 px-2 space-y-0.5">
      {filteredGroups.length === 0 && groupSearchQuery.trim() ? (
        <p className="text-gray-500 text-xs text-center px-4 py-6">No groups matching "{groupSearchQuery.trim()}"</p>
      ) : filteredGroups.length === 0 ? (
        <p className="text-gray-500 text-xs text-center px-4 py-6">No groups yet. Use the + button above to create one.</p>
      ) : (
        filteredGroups.map(g => (
          <GroupItem
            key={g.id}
            group={g}
            isActive={activeChatId === g.id && activeChatType === 'group'}
            onSelect={closePanel}
          />
        ))
      )}
    </div>
  </div>
)
```

- [ ] **Step 5: Wire groups section into sectionBody and nav**

In `sectionBody`:
```ts
const sectionBody: Record<SidebarSection, React.ReactNode> = {
  search: searchSection,
  messages: messagesSection,
  channels: channelsSection,
  groups: groupsSection,    // replace contacts: contactsSection
  settings: (...),
}
```

In the desktop panel header (around line 738), add the groups + button alongside the existing channel + button:
```tsx
{activeSection === 'groups' && (
  <button
    onClick={() => { setShowAddGroup(true); closePanel() }}
    aria-label="New Group"
    title="New Group"
    className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/[0.08] transition-colors"
  >
    <SquarePlus size={16} />
  </button>
)}
```

In the mobile sheet header (around line 804), add the same button with the `!isDesktop` guard:
```tsx
{!isDesktop && activeSection === 'groups' && (
  <button
    onClick={() => { setShowAddGroup(true); closePanel() }}
    aria-label="New Group"
    title="New Group"
    className="p-1.5 text-gray-500 hover:text-white rounded-lg hover:bg-white/[0.08] transition-colors"
  >
    <SquarePlus size={16} />
  </button>
)}
```

In the desktop nav rail, change the Contacts button label to 'Groups':
```tsx
<NavRailButton icon={<Users size={18} />} label="Groups" active={activeSection === 'groups'} onClick={() => toggleSection('groups')} />
```

In the mobile bottom nav, change the Contacts button:
```tsx
<BottomNavButton icon={<Users size={20} />} label="Groups" active={activeSection === 'groups'} onClick={() => toggleSection('groups')} />
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/Sidebar.tsx
git commit -m "feat: replace Contacts section with Groups in sidebar"
```

---

## Task 7: AddGroupModal component

**Files:**
- Create: `src/components/Chat/AddGroupModal.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/Chat/AddGroupModal.tsx
import { useState } from 'react'
import { X, Plus, Users, Loader2 } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useNostrStore } from '../../store/nostrStore'
import { generateGroupKey } from '../../lib/groupCrypto'
import {
  buildGroupMetadataEvent,
  buildGroupKeyBackupEvent,
  buildGroupInviteEvent,
  publishEvent,
} from '../../lib/nostr'

interface AddGroupModalProps {
  onClose: () => void
}

export function AddGroupModal({ onClose }: AddGroupModalProps) {
  const { relays, publicKey, getPrivateKey, addGroup, setGroupKey, setActiveChat } = useNostrStore()
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [memberInput, setMemberInput] = useState('')
  const [memberPubkeys, setMemberPubkeys] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const addMember = () => {
    const input = memberInput.trim()
    if (!input) return
    let pubkey = input
    if (input.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(input)
        if (decoded.type !== 'npub') { setError('Invalid npub'); return }
        pubkey = decoded.data as string
      } catch { setError('Invalid npub format'); return }
    } else if (!/^[0-9a-f]{64}$/.test(input)) {
      setError('Enter a valid npub or 64-char hex pubkey')
      return
    }
    if (pubkey === publicKey) { setError('You are already in the group'); return }
    if (memberPubkeys.includes(pubkey)) { setError('Already added'); return }
    setMemberPubkeys(prev => [...prev, pubkey])
    setMemberInput('')
    setError('')
  }

  const handleCreate = async () => {
    if (!name.trim()) { setError('Group name is required'); return }
    const sk = getPrivateKey()
    if (!sk || !publicKey) return
    setCreating(true)
    setError('')
    try {
      const groupId = crypto.randomUUID()
      const groupKeyHex = generateGroupKey()
      const allMembers = [publicKey, ...memberPubkeys]

      await publishEvent(relays, await buildGroupMetadataEvent(sk, groupKeyHex, groupId, name.trim(), about.trim(), allMembers))
      await publishEvent(relays, await buildGroupKeyBackupEvent(sk, groupId, groupKeyHex))
      for (const memberPubkey of memberPubkeys) {
        await publishEvent(relays, await buildGroupInviteEvent(sk, memberPubkey, groupId, groupKeyHex, name.trim()))
      }

      addGroup({
        id: groupId,
        name: name.trim(),
        about: about.trim() || undefined,
        creatorPubkey: publicKey,
        memberPubkeys: allMembers,
        relayUrl: relays[0],
      })
      setGroupKey(groupId, groupKeyHex)
      setActiveChat(groupId, 'group')
      onClose()
    } catch {
      setError('Failed to create group. Check relay connection.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl max-h-[92dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
          <h2 className="font-bold text-white text-lg">New Group</h2>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white rounded-lg hover:bg-white/10 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Group name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Team Alpha"
              className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/60 rounded-xl px-3 py-2.5 text-white text-sm outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Description</label>
            <input
              value={about}
              onChange={e => setAbout(e.target.value)}
              placeholder="Optional"
              className="w-full bg-gray-800 border border-gray-700 focus:border-purple-500/60 rounded-xl px-3 py-2.5 text-white text-sm outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Add members</label>
            <div className="flex gap-2">
              <input
                value={memberInput}
                onChange={e => setMemberInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMember() } }}
                placeholder="npub1… or hex pubkey"
                className="flex-1 bg-gray-800 border border-gray-700 focus:border-purple-500/60 rounded-xl px-3 py-2.5 text-white text-sm outline-none transition-colors"
              />
              <button
                onClick={addMember}
                className="px-3 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-xl text-gray-300 hover:text-white transition-colors"
              >
                <Plus size={16} />
              </button>
            </div>
            {memberPubkeys.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {memberPubkeys.map(pk => (
                  <span key={pk} className="flex items-center gap-1 bg-gray-800 rounded-lg px-2 py-1 text-xs text-gray-300">
                    {pk.slice(0, 8)}…{pk.slice(-4)}
                    <button onClick={() => setMemberPubkeys(prev => prev.filter(p => p !== pk))} className="text-gray-500 hover:text-white ml-0.5">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        <div className="px-4 py-4 border-t border-gray-800">
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
            {creating ? 'Creating…' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat/AddGroupModal.tsx
git commit -m "feat: add AddGroupModal component"
```

---

## Task 8: Wire modal and invite listener into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

In `src/App.tsx`, add to the existing imports:

```ts
import { AddGroupModal } from './components/Chat/AddGroupModal'
import { useGroupInviteListener } from './hooks/useNostrSubscriptions'
```

- [ ] **Step 2: Destructure `showAddGroup` and `setShowAddGroup` from store**

In the `App` function, update the store destructure:

```ts
const {
  publicKey,
  activeSettingsTab, setActiveSettingsTab,
  showAddChannel, setShowAddChannel,
  showAddContact, setShowAddContact,
  showAddGroup, setShowAddGroup,
} = useNostrStore()
```

- [ ] **Step 3: Mount `useGroupInviteListener`**

Inside the `App` function body (after the existing hooks), add:

```ts
useGroupInviteListener()
```

- [ ] **Step 4: Mount AddGroupModal**

In the JSX (after the existing `AddContactModal` block), add:

```tsx
{showAddGroup && (
  <AddGroupModal onClose={() => setShowAddGroup(false)} />
)}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: mount AddGroupModal and useGroupInviteListener in App"
```

---

## Task 9: GroupThread in MessageThread.tsx

**Files:**
- Modify: `src/components/Chat/MessageThread.tsx`

- [ ] **Step 1: Add imports**

In `src/components/Chat/MessageThread.tsx`, update the imports:

```ts
// Add to lucide-react imports:
import { Send, Hash, Lock, Wifi, WifiOff, ArrowLeft, Paperclip, X, Mic, Square, Phone, Video, Reply, Images, ChevronDown, Users } from 'lucide-react'

// Add to store import:
import { useNostrStore, type Message, type Group } from '../../store/nostrStore'

// Add to subscriptions import:
import { useChannelMessages, useDMMessages, useGroupMessages, sendChunkedFile } from '../../hooks/useNostrSubscriptions'

// Add after existing nostr imports:
import { buildChannelMessageEvent, buildDMEvent, buildGroupMessageEvent, publishEvent } from '../../lib/nostr'
import { encryptWithGroupKey } from '../../lib/groupCrypto'
```

- [ ] **Step 2: Add `GroupHeader` component**

Add after the existing `DMHeader` component:

```tsx
function GroupHeader({ groupId, onOpenGallery }: { groupId: string; onOpenGallery: () => void }) {
  const { groups, clearActiveChat } = useNostrStore()
  const group = groups.find((g: Group) => g.id === groupId)

  return (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-800 bg-gray-900">
      <button
        onClick={clearActiveChat}
        className="md:hidden p-2 -ml-1 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
        aria-label="Back"
      >
        <ArrowLeft size={20} />
      </button>
      <div className="w-9 h-9 bg-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
        <Users size={18} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="font-semibold text-white truncate">{group?.name || 'Group'}</h2>
        <div className="flex items-center gap-1 mt-0.5">
          <Lock size={11} className="text-green-400 flex-shrink-0" />
          <span className="text-xs text-gray-500">
            {group ? `${group.memberPubkeys.length} members · encrypted` : 'Encrypted group'}
          </span>
        </div>
      </div>
      <button
        onClick={onOpenGallery}
        className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
        title="Shared media"
      >
        <Images size={18} />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Add `GroupThread` component**

Add after `DMThread`:

```tsx
function GroupThread({ groupId }: { groupId: string }) {
  const {
    publicKey, messages, profiles, relays, getPrivateKey, groupKeys,
    addMessage, updateMessageStatus, seenAt, updateSeenAt, targetMessageId,
  } = useNostrStore()
  useGroupMessages(groupId)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [showGallery, setShowGallery] = useState(false)
  const pendingEventsRef = useRef<Map<string, NostrEvent>>(new Map())
  const dividerTimestampRef = useRef<number | undefined>(seenAt[groupId])
  const groupKey = groupKeys[groupId]

  useEffect(() => {
    return () => {
      const latest = useNostrStore.getState().messages[groupId]?.at(-1)?.createdAt
      if (latest !== undefined) updateSeenAt(groupId, latest)
    }
  }, [groupId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = async (content: string) => {
    const sk = getPrivateKey()
    if (!sk || !publicKey || !groupKey) return

    const encryptedContent = await encryptWithGroupKey(content, groupKey)
    const event = buildGroupMessageEvent(sk, encryptedContent, groupId, relays[0], replyTo?.id)

    addMessage(groupId, {
      id: event.id,
      pubkey: publicKey,
      content, // store plaintext locally
      createdAt: event.created_at,
      tags: event.tags,
      kind: 10042,
      status: 'sending',
      ...(replyTo && {
        replyTo: { id: replyTo.id, pubkey: replyTo.pubkey, previewText: getPreviewText(replyTo.content).slice(0, 100) },
      }),
    })
    pendingEventsRef.current.set(event.id, event)
    setReplyTo(null)

    try {
      await publishEvent(relays, event)
      updateMessageStatus(groupId, event.id, 'sent')
      pendingEventsRef.current.delete(event.id)
    } catch {
      updateMessageStatus(groupId, event.id, 'failed')
    }
  }

  const handleRetry = async (msgId: string) => {
    const event = pendingEventsRef.current.get(msgId)
    if (!event) return
    updateMessageStatus(groupId, msgId, 'sending')
    try {
      await publishEvent(relays, event)
      updateMessageStatus(groupId, msgId, 'sent')
      pendingEventsRef.current.delete(msgId)
    } catch {
      updateMessageStatus(groupId, msgId, 'failed')
    }
  }

  if (!groupKey) {
    return (
      <>
        <GroupHeader groupId={groupId} onOpenGallery={() => {}} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-6">
            <WifiOff size={40} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Group key unavailable. Try logging out and back in.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <GroupHeader groupId={groupId} onOpenGallery={() => setShowGallery(true)} />
      {showGallery ? (
        <MediaGallery messages={messages[groupId] || []} onClose={() => setShowGallery(false)} />
      ) : (
        <>
          <MessageList
            messages={messages[groupId] || []}
            myPubkey={publicKey || ''}
            profiles={profiles}
            onReply={setReplyTo}
            onRetry={handleRetry}
            dividerTimestamp={dividerTimestampRef.current}
            targetMessageId={targetMessageId ?? undefined}
          />
          <MessageInput
            chatId={groupId}
            onSend={handleSend}
            onSendChunked={async () => {}}
            onTyping={() => {}}
            placeholder="Message group…"
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          />
        </>
      )}
    </>
  )
}
```

- [ ] **Step 4: Update the `MessageThread` export to dispatch 'group'**

Find the exported `MessageThread` function (around line 804). Replace:

```tsx
  return (
    <div className="flex-1 flex flex-col bg-gray-950 overflow-hidden">
      {activeChatType === 'channel' ? (
        <ChannelThread channelId={activeChatId} />
      ) : (
        <DMThread theirPubkey={activeChatId} />
      )}
    </div>
  )
```

With:

```tsx
  return (
    <div className="flex-1 flex flex-col bg-gray-950 overflow-hidden">
      {activeChatType === 'channel' ? (
        <ChannelThread channelId={activeChatId} />
      ) : activeChatType === 'group' ? (
        <GroupThread groupId={activeChatId} />
      ) : (
        <DMThread theirPubkey={activeChatId} />
      )}
    </div>
  )
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat/MessageThread.tsx
git commit -m "feat: add GroupThread and dispatch group chat type in MessageThread"
```

---

## Task 10: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify Groups section in sidebar**

- Open the app and log in
- Click the Users icon in the sidebar — panel should open titled "Groups" with "No groups yet" empty state
- The + button in the panel header should open the `AddGroupModal`

- [ ] **Step 3: Create a group**

- Open `AddGroupModal`
- Enter a group name
- Click "Create Group" (no members needed for solo test)
- Group should appear in the Groups panel
- Clicking it should open a `GroupThread` with the encrypted header and message input

- [ ] **Step 4: Send a message within the group**

- Type a message and send
- Message should appear in the thread

- [ ] **Step 5: Verify Contacts section is gone**

- The nav rail and bottom nav should show "Groups" (Users icon) where Contacts was
- There should be no "Contacts" entry anywhere in the sidebar

- [ ] **Step 6: Final commit (if any cleanup needed)**

```bash
git add -p
git commit -m "fix: any smoke-test fixes"
```
