# Dedup Overlapping kind-4 Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicate `{ kinds:[4], '#p':[me] }` DM subscription and the redundant per-DM NIP-04 decrypt by folding group-invite handling into the shared `processDMEvent` processor.

**Architecture:** Move invite handling down into `src/lib/inbox.ts` (where the kind-4 stream is already decrypted once), then delete the now-redundant `useGroupInviteListener` hook and its mount. A single `useGlobalInbox` subscription feeds `processDMEvent`, which branches: group invite → `handleGroupInvite`; otherwise → normal DM flow.

**Tech Stack:** TypeScript, React 19, Zustand, nostr-tools, Vitest.

## Global Constraints

- No emojis in code, comments, or documentation.
- Prefer immutability; do not mutate store state directly outside store actions.
- Idempotency is mandatory: the same event may arrive via the global inbox, a per-chat subscription, and relay backfill. Side effects (group add, key backup publish) must run at most once per invite.
- Key-backup publish is fire-and-forget (`.catch(() => {})`) and must never block joining a group.
- Existing DM, request-gate, channel, and group tests must remain green.

---

### Task 1: Fold group-invite handling into `processDMEvent`

**Files:**
- Modify: `src/lib/inbox.ts` (imports near line 2; invite branch at lines 206-211; add `handleGroupInvite` helper)
- Test: `src/__tests__/inbox.test.ts` (convert test at lines 140-162; add idempotency test; extend `vi.mock('../lib/nostr', ...)` at lines 10-13)

**Interfaces:**
- Consumes: `processDMEvent(event: Event, myPubkey: string, relays: string[], opts: { live: boolean }): Promise<void>` (existing); store actions `addGroup`, `setGroupKey`; `buildGroupKeyBackupEvent(groupId: string, groupKeyHex: string): Promise<Event>` and `publishEvent(relays: string[], event: Event): Promise<void>` from `../lib/nostr`.
- Produces: internal `handleGroupInvite(event: Event, decrypted: string, relays: string[]): Promise<void>` (module-private, not exported). No public API change to `processDMEvent`.

- [ ] **Step 1: Extend the nostr mock and convert the invite test to assert handling**

In `src/__tests__/inbox.test.ts`, change the mock at lines 10-13 to also spy on `publishEvent`:

```ts
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return { ...actual, fetchEvent: vi.fn().mockResolvedValue(null), publishEvent: vi.fn().mockResolvedValue(undefined) }
})
```

Add the import for the spy near the top imports (after line 8):

```ts
import { publishEvent } from '../lib/nostr'
```

Replace the existing `it('ignores group invite payloads', ...)` test (lines 140-162) with:

```ts
  it('handles group invite payloads: adds the group, sets the key, publishes a backup, and creates no chat message', async () => {
    const senderSk = generateSecretKey()
    const senderPk = getPublicKey(senderSk)
    const mySk = generateSecretKey()
    const { signer } = installTestSigner(mySk)
    const myPk = signer.pubkey
    useNostrStore.setState({ publicKey: myPk })

    const payload = JSON.stringify({ type: 'group_invite', groupId: 'g', groupKeyHex: 'k', groupName: 'n' })
    const encrypted = await nip04.encrypt(senderSk, myPk, payload)
    const event = finalizeEvent({
      kind: 4,
      created_at: 1000,
      tags: [['p', myPk]],
      content: encrypted,
    }, senderSk)

    await processDMEvent(event, myPk, RELAYS, { live: true })

    const state = useNostrStore.getState()
    expect(state.groups.find(grp => grp.id === 'g')?.name).toBe('n')
    expect(state.groupKeys['g']).toBe('k')
    expect(state.messages[senderPk]).toBeUndefined()
    expect(state.contacts.find(c => c.pubkey === senderPk)).toBeUndefined()
    expect(publishEvent).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/inbox.test.ts -t "handles group invite payloads"`
Expected: FAIL — the group is not added (the current code returns early on `group_invite`), so `state.groups.find(...)` is `undefined` and `publishEvent` is never called.

- [ ] **Step 3: Add imports and the `handleGroupInvite` helper in `inbox.ts`**

