import type { Event } from 'nostr-tools'
import { fetchEvent, fetchEvents, publishEvent } from './nostr'
import type { Contact, NotificationSettings } from '../store/nostrStore'
import { requireSigner } from './signer'
import type { RelayModes } from './relayRouting'

// ── Kind 3 – NIP-02 contact list ─────────────────────────────────────────────

export async function buildContactListEvent(contacts: Contact[]): Promise<Event> {
  return requireSigner().signEvent({
    kind: 3,
    created_at: Math.floor(Date.now() / 1000),
    tags: contacts.filter(c => !c.pending).map(c => ['p', c.pubkey]),
    content: '',
  })
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

export async function publishContactList(contacts: Contact[], relays: string[]): Promise<void> {
  await publishEvent(relays, await buildContactListEvent(contacts))
}

// ── Kind 30001 – NIP-51 joined-channels bookmark list ────────────────────────

const CHANNELS_D_TAG = 'joined-channels'

export async function buildChannelBookmarkEvent(channelIds: string[]): Promise<Event> {
  return requireSigner().signEvent({
    kind: 30001,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', CHANNELS_D_TAG], ...channelIds.map(id => ['e', id])],
    content: '',
  })
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

export async function publishChannelBookmarks(channelIds: string[], relays: string[]): Promise<void> {
  await publishEvent(relays, await buildChannelBookmarkEvent(channelIds))
}

// ── Kind 30078 – NIP-78 app settings, NIP-04 self-encrypted ──────────────────

const SETTINGS_D_TAG = 'nostr-chat-settings'

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
  blockedPubkeys?: string[]
  dismissedRequests?: Record<string, number>
}

async function buildAppSettingsEvent(settings: SyncedSettings): Promise<Event> {
  const signer = requireSigner()
  const encrypted = await signer.nip04Encrypt(signer.pubkey, JSON.stringify(settings))
  return signer.signEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', SETTINGS_D_TAG]],
    content: encrypted,
  })
}

export async function fetchAppSettings(
  relays: string[],
): Promise<{ settings: SyncedSettings; createdAt: number } | null> {
  const signer = requireSigner()
  const event = await fetchEvent(relays, {
    kinds: [30078],
    authors: [signer.pubkey],
    '#d': [SETTINGS_D_TAG],
    limit: 1,
  })
  if (!event) return null
  try {
    const plaintext = await signer.nip04Decrypt(signer.pubkey, event.content)
    return { settings: JSON.parse(plaintext) as SyncedSettings, createdAt: event.created_at }
  } catch {
    return null
  }
}

export async function publishAppSettings(settings: SyncedSettings, relays: string[]): Promise<void> {
  await publishEvent(relays, await buildAppSettingsEvent(settings))
}

// ── Kind 30041 – self-encrypted group key backups ─────────────────────────────

export async function fetchGroupKeys(relays: string[]): Promise<Record<string, string>> {
  const signer = requireSigner()
  const events = await fetchEvents(relays, { kinds: [30041], authors: [signer.pubkey] })
  const keys: Record<string, string> = {}
  for (const event of events) {
    const groupId = event.tags.find(t => t[0] === 'd')?.[1]
    if (!groupId) continue
    try {
      keys[groupId] = await signer.nip04Decrypt(signer.pubkey, event.content)
    } catch {
      // corrupt or unrecognised - skip
    }
  }
  return keys
}

// ── Kind 10002 – NIP-65 relay list ───────────────────────────────────────────

export async function buildRelayListEvent(relays: string[], modes: RelayModes): Promise<Event> {
  const tags: string[][] = []
  for (const url of relays) {
    const m = modes[url] ?? { read: true, write: true }
    if (m.read && m.write) tags.push(['r', url])
    else if (m.read) tags.push(['r', url, 'read'])
    else if (m.write) tags.push(['r', url, 'write'])
    // neither -> omitted
  }
  return requireSigner().signEvent({
    kind: 10002,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })
}

export async function fetchRelayList(
  relays: string[],
  pubkey: string,
): Promise<{ urls: string[]; modes: RelayModes; createdAt: number } | null> {
  const event = await fetchEvent(relays, { kinds: [10002], authors: [pubkey], limit: 1 })
  if (!event) return null
  const urls: string[] = []
  const modes: RelayModes = {}
  for (const t of event.tags) {
    if (t[0] !== 'r' || !t[1]) continue
    const url = t[1]
    const marker = t[2]
    urls.push(url)
    if (marker === 'read') modes[url] = { read: true, write: false }
    else if (marker === 'write') modes[url] = { read: false, write: true }
    else modes[url] = { read: true, write: true }
  }
  if (urls.length === 0) return null
  return { urls, modes, createdAt: event.created_at }
}

export async function publishRelayList(writeRelays: string[], relays: string[], modes: RelayModes): Promise<void> {
  await publishEvent(writeRelays, await buildRelayListEvent(relays, modes))
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
  groupKeys: Record<string, string>
  relayList: { urls: string[]; modes: RelayModes; createdAt: number } | null
}

export async function syncFromRelays(relays: string[]): Promise<SyncResult> {
  const pubkey = requireSigner().pubkey
  const [contacts, channels, settings, groupKeysResult, relayList] = await Promise.allSettled([
    fetchContactList(relays, pubkey),
    fetchChannelBookmarks(relays, pubkey),
    fetchAppSettings(relays),
    fetchGroupKeys(relays),
    fetchRelayList(relays, pubkey),
  ])
  return {
    contacts: contacts.status === 'fulfilled' ? contacts.value : null,
    channels: channels.status === 'fulfilled' ? channels.value : null,
    settings: settings.status === 'fulfilled' ? settings.value : null,
    groupKeys: groupKeysResult.status === 'fulfilled' ? groupKeysResult.value : {},
    relayList: relayList.status === 'fulfilled' ? relayList.value : null,
  }
}
