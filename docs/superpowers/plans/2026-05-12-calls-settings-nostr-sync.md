# Calls Settings Nostr Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync TURN server configuration across devices by extending the existing kind 30078 NIP-78 app settings event.

**Architecture:** Add a `callsSettings` field to the `SyncedSettings` interface in `nostrSync.ts`. On save, `CallsTab` triggers the existing debounced settings sync (which now reads TURN config from Dexie and includes it). On login, the hydration handler writes any received `callsSettings` back to Dexie so `CallsTab` picks them up on mount.

**Tech Stack:** TypeScript, Zustand, Dexie (IndexedDB), nostr-tools NIP-04, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/lib/nostrSync.ts` | Add `CallsSyncedSettings` interface; add `callsSettings?` to `SyncedSettings` |
| `src/store/nostrStore.ts` | Import `getSetting`/`setSetting`/`CallsSyncedSettings`; update `scheduleSettingsSync` to read TURN keys from Dexie; update hydration handler to write TURN keys to Dexie; add `triggerSettingsSync` to `NostrState` and implement it |
| `src/components/Settings/CallsTab.tsx` | Import `useNostrStore`; call `triggerSettingsSync()` after successful save |
| `src/__tests__/nostrSync.test.ts` | New — test `fetchAppSettings` deserializes `callsSettings` |
| `src/__tests__/store.test.ts` | Add test that `triggerSettingsSync` is a callable action |

---

### Task 1: Write failing test for `fetchAppSettings` parsing `callsSettings`

**Files:**
- Create: `src/__tests__/nostrSync.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// src/__tests__/nostrSync.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fetchAppSettings } from '../lib/nostrSync'
import { fetchEvent } from '../lib/nostr'
import { nip04 } from 'nostr-tools'

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>()
  return {
    ...actual,
    nip04: { ...actual.nip04, decrypt: vi.fn(), encrypt: vi.fn() },
  }
})

