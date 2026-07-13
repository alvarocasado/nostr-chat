# Group Member Management + Key Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creator-only add/remove of group members, with automatic symmetric-key rotation on removal, per `docs/superpowers/specs/2026-07-13-group-rekey-design.md`.

**Architecture:** `groupKeys[groupId]` stays "the current key"; a new `groupKeyHistory` holds retired epochs and decryption falls back through them. The new key is distributed via per-member NIP-04 `group_rekey` DMs (reusing the invite pipeline); membership propagates via an in-group `members` control message. The kind-30041 backup grows from a bare hex key to a JSON key list, parsing both formats.

**Tech Stack:** React 19 + TypeScript + Zustand + nostr-tools + Vitest/@testing-library. No new dependencies.

## Global Constraints

- No new npm dependencies.
- Conventional commits (`feat:` / `test:` / `refactor:`), each ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Files stay under 800 lines.
- Tests live in `src/__tests__/`, run with `npx vitest run <path>`.
- Type check: `npx tsc -b --force` (must produce no output). Lint: `npx eslint <files>` (must produce no output).
- All hex keys/pubkeys are 64-char lowercase hex; validate with `/^[0-9a-f]{64}$/`.
- Key list ordering convention: **storage & backups are oldest→newest; decryption tries newest→oldest.** Every function below states which order it uses.

---

### Task 1: Multi-epoch decrypt fallback

**Files:**
- Modify: `src/lib/groupCrypto.ts` (append at end)
- Test: `src/__tests__/groupKeyFallback.test.ts` (create)

**Interfaces:**
- Consumes: existing `encryptWithGroupKey(plaintext, keyHex)`, `decryptWithGroupKey(ciphertext, keyHex)`, `generateGroupKey()` from `src/lib/groupCrypto.ts`.
- Produces: `decryptWithGroupKeys(ciphertext: string, keysNewestFirst: string[]): Promise<string>` — tries each key in order, returns first success, throws if none work.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/groupKeyFallback.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  generateGroupKey, encryptWithGroupKey, decryptWithGroupKeys,
} from '../lib/groupCrypto'

describe('decryptWithGroupKeys', () => {
  it('decrypts with the current (first) key', async () => {
    const key = generateGroupKey()
    const ct = await encryptWithGroupKey('hello', key)
    expect(await decryptWithGroupKeys(ct, [key])).toBe('hello')
  })

  it('falls back to an older key when the current one fails', async () => {
    const oldKey = generateGroupKey()
    const newKey = generateGroupKey()
    const ct = await encryptWithGroupKey('old epoch msg', oldKey)
    expect(await decryptWithGroupKeys(ct, [newKey, oldKey])).toBe('old epoch msg')
  })

  it('throws when no key decrypts', async () => {
    const ct = await encryptWithGroupKey('secret', generateGroupKey())
    await expect(decryptWithGroupKeys(ct, [generateGroupKey()])).rejects.toThrow()
  })

  it('throws on an empty key list', async () => {
    const ct = await encryptWithGroupKey('secret', generateGroupKey())
    await expect(decryptWithGroupKeys(ct, [])).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/groupKeyFallback.test.ts`
Expected: FAIL — `decryptWithGroupKeys` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/groupCrypto.ts`:

```ts
// Epoch fallback: rotation retires keys but old messages stay encrypted with
// them. Try newest→oldest; first success wins.
export async function decryptWithGroupKeys(ciphertext: string, keysNewestFirst: string[]): Promise<string> {
  for (const keyHex of keysNewestFirst) {
    try {
      return await decryptWithGroupKey(ciphertext, keyHex)
    } catch { /* wrong epoch — try older */ }
  }
  throw new Error('no group key decrypts this message')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/groupKeyFallback.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/groupCrypto.ts src/__tests__/groupKeyFallback.test.ts
git commit -m "feat: multi-epoch group key decrypt fallback"
```

---

### Task 2: Store — key history, rotation state, membership actions

**Files:**
- Modify: `src/store/nostrStore.ts`
- Test: `src/__tests__/groupRekeyStore.test.ts` (create)

**Interfaces:**
- Consumes: existing store shape (`groupKeys: Record<string, string>`, `groups: Group[]`, `setGroupKey`).
- Produces (all on `useNostrStore`):
  - state `groupKeyHistory: Record<string, string[]>` (oldest→newest) and `groupKeyRotatedAt: Record<string, number>` (unix seconds of last accepted rotation).
  - `Group` gains `removed?: boolean`.
  - `rotateGroupKey(groupId: string, newKeyHex: string, rotatedAt: number): void` — moves current key to history, installs the new one, records `rotatedAt`. No-ops if `newKeyHex` is already current or in history.
  - `setGroupMembers(groupId: string, memberPubkeys: string[]): void`
  - `markGroupRemoved(groupId: string): void`
  - `allGroupKeys(groupId: string): string[]` — **newest→oldest** (`[current, ...history reversed]`), `[]` if no key.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/groupRekeyStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useNostrStore } from '../store/nostrStore'

const GROUP = 'g1'

beforeEach(() => {
  useNostrStore.setState({
    groups: [{ id: GROUP, name: 'Team', creatorPubkey: 'creator', memberPubkeys: ['creator', 'bob'], relayUrl: 'wss://r' }],
    groupKeys: { [GROUP]: 'a'.repeat(64) },
    groupKeyHistory: {},
    groupKeyRotatedAt: {},
  })
})

describe('rotateGroupKey', () => {
  it('installs the new key and retires the old one to history', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    const s = useNostrStore.getState()
    expect(s.groupKeys[GROUP]).toBe('b'.repeat(64))
    expect(s.groupKeyHistory[GROUP]).toEqual(['a'.repeat(64)])
    expect(s.groupKeyRotatedAt[GROUP]).toBe(1000)
  })

  it('is idempotent for a key already current or in history', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 2000) // replay of current
    useNostrStore.getState().rotateGroupKey(GROUP, 'a'.repeat(64), 3000) // replay of retired
    const s = useNostrStore.getState()
    expect(s.groupKeys[GROUP]).toBe('b'.repeat(64))
    expect(s.groupKeyHistory[GROUP]).toEqual(['a'.repeat(64)])
    expect(s.groupKeyRotatedAt[GROUP]).toBe(1000)
  })

  it('stacks multiple epochs oldest→newest in history', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    useNostrStore.getState().rotateGroupKey(GROUP, 'c'.repeat(64), 2000)
    expect(useNostrStore.getState().groupKeyHistory[GROUP]).toEqual(['a'.repeat(64), 'b'.repeat(64)])
  })
})

describe('allGroupKeys', () => {
  it('returns newest→oldest', () => {
    useNostrStore.getState().rotateGroupKey(GROUP, 'b'.repeat(64), 1000)
    useNostrStore.getState().rotateGroupKey(GROUP, 'c'.repeat(64), 2000)
    expect(useNostrStore.getState().allGroupKeys(GROUP))
      .toEqual(['c'.repeat(64), 'b'.repeat(64), 'a'.repeat(64)])
  })

  it('returns empty array for unknown group', () => {
    expect(useNostrStore.getState().allGroupKeys('nope')).toEqual([])
  })
})

