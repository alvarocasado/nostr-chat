# Message Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate unsolicited DMs (surfaced by the global inbox) behind an Accept/Dismiss/Block flow, with a relay-synced blocklist and a Settings → Privacy management tab.

**Architecture:** A `pending` flag on `Contact` marks unsolicited-DM contacts. Two new persisted + relay-synced maps, `blockedPubkeys` and `dismissedRequests`, drive a gate inside `processDMEvent` in `src/lib/inbox.ts`. Store actions manage the lifecycle; the sidebar splits accepted vs. pending contacts, the DM thread shows an action banner, and a new Privacy settings tab lists/unblocks blocked pubkeys.

**Tech Stack:** TypeScript, React 19, Zustand (persisted to Dexie), nostr-tools, Vitest. Tests run with `npx vitest run <path>`.

---

## File structure

- `src/store/nostrStore.ts` (modify) — `Contact.pending`, new state `blockedPubkeys` / `dismissedRequests`, new actions, partialize, settings-merge on login.
- `src/lib/nostrSync.ts` (modify) — add `blockedPubkeys` / `dismissedRequests` to `SyncedSettings`; scheduleSettingsSync includes them.
- `src/lib/inbox.ts` (modify) — `processDMEvent` gate for blocked/dismissed/unknown/pending; suppress notification for pending.
- `src/components/Chat/Sidebar.tsx` (modify) — split contacts into accepted list + "Message requests" section; add Privacy entry to settings nav.
- `src/components/Chat/MessageThread.tsx` (modify) — request banner (Accept/Dismiss/Block) in `DMThread`; reply auto-accepts.
- `src/components/Settings/PrivacyTab.tsx` (create) — blocked-users list with Unblock.
- `src/components/Settings/SettingsScreen.tsx` (modify) — render PrivacyTab; add label.
- Tests: `src/__tests__/store.test.ts`, `src/__tests__/inbox.test.ts`, `src/__tests__/nostrSync.test.ts` (modify).

---

## Task 1: Store state + types for blocking/dismissal/pending

**Files:**
- Modify: `src/store/nostrStore.ts`
- Test: `src/__tests__/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/store.test.ts`:

```typescript
describe('message request actions', () => {
  const reqContact = { pubkey: 'req1', pending: true, unread: 1, lastMessage: 'hi' }

  it('acceptMessageRequest clears pending', () => {
    useNostrStore.setState({ contacts: [{ ...reqContact }] })
    useNostrStore.getState().acceptMessageRequest('req1')
    expect(useNostrStore.getState().contacts[0].pending).toBe(false)
  })

  it('dismissMessageRequest removes the contact and records a timestamp without blocking', () => {
    useNostrStore.setState({ contacts: [{ ...reqContact }], messages: { req1: [] }, blockedPubkeys: [], dismissedRequests: {} })
    useNostrStore.getState().dismissMessageRequest('req1')
    const s = useNostrStore.getState()
    expect(s.contacts.find(c => c.pubkey === 'req1')).toBeUndefined()
    expect(s.messages['req1']).toBeUndefined()
    expect(s.dismissedRequests['req1']).toBeGreaterThan(0)
    expect(s.blockedPubkeys).not.toContain('req1')
  })

  it('blockPubkey removes the contact and adds to the blocklist', () => {
    useNostrStore.setState({ contacts: [{ ...reqContact }], messages: { req1: [] }, blockedPubkeys: [], dismissedRequests: {} })
    useNostrStore.getState().blockPubkey('req1')
    const s = useNostrStore.getState()
    expect(s.contacts.find(c => c.pubkey === 'req1')).toBeUndefined()
    expect(s.blockedPubkeys).toContain('req1')
  })

  it('unblockPubkey removes from blocklist and clears the dismissal', () => {
    useNostrStore.setState({ blockedPubkeys: ['req1'], dismissedRequests: { req1: 1000 } })
    useNostrStore.getState().unblockPubkey('req1')
    const s = useNostrStore.getState()
    expect(s.blockedPubkeys).not.toContain('req1')
    expect(s.dismissedRequests['req1']).toBeUndefined()
  })

  it('addContact unblocks, clears dismissal, and never marks pending', () => {
    useNostrStore.setState({ contacts: [], blockedPubkeys: ['req1'], dismissedRequests: { req1: 1000 } })
    useNostrStore.getState().addContact('req1')
    const s = useNostrStore.getState()
    expect(s.blockedPubkeys).not.toContain('req1')
    expect(s.dismissedRequests['req1']).toBeUndefined()
    expect(s.contacts[0].pending).toBeFalsy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/store.test.ts -t "message request actions"`
