import { finalizeEvent, nip04 } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import { fetchEvent, publishEvent } from './nostr'
import type { Contact, NotificationSettings } from '../store/nostrStore'

// ── Kind 3 – NIP-02 contact list ─────────────────────────────────────────────

export function buildContactListEvent(sk: Uint8Array, contacts: Contact[]): Event {
  return finalizeEvent({
    kind: 3,
    created_at: Math.floor(Date.now() / 1000),
    tags: contacts.map(c => ['p', c.pubkey]),
    content: '',
  }, sk)
}

export async function fetchContactList(
  relays: string[],
  pubkey: string,
): Promise<{ pubkeys: string[]; createdAt: number } | null> {
  const event = await fetchEvent(relays, { kinds: [3], authors: [pubkey], limit: 1 })
  if (!event) return null
  return {
    pubkeys: event.tags.filter(t => t[0] === 'p' && t[1]).map(t => t[1]),
    createdAt: event.created_at,
  }
}

export async function publishContactList(
  sk: Uint8Array,
  contacts: Contact[],
  relays: string[],
): Promise<void> {
  await publishEvent(relays, buildContactListEvent(sk, contacts))
}

// ── Kind 30001 – NIP-51 joined-channels bookmark list ────────────────────────

const CHANNELS_D_TAG = 'joined-channels'

export function buildChannelBookmarkEvent(sk: Uint8Array, channelIds: string[]): Event {
  return finalizeEvent({
    kind: 30001,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', CHANNELS_D_TAG], ...channelIds.map(id => ['e', id])],
    content: '',
  }, sk)
}

export async function fetchChannelBookmarks(
  relays: string[],
  pubkey: string,
): Promise<{ channelIds: string[]; createdAt: number } | null> {
  const event = await fetchEvent(relays, {
    kinds: [30001],
    authors: [pubkey],
    '#d': [CHANNELS_D_TAG],
    limit: 1,
  })
  if (!event) return null
  return {
    channelIds: event.tags.filter(t => t[0] === 'e' && t[1]).map(t => t[1]),
    createdAt: event.created_at,
  }
}

export async function publishChannelBookmarks(
  sk: Uint8Array,
  channelIds: string[],
  relays: string[],
): Promise<void> {
  await publishEvent(relays, buildChannelBookmarkEvent(sk, channelIds))
}

// ── Kind 30078 – NIP-78 app settings, NIP-04 self-encrypted ──────────────────

const SETTINGS_D_TAG = 'nostr-chat-settings'

export interface SyncedSettings {
  notificationSettings?: NotificationSettings
  mutedChats?: Record<string, number | null>
  relays?: string[]
}

async function buildAppSettingsEvent(
  sk: Uint8Array,
  pubkey: string,
  settings: SyncedSettings,
): Promise<Event> {
  const encrypted = await nip04.encrypt(sk, pubkey, JSON.stringify(settings))
  return finalizeEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', SETTINGS_D_TAG]],
    content: encrypted,
  }, sk)
}

export async function fetchAppSettings(
  relays: string[],
  sk: Uint8Array,
  pubkey: string,
): Promise<{ settings: SyncedSettings; createdAt: number } | null> {
  const event = await fetchEvent(relays, {
    kinds: [30078],
    authors: [pubkey],
    '#d': [SETTINGS_D_TAG],
    limit: 1,
  })
  if (!event) return null
  try {
    const plaintext = await nip04.decrypt(sk, pubkey, event.content)
    return { settings: JSON.parse(plaintext) as SyncedSettings, createdAt: event.created_at }
  } catch {
    return null
  }
}

export async function publishAppSettings(
  sk: Uint8Array,
  pubkey: string,
  settings: SyncedSettings,
  relays: string[],
): Promise<void> {
  await publishEvent(relays, await buildAppSettingsEvent(sk, pubkey, settings))
}

// ── Debounce ──────────────────────────────────────────────────────────────────

const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function debounce(key: string, fn: () => void, ms = 1500): void {
  clearTimeout(timers.get(key))
  timers.set(key, setTimeout(() => { timers.delete(key); fn() }, ms))
}

// ── On-login sync ─────────────────────────────────────────────────────────────

export interface SyncResult {
  contacts: { pubkeys: string[]; createdAt: number } | null
  channels: { channelIds: string[]; createdAt: number } | null
  settings: { settings: SyncedSettings; createdAt: number } | null
}

export async function syncFromRelays(
  sk: Uint8Array,
  pubkey: string,
  relays: string[],
): Promise<SyncResult> {
  const [contacts, channels, settings] = await Promise.allSettled([
    fetchContactList(relays, pubkey),
    fetchChannelBookmarks(relays, pubkey),
    fetchAppSettings(relays, sk, pubkey),
  ])
  return {
    contacts: contacts.status === 'fulfilled' ? contacts.value : null,
    channels: channels.status === 'fulfilled' ? channels.value : null,
    settings: settings.status === 'fulfilled' ? settings.value : null,
  }
}