describe('membership actions', () => {
  it('setGroupMembers replaces the member list', () => {
    useNostrStore.getState().setGroupMembers(GROUP, ['creator'])
    expect(useNostrStore.getState().groups[0].memberPubkeys).toEqual(['creator'])
  })

  it('markGroupRemoved flags the group', () => {
    useNostrStore.getState().markGroupRemoved(GROUP)
    expect(useNostrStore.getState().groups[0].removed).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/groupRekeyStore.test.ts`
Expected: FAIL — `rotateGroupKey` / `groupKeyHistory` do not exist (TS error or runtime undefined).

- [ ] **Step 3: Implement store changes**

In `src/store/nostrStore.ts`:

1. `Group` interface (~line 81): add `removed?: boolean` after `relayUrl: string`.

2. `NostrState` interface, next to `groupKeys` declaration, add:

```ts
  groupKeyHistory: Record<string, string[]>
  groupKeyRotatedAt: Record<string, number>
```

and next to `setGroupKey` declaration add:

```ts
  rotateGroupKey: (groupId: string, newKeyHex: string, rotatedAt: number) => void
  setGroupMembers: (groupId: string, memberPubkeys: string[]) => void
  markGroupRemoved: (groupId: string) => void
  allGroupKeys: (groupId: string) => string[]
```

3. Initial state (~line 469, next to `groupKeys: {}`): add `groupKeyHistory: {},` and `groupKeyRotatedAt: {},`. Do the same in the logout reset block (~line 566) that already resets `groupKeys: {}`.

4. Implementation, next to `setGroupKey` (~line 668):

```ts
        rotateGroupKey: (groupId, newKeyHex, rotatedAt) => {
          const current = get().groupKeys[groupId]
          const history = get().groupKeyHistory[groupId] ?? []
          if (current === newKeyHex || history.includes(newKeyHex)) return
          set({
            groupKeys: { ...get().groupKeys, [groupId]: newKeyHex },
            groupKeyRotatedAt: { ...get().groupKeyRotatedAt, [groupId]: rotatedAt },
            ...(current !== undefined
              ? { groupKeyHistory: { ...get().groupKeyHistory, [groupId]: [...history, current] } }
              : {}),
          })
        },

        setGroupMembers: (groupId, memberPubkeys) => {
          set({ groups: get().groups.map(g => g.id === groupId ? { ...g, memberPubkeys } : g) })
        },

        markGroupRemoved: (groupId) => {
          set({ groups: get().groups.map(g => g.id === groupId ? { ...g, removed: true } : g) })
        },

        allGroupKeys: (groupId) => {
          const current = get().groupKeys[groupId]
          if (!current) return []
          return [current, ...(get().groupKeyHistory[groupId] ?? []).slice().reverse()]
        },
```

5. `partialize` (~line 977, next to `groupKeys: state.groupKeys,`): add

```ts
        groupKeyHistory: state.groupKeyHistory,
        groupKeyRotatedAt: state.groupKeyRotatedAt,
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/__tests__/groupRekeyStore.test.ts src/__tests__/store.test.ts` — Expected: PASS.
Run: `npx tsc -b --force` — Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/store/nostrStore.ts src/__tests__/groupRekeyStore.test.ts
git commit -m "feat: group key epochs and membership actions in store"
```

---

### Task 3: Membership payloads library

**Files:**
- Create: `src/lib/groupMembership.ts`
- Test: `src/__tests__/groupMembership.test.ts` (create)

**Interfaces:**
- Consumes: nothing project-specific (pure serialization).
- Produces (all exported from `src/lib/groupMembership.ts`):

```ts
interface GroupRekeyPayload { type: 'group_rekey'; groupId: string; groupKeyHex: string; groupName: string; memberPubkeys: string[] }
interface GroupRemovePayload { type: 'group_remove'; groupId: string }
interface MembersPayload { type: 'members'; memberPubkeys: string[] }
serializeGroupRekey(groupId: string, groupKeyHex: string, groupName: string, memberPubkeys: string[]): string
serializeGroupRemove(groupId: string): string
serializeMembers(memberPubkeys: string[]): string
parseGroupRekeyPayload(content: string): GroupRekeyPayload | null
parseGroupRemovePayload(content: string): GroupRemovePayload | null
parseMembersPayload(content: string): MembersPayload | null
isHex64(s: unknown): s is string
```

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/groupMembership.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  serializeGroupRekey, serializeGroupRemove, serializeMembers,
  parseGroupRekeyPayload, parseGroupRemovePayload, parseMembersPayload,
} from '../lib/groupMembership'

const KEY = 'f'.repeat(64)
const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)

describe('group_rekey payload', () => {
  it('round-trips', () => {
    const s = serializeGroupRekey('g1', KEY, 'Team', [PK_A, PK_B])
    expect(parseGroupRekeyPayload(s)).toEqual({
      type: 'group_rekey', groupId: 'g1', groupKeyHex: KEY, groupName: 'Team', memberPubkeys: [PK_A, PK_B],
    })
  })

  it('rejects bad key hex, bad members, and other types', () => {
    expect(parseGroupRekeyPayload(JSON.stringify({ type: 'group_rekey', groupId: 'g', groupKeyHex: 'short', groupName: 'x', memberPubkeys: [PK_A] }))).toBeNull()
    expect(parseGroupRekeyPayload(JSON.stringify({ type: 'group_rekey', groupId: 'g', groupKeyHex: KEY, groupName: 'x', memberPubkeys: ['nope'] }))).toBeNull()
    expect(parseGroupRekeyPayload(serializeGroupRemove('g1'))).toBeNull()
    expect(parseGroupRekeyPayload('not json')).toBeNull()
  })
})

describe('group_remove payload', () => {
  it('round-trips', () => {
    expect(parseGroupRemovePayload(serializeGroupRemove('g1'))).toEqual({ type: 'group_remove', groupId: 'g1' })
  })

  it('rejects missing groupId', () => {
    expect(parseGroupRemovePayload(JSON.stringify({ type: 'group_remove' }))).toBeNull()
  })
})

describe('members payload', () => {
  it('round-trips', () => {
    expect(parseMembersPayload(serializeMembers([PK_A]))).toEqual({ type: 'members', memberPubkeys: [PK_A] })
  })

  it('rejects invalid pubkeys and oversized lists', () => {
    expect(parseMembersPayload(JSON.stringify({ type: 'members', memberPubkeys: ['xyz'] }))).toBeNull()
    expect(parseMembersPayload(JSON.stringify({ type: 'members', memberPubkeys: Array(1001).fill(PK_A) }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/groupMembership.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/lib/groupMembership.ts`:

```ts
// Membership control payloads. group_rekey / group_remove ride NIP-04 kind-4
// DMs (like group_invite in lib/nostr.ts); members rides the in-group
// encrypted transport (like edit/delete in lib/messageOps.ts). Authorization
// (sender must be the group creator) is checked by the inbox handlers, not here.

const MAX_MEMBERS = 1000
const MAX_GROUP_ID_LEN = 100

export function isHex64(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)
}

function isValidGroupId(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= MAX_GROUP_ID_LEN
}

function isValidMembers(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.length <= MAX_MEMBERS && v.every(isHex64)
}

export interface GroupRekeyPayload {
  type: 'group_rekey'
  groupId: string
  groupKeyHex: string
  groupName: string
  memberPubkeys: string[]
}

export interface GroupRemovePayload {
  type: 'group_remove'
  groupId: string
}

export interface MembersPayload {
  type: 'members'
  memberPubkeys: string[]
}

export function serializeGroupRekey(groupId: string, groupKeyHex: string, groupName: string, memberPubkeys: string[]): string {
  return JSON.stringify({ type: 'group_rekey', groupId, groupKeyHex, groupName, memberPubkeys } satisfies GroupRekeyPayload)
}

export function serializeGroupRemove(groupId: string): string {
  return JSON.stringify({ type: 'group_remove', groupId } satisfies GroupRemovePayload)
}

export function serializeMembers(memberPubkeys: string[]): string {
  return JSON.stringify({ type: 'members', memberPubkeys } satisfies MembersPayload)
}

export function parseGroupRekeyPayload(content: string): GroupRekeyPayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (
      obj.type === 'group_rekey' &&
      isValidGroupId(obj.groupId) &&
      isHex64(obj.groupKeyHex) &&
      typeof obj.groupName === 'string' &&
      isValidMembers(obj.memberPubkeys)
    ) return obj as GroupRekeyPayload
  } catch { /* not JSON */ }
  return null
}

export function parseGroupRemovePayload(content: string): GroupRemovePayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (obj.type === 'group_remove' && isValidGroupId(obj.groupId)) return obj as GroupRemovePayload
  } catch { /* not JSON */ }
  return null
}

export function parseMembersPayload(content: string): MembersPayload | null {
  if (!content.startsWith('{')) return null
  try {
    const obj = JSON.parse(content)
    if (obj.type === 'members' && isValidMembers(obj.memberPubkeys)) return obj as MembersPayload
  } catch { /* not JSON */ }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/groupMembership.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/groupMembership.ts src/__tests__/groupMembership.test.ts
git commit -m "feat: group membership control payloads"
```

---

### Task 4: Multi-epoch key backup format (kind 30041)

**Files:**
- Modify: `src/lib/nostr.ts:191-196` (`buildGroupKeyBackupEvent`)
- Modify: `src/lib/nostrSync.ts:122-138` (`fetchGroupKeys`, add `parseKeyBackup`)
- Modify: `src/lib/nostrSync.ts:199` (`groupKeys` result type)
- Modify: `src/store/nostrStore.ts:326-331` (backup merge in `loadRemote`)
- Modify: `src/components/Chat/AddGroupModal.tsx:61` and `src/lib/inbox.ts:208` (callers pass `[key]`)
- Test: `src/__tests__/groupKeyBackup.test.ts` (create)

**Interfaces:**
- Consumes: `isHex64` from Task 3.
- Produces:
  - `buildGroupKeyBackupEvent(groupId: string, keysOldestFirst: string[]): Promise<Event>` — content is NIP-04 self-encrypted `JSON.stringify({ keys: keysOldestFirst })`.
  - `parseKeyBackup(plaintext: string): string[] | null` (exported from `nostrSync.ts`) — bare 64-hex → `[hex]`; `{"keys":[...]}` with all-hex entries → the list; anything else → `null`.
  - `fetchGroupKeys(relays: string[]): Promise<Record<string, string[]>>` — values oldest→newest.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/groupKeyBackup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseKeyBackup } from '../lib/nostrSync'

const K1 = '1'.repeat(64)
const K2 = '2'.repeat(64)

describe('parseKeyBackup', () => {
  it('accepts the legacy bare-hex format as a single-key list', () => {
    expect(parseKeyBackup(K1)).toEqual([K1])
    expect(parseKeyBackup(`  ${K1}  `)).toEqual([K1])
  })

  it('accepts the JSON multi-key format', () => {
    expect(parseKeyBackup(JSON.stringify({ keys: [K1, K2] }))).toEqual([K1, K2])
  })

  it('rejects garbage, empty lists, and non-hex entries', () => {
    expect(parseKeyBackup('not a key')).toBeNull()
    expect(parseKeyBackup(JSON.stringify({ keys: [] }))).toBeNull()
    expect(parseKeyBackup(JSON.stringify({ keys: [K1, 'bad'] }))).toBeNull()
    expect(parseKeyBackup(JSON.stringify({ nope: true }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/groupKeyBackup.test.ts`
Expected: FAIL — `parseKeyBackup` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/nostrSync.ts`, replace `fetchGroupKeys` (lines 124-138) with:

```ts
// Backup content: legacy bare hex (single key) or JSON {keys:[oldest→newest]}.
export function parseKeyBackup(plaintext: string): string[] | null {
  const trimmed = plaintext.trim()
  if (isHex64(trimmed)) return [trimmed]
  if (!trimmed.startsWith('{')) return null
  try {
    const obj = JSON.parse(trimmed)
    if (Array.isArray(obj.keys) && obj.keys.length > 0 && obj.keys.every(isHex64)) {
      return obj.keys as string[]
    }
  } catch { /* not JSON */ }
  return null
}

export async function fetchGroupKeys(relays: string[]): Promise<Record<string, string[]>> {
  const signer = requireSigner()
  const events = await fetchEvents(relays, { kinds: [30041], authors: [signer.pubkey] })
  const keys: Record<string, string[]> = {}
  for (const event of events) {
    const groupId = event.tags.find(t => t[0] === 'd')?.[1]
    if (!groupId) continue
    try {
      const parsed = parseKeyBackup(await signer.nip04Decrypt(signer.pubkey, event.content))
      if (parsed) keys[groupId] = parsed
    } catch {
      // corrupt or unrecognised - skip
    }
  }
  return keys
}
```

Add `import { isHex64 } from './groupMembership'` to the imports of `nostrSync.ts`. Update the `groupKeys` field of the sync result type at `nostrSync.ts:199` from `Record<string, string>` to `Record<string, string[]>`.

In `src/lib/nostr.ts`, replace `buildGroupKeyBackupEvent` (lines 192-196) with:

```ts
// Build kind-30041 self-encrypted key backup (NIP-04 with own pubkey as recipient).
// Content is JSON {keys:[oldest→newest]}; readers also accept the legacy bare hex.
export async function buildGroupKeyBackupEvent(groupId: string, keysOldestFirst: string[]): Promise<Event> {
  const signer = requireSigner()
  const encrypted = await signer.nip04Encrypt(signer.pubkey, JSON.stringify({ keys: keysOldestFirst }))
  return signer.signEvent({ kind: 30041, created_at: Math.floor(Date.now() / 1000), tags: [['d', groupId]], content: encrypted })
}
```

Update the two callers to pass a list:
- `src/components/Chat/AddGroupModal.tsx:61`: `buildGroupKeyBackupEvent(groupId, [groupKeyHex])`
- `src/lib/inbox.ts:208`: `buildGroupKeyBackupEvent(groupId, [groupKeyHex])`

In `src/store/nostrStore.ts`, replace the group-keys merge in `loadRemote` (lines 326-331) with:

```ts
  // Group keys: relay backup fills gaps; local state takes precedence
  if (result.groupKeys && Object.keys(result.groupKeys).length > 0) {
    const mergedKeys = { ...get().groupKeys }
    const mergedHistory = { ...get().groupKeyHistory }
    for (const [gid, list] of Object.entries(result.groupKeys)) {
      if (mergedKeys[gid] !== undefined || list.length === 0) continue
      mergedKeys[gid] = list[list.length - 1]
      if (list.length > 1) mergedHistory[gid] = list.slice(0, -1)
    }
    set({ groupKeys: mergedKeys, groupKeyHistory: mergedHistory })
  }
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/__tests__/groupKeyBackup.test.ts src/__tests__/inbox.test.ts src/__tests__/store.test.ts` — Expected: PASS.
Run: `npx tsc -b --force` — Expected: no output. (If other call sites of the changed signatures surface, fix them the same way: wrap single keys in `[...]`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/nostr.ts src/lib/nostrSync.ts src/store/nostrStore.ts src/components/Chat/AddGroupModal.tsx src/lib/inbox.ts src/__tests__/groupKeyBackup.test.ts
git commit -m "feat: multi-epoch group key backups (kind 30041)"
```

---

### Task 5: Inbox — rekey/remove DM handlers, members control, multi-key decrypt

**Files:**
- Modify: `src/lib/inbox.ts` (`handleGroupInvite`, new handlers, dispatch block at 317-325, `processGroupEvent` at 389-434)
- Modify: `src/hooks/useNostrSubscriptions.ts:155,219-220` (pass key lists)
- Modify: `src/hooks/useChatHistory.ts:68-71` (pass key list)
- Test: `src/__tests__/groupMembership.inbox.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 `decryptWithGroupKeys`, Task 2 store actions, Task 3 payload parsers.
- Produces:
  - `processGroupEvent(event, groupId, groupKeys: string[], relays, opts)` — **signature change**: third param is now the newest→oldest key list.
  - DM dispatch handles `group_rekey` and `group_remove`; group transport routes `members`.
  - `handleGroupInvite` honours `memberPubkeys` in the invite payload.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/groupMembership.inbox.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event } from 'nostr-tools'
import { useNostrStore } from '../store/nostrStore'
import { encryptWithGroupKey } from '../lib/groupCrypto'
import { serializeGroupRekey, serializeGroupRemove, serializeMembers } from '../lib/groupMembership'

// decryptDM returns whatever the test staged; publish is swallowed.
let stagedPlaintext = ''
vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    decryptDM: async () => stagedPlaintext,
    publishEvent: vi.fn().mockResolvedValue(undefined),
    buildGroupKeyBackupEvent: vi.fn().mockResolvedValue({ id: 'backup' }),
    fetchEvent: vi.fn().mockResolvedValue(null),
  }
})
vi.mock('../lib/signer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/signer')>()
  return { ...actual, getSigner: () => ({ pubkey: 'me'.padEnd(64, '0') }) }
})

import { processDMEvent, processGroupEvent, resetInboxDedup } from '../lib/inbox'

const ME = 'me'.padEnd(64, '0')
const CREATOR = 'c'.repeat(64)
const MALLORY = 'd'.repeat(64)
const GROUP = 'group-uuid-1'
const OLD_KEY = 'a'.repeat(64)
const NEW_KEY = 'b'.repeat(64)
const RELAYS = ['wss://r']

function dmEvent(from: string, createdAt = 100): Event {
  return {
    id: Math.random().toString(36).slice(2).padEnd(64, '0'),
    pubkey: from, created_at: createdAt, kind: 4,
    tags: [['p', ME]], content: 'ciphertext', sig: '',
  } as Event
}

beforeEach(() => {
  resetInboxDedup()
  useNostrStore.setState({
    publicKey: ME,
    groups: [{ id: GROUP, name: 'Team', creatorPubkey: CREATOR, memberPubkeys: [CREATOR, ME], relayUrl: RELAYS[0] }],
    groupKeys: { [GROUP]: OLD_KEY },
    groupKeyHistory: {},
    groupKeyRotatedAt: {},
    messages: {}, contacts: [], profiles: {}, blockedPubkeys: [], dismissedRequests: {}, seenAt: {},
  })
})

describe('group_rekey DM', () => {
  it('rotates the key and updates members when sent by the creator', async () => {
    stagedPlaintext = serializeGroupRekey(GROUP, NEW_KEY, 'Team', [CREATOR, ME])
    await processDMEvent(dmEvent(CREATOR), ME, RELAYS, { live: true })
    const s = useNostrStore.getState()
    expect(s.groupKeys[GROUP]).toBe(NEW_KEY)
    expect(s.groupKeyHistory[GROUP]).toEqual([OLD_KEY])
    expect(s.groups[0].memberPubkeys).toEqual([CREATOR, ME])
  })

  it('ignores rekey from a non-creator', async () => {
    stagedPlaintext = serializeGroupRekey(GROUP, NEW_KEY, 'Team', [MALLORY])
    await processDMEvent(dmEvent(MALLORY), ME, RELAYS, { live: true })
    expect(useNostrStore.getState().groupKeys[GROUP]).toBe(OLD_KEY)
  })

  it('ignores a stale rekey older than the last accepted rotation', async () => {
    stagedPlaintext = serializeGroupRekey(GROUP, NEW_KEY, 'Team', [CREATOR, ME])
    await processDMEvent(dmEvent(CREATOR, 200), ME, RELAYS, { live: true })
    stagedPlaintext = serializeGroupRekey(GROUP, 'e'.repeat(64), 'Team', [CREATOR, ME])
    await processDMEvent(dmEvent(CREATOR, 150), ME, RELAYS, { live: true }) // older replay
    expect(useNostrStore.getState().groupKeys[GROUP]).toBe(NEW_KEY)
  })
})

describe('group_remove DM', () => {
  it('marks the group removed when sent by the creator', async () => {
    stagedPlaintext = serializeGroupRemove(GROUP)
    await processDMEvent(dmEvent(CREATOR), ME, RELAYS, { live: true })
    expect(useNostrStore.getState().groups[0].removed).toBe(true)
  })

  it('ignores remove from a non-creator', async () => {
    stagedPlaintext = serializeGroupRemove(GROUP)
    await processDMEvent(dmEvent(MALLORY), ME, RELAYS, { live: true })
    expect(useNostrStore.getState().groups[0].removed).toBeUndefined()
  })
})

describe('members control in group transport', () => {
  async function groupEvent(plaintext: string, key: string, from: string): Promise<Event> {
    return {
      id: Math.random().toString(36).slice(2).padEnd(64, '0'),
      pubkey: from, created_at: 100, kind: 1042,
      tags: [['h', GROUP, RELAYS[0]]],
      content: await encryptWithGroupKey(plaintext, key), sig: '',
    } as Event
  }

  it('applies a creator-signed members update and does not store it as a message', async () => {
    const ev = await groupEvent(serializeMembers([CREATOR]), OLD_KEY, CREATOR)
    await processGroupEvent(ev, GROUP, [OLD_KEY], RELAYS, { live: true })
    const s = useNostrStore.getState()
    expect(s.groups[0].memberPubkeys).toEqual([CREATOR])
    expect(s.messages[GROUP] ?? []).toHaveLength(0)
  })

  it('ignores a members update from a non-creator', async () => {
    const ev = await groupEvent(serializeMembers([MALLORY]), OLD_KEY, MALLORY)
    await processGroupEvent(ev, GROUP, [OLD_KEY], RELAYS, { live: true })
    expect(useNostrStore.getState().groups[0].memberPubkeys).toEqual([CREATOR, ME])
  })

  it('decrypts an old-epoch message via key fallback', async () => {
    const ev = await groupEvent('old epoch text', OLD_KEY, CREATOR)
    await processGroupEvent(ev, GROUP, [NEW_KEY, OLD_KEY], RELAYS, { live: false })
    expect((useNostrStore.getState().messages[GROUP] ?? [])[0]?.content).toBe('old epoch text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/groupMembership.inbox.test.ts`
Expected: FAIL — rekey DM treated as a regular message; `processGroupEvent` rejects the array argument.

- [ ] **Step 3: Implement inbox changes**

In `src/lib/inbox.ts`:

1. Imports: replace `import { decryptWithGroupKey } from './groupCrypto'` with `import { decryptWithGroupKeys } from './groupCrypto'`, and add:

```ts
import { parseGroupRekeyPayload, parseGroupRemovePayload, parseMembersPayload, isHex64 } from './groupMembership'
```

2. In `handleGroupInvite` (~line 186): widen the payload type with `memberPubkeys?: unknown` and replace `memberPubkeys: [publicKey],` with:

```ts
      memberPubkeys: Array.isArray(payload.memberPubkeys) &&
        payload.memberPubkeys.every(isHex64) &&
        payload.memberPubkeys.includes(publicKey)
        ? payload.memberPubkeys
        : [publicKey],
```

3. Add the two DM handlers after `handleGroupInvite`:

```ts
/**
 * Handle a group_rekey DM: only honoured from the group's creator, and only
 * when newer than the last accepted rotation (stale replays are dropped).
 */
async function handleGroupRekey(event: Event, decrypted: string): Promise<void> {
  const payload = parseGroupRekeyPayload(decrypted)
  if (!payload) return
  const state = useNostrStore.getState()
  const group = state.groups.find(g => g.id === payload.groupId)
  if (!group || event.pubkey !== group.creatorPubkey) return
  if (event.created_at <= (state.groupKeyRotatedAt[payload.groupId] ?? 0)) return

  state.rotateGroupKey(payload.groupId, payload.groupKeyHex, event.created_at)
  state.setGroupMembers(payload.groupId, payload.memberPubkeys)

  // Refresh the cross-device backup with the full epoch list (oldest→newest)
  try {
    const keysOldestFirst = useNostrStore.getState().allGroupKeys(payload.groupId).slice().reverse()
    const backup = await buildGroupKeyBackupEvent(payload.groupId, keysOldestFirst)
    publishEvent(useNostrStore.getState().writeRelays(), backup).catch(() => {})
  } catch { /* backup is best-effort */ }
}

/** Handle a group_remove DM: courtesy notice that I was removed. Creator-only. */
function handleGroupRemove(event: Event, decrypted: string): void {
  const payload = parseGroupRemovePayload(decrypted)
  if (!payload) return
  const { groups, markGroupRemoved } = useNostrStore.getState()
  const group = groups.find(g => g.id === payload.groupId)
  if (!group || group.removed || event.pubkey !== group.creatorPubkey) return
  markGroupRemoved(payload.groupId)
}
```

4. Replace the dispatch block in `processDMEvent` (lines 317-325) with:

```ts
  // Group membership control DMs are not chat messages. Handle and stop.
  if (decrypted.startsWith('{')) {
    try {
      const controlType = (JSON.parse(decrypted) as { type?: string })?.type
      if (controlType === 'group_invite') {
        await handleGroupInvite(event, decrypted, relays)
        return
      }
      if (controlType === 'group_rekey') {
        await handleGroupRekey(event, decrypted)
        return
      }
      if (controlType === 'group_remove') {
        handleGroupRemove(event, decrypted)
        return
      }
    } catch { /* not JSON — regular message */ }
  }
```

5. Add the members router next to `routeReaction`:

```ts
/** Apply a creator-signed members update; never shown as a chat message. */
function routeMembers(content: string, groupId: string, event: Event): boolean {
  const payload = parseMembersPayload(content)
  if (!payload) return false
  if (claimSideEffects(event.id)) {
    const group = useNostrStore.getState().groups.find(g => g.id === groupId)
    if (group && event.pubkey === group.creatorPubkey) {
      useNostrStore.getState().setGroupMembers(groupId, payload.memberPubkeys)
    }
  }
  return true
}
```

6. Change `processGroupEvent`: parameter `groupKey: string` becomes `groupKeys: string[]` (newest→oldest); the decrypt line becomes `plaintext = await decryptWithGroupKeys(event.content, groupKeys)`; and add `if (routeMembers(plaintext, groupId, event)) return` directly after the `routeMessageOp` line.

7. Call sites:
   - `src/hooks/useNostrSubscriptions.ts:155` → `void processGroupEvent(event, groupId, useNostrStore.getState().allGroupKeys(groupId), stableRelays, { live })`
   - `src/hooks/useNostrSubscriptions.ts:219-220` →

```ts
        const keys = useNostrStore.getState().allGroupKeys(chatId)
        if (keys.length > 0) void processGroupEvent(event, chatId, keys, stableRelays, { live })
```

   - `src/hooks/useChatHistory.ts:69-70` →

```ts
          const keys = useNostrStore.getState().allGroupKeys(chatId)
          if (keys.length > 0) await processGroupEvent(ev, chatId, keys, relays, { live: false })
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/__tests__/groupMembership.inbox.test.ts src/__tests__/inbox.test.ts src/__tests__/useGlobalInbox.test.tsx src/__tests__/useChatHistory.test.tsx` — Expected: PASS. (`inbox.test.ts` calls `processGroupEvent` with a string key — update that call site to `[key]`.)
Run: `npx tsc -b --force` — Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbox.ts src/hooks/useNostrSubscriptions.ts src/hooks/useChatHistory.ts src/__tests__/groupMembership.inbox.test.ts src/__tests__/inbox.test.ts
git commit -m "feat: handle group rekey/remove/members controls, epoch-aware decrypt"
```

---

### Task 6: Creator actions — add/remove member flows

**Files:**
- Modify: `src/lib/nostr.ts` (extend `buildGroupInviteEvent`, add `buildGroupRekeyEvent`, `buildGroupRemoveEvent`)
- Create: `src/lib/groupManage.ts`
- Modify: `src/components/Chat/AddGroupModal.tsx:63` (pass member list to invite)
- Test: `src/__tests__/groupManage.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 store actions, Task 3 serializers, existing `generateGroupKey`, `sendGroupControl`, `publishEvent`, `buildGroupMetadataEvent`, `buildGroupKeyBackupEvent`.
- Produces:
  - `buildGroupInviteEvent(recipientPubkey, groupId, groupKeyHex, groupName, memberPubkeys: string[])` — payload gains `memberPubkeys`.
  - `buildGroupRekeyEvent(recipientPubkey: string, groupId: string, groupKeyHex: string, groupName: string, memberPubkeys: string[]): Promise<Event>`
  - `buildGroupRemoveEvent(recipientPubkey: string, groupId: string): Promise<Event>`
  - `addGroupMember(group: Group, newMemberPubkey: string): Promise<void>` (throws on publish failure)
  - `removeGroupMember(group: Group, removePubkey: string): Promise<void>` (throws on publish failure)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/groupManage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useNostrStore } from '../store/nostrStore'

const h = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  sendGroupControl: vi.fn(),
  buildGroupInviteEvent: vi.fn(),
  buildGroupRekeyEvent: vi.fn(),
  buildGroupRemoveEvent: vi.fn(),
  buildGroupMetadataEvent: vi.fn(),
  buildGroupKeyBackupEvent: vi.fn(),
}))

vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    publishEvent: h.publishEvent,
    buildGroupInviteEvent: h.buildGroupInviteEvent,
    buildGroupRekeyEvent: h.buildGroupRekeyEvent,
    buildGroupRemoveEvent: h.buildGroupRemoveEvent,
    buildGroupMetadataEvent: h.buildGroupMetadataEvent,
    buildGroupKeyBackupEvent: h.buildGroupKeyBackupEvent,
  }
})
vi.mock('../hooks/useNostrSubscriptions', () => ({ sendGroupControl: h.sendGroupControl }))