In `src/lib/inbox.ts`, update the `./nostr` import (line 2) to include the builder and publisher:

```ts
import { decryptDM, fetchEvent, parseProfile, buildGroupKeyBackupEvent, publishEvent } from './nostr'
```

Add this helper near the other helpers (for example just above `extractRootChatId`, around line 114):

```ts
/**
 * Handle a decrypted group_invite DM: join the group and back up the key once.
 * Idempotent — a group we already have is left untouched, so replays from
 * per-chat subscriptions or relay backfill do not re-add or re-publish.
 */
async function handleGroupInvite(event: Event, decrypted: string, relays: string[]): Promise<void> {
  try {
    const payload = JSON.parse(decrypted) as { groupId?: string; groupKeyHex?: string; groupName?: string }
    const { groupId, groupKeyHex, groupName } = payload
    if (!groupId || !groupKeyHex || !groupName) return

    const { groups, publicKey, addGroup, setGroupKey } = useNostrStore.getState()
    if (groups.find(g => g.id === groupId)) return
    if (!publicKey) return

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
    const backup = await buildGroupKeyBackupEvent(groupId, groupKeyHex)
    publishEvent(relays, backup).catch(() => {})
  } catch {
    // not a valid group invite or build/publish failed — ignore
  }
}
```

- [ ] **Step 4: Wire the helper into `processDMEvent`**

In `src/lib/inbox.ts`, replace the existing invite branch (lines 206-211):

```ts
  // Group invites are handled by useGroupInviteListener — not chat messages
  if (decrypted.startsWith('{')) {
    try {
      if ((JSON.parse(decrypted) as { type?: string })?.type === 'group_invite') return
    } catch { /* not JSON — regular message */ }
  }
```

with:

```ts
  // Group invites join a group, they are not chat messages. Handle and stop.
  if (decrypted.startsWith('{')) {
    try {
      if ((JSON.parse(decrypted) as { type?: string })?.type === 'group_invite') {
        await handleGroupInvite(event, decrypted, relays)
        return
      }
    } catch { /* not JSON — regular message */ }
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/inbox.test.ts -t "handles group invite payloads"`
Expected: PASS.

- [ ] **Step 6: Add an idempotency test**

In `src/__tests__/inbox.test.ts`, add this test immediately after the one from Step 1 (inside the same `describe` block):

```ts
  it('handles a repeated group invite once: no duplicate group, single backup publish', async () => {
    const senderSk = generateSecretKey()
    const mySk = generateSecretKey()
    const { signer } = installTestSigner(mySk)
    const myPk = signer.pubkey
    useNostrStore.setState({ publicKey: myPk })

    const payload = JSON.stringify({ type: 'group_invite', groupId: 'g', groupKeyHex: 'k', groupName: 'n' })
    const encrypted = await nip04.encrypt(senderSk, myPk, payload)
    const event = finalizeEvent({
      kind: 4,
      created_at: 1000,
      tags: [['p', myPk]],
      content: encrypted,
    }, senderSk)

    await processDMEvent(event, myPk, RELAYS, { live: true })
    await processDMEvent(event, myPk, RELAYS, { live: false })

    const state = useNostrStore.getState()
    expect(state.groups.filter(grp => grp.id === 'g')).toHaveLength(1)
    expect(publishEvent).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 7: Run the idempotency test to verify it passes**

Run: `npx vitest run src/__tests__/inbox.test.ts -t "handles a repeated group invite once"`
Expected: PASS — the second call hits the `groups.find(...)` guard and returns before adding or publishing.

- [ ] **Step 8: Run the full inbox test file to confirm no regressions**

Run: `npx vitest run src/__tests__/inbox.test.ts`
Expected: PASS — all tests in the file green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/inbox.ts src/__tests__/inbox.test.ts
git commit -m "feat: handle group invites inside processDMEvent

Fold group-invite join + key-backup into the shared kind-4 processor so a
single decrypt path handles both chat DMs and invites. Idempotent via the
existing group-exists guard.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Remove the redundant `useGroupInviteListener` hook and its mount

**Files:**
- Modify: `src/hooks/useNostrSubscriptions.ts` (delete `useGroupInviteListener` at lines 215-258; prune now-unused imports at lines 4-16)
- Modify: `src/App.tsx` (import at line 23; mount call at line 79)

**Interfaces:**
- Consumes: nothing new — `processDMEvent` (Task 1) now covers invites via the `useGlobalInbox` DM subscription.
- Produces: `useGroupInviteListener` no longer exists; `useGlobalInbox` remains the sole kind-4 `#p`-to-me subscription.

