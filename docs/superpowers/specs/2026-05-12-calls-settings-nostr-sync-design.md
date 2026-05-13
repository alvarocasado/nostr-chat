# Calls Settings — Nostr Sync Design

**Date:** 2026-05-12  
**Status:** Approved

## Problem

TURN server configuration in the Calls settings page is stored exclusively in Dexie (IndexedDB, per-device). A user who configures a TURN server on one device must reconfigure it on every other device. Media device preferences are intentionally excluded — device IDs are hardware-bound and meaningless on other machines.

## Goal

Sync TURN server configuration across devices using the same kind 30078 (NIP-78) Nostr event that already syncs notifications, relays, and muted chats. No new event kinds, no new subscriptions.

## Scope

**In scope:** `turn_mode`, `turn_metered_config`, `turn_custom_config`  
**Out of scope:** `turn_config` (computed RTCIceServer[], regenerated at call time), `media_audio_device`, `media_video_device`

---

## Data Model

Extend `SyncedSettings` in `src/lib/nostrSync.ts`:

```ts
interface CallsSyncedSettings {
  turnMode: 'none' | 'metered' | 'custom'
  turnMetered?: { subdomain: string; apiKey: string }
  turnCustom?: { url: string; username: string; credential: string }
}

interface SyncedSettings {
  notificationSettings?: NotificationSettings
  mutedChats?: Record<string, number | null>
  relays?: string[]
  callsSettings?: CallsSyncedSettings  // new
}
```

All fields are optional so existing events without `callsSettings` remain valid.

---

## Publish Flow

`publishAppSettings()` in `src/lib/nostrSync.ts` reads TURN keys from Dexie at publish time (via `getSetting()`) and includes them as `callsSettings` in the encrypted event payload. No new Zustand store state is needed.

`handleSave()` in `src/components/Settings/CallsTab.tsx` already writes to Dexie. After the existing Dexie writes, it calls `scheduleSettingsSync()` from the Nostr store to trigger the debounced Nostr publish.

---

## Hydration Flow

`syncFromRelays()` already calls `fetchAppSettings()` on login. Extend the handler that applies the result to write calls settings back into Dexie when present:

```ts
if (settings.callsSettings) {
  const { turnMode, turnMetered, turnCustom } = settings.callsSettings
  await setSetting('turn_mode', turnMode)
  if (turnMetered) await setSetting('turn_metered_config', turnMetered)
  if (turnCustom)  await setSetting('turn_custom_config', turnCustom)
}
```

`CallsTab` reads from Dexie on mount via its existing `useEffect` — no changes needed there.

---

## Conflict Resolution

Last-write wins via Nostr event timestamps.

- **On login:** Nostr value overwrites Dexie. The most recently saved config wins.
- **On save:** Local writes to Dexie first, then publishes to Nostr, becoming the new authoritative version.

---

## Files Touched

| File | Change |
|------|--------|
| `src/lib/nostrSync.ts` | Add `CallsSyncedSettings` type; extend `SyncedSettings`; read TURN keys from Dexie in `publishAppSettings()`; write TURN keys to Dexie in the `fetchAppSettings` handler inside `syncFromRelays()` |
| `src/components/Settings/CallsTab.tsx` | Call `scheduleSettingsSync()` at the end of `handleSave()` |

No new event kinds, no new Zustand store fields, no new subscriptions.
