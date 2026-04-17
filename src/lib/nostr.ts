import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip04,
  nip19,
  SimplePool,
  type Event,
  type Filter,
} from 'nostr-tools'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr.wine',
  'wss://relay.primal.net',
]

// Key management
export function generateKeys() {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  return { sk, pk }
}

export function encodeNsec(sk: Uint8Array): string {
  return nip19.nsecEncode(sk)
}

export function encodePubkey(pk: string): string {
  return nip19.npubEncode(pk)
}

// Build kind-0 (profile) event
export function buildProfileEvent(sk: Uint8Array, profile: {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  nip05?: string
}): Event {
  return finalizeEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(profile),
  }, sk)
}

// Build kind-4 (encrypted DM) - NIP-04
export async function buildDMEvent(sk: Uint8Array, recipientPubkey: string, content: string): Promise<Event> {
  const encryptedContent = await nip04.encrypt(sk, recipientPubkey, content)
  return finalizeEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkey]],
    content: encryptedContent,
  }, sk)
}

// Decrypt kind-4 DM
export async function decryptDM(sk: Uint8Array, senderPubkey: string, encryptedContent: string): Promise<string> {
  return nip04.decrypt(sk, senderPubkey, encryptedContent)
}

// Build kind-40 (channel creation)
export function buildChannelCreateEvent(sk: Uint8Array, name: string, about: string): Event {
  return finalizeEvent({
    kind: 40,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({ name, about }),
  }, sk)
}

// Build kind-24133 (ephemeral typing indicator — not stored by relays)
export function buildTypingEvent(sk: Uint8Array, chatType: 'dm' | 'channel', chatId: string): Event {
  const tags = chatType === 'dm' ? [['p', chatId]] : [['e', chatId]]
  return finalizeEvent({
    kind: 24133,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: 'typing',
  }, sk)
}

// Build kind-42 (channel message)
export function buildChannelMessageEvent(sk: Uint8Array, content: string, channelId: string, relayUrl: string): Event {
  return finalizeEvent({
    kind: 42,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', channelId, relayUrl, 'root']],
    content,
  }, sk)
}

// Pool singleton
let pool: SimplePool | null = null

export function getPool(): SimplePool {
  if (!pool) {
    pool = new SimplePool()
  }
  return pool
}

// Fetch single event
export async function fetchEvent(relays: string[], filter: Filter): Promise<Event | null> {
  const p = getPool()
  return p.get(relays, filter)
}

// Subscribe to events with a single filter
export function subscribeEvents(
  relays: string[],
  filter: Filter,
  onEvent: (event: Event) => void,
  onEose?: () => void,
) {
  const p = getPool()
  return p.subscribeMany(relays, filter, {
    onevent: onEvent,
    oneose: onEose,
  })
}

// Publish event to relays
export async function publishEvent(relays: string[], event: Event): Promise<void> {
  const p = getPool()
  await Promise.any(p.publish(relays, event))
}

// Shorten pubkey for display
export function shortPubkey(pk: string): string {
  return pk.slice(0, 8) + '...' + pk.slice(-4)
}

// Parse profile from kind-0 event content
export interface NostrProfile {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  nip05?: string
  website?: string
  pubkey: string
}

export function parseProfile(event: Event): NostrProfile {
  try {
    const data = JSON.parse(event.content)
    return { ...data, pubkey: event.pubkey }
  } catch {
    return { pubkey: event.pubkey }
  }
}