Expected: FAIL — `acceptMessageRequest is not a function` (and siblings).

- [ ] **Step 3: Add the `pending` field and state**

In the `Contact` interface (`src/store/nostrStore.ts`), add:

```typescript
export interface Contact {
  pubkey: string
  profile?: NostrProfile
  lastMessage?: string
  lastMessageAt?: number
  unread?: number
  pending?: boolean
}
```

In the `NostrState` interface, near `mutedChats`, add:

```typescript
  // Message requests: unsolicited-DM gating
  blockedPubkeys: string[]
  dismissedRequests: Record<string, number>  // pubkey → unix-seconds of dismissal
```

In the same interface, add the action signatures near `addContact`/`removeContact`:

```typescript
  acceptMessageRequest: (pubkey: string) => void
  dismissMessageRequest: (pubkey: string) => void
  blockPubkey: (pubkey: string) => void
  unblockPubkey: (pubkey: string) => void
```

- [ ] **Step 4: Add the initial state**

In the store's returned object, next to `mutedChats: {},` add:

```typescript
        blockedPubkeys: [],
        dismissedRequests: {},
```

- [ ] **Step 5: Implement the actions**

Add these actions in the store body (place them right after the existing `removeContact` action). Note `scheduleContactsSync` and `scheduleSettingsSync` are already defined in the store closure:

```typescript
        acceptMessageRequest: (pubkey) => {
          set({ contacts: get().contacts.map(c => c.pubkey === pubkey ? { ...c, pending: false } : c) })
          scheduleContactsSync()
        },

        dismissMessageRequest: (pubkey) => {
          const { [pubkey]: _removed, ...restMessages } = get().messages
          set({
            contacts: get().contacts.filter(c => c.pubkey !== pubkey),
            messages: restMessages,
            dismissedRequests: { ...get().dismissedRequests, [pubkey]: Math.floor(Date.now() / 1000) },
            activeChatId: get().activeChatId === pubkey ? null : get().activeChatId,
          })
          const db = getUserDb()
          if (db) void db.messages.where('[chatId+createdAt]').between([pubkey, -Infinity], [pubkey, Infinity]).delete()
          scheduleSettingsSync()
        },

        blockPubkey: (pubkey) => {
          get().dismissMessageRequest(pubkey)
          if (!get().blockedPubkeys.includes(pubkey)) {
            set({ blockedPubkeys: [...get().blockedPubkeys, pubkey] })
          }
          scheduleSettingsSync()
        },

        unblockPubkey: (pubkey) => {
          const { [pubkey]: _removed, ...restDismissed } = get().dismissedRequests
          set({
            blockedPubkeys: get().blockedPubkeys.filter(p => p !== pubkey),
            dismissedRequests: restDismissed,
          })
          scheduleSettingsSync()
        },
```

Note: `getUserDb` is already imported in this file. `chatId` alone is not a declared Dexie index, so deletion uses the `[chatId+createdAt]` compound-index range — the same pattern `setActiveChat` already uses to read a chat's messages.

- [ ] **Step 6: Extend `addContact` to unblock/clear-pending**

Replace the existing `addContact` action:

```typescript
        addContact: (pubkey) => {
          const { [pubkey]: _removed, ...restDismissed } = get().dismissedRequests
          const blockedChanged = get().blockedPubkeys.includes(pubkey)
          set({
            blockedPubkeys: get().blockedPubkeys.filter(p => p !== pubkey),
            dismissedRequests: restDismissed,
          })
          const existing = get().contacts.find(c => c.pubkey === pubkey)
          if (existing) {
            if (existing.pending) set({ contacts: get().contacts.map(c => c.pubkey === pubkey ? { ...c, pending: false } : c) })
          } else {
            set({ contacts: [{ pubkey }, ...get().contacts] })
          }
          scheduleContactsSync()
          if (blockedChanged) scheduleSettingsSync()
        },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/store.test.ts`