- [ ] **Step 1: Delete the `useGroupInviteListener` function**

In `src/hooks/useNostrSubscriptions.ts`, delete the entire block from the comment above `useGroupInviteListener` through its closing brace (lines 215-258):

```ts
// Hook to detect incoming group invites from kind-4 DMs addressed to the local user.
// Mount once at app level (inside App component when logged in).
export function useGroupInviteListener() {
  // ... full body ...
}
```

- [ ] **Step 2: Prune now-unused imports**

In `src/hooks/useNostrSubscriptions.ts`, the only remaining users of these symbols were `useGroupInviteListener`. Update the import from `../lib/nostr` (lines 2-15) to remove `decryptDM` and `buildGroupKeyBackupEvent` (keep `publishEvent` — still used by `sendChannelMessage`, `sendDM`, `createChannel`, `publishProfile`). Update the store import (line 16) to drop the now-unused `Group` type:

```ts
import { useNostrStore, type Channel } from '../store/nostrStore'
```

Leave `publishEvent`, `buildChannelCreateEvent`, `buildChannelMessageEvent`, `buildDMEvent`, `buildProfileEvent`, the group-kind constants, and `NostrProfile` in place.

- [ ] **Step 3: Remove the mount and import in `App.tsx`**

In `src/App.tsx`, change the import on line 23 from:

```ts
import { useGroupInviteListener, useGlobalInbox } from './hooks/useNostrSubscriptions'
```

to:

```ts
import { useGlobalInbox } from './hooks/useNostrSubscriptions'
```

And delete the call on line 79:

```ts
  useGroupInviteListener()
```

leaving `useGlobalInbox()` on the following line.

- [ ] **Step 4: Type-check and lint to confirm no dangling references or unused imports**

Run: `npx tsc --noEmit`
Expected: PASS — no errors. (If the project exposes a lint script, also run `npm run lint`; expected: no new warnings about unused imports.)

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — entire suite green, including the new invite tests from Task 1.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useNostrSubscriptions.ts src/App.tsx
git commit -m "refactor: drop redundant useGroupInviteListener subscription

Invites are now handled in processDMEvent via the single useGlobalInbox
kind-4 subscription, removing a duplicate relay subscription and a second
per-DM NIP-04 decrypt.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Add `handleGroupInvite` in `inbox.ts` with idempotency guard → Task 1, Steps 3-4.
- `processDMEvent` invite branch calls helper then returns → Task 1, Step 4.
- Import `buildGroupKeyBackupEvent` + `publishEvent` from `./nostr` → Task 1, Step 3.
- Fire-and-forget backup publish → Task 1, Step 3 (`.catch(() => {})`).
- Delete `useGroupInviteListener` → Task 2, Step 1.
- Prune unused imports (`decryptDM`, `buildGroupKeyBackupEvent`, `Group`; keep `publishEvent`) → Task 2, Step 2.
- Remove `App.tsx` call + import → Task 2, Step 3.
- Convert invite test to assert handling → Task 1, Step 1.
- Add idempotency test → Task 1, Step 6.
- Existing DM/request-gate/channel/group tests stay green → Task 1 Step 8, Task 2 Step 5.

All spec requirements map to a task. No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases" placeholders; every code step shows complete code.

**Type consistency:** `handleGroupInvite(event, decrypted, relays)` is defined and called with the same signature in Task 1 Steps 3-4. `processDMEvent` signature is unchanged and matches existing usage. `addGroup` payload mirrors the deleted hook's object exactly. `publishEvent`/`buildGroupKeyBackupEvent` names match `src/lib/nostr.ts`.