import { addGroupMember, removeGroupMember } from '../lib/groupManage'
import type { Group } from '../store/nostrStore'

const ME = 'me'.padEnd(64, '0')
const BOB = 'b'.repeat(64)
const EVE = 'e'.repeat(64)
const KEY = 'a'.repeat(64)
const GROUP: Group = { id: 'g1', name: 'Team', creatorPubkey: ME, memberPubkeys: [ME, BOB, EVE], relayUrl: 'wss://r' }

beforeEach(() => {
  vi.clearAllMocks()
  h.publishEvent.mockResolvedValue(undefined)
  h.sendGroupControl.mockResolvedValue(undefined)
  for (const b of [h.buildGroupInviteEvent, h.buildGroupRekeyEvent, h.buildGroupRemoveEvent, h.buildGroupMetadataEvent, h.buildGroupKeyBackupEvent]) {
    b.mockResolvedValue({ id: 'evt' })
  }
  useNostrStore.setState({
    publicKey: ME,
    groups: [{ ...GROUP }],
    groupKeys: { g1: KEY },
    groupKeyHistory: {},
    groupKeyRotatedAt: {},
    relays: ['wss://r'],
    relayModes: {},
  })
})

describe('addGroupMember', () => {
  it('invites with the current key and full member list, updates local members', async () => {
    const NEW = 'f'.repeat(64)
    await addGroupMember(GROUP, NEW)
    expect(h.buildGroupInviteEvent).toHaveBeenCalledWith(NEW, 'g1', KEY, 'Team', [ME, BOB, EVE, NEW])
    expect(h.buildGroupMetadataEvent).toHaveBeenCalledWith(KEY, 'g1', 'Team', '', [ME, BOB, EVE, NEW])
    expect(h.sendGroupControl).toHaveBeenCalledTimes(1)
    expect(useNostrStore.getState().groups[0].memberPubkeys).toContain(NEW)
    // no rotation on add
    expect(useNostrStore.getState().groupKeys.g1).toBe(KEY)
  })
})