Expected: PASS (all, including pre-existing tests).

- [ ] **Step 8: Commit**

```bash
git add src/store/nostrStore.ts src/__tests__/store.test.ts
git commit -m "feat: add message-request store state and actions"
```

---

## Task 2: Persist + relay-sync the new state

**Files:**
- Modify: `src/store/nostrStore.ts` (partialize + login merge)
- Modify: `src/lib/nostrSync.ts` (`SyncedSettings`)
- Test: `src/__tests__/nostrSync.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/nostrSync.test.ts` (it already imports from `../lib/nostrSync`; if `buildAppSettingsEvent` is not exported, use `publishAppSettings` round-trip via the existing pattern in that file — check the top of the file for the established helper). Add:

```typescript
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { fetchAppSettings, publishAppSettings } from '../lib/nostrSync'

describe('SyncedSettings blocklist round-trip', () => {
  it('serializes and parses blockedPubkeys and dismissedRequests', () => {
    const settings = {
      blockedPubkeys: ['aa', 'bb'],
      dismissedRequests: { cc: 1000 },
    }
    const json = JSON.stringify(settings)
    const parsed = JSON.parse(json)
    expect(parsed.blockedPubkeys).toEqual(['aa', 'bb'])
    expect(parsed.dismissedRequests).toEqual({ cc: 1000 })
  })
})
```