describe('fetchAppSettings', () => {
  it('returns callsSettings when present in the decrypted event', async () => {
    const payload = {
      callsSettings: {
        turnMode: 'metered',
        turnMetered: { subdomain: 'myproject', apiKey: 'secret' },
      },
    }
    vi.mocked(fetchEvent).mockResolvedValueOnce({
      id: 'abc123',
      pubkey: 'aabbcc',
      created_at: 1000,
      kind: 30078,
      tags: [['d', 'nostr-chat-settings']],
      content: 'encrypted-blob',
      sig: 'sig',
    })
    vi.mocked(nip04.decrypt).mockResolvedValueOnce(JSON.stringify(payload))

    const sk = new Uint8Array(32)
    const result = await fetchAppSettings(['wss://relay.example.com'], sk, 'aabbcc')

    expect(result).not.toBeNull()
    expect(result!.settings.callsSettings?.turnMode).toBe('metered')
    expect(result!.settings.callsSettings?.turnMetered?.subdomain).toBe('myproject')
    expect(result!.settings.callsSettings?.turnMetered?.apiKey).toBe('secret')
  })

  it('returns null callsSettings when not present in event', async () => {
    const payload = { notificationSettings: { enabled: true } }
    vi.mocked(fetchEvent).mockResolvedValueOnce({
      id: 'abc123',
      pubkey: 'aabbcc',
      created_at: 1000,
      kind: 30078,
      tags: [['d', 'nostr-chat-settings']],
      content: 'encrypted-blob',
      sig: 'sig',
    })
    vi.mocked(nip04.decrypt).mockResolvedValueOnce(JSON.stringify(payload))

    const sk = new Uint8Array(32)
    const result = await fetchAppSettings(['wss://relay.example.com'], sk, 'aabbcc')

    expect(result).not.toBeNull()
    expect(result!.settings.callsSettings).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- nostrSync
```

Expected: FAIL — `callsSettings` property does not exist on `SyncedSettings`

---

### Task 2: Add `CallsSyncedSettings` type and extend `SyncedSettings`

**Files:**
- Modify: `src/lib/nostrSync.ts:79-83`

- [ ] **Step 1: Add the interface and extend `SyncedSettings`**

Replace lines 79–83 in `src/lib/nostrSync.ts`:

```ts
export interface CallsSyncedSettings {
  turnMode: 'none' | 'metered' | 'custom'
  turnMetered?: { subdomain: string; apiKey: string }
  turnCustom?: { url: string; username: string; credential: string }
}

export interface SyncedSettings {
  notificationSettings?: NotificationSettings
  mutedChats?: Record<string, number | null>
  relays?: string[]
  callsSettings?: CallsSyncedSettings
}
```

- [ ] **Step 2: Run the test to confirm it passes**

```bash
npm test -- nostrSync
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/nostrSync.ts src/__tests__/nostrSync.test.ts
git commit -m "feat: add CallsSyncedSettings type to SyncedSettings"
```

---

### Task 3: Write failing test for `triggerSettingsSync` store action

**Files:**
- Modify: `src/__tests__/store.test.ts`

- [ ] **Step 1: Add the test at the end of `store.test.ts`**

```ts
describe('triggerSettingsSync', () => {
  it('is a callable action on the store', () => {
    const state = useNostrStore.getState()
    expect(typeof state.triggerSettingsSync).toBe('function')
    expect(() => state.triggerSettingsSync()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- store
```

Expected: FAIL — `state.triggerSettingsSync` is not a function

---

### Task 4: Implement `triggerSettingsSync` and update `scheduleSettingsSync` + hydration

**Files:**
- Modify: `src/store/nostrStore.ts`

- [ ] **Step 1: Add `getSetting`, `setSetting`, and `CallsSyncedSettings` to imports**

Change the import from `userDb` (line 6–11) to:

```ts
import {
  openUserDb,
  closeUserDb,
  getUserDb,
  getSetting,
  setSetting,
  setActivePubkey,
  clearActivePubkey,
} from '../lib/userDb'
```

Change the import from `nostrSync` (lines 13–19) to:

```ts
import {
  syncFromRelays,
  publishContactList,
  publishChannelBookmarks,
  publishAppSettings,
  debounce,
  type CallsSyncedSettings,
} from '../lib/nostrSync'
```

- [ ] **Step 2: Add `triggerSettingsSync` to the `NostrState` interface**

After the last action in the `NostrState` interface (line 182 `updateSeenAt`), add:

```ts
triggerSettingsSync: () => void
```

- [ ] **Step 3: Update `scheduleSettingsSync` to read TURN config from Dexie**

Replace the `scheduleSettingsSync` closure (lines 318–328) with:

```ts
const scheduleSettingsSync = () => {
  debounce('settings', () => {
    void (async () => {
      const { notificationSettings, mutedChats, relays, publicKey, getPrivateKey } = get()
      const sk = getPrivateKey()
      if (!sk || !publicKey) return
      const now = Math.floor(Date.now() / 1000)
      const [turnMode, turnMetered, turnCustom] = await Promise.all([
        getSetting<string>('turn_mode', 'none'),
        getSetting<{ subdomain: string; apiKey: string }>('turn_metered_config', { subdomain: '', apiKey: '' }),
        getSetting<{ url: string; username: string; credential: string }>('turn_custom_config', { url: '', username: '', credential: '' }),
      ])
      const callsSettings: CallsSyncedSettings = {
        turnMode: turnMode as 'none' | 'metered' | 'custom',
        turnMetered,
        turnCustom,
      }
      void publishAppSettings(sk, publicKey, { notificationSettings, mutedChats, relays, callsSettings }, relays)
        .then(() => set({ syncedSettingsAt: now }))
        .catch(() => {})
    })()
  })
}
```

- [ ] **Step 4: Update the hydration handler to write `callsSettings` to Dexie**

In the `syncFromRelays(...).then(result => {...})` block (around line 259–270), after the `set({...})` call inside the settings branch, add:

```ts
// Settings: apply only when the relay event is newer than the last one we synced
if (result.settings) {
  const lastSynced = get().syncedSettingsAt
  if (!lastSynced || result.settings.createdAt > lastSynced) {
    const s = result.settings.settings
    set({
      ...(s.notificationSettings !== undefined ? { notificationSettings: s.notificationSettings } : {}),
      ...(s.mutedChats !== undefined ? { mutedChats: s.mutedChats } : {}),
      ...(s.relays !== undefined ? { relays: s.relays } : {}),
      syncedSettingsAt: result.settings.createdAt,
    })
    if (s.callsSettings) {
      void setSetting('turn_mode', s.callsSettings.turnMode)
      if (s.callsSettings.turnMetered) void setSetting('turn_metered_config', s.callsSettings.turnMetered)
      if (s.callsSettings.turnCustom) void setSetting('turn_custom_config', s.callsSettings.turnCustom)
    }
  }
}
```

- [ ] **Step 5: Add `triggerSettingsSync` to the store's return object**

In the large return object of the `create` callback, add `triggerSettingsSync` alongside the other actions. A good place is right after `unmuteChat` (search for `unmuteChat`):

```ts
triggerSettingsSync: () => scheduleSettingsSync(),
```

- [ ] **Step 6: Run the store test to confirm it passes**

```bash
npm test -- store
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/store/nostrStore.ts src/__tests__/store.test.ts
git commit -m "feat: include TURN config in Nostr settings sync and expose triggerSettingsSync"
```

---

### Task 5: Wire `CallsTab.handleSave` to trigger Nostr sync

**Files:**
- Modify: `src/components/Settings/CallsTab.tsx`

- [ ] **Step 1: Import `useNostrStore` and read `triggerSettingsSync`**

Add the import at the top of `CallsTab.tsx` (after the existing imports on line 4):

```ts
import { useNostrStore } from '../../store/nostrStore'
```

Inside the `CallsTab` component body, add at the top alongside other state declarations:

```ts
const triggerSettingsSync = useNostrStore(s => s.triggerSettingsSync)
```

- [ ] **Step 2: Call `triggerSettingsSync` at the end of a successful save**

In `handleSave`, replace lines 255–256 (the `setSaved(true)` and `setTimeout` pair) with:

```ts
setSaved(true)
triggerSettingsSync()
setTimeout(() => setSaved(false), 2000)
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings/CallsTab.tsx
git commit -m "feat: trigger Nostr settings sync after saving TURN config"
```

---

### Task 6: Verify and close

**Files:** none modified

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 2: Run TypeScript check**

```bash
npm run build
```

Expected: no type errors, build succeeds

- [ ] **Step 3: Smoke test manually**

1. Open the app, go to Settings → Calls
2. Set TURN mode to Metered.ca, enter any subdomain/key, click Save
3. Observe the Save button briefly shows a checkmark
4. Open browser DevTools → Network, filter for WebSocket frames on a relay connection — you should see a kind 30078 event published within ~1.5 seconds of saving (the debounce delay)
5. Log out and log back in with the same key — Settings → Calls should show the same mode and subdomain pre-filled