describe('removeGroupMember', () => {
  it('rotates the key, rekeys remaining members, notifies the removed one', async () => {
    await removeGroupMember(GROUP, EVE)
    const s = useNostrStore.getState()
    expect(s.groupKeys.g1).not.toBe(KEY)
    expect(s.groupKeyHistory.g1).toEqual([KEY])
    expect(s.groups[0].memberPubkeys).toEqual([ME, BOB])
    // rekey DM to BOB only (not me, not the removed member)
    expect(h.buildGroupRekeyEvent).toHaveBeenCalledTimes(1)
    expect(h.buildGroupRekeyEvent).toHaveBeenCalledWith(BOB, 'g1', s.groupKeys.g1, 'Team', [ME, BOB])
    expect(h.buildGroupRemoveEvent).toHaveBeenCalledWith(EVE, 'g1')
    // backup carries both epochs oldest→newest
    expect(h.buildGroupKeyBackupEvent).toHaveBeenCalledWith('g1', [KEY, s.groupKeys.g1])
    // members control sent with the NEW key
    expect(h.sendGroupControl.mock.calls[0][2]).toBe(s.groupKeys.g1)
  })

  it('propagates a publish failure so the UI can offer retry', async () => {
    h.publishEvent.mockRejectedValueOnce(new Error('relay down'))
    await expect(removeGroupMember(GROUP, EVE)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/groupManage.test.ts`
Expected: FAIL — `../lib/groupManage` not found.

- [ ] **Step 3: Implement**

In `src/lib/nostr.ts`, replace `buildGroupInviteEvent` (lines 198-209) and add the two new builders after it:

```ts
// Build group invite as NIP-04 DM carrying
// { type: 'group_invite', groupId, groupKeyHex, groupName, memberPubkeys }
export async function buildGroupInviteEvent(
  recipientPubkey: string,
  groupId: string,
  groupKeyHex: string,
  groupName: string,
  memberPubkeys: string[],
): Promise<Event> {
  const signer = requireSigner()
  const payload = JSON.stringify({ type: 'group_invite', groupId, groupKeyHex, groupName, memberPubkeys })
  const encrypted = await signer.nip04Encrypt(recipientPubkey, payload)
  return signer.signEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', recipientPubkey]], content: encrypted })
}

// Build group rekey as NIP-04 DM (new epoch key after a member removal)
export async function buildGroupRekeyEvent(
  recipientPubkey: string,
  groupId: string,
  groupKeyHex: string,
  groupName: string,
  memberPubkeys: string[],
): Promise<Event> {
  const signer = requireSigner()
  const encrypted = await signer.nip04Encrypt(
    recipientPubkey,
    serializeGroupRekey(groupId, groupKeyHex, groupName, memberPubkeys),
  )
  return signer.signEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', recipientPubkey]], content: encrypted })
}

// Build courtesy removal notice as NIP-04 DM to the removed member
export async function buildGroupRemoveEvent(recipientPubkey: string, groupId: string): Promise<Event> {
  const signer = requireSigner()
  const encrypted = await signer.nip04Encrypt(recipientPubkey, serializeGroupRemove(groupId))
  return signer.signEvent({ kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', recipientPubkey]], content: encrypted })
}
```

Add to `nostr.ts` imports: `import { serializeGroupRekey, serializeGroupRemove } from './groupMembership'`.

Update `src/components/Chat/AddGroupModal.tsx:63` to pass the full list:

```ts
        await publishEvent(writeRelays, await buildGroupInviteEvent(memberPubkey, groupId, groupKeyHex, name.trim(), allMembers))
```

Create `src/lib/groupManage.ts`:

```ts
// Creator-side membership operations. Order matters on removal: metadata and
// backup first (durable records), then per-member key distribution, then the
// in-group members control encrypted with the NEW key so the removed member
// cannot read it. See docs/superpowers/specs/2026-07-13-group-rekey-design.md.
import {
  publishEvent, buildGroupInviteEvent, buildGroupRekeyEvent,
  buildGroupRemoveEvent, buildGroupMetadataEvent, buildGroupKeyBackupEvent,
} from './nostr'
import { generateGroupKey } from './groupCrypto'
import { serializeMembers } from './groupMembership'
import { sendGroupControl } from '../hooks/useNostrSubscriptions'
import { useNostrStore, type Group } from '../store/nostrStore'

/** Add a member: no rotation — they get the current key and see the current epoch. */
export async function addGroupMember(group: Group, newMemberPubkey: string): Promise<void> {
  const state = useNostrStore.getState()
  const key = state.groupKeys[group.id]
  if (!key) throw new Error('group key unavailable')
  const relays = state.writeRelays()
  const members = [...group.memberPubkeys, newMemberPubkey]

  await publishEvent(relays, await buildGroupInviteEvent(newMemberPubkey, group.id, key, group.name, members))
  await publishEvent(relays, await buildGroupMetadataEvent(key, group.id, group.name, group.about ?? '', members))
  await sendGroupControl(serializeMembers(members), group.id, key, relays)
  useNostrStore.getState().setGroupMembers(group.id, members)
}

/** Remove a member: rotate the key so they cannot read anything new. */
export async function removeGroupMember(group: Group, removePubkey: string): Promise<void> {
  const state = useNostrStore.getState()
  if (!state.groupKeys[group.id]) throw new Error('group key unavailable')
  const relays = state.writeRelays()
  const newKey = generateGroupKey()
  const members = group.memberPubkeys.filter(p => p !== removePubkey)
  const rotatedAt = Math.floor(Date.now() / 1000)

  await publishEvent(relays, await buildGroupMetadataEvent(newKey, group.id, group.name, group.about ?? '', members))

  // Local rotation before the backup so the backup includes the new epoch
  state.rotateGroupKey(group.id, newKey, rotatedAt)
  state.setGroupMembers(group.id, members)
  const keysOldestFirst = useNostrStore.getState().allGroupKeys(group.id).slice().reverse()
  await publishEvent(relays, await buildGroupKeyBackupEvent(group.id, keysOldestFirst))

  const me = state.publicKey
  for (const member of members) {
    if (member === me) continue
    await publishEvent(relays, await buildGroupRekeyEvent(member, group.id, newKey, group.name, members))
  }
  await publishEvent(relays, await buildGroupRemoveEvent(removePubkey, group.id))
  await sendGroupControl(serializeMembers(members), group.id, newKey, relays)
}
```

- [ ] **Step 4: Run tests and type check**

Run: `npx vitest run src/__tests__/groupManage.test.ts` — Expected: PASS.
Run: `npx tsc -b --force` — Expected: no output. (The `buildGroupInviteEvent` signature change may surface other call sites — the only one is AddGroupModal, already updated.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/nostr.ts src/lib/groupManage.ts src/components/Chat/AddGroupModal.tsx src/__tests__/groupManage.test.ts
git commit -m "feat: creator add/remove member flows with key rotation"
```

---

### Task 7: Members panel UI

**Files:**
- Create: `src/components/Chat/GroupMembersModal.tsx`
- Modify: `src/components/Chat/MessageThread.tsx` (`GroupHeader`, ~lines 123-176: member count becomes a button that opens the modal)
- Test: `src/__tests__/GroupMembersModal.test.tsx` (create)

**Interfaces:**
- Consumes: `addGroupMember(group, pubkey)`, `removeGroupMember(group, pubkey)` from Task 6; store `profiles`, `publicKey`; `getDisplayName` from `lib/fileUtils`; `Avatar` component; npub decode pattern from `AddGroupModal.tsx` (`nip19.decode`).
- Produces: `GroupMembersModal({ group, onClose }: { group: Group; onClose: () => void })`.

Behavior:
- Lists every `group.memberPubkeys` entry with `Avatar` + `getDisplayName(profiles[pk], pk, 12)`; creator row labeled "creator".
- If `publicKey === group.creatorPubkey`: an npub/hex input + "Invite" button (validates like `AddGroupModal.handleAddMember`: `nip19.decode` for `npub1…`, else 64-hex; rejects duplicates and self), and a "Remove" button per non-self member. Remove is two-step: first tap turns the button into "Confirm — rotates key"; second tap calls `removeGroupMember`, disables the panel while pending, and shows an error row with the caught message on failure (state `error: string | null`).
- Non-creators see the plain list only.
- Footer note (exact copy): `Anyone who was a member can still read messages from before their removal. Removing a member rotates the key so they can't read anything new.`
- Modal chrome copied from `AddGroupModal.tsx` (fixed overlay, `bg-gray-900` panel, X close button with `aria-label="Close"`).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/GroupMembersModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNostrStore, type Group } from '../store/nostrStore'

const h = vi.hoisted(() => ({ addGroupMember: vi.fn(), removeGroupMember: vi.fn() }))
vi.mock('../lib/groupManage', () => ({
  addGroupMember: h.addGroupMember,
  removeGroupMember: h.removeGroupMember,
}))

import { GroupMembersModal } from '../components/Chat/GroupMembersModal'

const ME = 'me'.padEnd(64, '0')
const BOB = 'b'.repeat(64)
const GROUP: Group = { id: 'g1', name: 'Team', creatorPubkey: ME, memberPubkeys: [ME, BOB], relayUrl: 'wss://r' }

beforeEach(() => {
  vi.clearAllMocks()
  h.removeGroupMember.mockResolvedValue(undefined)
  useNostrStore.setState({
    publicKey: ME,
    profiles: { [BOB]: { name: 'Bob', pubkey: BOB } },
    groups: [GROUP],
  })
})

describe('GroupMembersModal', () => {
  it('lists members with names and shows the trust note', () => {
    render(<GroupMembersModal group={GROUP} onClose={() => {}} />)
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText(/rotates the key/i)).toBeInTheDocument()
  })

  it('lets the creator remove a member after confirming', async () => {
    const user = userEvent.setup()
    render(<GroupMembersModal group={GROUP} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: /remove bob/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(h.removeGroupMember).toHaveBeenCalledWith(GROUP, BOB)
  })

  it('hides management controls from non-creators', () => {
    useNostrStore.setState({ publicKey: BOB })
    render(<GroupMembersModal group={GROUP} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/npub/i)).not.toBeInTheDocument()
  })

  it('lets the creator invite by hex pubkey', async () => {
    const user = userEvent.setup()
    h.addGroupMember.mockResolvedValue(undefined)
    render(<GroupMembersModal group={GROUP} onClose={() => {}} />)
    await user.type(screen.getByPlaceholderText(/npub/i), 'c'.repeat(64))
    await user.click(screen.getByRole('button', { name: /invite/i }))
    expect(h.addGroupMember).toHaveBeenCalledWith(GROUP, 'c'.repeat(64))
  })
})
```

Give each remove button `aria-label={'Remove ' + name}` so `/remove bob/i` matches, and the input `placeholder="npub or hex pubkey"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/GroupMembersModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the modal and header hookup**

Create `src/components/Chat/GroupMembersModal.tsx` implementing the behavior above (~150 lines). Skeleton:

```tsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useNostrStore, type Group } from '../../store/nostrStore'
import { Avatar } from './Avatar'
import { getDisplayName } from '../../lib/fileUtils'
import { addGroupMember, removeGroupMember } from '../../lib/groupManage'

export function GroupMembersModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const { publicKey, profiles } = useNostrStore()
  const isCreator = publicKey === group.creatorPubkey
  const [input, setInput] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolveInput = (): string | null => {
    const raw = input.trim()
    if (raw.startsWith('npub1')) {
      try {
        const d = nip19.decode(raw)
        if (d.type === 'npub') return d.data
      } catch { /* fall through */ }
      return null
    }
    return /^[0-9a-f]{64}$/.test(raw) ? raw : null
  }

  const handleInvite = async () => {
    const pk = resolveInput()
    if (!pk) { setError('Enter a valid npub or hex pubkey'); return }
    if (pk === publicKey || group.memberPubkeys.includes(pk)) { setError('Already a member'); return }
    setBusy(true); setError(null)
    try { await addGroupMember(group, pk); setInput('') }
    catch { setError('Invite failed. Check relay connection and retry.') }
    finally { setBusy(false) }
  }

  const handleRemove = async (pk: string) => {
    if (confirming !== pk) { setConfirming(pk); return }
    setBusy(true); setError(null)
    try { await removeGroupMember(group, pk); setConfirming(null) }
    catch { setError('Removal failed. Check relay connection and retry.') }
    finally { setBusy(false) }
  }

  return (
    /* overlay + panel chrome copied from AddGroupModal.tsx:
       - header row: title "Members · {group.memberPubkeys.length}", X button aria-label="Close" onClick={onClose}
       - member rows: Avatar + getDisplayName(profiles[pk], pk, 12); "creator" tag when pk === group.creatorPubkey;
         when isCreator && pk !== publicKey: remove button with
         aria-label={`Remove ${getDisplayName(profiles[pk], pk, 12)}`},
         label text: confirming === pk ? 'Confirm — rotates key' : 'Remove', disabled={busy}
       - when isCreator: input placeholder="npub or hex pubkey" bound to input/setInput + "Invite" button
         onClick={handleInvite} disabled={busy}
       - error !== null: red error row with the message
       - footer <p>: "Anyone who was a member can still read messages from before their removal.
         Removing a member rotates the key so they can't read anything new."
    */
  )
}
```

In `src/components/Chat/MessageThread.tsx` `GroupHeader`: add `const [showMembers, setShowMembers] = useState(false)`; wrap the `{group.memberPubkeys.length} members · encrypted` span in a `<button onClick={() => group && setShowMembers(true)} aria-label="Members">…</button>`; render `{showMembers && group && <GroupMembersModal group={group} onClose={() => setShowMembers(false)} />}` after the header div (wrap the return in a fragment). Import `GroupMembersModal`.

- [ ] **Step 4: Run tests, type check, lint**

Run: `npx vitest run src/__tests__/GroupMembersModal.test.tsx src/__tests__/MessageThread.test.tsx` — Expected: PASS.
Run: `npx tsc -b --force` and `npx eslint src/components/Chat/GroupMembersModal.tsx src/components/Chat/MessageThread.tsx` — Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/GroupMembersModal.tsx src/components/Chat/MessageThread.tsx src/__tests__/GroupMembersModal.test.tsx
git commit -m "feat: group members panel with creator management"
```

---

### Task 8: Removed-group thread state

**Files:**
- Modify: `src/components/Chat/MessageThread.tsx` (`GroupThread`)
- Test: extend `src/__tests__/MessageThread.test.tsx`

**Interfaces:**
- Consumes: `Group.removed` from Task 2.
- Produces: when the active group has `removed: true`, the thread shows a banner and no input; history stays visible.

- [ ] **Step 1: Write the failing test**

Add to the `describe('MessageThread')` block in `src/__tests__/MessageThread.test.tsx`:

```tsx
  it('shows a removed banner and no input when the user was removed from the group', () => {
    store.state = baseState({
      activeChatId: 'g1', activeChatType: 'group',
      groups: [{ id: 'g1', name: 'Team', memberPubkeys: [ME], creatorPubkey: THEM, removed: true }],
      groupKeys: { g1: 'a'.repeat(64) },
    })
    render(<MessageThread />)
    expect(screen.getByText(/you were removed from this group/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/message group/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/MessageThread.test.tsx`
Expected: FAIL — the input still renders.

- [ ] **Step 3: Implement**

In `src/components/Chat/MessageThread.tsx` `GroupThread`: read the group once — `const group = useNostrStore.getState().groups.find(g => g.id === groupId)` is wrong (not reactive); instead destructure `groups` from the existing `useNostrStore()` call and compute `const isRemoved = groups.find(g => g.id === groupId)?.removed === true`. In the main return, replace the `{signerCaps.nip04 && (<MessageInput …/>)}` block with:

```tsx
          {isRemoved ? (
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 border-t border-gray-800">
              <p className="flex-1 text-sm text-gray-400">You were removed from this group. You can read messages from before your removal.</p>
            </div>
          ) : !signerCaps.nip04 ? (
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 border-t border-gray-800">
              <p className="flex-1 text-sm text-gray-400">Your signer does not support encrypted messages yet</p>
            </div>
          ) : (
            <MessageInput
              chatId={groupId}
              chatType="group"
              onSend={handleSend}
              onTyping={() => {}}
              placeholder="Message group…"
              replyTo={thread.replyTo}
              onCancelReply={() => thread.setReplyTo(null)}
            />
          )}
```

(This replaces both the existing `{!signerCaps.nip04 && …}` and `{signerCaps.nip04 && …}` blocks.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/MessageThread.test.tsx` — Expected: PASS (all cases, including the pre-existing group ones).

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/MessageThread.tsx src/__tests__/MessageThread.test.tsx
git commit -m "feat: removed-from-group thread state"
```

---

### Task 9: Full verification + FeatureNotes + push

**Files:**
- Modify: `FeatureNotes.md` (add Unreleased entry)

- [ ] **Step 1: Full suite, type check, lint**

Run: `npx vitest run` — Expected: all files pass.
Run: `npx tsc -b --force` — Expected: no output.
Run: `npx eslint src/lib/groupMembership.ts src/lib/groupManage.ts src/lib/inbox.ts src/lib/nostr.ts src/lib/nostrSync.ts src/store/nostrStore.ts src/components/Chat/GroupMembersModal.tsx src/components/Chat/MessageThread.tsx` — Expected: no output.

- [ ] **Step 2: FeatureNotes entry**

Add under `## Unreleased` in `FeatureNotes.md`:

```markdown
- **Group member management + key rotation** (2026-07-13). Spec:
  `docs/superpowers/specs/2026-07-13-group-rekey-design.md`. Creator-only
  add/remove via the new Members panel (group header). Removal mints a new
  AES-GCM epoch key, distributed to remaining members as NIP-04 `group_rekey`
  DMs; the removed member gets a courtesy `group_remove` notice and a
  disabled thread. Old epochs stay in `groupKeyHistory` so history remains
  readable; decryption falls back newest→oldest. Kind-30041 backups now carry
  the full epoch list as JSON (legacy bare-hex backups still parse). New
  members receive only the current epoch key. Membership propagates via an
  in-group `members` control (creator-signed only), which also fixes invitee
  member counts. Accepted limits: no admin transfer, no forward secrecy
  within an epoch (MLS later), removed members keep pre-removal history,
  authorization is client-side creator-signature checking.
```

- [ ] **Step 3: Commit and push**

```bash
git add FeatureNotes.md
git commit -m "docs: FeatureNotes entry for group member management + key rotation"
git push origin develop
```

- [ ] **Step 4: Manual verification note**

Report to the user for live verification with two accounts/devices: create group → add member → remove member → verify the removed client shows the banner and cannot read new messages, and the remaining client keeps reading old + new messages.