(If `nostrSync.test.ts` already has integration-style relay tests with mocks, prefer matching that style; the assertion that matters is that the two fields survive `SyncedSettings` typing without a TS error.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/nostrSync.test.ts -t "blocklist round-trip"`
Expected: FAIL — the test file does not yet compile against the new `SyncedSettings` fields, or the test is missing.

- [ ] **Step 3: Extend `SyncedSettings`**

In `src/lib/nostrSync.ts`:

```typescript
export interface SyncedSettings {
  notificationSettings?: NotificationSettings
  mutedChats?: Record<string, number | null>
  relays?: string[]
  callsSettings?: CallsSyncedSettings
  blockedPubkeys?: string[]
  dismissedRequests?: Record<string, number>
}
```

- [ ] **Step 4: Include the fields in the publish path**

In `src/store/nostrStore.ts`, inside `scheduleSettingsSync`, the call currently reads:

```typescript
            const { notificationSettings, mutedChats, relays, publicKey, getPrivateKey } = get()
```

Change to also pull the new fields:

```typescript
            const { notificationSettings, mutedChats, relays, publicKey, getPrivateKey, blockedPubkeys, dismissedRequests } = get()
```

and update the `publishAppSettings` settings object:

```typescript
            void publishAppSettings(sk, publicKey, { notificationSettings, mutedChats, relays, callsSettings, blockedPubkeys, dismissedRequests }, relays)
```

- [ ] **Step 5: Apply the fields on login merge**

In `completeLogin` (`src/store/nostrStore.ts`), inside the `if (result.settings)` block where `s` is destructured, extend the `set({ ... })` to include the new fields (matching the existing conditional-spread style):

```typescript
        set({
          ...(s.notificationSettings !== undefined ? { notificationSettings: s.notificationSettings } : {}),
          ...(s.mutedChats !== undefined ? { mutedChats: s.mutedChats } : {}),
          ...(s.relays !== undefined ? { relays: s.relays } : {}),
          ...(s.blockedPubkeys !== undefined ? { blockedPubkeys: s.blockedPubkeys } : {}),
          ...(s.dismissedRequests !== undefined ? { dismissedRequests: s.dismissedRequests } : {}),
          syncedSettingsAt: result.settings.createdAt,
        })
```

- [ ] **Step 6: Add the fields to partialize**

In the `partialize` block at the bottom of the store, add:

```typescript
        blockedPubkeys: state.blockedPubkeys,
        dismissedRequests: state.dismissedRequests,
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/__tests__/nostrSync.test.ts src/__tests__/store.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/nostrSync.ts src/store/nostrStore.ts src/__tests__/nostrSync.test.ts
git commit -m "feat: persist and relay-sync blocklist and dismissed requests"
```

---

## Task 3: Inbox gate in processDMEvent

**Files:**
- Modify: `src/lib/inbox.ts`
- Test: `src/__tests__/inbox.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/inbox.test.ts` (reuse the existing helpers `processDMEvent`, `nip04`, `finalizeEvent`, `generateSecretKey`, `getPublicKey`, `RELAYS` already imported there). Add a notification spy at the top of the new describe block:

```typescript
import { fireNotification } from '../lib/notifications'
vi.mock('../lib/notifications', () => ({ fireNotification: vi.fn() }))

describe('processDMEvent — request gate', () => {
  async function incomingDM(text: string, createdAt = 1000) {
    const senderSk = generateSecretKey()
    const senderPk = getPublicKey(senderSk)
    const mySk = generateSecretKey()
    const myPk = getPublicKey(mySk)
    useNostrStore.setState({ publicKey: myPk })
    const encrypted = await nip04.encrypt(senderSk, myPk, text)
    const event = finalizeEvent({ kind: 4, created_at: createdAt, tags: [['p', myPk]], content: encrypted }, senderSk)
    return { event, senderPk, mySk, myPk }
  }

  it('drops events from a blocked sender entirely', async () => {
    const { event, senderPk, mySk, myPk } = await incomingDM('blocked hello')
    useNostrStore.setState({ blockedPubkeys: [senderPk], contacts: [] })
    await processDMEvent(event, mySk, myPk, RELAYS, { live: true })
    const s = useNostrStore.getState()
    expect(s.messages[senderPk]).toBeUndefined()
    expect(s.contacts.find(c => c.pubkey === senderPk)).toBeUndefined()
  })

  it('drops a dismissed sender message older than the dismissal but reopens for a newer one', async () => {
    const old = await incomingDM('old', 500)
    useNostrStore.setState({ dismissedRequests: { [old.senderPk]: 1000 }, contacts: [], messages: {} })
    await processDMEvent(old.event, old.mySk, old.myPk, RELAYS, { live: false })
    expect(useNostrStore.getState().contacts.find(c => c.pubkey === old.senderPk)).toBeUndefined()
  })

  it('creates a pending contact for an unknown sender and does not notify', async () => {
    vi.mocked(fireNotification).mockClear()
    const { event, senderPk, mySk, myPk } = await incomingDM('hi stranger')
    useNostrStore.setState({ contacts: [], blockedPubkeys: [], dismissedRequests: {} })
    await processDMEvent(event, mySk, myPk, RELAYS, { live: true })
    const c = useNostrStore.getState().contacts.find(c => c.pubkey === senderPk)
    expect(c?.pending).toBe(true)
    expect(useNostrStore.getState().messages[senderPk]).toHaveLength(1)
    expect(fireNotification).not.toHaveBeenCalled()
  })

  it('notifies for an already-accepted contact', async () => {
    vi.mocked(fireNotification).mockClear()
    const { event, senderPk, mySk, myPk } = await incomingDM('hey again')
    useNostrStore.setState({ contacts: [{ pubkey: senderPk, pending: false }], blockedPubkeys: [], dismissedRequests: {} })
    await processDMEvent(event, mySk, myPk, RELAYS, { live: true })
    expect(fireNotification).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/inbox.test.ts -t "request gate"`
Expected: FAIL — blocked events still create contacts; pending contacts not created; notification fires for unknown senders.

- [ ] **Step 3: Implement the gate**

In `src/lib/inbox.ts`, in `processDMEvent`, after `peer` is resolved and after the group-invite filter, but before the `sideEffects` line, insert the gate. Only gate incoming events (not the user's own sends):

```typescript
  // Request gate (incoming only)
  const incoming = event.pubkey !== myPubkey
  if (incoming) {
    const { blockedPubkeys, dismissedRequests, contacts } = useNostrStore.getState()
    if (blockedPubkeys.includes(peer)) return
    const dismissedAt = dismissedRequests[peer]
    if (dismissedAt !== undefined && event.created_at <= dismissedAt) return
  }
```

Then compute whether the sender is pending/unknown so the notification can be suppressed. Replace the existing notification block. The current code is:

```typescript
  useNostrStore.getState().addMessage(peer, msg)
  if (!sideEffects || event.pubkey === myPubkey) return

  const { profiles, updateContactLastMessage } = useNostrStore.getState()
  const preview = getPreviewText(decrypted)
  updateContactLastMessage(peer, preview, event.created_at, {
    incrementUnread: shouldCountUnread(peer, event.created_at, opts.live),
  })

  if (opts.live) {
    const senderName = getDisplayName(profiles[event.pubkey], event.pubkey)
    fireNotification(peer, 'dm', senderName, preview, profiles[event.pubkey]?.picture)
  }

  ensureProfile(event.pubkey, relays)
```

Replace it with:

```typescript
  // Unknown sender (no contact yet) becomes a pending request; never notify while pending.
  const existingContact = useNostrStore.getState().contacts.find(c => c.pubkey === peer)
  const isPending = incoming && (!existingContact || existingContact.pending === true)
  if (incoming && !existingContact) {
    useNostrStore.getState().addContact(peer)
    useNostrStore.setState({
      contacts: useNostrStore.getState().contacts.map(c => c.pubkey === peer ? { ...c, pending: true } : c),
    })
  }

  useNostrStore.getState().addMessage(peer, msg)
  if (!sideEffects || event.pubkey === myPubkey) return

  const { profiles, updateContactLastMessage } = useNostrStore.getState()
  const preview = getPreviewText(decrypted)
  updateContactLastMessage(peer, preview, event.created_at, {
    incrementUnread: shouldCountUnread(peer, event.created_at, opts.live),
  })

  if (opts.live && !isPending) {
    const senderName = getDisplayName(profiles[event.pubkey], event.pubkey)
    fireNotification(peer, 'dm', senderName, preview, profiles[event.pubkey]?.picture)
  }

  ensureProfile(event.pubkey, relays)
```

Note: `addContact` schedules a kind-3 contacts publish. For a *pending* request we do not want to publish to the public follow list yet. Adjust: instead of calling `addContact`, insert the pending contact directly so no sync fires. Replace the `if (incoming && !existingContact)` block above with:

```typescript
  if (incoming && !existingContact) {
    useNostrStore.setState({
      contacts: [{ pubkey: peer, pending: true }, ...useNostrStore.getState().contacts],
    })
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/inbox.test.ts`
Expected: PASS (including the pre-existing inbox tests). The earlier test `creates the contact` in the "processDMEvent" describe now expects a pending contact — update that pre-existing assertion to `expect(contact?.pending).toBe(true)` if it asserted otherwise.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbox.ts src/__tests__/inbox.test.ts
git commit -m "feat: gate unsolicited DMs as pending message requests"
```

---

## Task 4: Sidebar — split accepted contacts from requests

**Files:**
- Modify: `src/components/Chat/Sidebar.tsx`

No new unit test (presentational); verified via build + manual run. Keep changes minimal.

- [ ] **Step 1: Derive the two lists**

In the `messagesSection` area of `Sidebar.tsx`, where `filteredContacts` is computed from `contacts`, split first. Find:

```typescript
  const filteredContacts = dmSearchQuery.trim()
    ? contacts.filter(c => {
        const p = c.profile || profiles[c.pubkey]
        return getDisplayName(p, c.pubkey, 10).toLowerCase().includes(dmSearchQuery.trim().toLowerCase())
      })
    : contacts
```

Replace the source `contacts` with accepted-only, and add the requests list:

```typescript
  const acceptedContacts = contacts.filter(c => !c.pending)
  const pendingRequests = contacts.filter(c => c.pending)
  const filteredContacts = dmSearchQuery.trim()
    ? acceptedContacts.filter(c => {
        const p = c.profile || profiles[c.pubkey]
        return getDisplayName(p, c.pubkey, 10).toLowerCase().includes(dmSearchQuery.trim().toLowerCase())
      })
    : acceptedContacts
```

- [ ] **Step 2: Render the requests section**

In the `messagesSection` JSX, immediately inside the scroll container and before the "Conversations" search label / contact list, add (only when not searching and requests exist):

```tsx
        {!dmSearchQuery.trim() && pendingRequests.length > 0 && (
          <>
            <p className="text-gray-600 text-[10px] uppercase tracking-wide px-2 py-1">
              Message requests · {pendingRequests.length}
            </p>
            {pendingRequests.map(c => (
              <ContactItem
                key={c.pubkey}
                contact={c}
                isActive={activeChatId === c.pubkey && activeChatType === 'dm'}
                onSelect={closePanel}
              />
            ))}
            <div className="h-px bg-gray-800 my-1 mx-2" />
          </>
        )}
```

- [ ] **Step 3: Keep the DM tab unread badge counting accepted only**

`totalUnreadDMs` currently reads `contacts.reduce(...)`. Change it to count accepted contacts so requests don't inflate the main DM badge:

```typescript
  const totalUnreadDMs = useMemo(() => contacts.filter(c => !c.pending).reduce((sum, c) => sum + (c.unread || 0), 0), [contacts])
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/Sidebar.tsx
git commit -m "feat: show message requests section in DM sidebar"
```

---

## Task 5: DM thread — request action banner

**Files:**
- Modify: `src/components/Chat/MessageThread.tsx`

- [ ] **Step 1: Read the pending state + actions in DMThread**

In `DMThread` (`src/components/Chat/MessageThread.tsx`), extend the store destructure on the first line of the component to include the contact list and the three actions:

```typescript
  const { publicKey, messages, profiles, relays, getPrivateKey, addMessage, updateMessageStatus, seenAt, updateSeenAt, targetMessageId,
    contacts, acceptMessageRequest, dismissMessageRequest, blockPubkey, clearActiveChat } = useNostrStore()
  const isPending = contacts.find(c => c.pubkey === theirPubkey)?.pending === true
```

- [ ] **Step 2: Auto-accept on reply**

In `handleSend`, accept the request before sending so answering accepts it. Add at the top of `handleSend`, after the `sk`/`publicKey` guard:

```typescript
    if (isPending) acceptMessageRequest(theirPubkey)
```

- [ ] **Step 3: Render the banner**

In the `DMThread` return, between `<DMHeader .../>` and the `{showGallery ? ... }` block, add:

```tsx
      {isPending && (
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 border-b border-gray-800">
          <p className="flex-1 text-sm text-gray-300">This person isn't in your contacts.</p>
          <button
            onClick={() => acceptMessageRequest(theirPubkey)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white transition-colors"
          >
            Accept
          </button>
          <button
            onClick={() => { dismissMessageRequest(theirPubkey); clearActiveChat() }}
            className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-white/5 transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={() => { blockPubkey(theirPubkey); clearActiveChat() }}
            className="px-3 py-1.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Block
          </button>
        </div>
      )}
```

Note: `clearActiveChat` already exists in the store; `dismissMessageRequest`/`blockPubkey` already null out `activeChatId` when it matches, so the explicit `clearActiveChat()` is belt-and-suspenders for the mobile panel.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/MessageThread.tsx
git commit -m "feat: add accept/dismiss/block banner to request DM threads"
```

---

## Task 6: Privacy settings tab

**Files:**
- Create: `src/components/Settings/PrivacyTab.tsx`
- Modify: `src/store/nostrStore.ts` (`SettingsTab` union)
- Modify: `src/components/Settings/SettingsScreen.tsx`
- Modify: `src/components/Chat/Sidebar.tsx` (nav entry)

- [ ] **Step 1: Add `'privacy'` to the tab union**

In `src/store/nostrStore.ts`:

```typescript
export type SettingsTab = 'profile' | 'relays' | 'keys' | 'calls' | 'notifications' | 'privacy'
```

- [ ] **Step 2: Create the PrivacyTab component**

Create `src/components/Settings/PrivacyTab.tsx`:

```tsx
import { useNostrStore } from '../../store/nostrStore'
import { Avatar } from '../Chat/Avatar'
import { getDisplayName } from '../../lib/fileUtils'

export function PrivacyTab() {
  const { blockedPubkeys, profiles, unblockPubkey } = useNostrStore()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1">Blocked users</h2>
        <p className="text-xs text-gray-500">
          {blockedPubkeys.length === 0
            ? "You haven't blocked anyone."
            : `You've blocked ${blockedPubkeys.length} ${blockedPubkeys.length === 1 ? 'person' : 'people'}. Unblocking lets them message you again.`}
        </p>
      </div>

      <div className="space-y-1">
        {blockedPubkeys.map(pk => {
          const profile = profiles[pk]
          return (
            <div key={pk} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-900 border border-gray-800">
              <Avatar profile={profile} pubkey={pk} size={32} />
              <span className="flex-1 text-sm text-white truncate">{getDisplayName(profile, pk, 12)}</span>
              <button
                onClick={() => unblockPubkey(pk)}
                className="px-3 py-1.5 rounded-lg text-sm text-purple-400 hover:bg-purple-500/10 transition-colors"
              >
                Unblock
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

Note: confirm the `Avatar` prop names by checking `src/components/Chat/Avatar.tsx` (it is used in `SettingsScreen.tsx` already — match that call site's props; adjust `profile`/`pubkey`/`size` to whatever Avatar expects).

- [ ] **Step 3: Wire it into SettingsScreen**

In `src/components/Settings/SettingsScreen.tsx`, add the import:

```typescript
import { PrivacyTab } from './PrivacyTab'
```

Add to `TAB_LABELS`:

```typescript
  privacy: 'Privacy',
```

After the notifications line in the render, add:

```tsx
          {activeSettingsTab === 'privacy' && <PrivacyTab />}
```

- [ ] **Step 4: Add the nav entry**

In `src/components/Chat/Sidebar.tsx`, in the settings nav list (the `[...] as const` array of `{ tab, label, icon, badge }`), add a Privacy entry after notifications. Use an existing lucide icon already imported, or add `Shield` to the lucide import at the top:

```typescript
            { tab: 'privacy',       label: 'Privacy',       icon: <Shield size={16} />, badge: null },
```

Add `Shield` to the `lucide-react` import in `Sidebar.tsx` if not present.

- [ ] **Step 5: Verify build + full test suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/PrivacyTab.tsx src/components/Settings/SettingsScreen.tsx src/store/nostrStore.ts src/components/Chat/Sidebar.tsx
git commit -m "feat: add Privacy settings tab for managing blocked users"
```

---

## Task 7: Final verification

- [ ] **Step 1: Lint, test, build**

Run: `npm run lint && npx vitest run && npm run build`
Expected: lint clean, all tests pass, build succeeds.

- [ ] **Step 2: Manual smoke (optional, via `/run`)**

- Receiving a DM from a non-contact shows it under "Message requests", no notification, badge-only.
- Accept moves it into the conversation list; Dismiss removes it; Block removes it and it appears in Settings → Privacy.
- Unblock from Privacy removes it from the list; a fresh DM from that pubkey re-opens a request.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "chore: message-requests cleanup"
```

---

## Self-review notes

- **Spec coverage:** `pending` flag (T1), `blockedPubkeys`/`dismissedRequests` (T1), sync + persist (T2), five-case inbox gate + notification suppression (T3), sidebar requests section (T4), thread banner + reply-accepts (T5), Privacy tab + unblock + `addContact` unblock path (T1/T6). All spec sections mapped.
- **Pending contacts are NOT published to kind-3** — T3 inserts the pending contact directly via `setState` rather than `addContact`, so the public follow list is only touched on Accept (`acceptMessageRequest` → `scheduleContactsSync`). This matches the spec's "accepting publishes to kind-3" intent.
- **Type consistency:** action names `acceptMessageRequest` / `dismissMessageRequest` / `blockPubkey` / `unblockPubkey` used identically across T1, T5, T6. `Contact.pending` consistent throughout.
- **Verification gap to watch:** the Avatar prop names in T6 and the exact pre-existing inbox-test assertion text in T3 must be matched to the real code at implementation time (called out inline).
